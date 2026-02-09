import logging
import time
from datetime import datetime, timezone
from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from sqlalchemy import text
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.config import settings
from app.core.database import SessionLocal
from app.core.security import create_access_token, decode_access_token
from app.middleware.auth import COOKIE_NAME, CSRF_COOKIE_NAME
from app.models.models import Lab, UserRole
from app.routers.auth import _set_auth_cookies

from app.routers import antibodies, audit, auth, lots, lot_requests, scan, search, storage, vials, labs, documents, fluorochromes, tickets

# ── Structured JSON logging ──────────────────────────────────────────────

logger = logging.getLogger("labaid")


class JSONFormatter(logging.Formatter):
    def format(self, record: logging.LogRecord) -> str:
        import json
        log = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "logger": record.name,
            "message": record.getMessage(),
        }
        if record.exc_info and record.exc_info[0]:
            log["exception"] = self.formatException(record.exc_info)
        return json.dumps(log)


def configure_logging() -> None:
    handler = logging.StreamHandler()
    handler.setFormatter(JSONFormatter())
    root = logging.getLogger()
    root.handlers.clear()
    root.addHandler(handler)
    root.setLevel(logging.INFO)
    # Reduce noise from third-party libs
    logging.getLogger("uvicorn.access").setLevel(logging.WARNING)
    logging.getLogger("botocore").setLevel(logging.WARNING)
    logging.getLogger("boto3").setLevel(logging.WARNING)


configure_logging()


# ── Paths exempt from suspension / CSRF ──────────────────────────────────

_SUSPENSION_EXEMPT = {
    "/api/auth/login",
    "/api/auth/logout",
    "/api/auth/change-password",
    "/api/auth/me",
    "/api/auth/setup",
    "/api/auth/impersonate",
    "/api/auth/end-impersonate",
    "/api/health",
}


def _extract_token(request: Request) -> str | None:
    """Extract JWT from Authorization header or HttpOnly cookie."""
    auth_header = request.headers.get("authorization", "")
    if auth_header.startswith("Bearer "):
        return auth_header[7:]
    return request.cookies.get(COOKIE_NAME)


def _is_cookie_auth(request: Request) -> bool:
    """True if the request is authenticated via cookie (not Bearer header)."""
    auth_header = request.headers.get("authorization", "")
    return not auth_header.startswith("Bearer ") and COOKIE_NAME in request.cookies


# ── Middleware ────────────────────────────────────────────────────────────


class CSRFMiddleware(BaseHTTPMiddleware):
    """Validate CSRF token on state-changing requests using cookie auth."""

    async def dispatch(self, request: Request, call_next):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)

        if not _is_cookie_auth(request):
            return await call_next(request)

        csrf_cookie = request.cookies.get(CSRF_COOKIE_NAME)
        csrf_header = request.headers.get("x-csrf-token")

        if not csrf_cookie or not csrf_header or csrf_cookie != csrf_header:
            return JSONResponse(
                status_code=403,
                content={"detail": "CSRF validation failed"},
            )

        return await call_next(request)


