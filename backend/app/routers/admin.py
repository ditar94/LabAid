import logging
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func, text
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import require_role
from app.models.models import (
    Antibody,
    AuditLog,
    Lot,
    LotDocument,
    User,
    UserRole,
    Vial,
)
from app.services.object_storage import object_storage

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin", tags=["admin"])


@router.get("/integrity")
def check_integrity(
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN)),
):
    """Validate referential integrity and blob consistency across the database."""
    checks: dict = {}

    # 1. Orphaned lots (lot.antibody_id points to non-existent antibody)
    orphaned_lots = (
        db.query(func.count(Lot.id))
        .outerjoin(Antibody, Lot.antibody_id == Antibody.id)
        .filter(Antibody.id.is_(None))
        .scalar()
    )
    checks["orphaned_lots"] = orphaned_lots

    # 2. Orphaned vials (vial.lot_id points to non-existent lot)
    orphaned_vials = (
        db.query(func.count(Vial.id))
        .outerjoin(Lot, Vial.lot_id == Lot.id)
        .filter(Lot.id.is_(None))
        .scalar()
    )
    checks["orphaned_vials"] = orphaned_vials

    # 3. Orphaned documents (document.lot_id points to non-existent lot)
    orphaned_docs = (
        db.query(func.count(LotDocument.id))
        .outerjoin(Lot, LotDocument.lot_id == Lot.id)
        .filter(Lot.id.is_(None))
        .scalar()
    )
    checks["orphaned_documents"] = orphaned_docs

    # 4. Entity counts
    counts = {
        "labs": db.execute(text("SELECT COUNT(*) FROM labs")).scalar(),
        "users": db.execute(text("SELECT COUNT(*) FROM users")).scalar(),
        "antibodies": db.execute(text("SELECT COUNT(*) FROM antibodies")).scalar(),
        "lots": db.execute(text("SELECT COUNT(*) FROM lots")).scalar(),
        "vials": db.execute(text("SELECT COUNT(*) FROM vials")).scalar(),
        "documents": db.execute(text("SELECT COUNT(*) FROM lot_documents")).scalar(),
        "audit_log": db.execute(text("SELECT COUNT(*) FROM audit_log")).scalar(),
    }
    checks["entity_counts"] = counts

    # 5. Audit log span
    audit_span = db.execute(
        text("SELECT MIN(created_at), MAX(created_at) FROM audit_log")
    ).first()
    checks["audit_log_span"] = {
        "earliest": str(audit_span[0]) if audit_span[0] else None,
        "latest": str(audit_span[1]) if audit_span[1] else None,
    }

    # 6. Missing blobs (documents where S3 key exists but blob is missing)
    missing_blobs = []
    if object_storage.enabled:
        s3_docs = (
            db.query(LotDocument.id, LotDocument.file_path)
            .filter(~LotDocument.file_path.startswith("uploads"))
            .all()
        )
        for doc_id, key in s3_docs:
            try:
                object_storage._client.head_object(
                    Bucket=object_storage._bucket, Key=key
                )
            except Exception:
                missing_blobs.append({"id": str(doc_id), "key": key})
    checks["missing_blobs"] = len(missing_blobs)
    if missing_blobs:
        checks["missing_blob_details"] = missing_blobs[:20]  # cap at 20

    # 7. Documents missing metadata (uploaded before checksum tracking)
    docs_without_checksum = (
        db.query(func.count(LotDocument.id))
        .filter(LotDocument.checksum_sha256.is_(None))
        .scalar()
    )
    checks["documents_without_checksum"] = docs_without_checksum

    # Overall status
    has_issues = (
        orphaned_lots > 0
        or orphaned_vials > 0
        or orphaned_docs > 0
        or len(missing_blobs) > 0
    )
    return {
        "status": "issues_found" if has_issues else "ok",
        "checks": checks,
    }
