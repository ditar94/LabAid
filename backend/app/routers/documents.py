import os
import shutil
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.orm import Session
from starlette.responses import FileResponse

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import Antibody, Lot, LotDocument, User, UserRole
from app.schemas.schemas import LotDocumentOut
from app.services.audit import log_audit

router = APIRouter(prefix="/api/documents", tags=["documents"])

UPLOAD_DIR = "uploads"


@router.post("/lots/{lot_id}", response_model=LotDocumentOut)
def upload_lot_document(
    lot_id: UUID,
    file: UploadFile = File(...),
    description: str | None = Form(None),
    is_qc_document: bool = Form(False),
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
):
    q = db.query(Lot).filter(Lot.id == lot_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(Lot.lab_id == current_user.lab_id)
    lot = q.first()
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")

    # Ensure upload directory exists
    os.makedirs(UPLOAD_DIR, exist_ok=True)

    file_path = os.path.join(UPLOAD_DIR, f"{lot.id}_{file.filename}")
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)

    desc = description.strip() if description else None
    doc = LotDocument(
        lot_id=lot.id,
        lab_id=lot.lab_id,
        user_id=current_user.id,
        file_path=file_path,
        file_name=file.filename,
        description=desc,
        is_qc_document=is_qc_document,
    )
    db.add(doc)
    db.flush()

    # Build audit note with file name and description
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


@router.get("/{document_id}", response_class=FileResponse)
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
    
    return FileResponse(path=doc.file_path, filename=doc.file_name)
