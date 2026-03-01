import logging
import time
from urllib.parse import urlencode

import httpx
import jwt
from jwt.exceptions import PyJWTError

from app.models.models import AuthProviderType, LabAuthProvider

logger = logging.getLogger("labaid.oidc")

# ── Provider endpoint configs ─────────────────────────────────────────────

_PROVIDER_ENDPOINTS = {
    AuthProviderType.OIDC_MICROSOFT: {
        "authorize": "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize",
        "token": "https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token",
        "jwks": "https://login.microsoftonline.com/{tenant_id}/discovery/v2.0/keys",
        "issuer": "https://login.microsoftonline.com/{tenant_id}/v2.0",
    },
    AuthProviderType.OIDC_GOOGLE: {
        "authorize": "https://accounts.google.com/o/oauth2/v2/auth",
        "token": "https://oauth2.googleapis.com/token",
        "jwks": "https://www.googleapis.com/oauth2/v3/certs",
        "issuer": "https://accounts.google.com",
    },
}

OIDC_SCOPES = "openid email profile"

# ── JWKS cache (in-memory, 1-hour TTL) ───────────────────────────────────

_jwks_cache: dict[str, tuple[dict, float]] = {}
_JWKS_TTL = 3600  # 1 hour


def _get_endpoints(provider: LabAuthProvider) -> dict[str, str]:
    base = _PROVIDER_ENDPOINTS[provider.provider_type]
    tenant_id = provider.config.get("tenant_id", "common")
    return {k: v.format(tenant_id=tenant_id) for k, v in base.items()}


# ── Secret resolution ─────────────────────────────────────────────────────

def store_secret(lab_id: str, provider_type: str, raw_secret: str) -> str:
    from app.core.config import settings
    project = settings.GCP_PROJECT
    if not project:
        raise ValueError("GCP_PROJECT not configured — cannot store secrets")

    from google.cloud import secretmanager
    client = secretmanager.SecretManagerServiceClient()

    secret_id = f"labaid-sso-{lab_id}-{provider_type}"
    parent = f"projects/{project}"
    secret_path = f"{parent}/secrets/{secret_id}"

    try:
        client.get_secret(request={"name": secret_path})
    except Exception:
        client.create_secret(request={
            "parent": parent,
            "secret_id": secret_id,
            "secret": {"replication": {"automatic": {}}},
        })

    version = client.add_secret_version(
        request={
            "parent": secret_path,
            "payload": {"data": raw_secret.encode("UTF-8")},
        }
    )
    return version.name


def resolve_secret(provider: LabAuthProvider) -> str | None:
    config = provider.config
    ref = config.get("client_secret_ref")
    if ref and ref.startswith("projects/"):
        try:
            from google.cloud import secretmanager
            client = secretmanager.SecretManagerServiceClient()
            response = client.access_secret_version(request={"name": ref})
            return response.payload.data.decode("UTF-8")
        except Exception:
            logger.exception("Failed to resolve secret from GCP: %s", ref)
            return None
    return config.get("client_secret")


# ── JWKS fetching ─────────────────────────────────────────────────────────

async def _fetch_jwks(jwks_uri: str) -> dict:
    now = time.time()
    cached = _jwks_cache.get(jwks_uri)
    if cached and (now - cached[1]) < _JWKS_TTL:
        return cached[0]

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(jwks_uri)
        resp.raise_for_status()
        jwks = resp.json()

    _jwks_cache[jwks_uri] = (jwks, now)
    return jwks


# ── Authorize URL generation ──────────────────────────────────────────────

def get_authorize_url(
    provider: LabAuthProvider,
    redirect_uri: str,
    state: str,
    nonce: str,
    login_hint: str | None = None,
) -> str:
    endpoints = _get_endpoints(provider)
    params = {
        "client_id": provider.config["client_id"],
        "response_type": "code",
        "redirect_uri": redirect_uri,
        "scope": OIDC_SCOPES,
        "state": state,
        "nonce": nonce,
    }
    if login_hint:
        params["login_hint"] = login_hint
    else:
        params["prompt"] = "select_account"
    return f"{endpoints['authorize']}?{urlencode(params)}"


# ── Code → token exchange ─────────────────────────────────────────────────

async def exchange_code(
    provider: LabAuthProvider,
    code: str,
    redirect_uri: str,
) -> dict:
    endpoints = _get_endpoints(provider)
    client_secret = resolve_secret(provider)
    if not client_secret:
        raise ValueError("Client secret not configured or could not be resolved")

    data = {
        "client_id": provider.config["client_id"],
        "client_secret": client_secret,
        "code": code,
        "redirect_uri": redirect_uri,
        "grant_type": "authorization_code",
    }

    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.post(endpoints["token"], data=data)
        if resp.status_code != 200:
            logger.error("Token exchange failed: %s %s", resp.status_code, resp.text)
            raise ValueError(f"Token exchange failed: {resp.status_code}")
        return resp.json()


# ── id_token validation ───────────────────────────────────────────────────

async def validate_id_token(
    provider: LabAuthProvider,
    id_token: str,
    nonce: str,
) -> dict:
    endpoints = _get_endpoints(provider)
    jwks = await _fetch_jwks(endpoints["jwks"])

    # Extract the key ID from the token header to find the right key
    unverified_header = jwt.get_unverified_header(id_token)
    kid = unverified_header.get("kid")

    rsa_key = None
    for key in jwks.get("keys", []):
        if key.get("kid") == kid:
            rsa_key = key
            break

    if not rsa_key:
        raise ValueError("Unable to find matching JWKS key for id_token")

    try:
        signing_key = jwt.PyJWK(rsa_key).key
        claims = jwt.decode(
            id_token,
            signing_key,
            algorithms=["RS256"],
            audience=provider.config["client_id"],
            issuer=endpoints["issuer"],
        )
    except PyJWTError as e:
        raise ValueError(f"id_token validation failed: {e}")

    # Validate nonce
    if claims.get("nonce") != nonce:
        raise ValueError("id_token nonce mismatch")

    # Provider-specific validation
    if provider.provider_type == AuthProviderType.OIDC_GOOGLE:
        hd = claims.get("hd")
        if provider.email_domain and hd != provider.email_domain:
            raise ValueError(
                f"Google hosted domain mismatch: expected {provider.email_domain}, got {hd}"
            )

    if provider.provider_type == AuthProviderType.OIDC_MICROSOFT:
        # For multi-tenant apps (tenant_id="common" or "organizations"),
        # validate the tid claim matches the provider config
        config_tenant = provider.config.get("tenant_id", "")
        if config_tenant not in ("common", "organizations"):
            tid = claims.get("tid")
            if tid and tid != config_tenant:
                raise ValueError(
                    f"Microsoft tenant mismatch: expected {config_tenant}, got {tid}"
                )

    return claims
