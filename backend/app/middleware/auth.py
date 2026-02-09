from uuid import UUID

from fastapi import Cookie, Depends, HTTPException, Request, status
from fastapi.security import OAuth2PasswordBearer
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import decode_access_token
from app.models.models import User, UserRole

# auto_error=False so we can fall back to cookie auth
oauth2_scheme = OAuth2PasswordBearer(tokenUrl="/api/auth/login", auto_error=False)

COOKIE_NAME = "__session"
CSRF_COOKIE_NAME = "labaid_csrf"  # Kept for reference; not used with Firebase Hosting


def get_current_user(
    request: Request,
    bearer_token: str | None = Depends(oauth2_scheme),
    db: Session = Depends(get_db),
) -> User:
    token = None

    # 1. Try Authorization header first (API clients, backward compat)
    if bearer_token:
        token = bearer_token
    else:
        # 2. Fall back to HttpOnly cookie
        token = request.cookies.get(COOKIE_NAME)

    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )

    payload = decode_access_token(token)
    if payload is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
        )
    user_id = payload.get("sub")
    if user_id is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token payload",
        )
    user = db.query(User).filter(User.id == UUID(user_id), User.is_active.is_(True)).first()
    if user is None:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )
    # Flag impersonation for audit trail attribution
    if payload.get("impersonating"):
        user._is_impersonating = True
        # Override lab_id from the JWT so all lab-scoped queries use the impersonated lab
        impersonated_lab_id = payload.get("lab_id")
        if impersonated_lab_id:
            # Expunge first so SQLAlchemy won't auto-flush this change to DB
            db.expunge(user)
            user.lab_id = UUID(impersonated_lab_id)
    return user


def require_role(*roles: UserRole):
    """Dependency that checks if the current user has one of the required roles."""

    def checker(current_user: User = Depends(get_current_user)) -> User:
        if current_user.role not in roles:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail=f"Role '{current_user.role.value}' not authorized for this action",
            )
        return current_user

    return checker
