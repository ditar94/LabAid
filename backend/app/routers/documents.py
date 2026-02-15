import hashlib
import io
import logging
import mimetypes
import os
import uuid as uuid_mod
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy.orm import Session
from starlette.responses import FileResponse, RedirectResponse

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import Lot, LotDocument, User, UserRole
from app.core.config import settings
from app.schemas.schemas import LotDocumentOut, LotDocumentUpdate
from app.routers.auth import limiter
from app.services.audit import log_audit
from app.services.object_storage import object_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/documents", tags=["documents"])

UPLOAD_DIR = "uploads"

MAX_UPLOAD_BYTES = settings.MAX_UPLOAD_SIZE_MB * 1024 * 1024

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "image/jpeg",
    "image/png",
    "image/gif",
    "image/webp",
    "text/csv",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/vnd.ms-excel",
    "application/msword",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}

# Fallback: allow upload if the file extension is recognized (browsers can misidentify MIME types)
ALLOWED_EXTENSIONS = {
    ".pdf", ".jpg", ".jpeg", ".png", ".gif", ".webp",
    ".csv", ".xlsx", ".xls", ".doc", ".docx",
}

GENERIC_CONTENT_TYPES = {
    "",
    "application/octet-stream",
    "binary/octet-stream",
}

EXTENSION_CONTENT_TYPES = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".csv": "text/csv",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".xls": "application/vnd.ms-excel",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
}


def _normalize_content_type(file_name: str | None, raw_content_type: str | None) -> str:
    """Prefer explicit type, but repair generic MIME values using file extension."""
    content_type = (raw_content_type or "").strip().lower()
    if content_type and content_type not in GENERIC_CONTENT_TYPES:
        return content_type

    ext = os.path.splitext(file_name or "")[1].lower()
    if ext in EXTENSION_CONTENT_TYPES:
        return EXTENSION_CONTENT_TYPES[ext]

    guessed = mimetypes.guess_type(file_name or "")[0]
    if guessed:
        return guessed

    if content_type:
        return content_type
    return "application/octet-stream"


def _snapshot_document(doc: LotDocument) -> dict:
    return {
        "id": str(doc.id),
        "lot_id": str(doc.lot_id),
        "file_name": doc.file_name,
        "description": doc.description,
        "is_qc_document": doc.is_qc_document,
    }


@router.post("/lots/{lot_id}", response_model=LotDocumentOut)
@limiter.limit("10/minute")
def upload_lot_document(
    request: Request,
    lot_id: UUID,
    file: UploadFile = File(...),
    description: str | None = Form(None),
    is_qc_document: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    # Validate MIME type (fall back to extension if browser misidentifies)
    ext = os.path.splitext(file.filename or "")[1].lower()
    mime_ok = not file.content_type or file.content_type in ALLOWED_MIME_TYPES
    ext_ok = ext in ALLOWED_EXTENSIONS
    if not mime_ok and not ext_ok:
        raise HTTPException(status_code=400, detail=f"File type '{file.content_type}' is not allowed")

    # Read file content and validate size
    file_bytes = file.file.read()
    size = len(file_bytes)
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB}MB limit")

    # Compute SHA-256 checksum
    checksum = hashlib.sha256(file_bytes).hexdigest()

    q = db.query(Lot).filter(Lot.id == lot_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Lot.lab_id == current_user.lab_id)
    lot = q.first()
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")

    doc_id = uuid_mod.uuid4()
    mime = _normalize_content_type(file.filename, file.content_type)

    if object_storage.enabled:
        key = f"{lot.lab_id}/{lot.id}/{doc_id}_{file.filename}"
        file_data = io.BytesIO(file_bytes)
        try:
            object_storage.upload(
                key,
                file_data,
                content_type=mime,
                tags={"storage-class": "hot", "lab-active": "true"},
            )
        except Exception:
            logger.exception("Failed to upload document to object storage: %s", key)
            raise HTTPException(status_code=502, detail="File upload failed. Please try again.")
        stored_path = key
    else:
        logger.warning("S3 not configured — writing to local filesystem (not suitable for production)")
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        stored_path = os.path.join(UPLOAD_DIR, f"{lot.id}_{file.filename}")
        with open(stored_path, "wb") as buffer:
            buffer.write(file_bytes)

    desc = description.strip() if description else None
    doc = LotDocument(
        id=doc_id,
        lot_id=lot.id,
        lab_id=lot.lab_id,
        user_id=current_user.id,
        file_path=stored_path,
        file_name=file.filename,
        file_size=size,
        content_type=mime,
        checksum_sha256=checksum,
        description=desc,
        is_qc_document=is_qc_document,
    )
    db.add(doc)
    db.flush()

    note = f"Uploaded: {file.filename}"
    if desc:
        note += f" — {desc}"

    log_audit(
        db,
        lab_id=lot.lab_id,
        user_id=current_user.id,
        action="document.uploaded",
        entity_type="lot",
        entity_id=lot.id,
        after_state={
            "document_id": str(doc.id),
            "file_name": file.filename,
            "description": desc,
            "is_qc_document": is_qc_document,
        },
        note=note,
    )

    db.commit()
    db.refresh(doc)
    return doc


