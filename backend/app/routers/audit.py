from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.models import (
    AuditLog,
    Lot,
    LotDocument,
    User,
    UserRole,
    Vial,
)
from app.schemas.schemas import AuditLogOut, AuditLogRangeOut
from app.services.audit import batch_resolve_audit_logs

router = APIRouter(prefix="/api/audit", tags=["audit"])


def _apply_audit_filters(
    q,
    db: Session,
    current_user: User,
    *,
    lab_id: UUID | None = None,
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    entity_type: str | None = None,
    entity_id: UUID | None = None,
    action: str | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
):
    """Apply common audit log filters. Shared by list and range endpoints."""
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        q = q.filter(AuditLog.lab_id == lab_id)
    elif current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(AuditLog.lab_id == current_user.lab_id)

    # Scope filtering: collect all related entity IDs in a single pass
    if antibody_id or lot_id:
        related_ids: list[UUID] = []
        # Determine which lot_ids to expand
        if lot_id:
            target_lot_ids = [lot_id]
            related_ids.append(lot_id)
        elif antibody_id:
            related_ids.append(antibody_id)
            target_lot_ids = [r[0] for r in db.query(Lot.id).filter(Lot.antibody_id == antibody_id).all()]
            related_ids.extend(target_lot_ids)
        else:
            target_lot_ids = []

        # Batch-load vial and document IDs for all target lots in 2 queries
        if target_lot_ids:
            vial_ids = [r[0] for r in db.query(Vial.id).filter(Vial.lot_id.in_(target_lot_ids)).all()]
            related_ids.extend(vial_ids)
            doc_ids = [r[0] for r in db.query(LotDocument.id).filter(LotDocument.lot_id.in_(target_lot_ids)).all()]
            related_ids.extend(doc_ids)

        q = q.filter(AuditLog.entity_id.in_(related_ids))
    else:
        if entity_type:
            q = q.filter(AuditLog.entity_type == entity_type)
        if entity_id:
            q = q.filter(AuditLog.entity_id == entity_id)

    if date_from:
        q = q.filter(AuditLog.created_at >= date_from)
    if date_to:
        q = q.filter(AuditLog.created_at < date_to)

    if action:
        actions = [a.strip() for a in action.split(",") if a.strip()]
        if len(actions) == 1:
            q = q.filter(AuditLog.action == actions[0])
        else:
            q = q.filter(AuditLog.action.in_(actions))

    return q


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
    q = _apply_audit_filters(
        db.query(AuditLog), db, current_user,
        lab_id=lab_id, antibody_id=antibody_id, lot_id=lot_id,
        entity_type=entity_type, entity_id=entity_id,
        action=action, date_from=date_from, date_to=date_to,
    )

    logs = q.order_by(AuditLog.created_at.desc()).offset(offset).limit(limit).all()

    # Build a map of user_id -> full_name for all users referenced in this page
    user_ids = {log.user_id for log in logs}
    user_map: dict[UUID, str] = {}
    if user_ids:
        users = db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()
        user_map = {u.id: u.full_name for u in users}

    # Batch-resolve labels and lineage for all entities on this page
    labels_map, lineage_map = batch_resolve_audit_logs(db, logs)

    results = []
    for log in logs:
        out = AuditLogOut.model_validate(log)
        out.user_full_name = user_map.get(log.user_id)
        out.entity_label = labels_map.get(log.entity_id)
        lin = lineage_map.get(log.entity_id, {"lot_id": None, "antibody_id": None})
        out.lot_id = lin["lot_id"]
        out.antibody_id = lin["antibody_id"]
        results.append(out)

    return results


@router.get("/range", response_model=AuditLogRangeOut)
def get_audit_log_range(
    action: str | None = None,
    lab_id: UUID | None = None,
    lot_id: UUID | None = None,
    antibody_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = _apply_audit_filters(
        db.query(AuditLog), db, current_user,
        lab_id=lab_id, antibody_id=antibody_id, lot_id=lot_id,
        action=action,
    )

    min_ts, max_ts = q.with_entities(
        func.min(AuditLog.created_at),
        func.max(AuditLog.created_at),
    ).one()

    return AuditLogRangeOut(min_created_at=min_ts, max_created_at=max_ts)
