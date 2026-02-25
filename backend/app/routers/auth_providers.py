from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from slowapi import Limiter
from slowapi.util import get_remote_address
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import AuthProviderType, ExternalIdentity, Lab, LabAuthProvider, User, UserRole
from app.schemas.schemas import (
    AuthProviderCreate,
    AuthProviderOut,
    AuthProviderUpdate,
    DiscoverRequest,
    DiscoverResponse,
)
from app.services.audit import log_audit
from app.services.oidc_service import store_secret

limiter = Limiter(key_func=get_remote_address)

router = APIRouter(prefix="/api/auth/providers", tags=["auth-providers"])


_REQUIRED_OIDC_FIELDS = {"client_id"}
_REQUIRED_MICROSOFT_FIELDS = {"client_id", "tenant_id"}

_PROVIDER_REQUIRED_CONFIG = {
    AuthProviderType.PASSWORD: set(),
    AuthProviderType.OIDC_GOOGLE: _REQUIRED_OIDC_FIELDS,
    AuthProviderType.OIDC_MICROSOFT: _REQUIRED_MICROSOFT_FIELDS,
    AuthProviderType.SAML: {"entity_id", "sso_url"},
}


def password_enabled(db: Session, lab_id) -> bool:
    if not lab_id:
        return True
    pw = db.query(LabAuthProvider).filter(
        LabAuthProvider.lab_id == lab_id,
        LabAuthProvider.provider_type == AuthProviderType.PASSWORD,
    ).first()
    if not pw:
        return True
    return pw.is_enabled


def _check_password_disable_safe(db: Session, lab_id: UUID) -> None:
    admins = db.query(User).filter(
        User.lab_id == lab_id,
        User.role == UserRole.LAB_ADMIN,
        User.is_active.is_(True),
    ).all()
    if not admins:
        return

    sso_types = {
        p.provider_type.value
        for p in db.query(LabAuthProvider).filter(
            LabAuthProvider.lab_id == lab_id,
            LabAuthProvider.provider_type != AuthProviderType.PASSWORD,
            LabAuthProvider.is_enabled.is_(True),
        ).all()
    }
    if not sso_types:
        raise HTTPException(
            status_code=400,
            detail="Cannot disable password: no enabled SSO provider configured for this lab",
        )

    admin_ids = [a.id for a in admins]
    admins_with_sso = db.query(ExternalIdentity).filter(
        ExternalIdentity.user_id.in_(admin_ids),
        ExternalIdentity.provider_type.in_(sso_types),
    ).count()
    if admins_with_sso == 0:
        raise HTTPException(
            status_code=400,
            detail="Cannot disable password: no lab admin has logged in via SSO yet. "
            "At least one lab admin must complete an SSO login before password can be disabled.",
        )


def _validate_provider_config(provider_type: AuthProviderType, config: dict) -> None:
    required = _PROVIDER_REQUIRED_CONFIG.get(provider_type, set())
    missing = required - set(config.keys())
    if missing:
        raise HTTPException(
            status_code=400,
            detail=f"Missing required config fields for {provider_type.value}: {', '.join(sorted(missing))}",
        )


def _store_raw_secret_if_present(config: dict, lab_id: UUID, provider_type: AuthProviderType) -> dict:
    raw = config.pop("client_secret", None)
    if raw and raw != "••••••••":
        try:
            ref = store_secret(str(lab_id), provider_type.value, raw)
        except Exception as e:
            raise HTTPException(
                status_code=502,
                detail=f"Failed to store client secret: {e}",
            )
        config["client_secret_ref"] = ref
    return config


def _sanitize_config_for_response(config: dict) -> dict:
    sanitized = dict(config)
    for key in ("client_secret", "client_secret_ref"):
        if key in sanitized:
            sanitized[key] = "••••••••"
    return sanitized


@router.get("/{lab_id}", response_model=list[AuthProviderOut])
def list_providers(
    lab_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(
        require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)
    ),
):
    if current_user.role != UserRole.SUPER_ADMIN and current_user.lab_id != lab_id:
        raise HTTPException(status_code=403, detail="Not your lab")

    providers = db.query(LabAuthProvider).filter(LabAuthProvider.lab_id == lab_id).all()
    for p in providers:
        p.config = _sanitize_config_for_response(p.config)
    return providers


