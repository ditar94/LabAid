"""Report data-fetching service for compliance exports.

Each function returns structured dicts ready for rendering into CSV or PDF.
All queries are lab-scoped and read-only.
"""

from datetime import date, datetime
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.models import (
    Antibody,
    AuditLog,
    Lab,
    Lot,
    LotDocument,
    User,
    UserRole,
    Vial,
)
from app.services.audit import batch_resolve_audit_logs


MAX_AUDIT_ROWS = 50_000


def _resolve_user_map(db: Session, user_ids: set[UUID]) -> dict[UUID, str]:
    if not user_ids:
        return {}
    rows = db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()
    return {r.id: r.full_name for r in rows}


def get_audit_trail_data(
    db: Session,
    *,
    lab_id: UUID,
    date_from: date | None = None,
    date_to: date | None = None,
    entity_type: str | None = None,
    action: str | None = None,
) -> list[dict]:
    """Fetch resolved audit trail rows for a lab."""
    q = db.query(AuditLog).filter(AuditLog.lab_id == lab_id)

    if date_from:
        q = q.filter(AuditLog.created_at >= date_from)
    if date_to:
        q = q.filter(AuditLog.created_at < date_to)
    if entity_type:
        q = q.filter(AuditLog.entity_type == entity_type)
    if action:
        actions = [a.strip() for a in action.split(",") if a.strip()]
        if len(actions) == 1:
            q = q.filter(AuditLog.action == actions[0])
        else:
            q = q.filter(AuditLog.action.in_(actions))

    logs = q.order_by(AuditLog.created_at.desc()).limit(MAX_AUDIT_ROWS).all()
    if not logs:
        return []

    user_map = _resolve_user_map(db, {log.user_id for log in logs})
    labels_map, _ = batch_resolve_audit_logs(db, logs)

    return [
        {
            "timestamp": log.created_at.isoformat() if log.created_at else "",
            "user": user_map.get(log.user_id, str(log.user_id)),
            "action": log.action,
            "entity_type": log.entity_type,
            "entity": labels_map.get(log.entity_id, str(log.entity_id)),
            "note": log.note or "",
            "support": "Yes" if log.is_support_action else "No",
        }
        for log in logs
    ]


def get_lot_lifecycle_data(
    db: Session,
    *,
    lab_id: UUID,
    lot_id: UUID | None = None,
    antibody_id: UUID | None = None,
) -> list[dict]:
    """Fetch per-lot lifecycle timeline: created -> received -> opened -> depleted."""
    lots_q = db.query(Lot).filter(Lot.lab_id == lab_id)
    if lot_id:
        lots_q = lots_q.filter(Lot.id == lot_id)
    elif antibody_id:
        lots_q = lots_q.filter(Lot.antibody_id == antibody_id)
    else:
        return []

    lots = lots_q.order_by(Lot.created_at.desc()).all()
    if not lots:
        return []

    # Preload antibodies
    ab_ids = {l.antibody_id for l in lots if l.antibody_id}
    ab_map: dict[UUID, Antibody] = {}
    if ab_ids:
        rows = db.query(Antibody).filter(Antibody.id.in_(ab_ids)).all()
        ab_map = {a.id: a for a in rows}

    # Preload vials for all lots
    lot_ids = [l.id for l in lots]
    vials = db.query(Vial).filter(Vial.lot_id.in_(lot_ids)).all()
    vials_by_lot: dict[UUID, list[Vial]] = {}
    for v in vials:
        vials_by_lot.setdefault(v.lot_id, []).append(v)

    # Preload QC-related audit entries for these lots
    related_ids: list[UUID] = list(lot_ids)
    vial_ids = [v.id for v in vials]
    related_ids.extend(vial_ids)
    doc_ids_q = db.query(LotDocument.id).filter(LotDocument.lot_id.in_(lot_ids)).all()
    doc_ids = [r[0] for r in doc_ids_q]
    related_ids.extend(doc_ids)

    audit_logs = (
        db.query(AuditLog)
        .filter(AuditLog.lab_id == lab_id, AuditLog.entity_id.in_(related_ids))
        .order_by(AuditLog.created_at.asc())
        .limit(MAX_AUDIT_ROWS)
        .all()
    )
    user_ids = {a.user_id for a in audit_logs}
    user_map = _resolve_user_map(db, user_ids)

    # Group audit events by lot
    audit_by_lot: dict[UUID, list] = {}
    # Map vial_id -> lot_id
    vial_lot_map = {v.id: v.lot_id for v in vials}
    # Map doc_id -> lot_id
    doc_lot_map = {d_id: None for d_id in doc_ids}
    for doc_row in db.query(LotDocument.id, LotDocument.lot_id).filter(LotDocument.id.in_(doc_ids)).all():
        doc_lot_map[doc_row.id] = doc_row.lot_id

    for a in audit_logs:
        owner_lot_id = None
        if a.entity_id in {l.id for l in lots}:
            owner_lot_id = a.entity_id
        elif a.entity_id in vial_lot_map:
            owner_lot_id = vial_lot_map[a.entity_id]
        elif a.entity_id in doc_lot_map:
            owner_lot_id = doc_lot_map[a.entity_id]
        if owner_lot_id:
            audit_by_lot.setdefault(owner_lot_id, []).append(a)

    result = []
    for lot in lots:
        ab = ab_map.get(lot.antibody_id) if lot.antibody_id else None
        lot_vials = vials_by_lot.get(lot.id, [])
        events = []
        for a in audit_by_lot.get(lot.id, []):
            events.append({
                "timestamp": a.created_at.isoformat() if a.created_at else "",
                "action": a.action,
                "user": user_map.get(a.user_id, str(a.user_id)),
                "note": a.note or "",
                "support": "Yes" if a.is_support_action else "No",
            })

        result.append({
            "lot_number": lot.lot_number,
            "antibody": f"{ab.target} {ab.fluorochrome}" if ab else "N/A",
            "expiration_date": str(lot.expiration_date) if lot.expiration_date else "",
            "qc_status": lot.qc_status.value if lot.qc_status else "",
            "is_archived": lot.is_archived,
            "created_at": lot.created_at.isoformat() if lot.created_at else "",
            "total_vials": len(lot_vials),
            "sealed": sum(1 for v in lot_vials if v.status and v.status.value == "sealed"),
            "opened": sum(1 for v in lot_vials if v.status and v.status.value == "opened"),
            "depleted": sum(1 for v in lot_vials if v.status and v.status.value == "depleted"),
            "events": events,
        })

    return result


