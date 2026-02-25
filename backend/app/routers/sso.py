import logging
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Query, Request, Response
from fastapi.responses import RedirectResponse
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.config import settings
from app.core.database import get_db
from app.core.security import create_access_token, decode_access_token
from app.middleware.auth import COOKIE_NAME
from app.models.models import (
    AuthProviderType,
    ExternalIdentity,
    Lab,
    LabAuthProvider,
    User,
)
from app.routers.auth import _set_auth_cookies
from app.services.audit import log_audit
from app.services.oidc_service import exchange_code, get_authorize_url, validate_id_token

logger = logging.getLogger("labaid.sso")

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api/auth/sso", tags=["sso"])

_OIDC_TYPES = {AuthProviderType.OIDC_MICROSOFT, AuthProviderType.OIDC_GOOGLE}


def _build_redirect_uri() -> str:
    return f"{settings.APP_URL.rstrip('/')}/api/auth/sso/callback"


def _make_state(provider_id: str, nonce: str) -> str:
    """Create a signed JWT state token with 5-min expiry."""
    return create_access_token(
        {"purpose": "oidc_state", "provider_id": provider_id, "nonce": nonce},
        expires_minutes=5,
    )


def _verify_state(state: str) -> dict:
    """Verify and decode the state JWT. Raises on invalid/expired."""
    payload = decode_access_token(state)
    if not payload or payload.get("purpose") != "oidc_state":
        raise HTTPException(status_code=400, detail="Invalid SSO state parameter")
    return payload


@router.get("/{provider_type}/authorize")
@limiter.limit("10/minute")
def sso_authorize(
    request: Request,
    provider_type: str,
    email_domain: str = Query(..., description="Email domain for provider lookup"),
    login_hint: str | None = Query(None, description="Email to pre-select at the identity provider"),
    db: Session = Depends(get_db),
):
    try:
        ptype = AuthProviderType(provider_type)
    except ValueError:
        raise HTTPException(status_code=400, detail=f"Unknown provider type: {provider_type}")

    if ptype not in _OIDC_TYPES:
        raise HTTPException(status_code=400, detail=f"Provider type {provider_type} is not an OIDC provider")

    provider = db.query(LabAuthProvider).filter(
        LabAuthProvider.provider_type == ptype,
        func.lower(LabAuthProvider.email_domain) == email_domain.lower(),
        LabAuthProvider.is_enabled.is_(True),
    ).first()

    if not provider:
        raise HTTPException(status_code=404, detail="No enabled provider found for this domain")

    lab = db.query(Lab).filter(Lab.id == provider.lab_id).first()
    if not lab or not (lab.settings or {}).get("sso_enabled"):
        raise HTTPException(status_code=403, detail="SSO is not enabled for this lab")

    import secrets
    nonce = secrets.token_urlsafe(32)
    state = _make_state(str(provider.id), nonce)
    redirect_uri = _build_redirect_uri()

    authorize_url = get_authorize_url(provider, redirect_uri, state, nonce, login_hint=login_hint)
    return RedirectResponse(url=authorize_url, status_code=302)