@router.get("/lots/{lot_id}", response_model=list[LotDocumentOut])
def get_lot_documents(
    lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(LotDocument).filter(LotDocument.lot_id == lot_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(LotDocument.lab_id == current_user.lab_id)
    docs = q.all()
    return docs


@router.get("/{document_id}")
def get_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(LotDocument).filter(LotDocument.id == document_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(LotDocument.lab_id == current_user.lab_id)
    doc = q.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    resolved_content_type = _normalize_content_type(doc.file_name, doc.content_type)

    # S3 path (doesn't start with "uploads/")
    if object_storage.enabled and not doc.file_path.startswith("uploads"):
        try:
            signed_url = object_storage.presign_download(
                doc.file_path,
                doc.file_name,
                expires=300,
                response_content_type=resolved_content_type,
            )
        except Exception:
            logger.exception("Failed to generate presigned download URL for %s", doc.file_path)
            raise HTTPException(status_code=502, detail="Document download is temporarily unavailable")
        return RedirectResponse(url=signed_url, status_code=307)

    # Local filesystem fallback (legacy files or S3 disabled)
    if os.path.exists(doc.file_path):
        return FileResponse(
            path=doc.file_path,
            filename=doc.file_name,
            media_type=resolved_content_type,
            content_disposition_type="inline",
        )

    raise HTTPException(status_code=404, detail="File not found")


@router.patch("/{document_id}", response_model=LotDocumentOut)
def update_document(
    document_id: UUID,
    body: LotDocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    q = db.query(LotDocument).filter(LotDocument.id == document_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(LotDocument.lab_id == current_user.lab_id)
    doc = q.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    before = _snapshot_document(doc)
    changed_fields: list[str] = []

    if "description" in body.model_fields_set:
        raw_description = body.description or ""
        new_description = raw_description.strip() if raw_description.strip() else None
        if new_description != doc.description:
            doc.description = new_description
            changed_fields.append("description")

    if "is_qc_document" in body.model_fields_set and body.is_qc_document is not None:
        if body.is_qc_document != doc.is_qc_document:
            doc.is_qc_document = body.is_qc_document
            changed_fields.append("is_qc_document")

    if changed_fields:
        # Build a descriptive note
        if "is_qc_document" in changed_fields:
            qc_verb = "Marked" if doc.is_qc_document else "Unmarked"
            note = f"{qc_verb} as QC document: {doc.file_name}"
        elif "description" in changed_fields:
            note = f"Updated description: {doc.file_name}"
        else:
            note = f"Updated document: {doc.file_name}"

        log_audit(
            db,
            lab_id=doc.lab_id,
            user_id=current_user.id,
            action="document.updated",
            entity_type="lot",
            entity_id=doc.lot_id,
            before_state=before,
            after_state=_snapshot_document(doc),
            note=note,
        )
        db.commit()
        db.refresh(doc)

    return doc


@router.delete("/{document_id}")
def delete_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    q = db.query(LotDocument).filter(LotDocument.id == document_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(LotDocument.lab_id == current_user.lab_id)
    doc = q.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    before = _snapshot_document(doc)

    if object_storage.enabled and not doc.file_path.startswith("uploads"):
        try:
            object_storage.delete(doc.file_path)
        except Exception:
            logger.exception("Failed to delete document from object storage: %s", doc.file_path)
            raise HTTPException(status_code=502, detail="Failed to delete file from object storage")
    else:
        if os.path.exists(doc.file_path):
            try:
                os.remove(doc.file_path)
            except OSError:
                logger.exception("Failed to delete local document file: %s", doc.file_path)
                raise HTTPException(status_code=500, detail="Failed to delete local file")

    log_audit(
        db,
        lab_id=doc.lab_id,
        user_id=current_user.id,
        action="document.deleted",
        entity_type="lot",
        entity_id=doc.lot_id,
        before_state=before,
        note=f"Deleted document: {doc.file_name}",
    )

    db.delete(doc)
    db.commit()
    return {"detail": "Document deleted"}
