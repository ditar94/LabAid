from uuid import UUID

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.core.database import SessionLocal
from app.core.security import decode_access_token
from app.models.models import Lab, User, UserRole

from app.routers import antibodies, audit, auth, lots, scan, search, storage, vials, labs, documents, fluorochromes, tickets


# Paths exempt from lab suspension check (auth operations)
_SUSPENSION_EXEMPT = {
    "/api/auth/login",
    "/api/auth/change-password",
    "/api/auth/me",
    "/api/auth/setup",
    "/api/auth/impersonate",
    "/api/auth/end-impersonate",
    "/api/health",
}


class LabSuspensionMiddleware(BaseHTTPMiddleware):
    """Block write operations for suspended labs. Read-only access is preserved."""

    async def dispatch(self, request: Request, call_next):
        # Allow GET/HEAD/OPTIONS — read-only access always permitted
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return await call_next(request)

        # Allow exempt paths
        if request.url.path in _SUSPENSION_EXEMPT:
            return await call_next(request)

        # Extract token from Authorization header
        auth_header = request.headers.get("authorization", "")
        if not auth_header.startswith("Bearer "):
            return await call_next(request)

        token = auth_header[7:]
        payload = decode_access_token(token)
        if not payload:
            return await call_next(request)

        # Super admins bypass suspension check
        if payload.get("role") == UserRole.SUPER_ADMIN.value:
            return await call_next(request)

        lab_id_str = payload.get("lab_id")
        if not lab_id_str:
            return await call_next(request)

        # Check lab.is_active
        db = SessionLocal()
        try:
            lab = db.query(Lab).filter(Lab.id == UUID(lab_id_str)).first()
            if lab and not lab.is_active:
                return JSONResponse(
                    status_code=403,
                    content={"detail": "Lab is suspended. Read-only access only."},
                )
        finally:
            db.close()

        return await call_next(request)


app = FastAPI(title="LabAid - Flow Cytometry Inventory", version="1.0.0")

app.add_middleware(LabSuspensionMiddleware)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173"],  # Vite dev server
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


@app.get("/api/health")
def health():
    return {"status": "ok"}