@router.get("/callback")
@limiter.limit("10/minute")
async def sso_callback(
    request: Request,
    response: Response,
    code: str = Query(...),
    state: str = Query(...),
    db: Session = Depends(get_db),
):
    # 1. Validate state
    state_payload = _verify_state(state)
    provider_id = state_payload.get("provider_id")
    nonce = state_payload.get("nonce")

    if not provider_id or not nonce:
        raise HTTPException(status_code=400, detail="Invalid SSO state payload")

    # 2. Look up provider
    try:
        provider_uuid = UUID(provider_id)
    except (ValueError, TypeError):
        raise HTTPException(status_code=400, detail="Invalid provider ID in state")

    provider = db.query(LabAuthProvider).filter(
        LabAuthProvider.id == provider_uuid,
        LabAuthProvider.is_enabled.is_(True),
    ).first()

    if not provider:
        raise HTTPException(status_code=400, detail="SSO provider not found or disabled")

    # 3. Exchange code for tokens
    redirect_uri = _build_redirect_uri()
    try:
        token_response = await exchange_code(provider, code, redirect_uri)
    except ValueError as e:
        logger.error("SSO token exchange failed: %s", e)
        error_url = f"{settings.APP_URL.rstrip('/')}/auth/callback?error=token_exchange_failed"
        return RedirectResponse(url=error_url, status_code=302)

    id_token = token_response.get("id_token")
    if not id_token:
        logger.error("No id_token in token response")
        error_url = f"{settings.APP_URL.rstrip('/')}/auth/callback?error=no_id_token"
        return RedirectResponse(url=error_url, status_code=302)

    # 4. Validate id_token
    try:
        claims = await validate_id_token(provider, id_token, nonce)
    except ValueError as e:
        logger.error("SSO id_token validation failed: %s", e)
        error_url = f"{settings.APP_URL.rstrip('/')}/auth/callback?error=token_validation_failed"
        return RedirectResponse(url=error_url, status_code=302)

    sub = claims.get("sub")
    email = (claims.get("email") or claims.get("preferred_username") or claims.get("upn") or "").lower()
    name = claims.get("name", "")

    logger.warning("SSO claims: sub=%s, email=%s, keys=%s", sub, email, list(claims.keys()))

    if not sub or not email:
        error_url = f"{settings.APP_URL.rstrip('/')}/auth/callback?error=missing_claims"
        return RedirectResponse(url=error_url, status_code=302)

    # 5. Match user
    # First: check external_identities for exact match
    ext_identity = db.query(ExternalIdentity).filter(
        ExternalIdentity.provider_type == provider.provider_type.value,
        ExternalIdentity.provider_subject == sub,
    ).first()

    user = None
    if ext_identity:
        user = db.query(User).filter(User.id == ext_identity.user_id).first()
    else:
        # Fall back: match by email + verify user belongs to a lab with this provider
        user = db.query(User).filter(
            func.lower(User.email) == email,
            User.lab_id == provider.lab_id,
        ).first()

        if user:
            # Auto-create external_identity on first SSO login
            ext_identity = ExternalIdentity(
                user_id=user.id,
                provider_type=provider.provider_type.value,
                provider_subject=sub,
                provider_email=email,
            )
            db.add(ext_identity)

    if not user:
        logger.warning("SSO user_not_found: email=%s, provider_lab_id=%s", email, provider.lab_id)
        error_url = f"{settings.APP_URL.rstrip('/')}/auth/callback?error=user_not_found"
        return RedirectResponse(url=error_url, status_code=302)

    # 6. Check user is active
    if not user.is_active:
        error_url = f"{settings.APP_URL.rstrip('/')}/auth/callback?error=user_inactive"
        return RedirectResponse(url=error_url, status_code=302)

    # 7. Check lab is active
    lab = db.query(Lab).filter(Lab.id == user.lab_id).first()
    if lab and not lab.is_active:
        error_url = f"{settings.APP_URL.rstrip('/')}/auth/callback?error=lab_inactive"
        return RedirectResponse(url=error_url, status_code=302)

    # 8. Create JWT — same claims as password login
    token = create_access_token({
        "sub": str(user.id),
        "lab_id": str(user.lab_id) if user.lab_id else None,
        "role": user.role.value,
    })

    # 9. Audit log
    log_audit(
        db,
        lab_id=user.lab_id,
        user_id=user.id,
        action="user.login_sso",
        entity_type="user",
        entity_id=user.id,
        note=f"provider: {provider.provider_type.value}",
    )

    db.commit()

    # 10. Set cookie and redirect to dashboard
    redirect = RedirectResponse(url=f"{settings.APP_URL.rstrip('/')}/dashboard", status_code=302)
    max_age = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
    redirect.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=settings.COOKIE_SECURE,
        samesite=settings.COOKIE_SAMESITE,
        domain=settings.COOKIE_DOMAIN,
        max_age=max_age,
        path="/",
    )
    return redirect
