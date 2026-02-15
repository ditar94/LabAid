import secrets
from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, Response, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import (
    create_access_token,
    generate_invite_token,
    generate_temp_password,
    hash_password,
    verify_password,
)
from app.middleware.auth import COOKIE_NAME, get_current_user, require_role
from app.models.models import Lab, User, UserRole
from app.services.audit import log_audit, snapshot_user
from app.services.email import send_invite_email, send_reset_email
from app.schemas.schemas import (
    AcceptInviteRequest,
    ChangePasswordRequest,
    ImpersonateRequest,
    ImpersonateResponse,
    LoginRequest,
    ResetPasswordResponse,
    RoleUpdateRequest,
    SetupRequest,
    TokenResponse,
    UserCreate,
    UserCreateResponse,
    UserOut,
    UserUpdateRequest,
)

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api/auth", tags=["auth"])

# Role hierarchy for scope checks (higher index = higher privilege)
_ROLE_RANK = {
    UserRole.READ_ONLY: 0,
    UserRole.TECH: 1,
    UserRole.SUPERVISOR: 2,
    UserRole.LAB_ADMIN: 3,
    UserRole.SUPER_ADMIN: 4,
}

MIN_PASSWORD_LENGTH = 8


def _set_auth_cookies(response: Response, token: str) -> None:
    """Set HttpOnly JWT cookie on the response.

    CSRF protection is handled by SameSite=lax (Firebase Hosting strips
    all cookies except __session, so double-submit CSRF cookies won't work).
    """
    max_age = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        max_age=max_age,
        path="/",
    )


def _clear_auth_cookies(response: Response) -> None:
    """Clear auth cookies."""
    response.delete_cookie(key=COOKIE_NAME, path="/", domain=settings.COOKIE_DOMAIN)


@router.post("/login", response_model=TokenResponse)
@limiter.limit("5/minute")
def login(request: Request, response: Response, body: LoginRequest, db: Session = Depends(get_db)):
    user = db.query(User).filter(func.lower(User.email) == body.email.lower(), User.is_active.is_(True)).first()
    if not user or not verify_password(body.password, user.hashed_password):
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid credentials",
        )
    token = create_access_token(
        {"sub": str(user.id), "lab_id": str(user.lab_id) if user.lab_id else None, "role": user.role.value}
    )
    _set_auth_cookies(response, token)
    # Still return token in body for backward compatibility (mobile clients, etc.)
    return TokenResponse(access_token=token)


@router.post("/logout")
def logout(response: Response):
    """Clear auth cookies."""
    _clear_auth_cookies(response)
    return {"detail": "Logged out"}


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return current_user


@router.post("/setup", response_model=UserOut)
def initial_setup(body: SetupRequest, response: Response, db: Session = Depends(get_db)):
    """One-time setup: create the platform super admin. Only works if no super admin exists."""
    existing = db.query(User).filter(User.role == UserRole.SUPER_ADMIN).first()
    if existing:
        raise HTTPException(status_code=400, detail="Setup already completed")

    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )

    user = User(
        lab_id=None,
        email=body.email.lower(),
        hashed_password=hash_password(body.password),
        full_name=body.full_name,
        role=UserRole.SUPER_ADMIN,
        must_change_password=False,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    # Auto-login after setup
    token = create_access_token(
        {"sub": str(user.id), "lab_id": None, "role": user.role.value}
    )
    _set_auth_cookies(response, token)

    return user


@router.post("/users", response_model=UserCreateResponse)
def create_user(
    body: UserCreate,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)
    ),
):
    # Scope check: can't create users above your own role level
    if _ROLE_RANK.get(body.role, 0) > _ROLE_RANK[current_user.role]:
        raise HTTPException(
            status_code=403,
            detail="Cannot create a user with a higher role than your own",
        )
    # Only super admin can create other super admins
    if body.role == UserRole.SUPER_ADMIN and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only super admins can create super admins")

    if current_user.role == UserRole.SUPER_ADMIN:
        if not lab_id:
            raise HTTPException(status_code=400, detail="Super admin must specify lab_id")
        target_lab_id = lab_id
    else:
        target_lab_id = current_user.lab_id

    existing = db.query(User).filter(func.lower(User.email) == body.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    invite_token = generate_invite_token()

    user = User(
        lab_id=target_lab_id,
        email=body.email.lower(),
        hashed_password=hash_password(secrets.token_urlsafe(32)),
        full_name=body.full_name,
        role=body.role,
        must_change_password=True,
        invite_token=invite_token,
        invite_token_expires_at=datetime.now(timezone.utc) + timedelta(hours=24),
    )
    db.add(user)
    db.flush()

    log_audit(
        db,
        lab_id=target_lab_id,
        user_id=current_user.id,
        action="user.created",
        entity_type="user",
        entity_id=user.id,
        after_state=snapshot_user(user),
    )

    db.commit()
    db.refresh(user)

    success, link = send_invite_email(user.email, user.full_name, invite_token)

    return UserCreateResponse(
        id=user.id,
        lab_id=user.lab_id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        invite_sent=success,
        set_password_link=link if settings.EMAIL_BACKEND == "console" else None,
    )


@router.get("/users", response_model=list[UserOut])
def list_users(
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)
    ),
):
    if current_user.role == UserRole.SUPER_ADMIN:
        if not lab_id:
            raise HTTPException(status_code=400, detail="Super admin must specify lab_id")
        return db.query(User).filter(User.lab_id == lab_id).all()
    return db.query(User).filter(User.lab_id == current_user.lab_id).all()