def get_qc_history_data(
    db: Session,
    *,
    lab_id: UUID,
    date_from: date | None = None,
    date_to: date | None = None,
    antibody_id: UUID | None = None,
) -> list[dict]:
    """Fetch QC-related audit events: approvals, failures, doc uploads, overrides."""
    qc_actions = [
        "lot.qc_approved",
        "lot.qc_pending",
        "lot.qc_failed",
        "document.uploaded",
        "document.updated",
        "document.deleted",
    ]

    q = (
        db.query(AuditLog)
        .filter(AuditLog.lab_id == lab_id, AuditLog.action.in_(qc_actions))
    )

    if date_from:
        q = q.filter(AuditLog.created_at >= date_from)
    if date_to:
        q = q.filter(AuditLog.created_at < date_to)

    if antibody_id:
        # Scope to lots for this antibody
        lot_ids = [r[0] for r in db.query(Lot.id).filter(Lot.antibody_id == antibody_id, Lot.lab_id == lab_id).all()]
        if not lot_ids:
            return []
        doc_ids = [r[0] for r in db.query(LotDocument.id).filter(LotDocument.lot_id.in_(lot_ids)).all()]
        related = list(lot_ids) + doc_ids
        q = q.filter(AuditLog.entity_id.in_(related))

    logs = q.order_by(AuditLog.created_at.desc()).limit(MAX_AUDIT_ROWS).all()
    if not logs:
        return []

    user_map = _resolve_user_map(db, {log.user_id for log in logs})
    labels_map, lineage_map = batch_resolve_audit_logs(db, logs)

    # Resolve lot number + antibody for each entry
    lot_ids_needed = set()
    for log in logs:
        lin = lineage_map.get(log.entity_id, {})
        if lin.get("lot_id"):
            lot_ids_needed.add(lin["lot_id"])
    lot_map: dict[UUID, Lot] = {}
    if lot_ids_needed:
        rows = db.query(Lot).filter(Lot.id.in_(lot_ids_needed)).all()
        lot_map = {l.id: l for l in rows}
    ab_ids_needed = {lot_map[lid].antibody_id for lid in lot_ids_needed if lid in lot_map and lot_map[lid].antibody_id}
    ab_map: dict[UUID, Antibody] = {}
    if ab_ids_needed:
        rows = db.query(Antibody).filter(Antibody.id.in_(ab_ids_needed)).all()
        ab_map = {a.id: a for a in rows}

    result = []
    for log in logs:
        lin = lineage_map.get(log.entity_id, {})
        lot = lot_map.get(lin.get("lot_id")) if lin.get("lot_id") else None
        ab = ab_map.get(lot.antibody_id) if lot and lot.antibody_id else None
        result.append({
            "timestamp": log.created_at.isoformat() if log.created_at else "",
            "lot_number": lot.lot_number if lot else "",
            "antibody": f"{ab.target} {ab.fluorochrome}" if ab else "",
            "action": log.action,
            "user": user_map.get(log.user_id, str(log.user_id)),
            "entity": labels_map.get(log.entity_id, str(log.entity_id)),
            "note": log.note or "",
            "support": "Yes" if log.is_support_action else "No",
        })

    return result


