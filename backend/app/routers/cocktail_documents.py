import hashlib
import io
import logging
import os
import uuid as uuid_mod
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile
from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session
from starlette.responses import FileResponse, RedirectResponse

from app.core.database import get_db
from app.core.config import settings
from app.middleware.auth import get_current_user, require_role
from app.models.models import CocktailLot, CocktailLotDocument, User, UserRole
from app.routers.auth import limiter
from app.routers.documents import (
    ALLOWED_EXTENSIONS,
    ALLOWED_MIME_TYPES,
    MAX_UPLOAD_BYTES,
    UPLOAD_DIR,
    _normalize_content_type,
)
from app.schemas.schemas import CocktailLotDocumentOut, CocktailLotDocumentUpdate
from app.services.audit import log_audit
from app.services.object_storage import object_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/cocktail-documents", tags=["cocktail-documents"])


def _snapshot_document(doc: CocktailLotDocument) -> dict:
    return {
        "id": str(doc.id),
        "cocktail_lot_id": str(doc.cocktail_lot_id),
        "file_name": doc.file_name,
        "description": doc.description,
        "is_qc_document": doc.is_qc_document,
        "renewal_number": doc.renewal_number,
    }


@router.post("/lots/{cocktail_lot_id}", response_model=CocktailLotDocumentOut)
@limiter.limit("10/minute")
def upload_cocktail_lot_document(
    request: Request,
    cocktail_lot_id: UUID,
    file: UploadFile = File(...),
    description: str | None = Form(None),
    is_qc_document: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    ext = os.path.splitext(file.filename or "")[1].lower()
    mime_ok = not file.content_type or file.content_type in ALLOWED_MIME_TYPES
    ext_ok = ext in ALLOWED_EXTENSIONS
    if not mime_ok and not ext_ok:
        raise HTTPException(status_code=400, detail=f"File type '{file.content_type}' is not allowed")

    file_bytes = file.file.read()
    size = len(file_bytes)
    if size > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=400, detail=f"File exceeds {settings.MAX_UPLOAD_SIZE_MB}MB limit")

    checksum = hashlib.sha256(file_bytes).hexdigest()

    q = db.query(CocktailLot).filter(CocktailLot.id == cocktail_lot_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(CocktailLot.lab_id == current_user.lab_id)
    lot = q.first()
    if not lot:
        raise HTTPException(status_code=404, detail="Cocktail lot not found")

    doc_id = uuid_mod.uuid4()
    mime = _normalize_content_type(file.filename, file.content_type)

    if object_storage.enabled:
        key = f"{lot.lab_id}/cocktails/{lot.id}/{doc_id}_{file.filename}"
        file_data = io.BytesIO(file_bytes)
        try:
            object_storage.upload(
                key, file_data, content_type=mime,
                tags={"storage-class": "hot", "lab-active": "true"},
            )
        except Exception:
            logger.exception("Failed to upload cocktail document to object storage: %s", key)
            raise HTTPException(status_code=502, detail="File upload failed. Please try again.")
        stored_path = key
    else:
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        stored_path = os.path.join(UPLOAD_DIR, f"cocktail_{lot.id}_{file.filename}")
        with open(stored_path, "wb") as buffer:
            buffer.write(file_bytes)

    desc = description.strip() if description else None
    doc = CocktailLotDocument(
        id=doc_id,
        cocktail_lot_id=lot.id,
        lab_id=lot.lab_id,
        user_id=current_user.id,
        file_path=stored_path,
        file_name=file.filename,
        file_size=size,
        content_type=mime,
        checksum_sha256=checksum,
        description=desc,
        is_qc_document=is_qc_document,
        renewal_number=lot.renewal_count,
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
        action="cocktail_document.uploaded",
        entity_type="cocktail_lot",
        entity_id=lot.id,
        after_state={
            "document_id": str(doc.id),
            "file_name": file.filename,
            "description": desc,
            "is_qc_document": is_qc_document,
        },
        note=note,
        is_support_action=getattr(current_user, "_is_impersonating", False),
    )

    db.commit()
    db.refresh(doc)
    return doc


@router.get("/lots/{cocktail_lot_id}", response_model=list[CocktailLotDocumentOut])
def get_cocktail_lot_documents(
    cocktail_lot_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(CocktailLotDocument).filter(
        CocktailLotDocument.cocktail_lot_id == cocktail_lot_id,
        CocktailLotDocument.is_deleted == False,  # noqa: E712
    )
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(CocktailLotDocument.lab_id == current_user.lab_id)
    return q.all()


@router.get("/{document_id}")
def get_cocktail_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(CocktailLotDocument).filter(
        CocktailLotDocument.id == document_id,
        CocktailLotDocument.is_deleted == False,  # noqa: E712
    )
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(CocktailLotDocument.lab_id == current_user.lab_id)
    doc = q.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    resolved_content_type = _normalize_content_type(doc.file_name, doc.content_type)

    if object_storage.enabled and not doc.file_path.startswith("uploads"):
        try:
            signed_url = object_storage.presign_download(
                doc.file_path, doc.file_name,
                expires=300, response_content_type=resolved_content_type,
            )
        except Exception:
            logger.exception("Failed to generate presigned URL for %s", doc.file_path)
            raise HTTPException(status_code=502, detail="Document download is temporarily unavailable")
        return RedirectResponse(url=signed_url, status_code=307)

    if os.path.exists(doc.file_path):
        return FileResponse(
            path=doc.file_path, filename=doc.file_name,
            media_type=resolved_content_type, content_disposition_type="inline",
        )

    raise HTTPException(status_code=404, detail="File not found")


@router.patch("/{document_id}", response_model=CocktailLotDocumentOut)
def update_cocktail_document(
    document_id: UUID,
    body: CocktailLotDocumentUpdate,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    q = db.query(CocktailLotDocument).filter(
        CocktailLotDocument.id == document_id,
        CocktailLotDocument.is_deleted == False,  # noqa: E712
    )
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(CocktailLotDocument.lab_id == current_user.lab_id)
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
            action="cocktail_document.updated",
            entity_type="cocktail_lot",
            entity_id=doc.cocktail_lot_id,
            before_state=before,
            after_state=_snapshot_document(doc),
            note=note,
            is_support_action=getattr(current_user, "_is_impersonating", False),
        )
        db.commit()
        db.refresh(doc)

    return doc


@router.delete("/{document_id}")
def delete_cocktail_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    q = db.query(CocktailLotDocument).filter(
        CocktailLotDocument.id == document_id,
        CocktailLotDocument.is_deleted == False,  # noqa: E712
    )
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(CocktailLotDocument.lab_id == current_user.lab_id)
    doc = q.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    before = _snapshot_document(doc)
    doc.is_deleted = True
    doc.deleted_at = sa_func.now()
    doc.deleted_by = current_user.id

    log_audit(
        db,
        lab_id=doc.lab_id,
        user_id=current_user.id,
        action="cocktail_document.deleted",
        entity_type="cocktail_lot",
        entity_id=doc.cocktail_lot_id,
        before_state=before,
        note=f"Deleted document: {doc.file_name}",
        is_support_action=getattr(current_user, "_is_impersonating", False),
    )

    db.commit()
    return {"detail": "Document deleted"}


@router.post("/{document_id}/restore")
def restore_cocktail_document(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)),
):
    q = db.query(CocktailLotDocument).filter(
        CocktailLotDocument.id == document_id,
        CocktailLotDocument.is_deleted == True,  # noqa: E712
    )
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(CocktailLotDocument.lab_id == current_user.lab_id)
    doc = q.first()
    if not doc:
        raise HTTPException(status_code=404, detail="Deleted document not found")

    doc.is_deleted = False
    doc.deleted_at = None
    doc.deleted_by = None

    log_audit(
        db,
        lab_id=doc.lab_id,
        user_id=current_user.id,
        action="cocktail_document.restored",
        entity_type="cocktail_lot",
        entity_id=doc.cocktail_lot_id,
        after_state=_snapshot_document(doc),
        note=f"Restored document: {doc.file_name}",
        is_support_action=getattr(current_user, "_is_impersonating", False),
    )

    db.commit()
    return {"detail": "Document restored"}