@router.post("/", response_model=AuthProviderOut, status_code=status.HTTP_201_CREATED)
def create_provider(
    body: AuthProviderCreate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)),
):
    if current_user.role != UserRole.SUPER_ADMIN:
        if current_user.lab_id != body.lab_id:
            raise HTTPException(status_code=403, detail="Not your lab")

    lab = db.query(Lab).filter(Lab.id == body.lab_id).first()
    if not lab:
        raise HTTPException(status_code=404, detail="Lab not found")

    if body.provider_type != AuthProviderType.PASSWORD and not (lab.settings or {}).get("sso_enabled"):
        raise HTTPException(status_code=403, detail="SSO is not enabled for this lab")

    existing = db.query(LabAuthProvider).filter(
        LabAuthProvider.lab_id == body.lab_id,
        LabAuthProvider.provider_type == body.provider_type,
    ).first()
    if existing:
        raise HTTPException(status_code=400, detail=f"Provider {body.provider_type.value} already configured for this lab")

    if body.provider_type == AuthProviderType.PASSWORD and not body.is_enabled:
        _check_password_disable_safe(db, body.lab_id)

    _validate_provider_config(body.provider_type, body.config)
    config = _store_raw_secret_if_present(dict(body.config), body.lab_id, body.provider_type)

    provider = LabAuthProvider(
        lab_id=body.lab_id,
        provider_type=body.provider_type,
        config=config,
        email_domain=body.email_domain.lower().strip() if body.email_domain else None,
        is_enabled=body.is_enabled,
    )
    db.add(provider)
    db.flush()

    log_audit(
        db,
        lab_id=body.lab_id,
        user_id=current_user.id,
        action="auth_provider.created",
        entity_type="auth_provider",
        entity_id=provider.id,
        after_state={"provider_type": body.provider_type.value, "email_domain": provider.email_domain},
    )

    db.commit()
    db.refresh(provider)
    provider.config = _sanitize_config_for_response(provider.config)
    return provider


@router.patch("/{provider_id}", response_model=AuthProviderOut)
def update_provider(
    provider_id: UUID,
    body: AuthProviderUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)),
):
    provider = db.query(LabAuthProvider).filter(LabAuthProvider.id == provider_id).first()
    if not provider:
        raise HTTPException(status_code=404, detail="Provider not found")

    if current_user.role != UserRole.SUPER_ADMIN and current_user.lab_id != provider.lab_id:
        raise HTTPException(status_code=403, detail="Not your lab")

    if provider.provider_type != AuthProviderType.PASSWORD:
        lab = db.query(Lab).filter(Lab.id == provider.lab_id).first()
        if lab and not (lab.settings or {}).get("sso_enabled"):
            raise HTTPException(status_code=403, detail="SSO is not enabled for this lab")

    before = {"provider_type": provider.provider_type.value, "is_enabled": provider.is_enabled, "email_domain": provider.email_domain}

    if body.config is not None:
        merged = dict(provider.config)
        merged.update(body.config)
        _validate_provider_config(provider.provider_type, merged)
        merged = _store_raw_secret_if_present(merged, provider.lab_id, provider.provider_type)
        provider.config = merged

    if body.email_domain is not None:
        provider.email_domain = body.email_domain.lower().strip() if body.email_domain else None

    if body.is_enabled is not None:
        if provider.provider_type == AuthProviderType.PASSWORD and body.is_enabled is False:
            _check_password_disable_safe(db, provider.lab_id)
        provider.is_enabled = body.is_enabled

    after = {"provider_type": provider.provider_type.value, "is_enabled": provider.is_enabled, "email_domain": provider.email_domain}

    log_audit(
        db,
        lab_id=provider.lab_id,
        user_id=current_user.id,
        action="auth_provider.updated",
        entity_type="auth_provider",
        entity_id=provider.id,
        before_state=before,
        after_state=after,
    )

    db.commit()
    db.refresh(provider)
    provider.config = _sanitize_config_for_response(provider.config)
    return provider


# ── Public discovery endpoint ─────────────────────────────────────────────

discover_router = APIRouter(prefix="/api/auth", tags=["auth"])


@discover_router.post("/discover", response_model=DiscoverResponse)
@limiter.limit("10/minute")
def discover_providers(
    request: Request,
    body: DiscoverRequest,
    db: Session = Depends(get_db),
):
    email = body.email.lower()
    domain = email.split("@")[1] if "@" in email else None
    if not domain:
        return DiscoverResponse(providers=["password"])

    providers_q = db.query(LabAuthProvider).filter(
        func.lower(LabAuthProvider.email_domain) == domain,
        LabAuthProvider.is_enabled.is_(True),
    ).all()

    if not providers_q:
        return DiscoverResponse(providers=["password"])

    lab_id = providers_q[0].lab_id
    lab = db.query(Lab).filter(Lab.id == lab_id).first()
    lab_name = lab.name if lab else None
    sso_enabled = (lab.settings or {}).get("sso_enabled", False) if lab else False

    provider_types = [
        p.provider_type.value for p in providers_q
        if p.provider_type == AuthProviderType.PASSWORD or sso_enabled
    ]
    if "password" not in provider_types and password_enabled(db, lab_id):
        provider_types.insert(0, "password")

    return DiscoverResponse(providers=provider_types, lab_name=lab_name)