class SlidingWindowMiddleware(BaseHTTPMiddleware):
    """Extend session by reissuing JWT cookie when past 50% of lifetime."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)

        if not _is_cookie_auth(request):
            return response

        token = request.cookies.get(COOKIE_NAME)
        if not token:
            return response

        payload = decode_access_token(token)
        if not payload:
            return response

        exp = payload.get("exp")
        if not exp:
            return response

        total_lifetime = settings.ACCESS_TOKEN_EXPIRE_MINUTES * 60
        remaining = exp - time.time()

        # Reissue if past 50% of lifetime
        if remaining < total_lifetime * 0.5:
            new_token = create_access_token({
                "sub": payload["sub"],
                "lab_id": payload.get("lab_id"),
                "role": payload.get("role"),
                "impersonating": payload.get("impersonating"),
            })
            _set_auth_cookies(response, new_token)

        return response


class SecurityHeadersMiddleware(BaseHTTPMiddleware):
    """Add security headers to all responses."""

    async def dispatch(self, request: Request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "strict-origin-when-cross-origin"
        response.headers["X-XSS-Protection"] = "1; mode=block"
        if settings.COOKIE_SECURE:
            response.headers["Strict-Transport-Security"] = "max-age=31536000; includeSubDomains"
        return response


# Simple TTL cache for lab suspension status
_suspension_cache: dict[str, tuple[bool, float]] = {}
_SUSPENSION_TTL = 60  # seconds


class LabSuspensionMiddleware(BaseHTTPMiddleware):
    """Block write operations for suspended labs. Read-only access is preserved."""

    async def dispatch(self, request: Request, call_next):
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)

        if request.url.path in _SUSPENSION_EXEMPT:
            return await call_next(request)

        token = _extract_token(request)
        if not token:
            return await call_next(request)

        payload = decode_access_token(token)
        if not payload:
            return await call_next(request)

        if payload.get("role") == UserRole.SUPER_ADMIN.value:
            return await call_next(request)

        lab_id_str = payload.get("lab_id")
        if not lab_id_str:
            return await call_next(request)

        # Check TTL cache first
        now = time.time()
        cached = _suspension_cache.get(lab_id_str)
        if cached and (now - cached[1]) < _SUSPENSION_TTL:
            is_active = cached[0]
        else:
            db = SessionLocal()
            try:
                lab = db.query(Lab).filter(Lab.id == UUID(lab_id_str)).first()
                is_active = lab.is_active if lab else True
            finally:
                db.close()
            _suspension_cache[lab_id_str] = (is_active, now)

        if not is_active:
            return JSONResponse(
                status_code=403,
                content={"detail": "Lab is suspended. Read-only access only."},
            )

        return await call_next(request)


# ── App setup ─────────────────────────────────────────────────────────────

from slowapi import _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from app.routers.auth import limiter

app = FastAPI(title="LabAid - Flow Cytometry Inventory", version="1.0.0")
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)

# Google Cloud Error Reporting (enabled when GCP_PROJECT is set)
if settings.GCP_PROJECT:
    try:
        from google.cloud import error_reporting
        _error_client = error_reporting.Client(project=settings.GCP_PROJECT)

        @app.exception_handler(Exception)
        async def gcp_error_handler(request: Request, exc: Exception):
            _error_client.report_exception()
            logger.exception("Unhandled exception: %s %s", request.method, request.url.path)
            return JSONResponse(status_code=500, content={"detail": "Internal server error"})

        logger.info("Google Cloud Error Reporting enabled for project: %s", settings.GCP_PROJECT)
    except ImportError:
        logger.warning("google-cloud-error-reporting not installed; GCP_PROJECT is set but reporting is disabled")

# Middleware order: outermost runs first
# SecurityHeaders → SlidingWindow → CSRF → Suspension → CORS
app.add_middleware(SecurityHeadersMiddleware)
app.add_middleware(SlidingWindowMiddleware)
app.add_middleware(CSRFMiddleware)
app.add_middleware(LabSuspensionMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=[o.strip() for o in settings.CORS_ORIGINS.split(",")],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth.router)
app.include_router(labs.router)
app.include_router(antibodies.router)
app.include_router(lots.router)
app.include_router(vials.router)
app.include_router(storage.router)
app.include_router(scan.router)
app.include_router(audit.router)
app.include_router(documents.router)
app.include_router(fluorochromes.router)
app.include_router(tickets.router)
app.include_router(search.router)
app.include_router(lot_requests.router)


@app.get("/api/health")
def health():
    checks: dict = {}

    # Database connectivity
    db = SessionLocal()
    try:
        db.execute(text("SELECT 1"))
        checks["database"] = "ok"
    except Exception:
        checks["database"] = "error"
    finally:
        db.close()

    # Object storage connectivity
    from app.services.object_storage import object_storage

    if object_storage.enabled:
        try:
            object_storage._client.head_bucket(Bucket=object_storage._bucket)
            checks["storage"] = "ok"
        except Exception:
            checks["storage"] = "error"
    else:
        checks["storage"] = "disabled"

    overall = "ok" if all(v == "ok" or v == "disabled" for v in checks.values()) else "degraded"
    return {"status": overall, "checks": checks}
