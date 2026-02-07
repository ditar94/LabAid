from datetime import date
from uuid import UUID

from fastapi import APIRouter, Depends
from sqlalchemy import func
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
from app.schemas.schemas import AuditLogOut, AuditLogRangeOut

router = APIRouter(prefix="/api/audit", tags=["audit"])


def _batch_resolve(db: Session, logs: list) -> tuple[dict[UUID, str], dict[UUID, dict]]:
    """Batch-resolve entity labels and lineage for a page of audit log rows.

    Returns (labels_map, lineage_map) keyed by entity_id.
    Replaces per-row _resolve_entity_label / _resolve_lineage with bulk queries.
    """
    from app.models.models import StorageCell

    # Group entity IDs by type
    ids_by_type: dict[str, set[UUID]] = {}
    for log in logs:
        ids_by_type.setdefault(log.entity_type, set()).add(log.entity_id)

    labels: dict[UUID, str] = {}
    lineage: dict[UUID, dict] = {}

    # ── Bulk-load each entity type ──

    ab_ids = ids_by_type.get("antibody", set())
    ab_map: dict[UUID, Antibody] = {}
    if ab_ids:
        rows = db.query(Antibody).filter(Antibody.id.in_(ab_ids)).all()
        ab_map = {a.id: a for a in rows}
        for a in rows:
            labels[a.id] = f"{a.target} - {a.fluorochrome}"
            lineage[a.id] = {"lot_id": None, "antibody_id": a.id}

    lot_ids_direct = ids_by_type.get("lot", set())
    lot_map: dict[UUID, Lot] = {}
    if lot_ids_direct:
        rows = db.query(Lot).filter(Lot.id.in_(lot_ids_direct)).all()
        lot_map = {l.id: l for l in rows}
        # Need antibodies for labels
        lot_ab_ids = {l.antibody_id for l in rows if l.antibody_id} - set(ab_map.keys())
        if lot_ab_ids:
            extra = db.query(Antibody).filter(Antibody.id.in_(lot_ab_ids)).all()
            ab_map.update({a.id: a for a in extra})
        for l in rows:
            ab = ab_map.get(l.antibody_id) if l.antibody_id else None
            if ab:
                labels[l.id] = f"{ab.target} {ab.fluorochrome} — Lot {l.lot_number}"
            else:
                labels[l.id] = f"Lot {l.lot_number}"
            lineage[l.id] = {"lot_id": l.id, "antibody_id": l.antibody_id}

    vial_ids = ids_by_type.get("vial", set())
    if vial_ids:
        vials = db.query(Vial).filter(Vial.id.in_(vial_ids)).all()
        # Load lots for these vials
        vial_lot_ids = {v.lot_id for v in vials} - set(lot_map.keys())
        if vial_lot_ids:
            extra = db.query(Lot).filter(Lot.id.in_(vial_lot_ids)).all()
            lot_map.update({l.id: l for l in extra})
        # Load antibodies for those lots
        extra_ab_ids = {lot_map[v.lot_id].antibody_id for v in vials if v.lot_id in lot_map and lot_map[v.lot_id].antibody_id} - set(ab_map.keys())
        if extra_ab_ids:
            extra = db.query(Antibody).filter(Antibody.id.in_(extra_ab_ids)).all()
            ab_map.update({a.id: a for a in extra})
        # Load cells + units for vials with locations
        cell_ids = [v.location_cell_id for v in vials if v.location_cell_id]
        cell_map: dict[UUID, StorageCell] = {}
        unit_map: dict[UUID, StorageUnit] = {}
        if cell_ids:
            cells = db.query(StorageCell).filter(StorageCell.id.in_(cell_ids)).all()
            cell_map = {c.id: c for c in cells}
            unit_ids = list({c.storage_unit_id for c in cells})
            if unit_ids:
                units = db.query(StorageUnit).filter(StorageUnit.id.in_(unit_ids)).all()
                unit_map = {u.id: u for u in units}

        for v in vials:
            lot = lot_map.get(v.lot_id)
            ab = ab_map.get(lot.antibody_id) if lot and lot.antibody_id else None
            if ab:
                label = f"{ab.target}-{ab.fluorochrome} (Lot {lot.lot_number})"
            elif lot:
                label = f"Vial ({lot.lot_number})"
            else:
                label = "Vial"
            if v.location_cell_id and v.location_cell_id in cell_map:
                cell = cell_map[v.location_cell_id]
                unit = unit_map.get(cell.storage_unit_id)
                cell_label = cell.label or f"R{cell.row + 1}C{cell.col + 1}"
                if unit:
                    label += f" @ {unit.name} [{cell_label}]"
                else:
                    label += f" [{cell_label}]"
            labels[v.id] = label
            lineage[v.id] = {"lot_id": v.lot_id, "antibody_id": lot.antibody_id if lot else None}

    fluoro_ids = ids_by_type.get("fluorochrome", set())
    if fluoro_ids:
        rows = db.query(Fluorochrome).filter(Fluorochrome.id.in_(fluoro_ids)).all()
        for f in rows:
            labels[f.id] = f.name
            lineage[f.id] = {"lot_id": None, "antibody_id": None}

    user_entity_ids = ids_by_type.get("user", set())
    if user_entity_ids:
        rows = db.query(User).filter(User.id.in_(user_entity_ids)).all()
        for u in rows:
            labels[u.id] = u.full_name
            lineage[u.id] = {"lot_id": None, "antibody_id": None}

    lab_ids = ids_by_type.get("lab", set())
    if lab_ids:
        rows = db.query(Lab).filter(Lab.id.in_(lab_ids)).all()
        for lb in rows:
            labels[lb.id] = lb.name
            lineage[lb.id] = {"lot_id": None, "antibody_id": None}

    su_ids = ids_by_type.get("storage_unit", set())
    if su_ids:
        rows = db.query(StorageUnit).filter(StorageUnit.id.in_(su_ids)).all()
        for su in rows:
            labels[su.id] = su.name
            lineage[su.id] = {"lot_id": None, "antibody_id": None}

    doc_ids = ids_by_type.get("document", set()) | ids_by_type.get("lot_document", set())
    if doc_ids:
        docs = db.query(LotDocument).filter(LotDocument.id.in_(doc_ids)).all()
        # Load lots for lineage
        doc_lot_ids = {d.lot_id for d in docs} - set(lot_map.keys())
        if doc_lot_ids:
            extra = db.query(Lot).filter(Lot.id.in_(doc_lot_ids)).all()
            lot_map.update({l.id: l for l in extra})
        for d in docs:
            labels[d.id] = d.file_name
            lot = lot_map.get(d.lot_id)
            lineage[d.id] = {"lot_id": d.lot_id, "antibody_id": lot.antibody_id if lot else None}

    return labels, lineage


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

    # Batch-resolve labels and lineage for all entities on this page
    labels_map, lineage_map = _batch_resolve(db, logs)

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
    q = db.query(AuditLog)
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        q = q.filter(AuditLog.lab_id == lab_id)
    elif current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(AuditLog.lab_id == current_user.lab_id)

    # Scope filtering: antibody and lot filters are additive (lot narrows antibody)
    if antibody_id and lot_id:
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

    # Support multiple comma-separated actions
    if action:
        actions = [a.strip() for a in action.split(",") if a.strip()]
        if len(actions) == 1:
            q = q.filter(AuditLog.action == actions[0])
        else:
            q = q.filter(AuditLog.action.in_(actions))

    min_ts, max_ts = q.with_entities(
        func.min(AuditLog.created_at),
        func.max(AuditLog.created_at),
    ).one()

    return AuditLogRangeOut(min_created_at=min_ts, max_created_at=max_ts)
