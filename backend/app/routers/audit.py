from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.models import (
    Antibody,
    AuditLog,
    Fluorochrome,
    Lab,
    Lot,
    LotDocument,
    StorageUnit,
    User,
    UserRole,
    Vial,
)
from app.schemas.schemas import AuditLogOut

router = APIRouter(prefix="/api/audit", tags=["audit"])


def _resolve_entity_label(db: Session, entity_type: str, entity_id: UUID) -> str | None:
    """Best-effort resolution of a human-readable label for an audit log entity."""
    try:
        if entity_type == "antibody":
            ab = db.get(Antibody, entity_id)
            if ab:
                return f"{ab.target} - {ab.fluorochrome}"
        elif entity_type == "lot":
            lot = db.get(Lot, entity_id)
            if lot:
                ab = db.get(Antibody, lot.antibody_id) if lot.antibody_id else None
                if ab:
                    return f"{ab.target} {ab.fluorochrome} — Lot {lot.lot_number}"
                return f"Lot {lot.lot_number}"
        elif entity_type == "vial":
            vial = db.get(Vial, entity_id)
            if vial and vial.lot:
                label = f"Vial ({vial.lot.lot_number})"
                if vial.location_cell_id:
                    from app.models.models import StorageCell
                    cell = db.get(StorageCell, vial.location_cell_id)
                    if cell:
                        unit = db.get(StorageUnit, cell.storage_unit_id)
                        cell_label = cell.label or f"R{cell.row + 1}C{cell.col + 1}"
                        if unit:
                            label += f" @ {unit.name} [{cell_label}]"
                        else:
                            label += f" [{cell_label}]"
                return label
        elif entity_type == "fluorochrome":
            f = db.get(Fluorochrome, entity_id)
            if f:
                return f.name
        elif entity_type == "user":
            u = db.get(User, entity_id)
            if u:
                return u.full_name
        elif entity_type == "lab":
            lab = db.get(Lab, entity_id)
            if lab:
                return lab.name
        elif entity_type == "storage_unit":
            su = db.get(StorageUnit, entity_id)
            if su:
                return su.name
        elif entity_type == "document":
            doc = db.get(LotDocument, entity_id)
            if doc:
                return doc.file_name
    except Exception:
        pass
    return None


def _resolve_lineage(db: Session, entity_type: str, entity_id: UUID) -> dict:
    """Return lot_id and antibody_id for any entity in the hierarchy."""
    lot_id = None
    antibody_id = None
    try:
        if entity_type == "antibody":
            antibody_id = entity_id
        elif entity_type == "lot":
            lot_id = entity_id
            lot = db.get(Lot, entity_id)
            if lot:
                antibody_id = lot.antibody_id
        elif entity_type == "vial":
            vial = db.get(Vial, entity_id)
            if vial:
                lot_id = vial.lot_id
                lot = db.get(Lot, vial.lot_id)
                if lot:
                    antibody_id = lot.antibody_id
        elif entity_type in ("lot_document", "document"):
            doc = db.get(LotDocument, entity_id)
            if doc:
                lot_id = doc.lot_id
                lot = db.get(Lot, doc.lot_id)
                if lot:
                    antibody_id = lot.antibody_id
    except Exception:
        pass
    return {"lot_id": lot_id, "antibody_id": antibody_id}


@router.get("/", response_model=list[AuditLogOut])
def list_audit_logs(
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    action: str | None = None,
    lab_id: UUID | None = None,
    lot_id: UUID | None = None,
    antibody_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
    limit: int = 100,
    offset: int = 0,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(AuditLog)
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        q = q.filter(AuditLog.lab_id == lab_id)
    elif current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(AuditLog.lab_id == current_user.lab_id)

    # Scope filtering: antibody and lot filters are additive (lot narrows antibody)
    if antibody_id and lot_id:
        # Lot filter is more specific — use it, but only if the lot belongs to the antibody
        related_ids: list[UUID] = [lot_id]
        vial_ids = [r[0] for r in db.query(Vial.id).filter(Vial.lot_id == lot_id).all()]
        related_ids.extend(vial_ids)
        doc_ids = [r[0] for r in db.query(LotDocument.id).filter(LotDocument.lot_id == lot_id).all()]
        related_ids.extend(doc_ids)
        q = q.filter(AuditLog.entity_id.in_(related_ids))
    elif antibody_id:
        related_ids = [antibody_id]
        lot_ids = [r[0] for r in db.query(Lot.id).filter(Lot.antibody_id == antibody_id).all()]
        related_ids.extend(lot_ids)
        if lot_ids:
            vial_ids = [r[0] for r in db.query(Vial.id).filter(Vial.lot_id.in_(lot_ids)).all()]
            related_ids.extend(vial_ids)
            doc_ids = [r[0] for r in db.query(LotDocument.id).filter(LotDocument.lot_id.in_(lot_ids)).all()]
            related_ids.extend(doc_ids)
        q = q.filter(AuditLog.entity_id.in_(related_ids))
    elif lot_id:
        related_ids = [lot_id]
        vial_ids = [r[0] for r in db.query(Vial.id).filter(Vial.lot_id == lot_id).all()]
        related_ids.extend(vial_ids)
        doc_ids = [r[0] for r in db.query(LotDocument.id).filter(LotDocument.lot_id == lot_id).all()]
        related_ids.extend(doc_ids)
        q = q.filter(AuditLog.entity_id.in_(related_ids))
    else:
        if entity_type:
            q = q.filter(AuditLog.entity_type == entity_type)
        if entity_id:
            q = q.filter(AuditLog.entity_id == entity_id)

    # Date range filtering (date_to is exclusive — first day of the month AFTER the range)
    if date_from:
        q = q.filter(AuditLog.created_at >= date_from)
    if date_to:
        q = q.filter(AuditLog.created_at < date_to)

    # Support multiple comma-separated actions
    if action:
        actions = [a.strip() for a in action.split(",") if a.strip()]
        if len(actions) == 1:
            q = q.filter(AuditLog.action == actions[0])
        else:
            q = q.filter(AuditLog.action.in_(actions))

    logs = q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()

    # Build a map of user_id -> full_name for all users referenced in this page
    user_ids = {log.user_id for log in logs}
    user_map: dict[UUID, str] = {}
    if user_ids:
        users = db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()
        user_map = {u.id: u.full_name for u in users}

    results = []
    for log in logs:
        out = AuditLogOut.model_validate(log)
        out.user_full_name = user_map.get(log.user_id)
        out.entity_label = _resolve_entity_label(db, log.entity_type, log.entity_id)
        lineage = _resolve_lineage(db, log.entity_type, log.entity_id)
        out.lot_id = lineage["lot_id"]
        out.antibody_id = lineage["antibody_id"]
        results.append(out)

    return results