@router.post("/users/{user_id}/reset-password", response_model=ResetPasswordResponse)
def reset_password(
    user_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)
    ),
):
    q = db.query(User).filter(User.id == user_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(User.lab_id == current_user.lab_id)
    target = q.first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Scope check: can't reset password of users above your role
    if _ROLE_RANK.get(target.role, 0) > _ROLE_RANK[current_user.role]:
        raise HTTPException(
            status_code=403,
            detail="Cannot reset password of a user with a higher role",
        )

    invite_token = generate_invite_token()
    target.hashed_password = hash_password(secrets.token_urlsafe(32))
    target.must_change_password = True
    target.invite_token = invite_token
    target.invite_token_expires_at = datetime.now(timezone.utc) + timedelta(hours=24)

    log_audit(
        db,
        lab_id=target.lab_id or current_user.lab_id,
        user_id=current_user.id,
        action="user.password_reset",
        entity_type="user",
        entity_id=target.id,
        note=f"Password reset by {current_user.email}",
    )

    db.commit()

    success, link = send_reset_email(target.email, target.full_name, invite_token)

    return ResetPasswordResponse(
        email_sent=success,
        set_password_link=link if settings.EMAIL_BACKEND == "console" else None,
    )


@router.post("/accept-invite", response_model=TokenResponse)
@limiter.limit("5/minute")
def accept_invite(
    request: Request,
    response: Response,
    body: AcceptInviteRequest,
    db: Session = Depends(get_db),
):
    if len(body.password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )

    user = db.query(User).filter(
        User.invite_token == body.token,
        User.is_active.is_(True),
    ).first()
    if not user:
        raise HTTPException(status_code=400, detail="Invalid or expired invite link")

    if user.invite_token_expires_at:
        expires = user.invite_token_expires_at
        now = datetime.now(timezone.utc)
        # Handle naive datetimes (e.g. from SQLite) by assuming UTC
        if expires.tzinfo is None:
            expires = expires.replace(tzinfo=timezone.utc)
        if expires < now:
            raise HTTPException(status_code=400, detail="Invalid or expired invite link")

    user.hashed_password = hash_password(body.password)
    user.invite_token = None
    user.invite_token_expires_at = None
    user.must_change_password = False

    log_audit(
        db,
        lab_id=user.lab_id or user.id,
        user_id=user.id,
        action="user.password_set_via_invite",
        entity_type="user",
        entity_id=user.id,
    )

    db.commit()

    token = create_access_token(
        {"sub": str(user.id), "lab_id": str(user.lab_id) if user.lab_id else None, "role": user.role.value}
    )
    _set_auth_cookies(response, token)
    return TokenResponse(access_token=token)


@router.patch("/users/{user_id}/role", response_model=UserOut)
def update_user_role(
    user_id: UUID,
    body: RoleUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)
    ),
):
    q = db.query(User).filter(User.id == user_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(User.lab_id == current_user.lab_id)
    target = q.first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    # Can't change your own role
    if target.id == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot change your own role")

    # Can't assign a role above your own
    if _ROLE_RANK.get(body.role, 0) > _ROLE_RANK[current_user.role]:
        raise HTTPException(status_code=403, detail="Cannot assign a role higher than your own")

    # Only super admin can assign super admin
    if body.role == UserRole.SUPER_ADMIN and current_user.role != UserRole.SUPER_ADMIN:
        raise HTTPException(status_code=403, detail="Only super admins can assign super admin role")

    before = snapshot_user(target)
    target.role = body.role
    log_audit(
        db,
        lab_id=target.lab_id or current_user.lab_id,
        user_id=current_user.id,
        action="user.role_changed",
        entity_type="user",
        entity_id=target.id,
        before_state=before,
        after_state=snapshot_user(target),
        note=f"Role changed from {before['role']} to {body.role.value} by {current_user.email}",
    )
    db.commit()
    db.refresh(target)
    return target


@router.patch("/users/{user_id}", response_model=UserOut)
def update_user(
    user_id: UUID,
    body: UserUpdateRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)
    ),
):
    q = db.query(User).filter(User.id == user_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(User.lab_id == current_user.lab_id)
    target = q.first()
    if not target:
        raise HTTPException(status_code=404, detail="User not found")

    if target.id == current_user.id:
        raise HTTPException(status_code=403, detail="Cannot modify your own account here")

    if _ROLE_RANK.get(target.role, 0) >= _ROLE_RANK[current_user.role]:
        raise HTTPException(status_code=403, detail="Cannot modify a user with equal or higher role")

    before = snapshot_user(target)
    changes: list[str] = []

    if body.email is not None:
        new_email = body.email.lower()
        if new_email != target.email:
            existing = db.query(User).filter(
                func.lower(User.email) == new_email, User.id != target.id
            ).first()
            if existing:
                raise HTTPException(status_code=400, detail="Email already registered")
            target.email = new_email
            changes.append(f"email changed from {before['email']} to {new_email}")

    if body.is_active is not None and body.is_active != target.is_active:
        target.is_active = body.is_active
        changes.append("deactivated" if not body.is_active else "reactivated")

    if not changes:
        return target

    log_audit(
        db,
        lab_id=target.lab_id or current_user.lab_id,
        user_id=current_user.id,
        action="user.updated",
        entity_type="user",
        entity_id=target.id,
        before_state=before,
        after_state=snapshot_user(target),
        note=f"{'; '.join(changes)} by {current_user.email}",
    )
    db.commit()
    db.refresh(target)
    return target


@router.post("/change-password")
def change_password(
    body: ChangePasswordRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    if len(body.new_password) < MIN_PASSWORD_LENGTH:
        raise HTTPException(
            status_code=400,
            detail=f"Password must be at least {MIN_PASSWORD_LENGTH} characters",
        )

    current_user.hashed_password = hash_password(body.new_password)
    current_user.must_change_password = False

    log_audit(
        db,
        lab_id=current_user.lab_id or current_user.id,
        user_id=current_user.id,
        action="user.password_changed",
        entity_type="user",
        entity_id=current_user.id,
    )

    db.commit()

    # Issue new cookie with fresh token
    token = create_access_token(
        {"sub": str(current_user.id), "lab_id": str(current_user.lab_id) if current_user.lab_id else None, "role": current_user.role.value}
    )
    _set_auth_cookies(response, token)

    return {"detail": "Password changed successfully"}


@router.post("/impersonate", response_model=ImpersonateResponse)
def impersonate_lab(
    body: ImpersonateRequest,
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    """Generate a support JWT scoped to a specific lab for troubleshooting."""
    lab = db.query(Lab).filter(Lab.id == body.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")

    lab_settings = lab.settings or {}
    has_users = db.query(User).filter(User.lab_id == lab.id).count() > 0
    if has_users and not lab_settings.get("support_access_enabled"):
        raise HTTPException(
            status_code=403,
            detail="Support access is not enabled for this lab",
        )

    # Generate a JWT with the lab_id and impersonating flag
    token = create_access_token({
        "sub": str(current_user.id),
        "lab_id": str(lab.id),
        "role": UserRole.SUPER_ADMIN.value,
        "impersonating": True,
    })

    _set_auth_cookies(response, token)

    log_audit(
        db,
        lab_id=lab.id,
        user_id=current_user.id,
        action="support.impersonate_start",
        entity_type="lab",
        entity_id=lab.id,
        is_support_action=True,
    )
    db.commit()

    return ImpersonateResponse(token=token, lab_id=lab.id, lab_name=lab.name)


@router.post("/end-impersonate")
def end_impersonate(
    response: Response,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    """End impersonation and return a clean super admin JWT."""
    # Log the end of impersonation if currently impersonating
    if getattr(current_user, "_is_impersonating", False) and current_user.lab_id:
        log_audit(
            db,
            lab_id=current_user.lab_id,
            user_id=current_user.id,
            action="support.impersonate_end",
            entity_type="lab",
            entity_id=current_user.lab_id,
            is_support_action=True,
        )
        db.commit()

    # Generate a clean super admin token (no lab_id, no impersonating)
    token = create_access_token({
        "sub": str(current_user.id),
        "lab_id": None,
        "role": UserRole.SUPER_ADMIN.value,
    })

    _set_auth_cookies(response, token)

    return {"token": token}