def get_qc_verification_data(
    db: Session,
    *,
    lab_id: UUID,
    lot_id: UUID,
) -> dict | None:
    """Build a single-lot QC verification dossier."""
    lot = db.query(Lot).filter(Lot.id == lot_id, Lot.lab_id == lab_id).first()
    if not lot:
        return None

    ab = db.query(Antibody).filter(Antibody.id == lot.antibody_id).first() if lot.antibody_id else None

    # Documents
    docs = db.query(LotDocument).filter(LotDocument.lot_id == lot_id).order_by(LotDocument.created_at.asc()).all()
    doc_user_ids = {d.user_id for d in docs}
    doc_user_map = _resolve_user_map(db, doc_user_ids)

    # All audit entries for this lot + its vials + its docs
    related_ids: list[UUID] = [lot_id]
    vial_ids = [r[0] for r in db.query(Vial.id).filter(Vial.lot_id == lot_id).all()]
    related_ids.extend(vial_ids)
    doc_ids = [d.id for d in docs]
    related_ids.extend(doc_ids)

    audit_logs = (
        db.query(AuditLog)
        .filter(AuditLog.lab_id == lab_id, AuditLog.entity_id.in_(related_ids))
        .order_by(AuditLog.created_at.asc())
        .limit(MAX_AUDIT_ROWS)
        .all()
    )
    audit_user_ids = {a.user_id for a in audit_logs}
    audit_user_map = _resolve_user_map(db, audit_user_ids)

    # QC approver
    approver = None
    if lot.qc_approved_by:
        u = db.query(User).filter(User.id == lot.qc_approved_by).first()
        if u:
            approver = u.full_name

    # Filter QC-specific events
    qc_events = []
    for a in audit_logs:
        if a.action in ("lot.qc_approved", "lot.qc_pending", "lot.qc_failed",
                        "document.uploaded", "document.updated", "document.deleted"):
            qc_events.append({
                "timestamp": a.created_at.isoformat() if a.created_at else "",
                "action": a.action,
                "user": audit_user_map.get(a.user_id, str(a.user_id)),
                "note": a.note or "",
                "support": "Yes" if a.is_support_action else "No",
            })

    return {
        "lot_number": lot.lot_number,
        "antibody": f"{ab.target} {ab.fluorochrome}" if ab else "N/A",
        "vendor": ab.vendor if ab else "",
        "catalog_number": ab.catalog_number if ab else "",
        "expiration_date": str(lot.expiration_date) if lot.expiration_date else "",
        "qc_status": lot.qc_status.value if lot.qc_status else "",
        "qc_approved_by": approver or "",
        "qc_approved_at": lot.qc_approved_at.isoformat() if lot.qc_approved_at else "",
        "created_at": lot.created_at.isoformat() if lot.created_at else "",
        "is_archived": lot.is_archived,
        "documents": [
            {
                "file_name": d.file_name,
                "is_qc_document": d.is_qc_document,
                "description": d.description or "",
                "uploaded_by": doc_user_map.get(d.user_id, str(d.user_id)),
                "uploaded_at": d.created_at.isoformat() if d.created_at else "",
            }
            for d in docs
        ],
        "qc_history": qc_events,
        "full_audit_trail": [
            {
                "timestamp": a.created_at.isoformat() if a.created_at else "",
                "action": a.action,
                "user": audit_user_map.get(a.user_id, str(a.user_id)),
                "note": a.note or "",
                "support": "Yes" if a.is_support_action else "No",
            }
            for a in audit_logs
        ],
    }
