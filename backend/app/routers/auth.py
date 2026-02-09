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
    generate_temp_password,
    hash_password,
    verify_password,
)
from app.middleware.auth import COOKIE_NAME, get_current_user, require_role
from app.models.models import Lab, User, UserRole
from app.services.audit import log_audit, snapshot_user
from app.schemas.schemas import (
    ChangePasswordRequest,
    ImpersonateRequest,
    ImpersonateResponse,
    LoginRequest,
    ResetPasswordResponse,
    SetupRequest,
    TokenResponse,
    UserCreate,
    UserCreateResponse,
    UserOut,
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
    # Scope check: can't create users at or above your own role level
    if _ROLE_RANK.get(body.role, 0) >= _ROLE_RANK[current_user.role]:
        raise HTTPException(
            status_code=403,
            detail="Cannot create a user with equal or higher role than your own",
        )

    if current_user.role == UserRole.SUPER_ADMIN:
        if not lab_id:
            raise HTTPException(status_code=400, detail="Super admin must specify lab_id")
        target_lab_id = lab_id
    else:
        target_lab_id = current_user.lab_id

    existing = db.query(User).filter(func.lower(User.email) == body.email.lower()).first()
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")

    temp_pw = generate_temp_password()

    user = User(
        lab_id=target_lab_id,
        email=body.email.lower(),
        hashed_password=hash_password(temp_pw),
        full_name=body.full_name,
        role=body.role,
        must_change_password=True,
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

    return UserCreateResponse(
        id=user.id,
        lab_id=user.lab_id,
        email=user.email,
        full_name=user.full_name,
        role=user.role,
        is_active=user.is_active,
        must_change_password=user.must_change_password,
        temp_password=temp_pw,
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

    # Scope check: can't reset password of users at or above your role
    if _ROLE_RANK.get(target.role, 0) >= _ROLE_RANK[current_user.role]:
        raise HTTPException(
            status_code=403,
            detail="Cannot reset password of a user with equal or higher role",
        )

    temp_pw = generate_temp_password()
    target.hashed_password = hash_password(temp_pw)
    target.must_change_password = True

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

    return ResetPasswordResponse(temp_password=temp_pw)


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
    if not lab_settings.get("support_access_enabled"):
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
