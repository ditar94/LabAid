import io
import logging
import os
import shutil
import uuid as uuid_mod
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from starlette.responses import FileResponse

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import Lot, LotDocument, User, UserRole
from app.core.config import settings
from app.schemas.schemas import LotDocumentOut
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


@router.post("/lots/{lot_id}", response_model=LotDocumentOut)
def upload_lot_document(
    lot_id: UUID,
    file: UploadFile = File(...),
    description: str | None = Form(None),
    is_qc_document: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    # Validate MIME type
    if file.content_type and file.content_type not in ALLOWED_MIME_TYPES:
        raise HTTPException(status_code=400, detail=f"File type '{file.content_type}' is not allowed")

    # Validate file size
    file.file.seek(0, 2)
    size = file.file.tell()
    file.file.seek(0)
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB}MB limit")

    q = db.query(Lot).filter(Lot.id == lot_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Lot.lab_id == current_user.lab_id)
    lot = q.first()
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")

    doc_id = uuid_mod.uuid4()

    if object_storage.enabled:
        key = f"{lot.lab_id}/{lot.id}/{doc_id}_{file.filename}"
        file_data = io.BytesIO(file.file.read())
        try:
            object_storage.upload(
                key,
                file_data,
                content_type=file.content_type or "application/octet-stream",
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
            shutil.copyfileobj(file.file, buffer)

    desc = description.strip() if description else None
    doc = LotDocument(
        id=doc_id,
        lot_id=lot.id,
        lab_id=lot.lab_id,
        user_id=current_user.id,
        file_path=stored_path,
        file_name=file.filename,
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

    # S3 path (doesn't start with "uploads/")
    if object_storage.enabled and not doc.file_path.startswith("uploads"):
        body, content_type = object_storage.download(doc.file_path)
        return StreamingResponse(
            body,
            media_type=content_type,
            headers={"Content-Disposition": f'inline; filename="{doc.file_name}"'},
        )

    # Local filesystem fallback (legacy files or S3 disabled)
    if os.path.exists(doc.file_path):
        return FileResponse(path=doc.file_path, filename=doc.file_name)

    raise HTTPException(status_code=404, detail="File not found")
