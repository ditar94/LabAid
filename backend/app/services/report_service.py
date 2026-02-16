"""Report data-fetching service for compliance exports.

Each function returns structured dicts ready for rendering into CSV or PDF.
All queries are lab-scoped and read-only.
"""

from datetime import date, datetime, timedelta, timezone
from math import ceil
from uuid import UUID

from sqlalchemy import func as sa_func
from sqlalchemy.orm import Session

from app.models.models import (
    Antibody,
    AuditLog,
    Lot,
    LotDocument,
    User,
    Vial,
    VialStatus,
)
from app.services.audit import batch_resolve_audit_logs


MAX_AUDIT_ROWS = 50_000


def _resolve_user_map(db: Session, user_ids: set[UUID]) -> dict[UUID, str]:
    if not user_ids:
        return {}
    rows = db.query(User.id, User.full_name).filter(User.id.in_(user_ids)).all()
    return {r.id: r.full_name for r in rows}


def _make_date_inclusive(date_to: date | None) -> date | None:
    """Add 1 day to make the upper bound inclusive (< next day)."""
    if date_to:
        return date_to + timedelta(days=1)
    return None


def _fmt_date(dt: datetime | date | None) -> str:
    if dt is None:
        return ""
    if isinstance(dt, datetime):
        return dt.strftime("%Y-%m-%d")
    return str(dt)


# ── Lot Activity Report ───────────────────────────────────────────────────


def _antibody_name_map(db: Session, antibody_ids: set[UUID]) -> dict[UUID, str]:
    """Short name: 'Target Fluorochrome'."""
    if not antibody_ids:
        return {}
    rows = db.query(Antibody.id, Antibody.target, Antibody.fluorochrome).filter(
        Antibody.id.in_(antibody_ids)
    ).all()
    return {r.id: f"{r.target} {r.fluorochrome}".strip() for r in rows}


def _antibody_full_map(db: Session, antibody_ids: set[UUID]) -> dict[UUID, str]:
    """Full label: 'Target Fluorochrome — Vendor'."""
    if not antibody_ids:
        return {}
    rows = db.query(Antibody.id, Antibody.target, Antibody.fluorochrome, Antibody.vendor).filter(
        Antibody.id.in_(antibody_ids)
    ).all()
    result = {}
    for r in rows:
        name = f"{r.target} {r.fluorochrome}".strip()
        if r.vendor:
            name += f" - {r.vendor}"
        result[r.id] = name
    return result


def get_lot_activity_data(
    db: Session,
    *,
    lab_id: UUID,
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    """One row per lot: received, QC, opened milestones + vial counts."""
    lots_q = db.query(Lot).filter(Lot.lab_id == lab_id)
    if antibody_id:
        lots_q = lots_q.filter(Lot.antibody_id == antibody_id)
    if lot_id:
        lots_q = lots_q.filter(Lot.id == lot_id)
    if date_from:
        lots_q = lots_q.filter(Lot.created_at >= date_from)
    if date_to:
        lots_q = lots_q.filter(Lot.created_at < _make_date_inclusive(date_to))
    lots = lots_q.order_by(Lot.created_at.desc()).all()
    if not lots:
        return []

    lot_ids = [l.id for l in lots]

    # Batch: vials for all lots
    vials = db.query(Vial).filter(Vial.lot_id.in_(lot_ids)).all()
    vials_by_lot: dict[UUID, list[Vial]] = {}
    for v in vials:
        vials_by_lot.setdefault(v.lot_id, []).append(v)

    # Batch: QC docs exist per lot
    qc_doc_lot_ids = set(
        r[0] for r in db.query(LotDocument.lot_id)
        .filter(LotDocument.lot_id.in_(lot_ids), LotDocument.is_qc_document.is_(True))
        .distinct()
        .all()
    )

    # Batch: received-by user — from audit log vial.received action on each lot
    received_audit = (
        db.query(AuditLog.entity_id, AuditLog.user_id)
        .filter(
            AuditLog.entity_id.in_(lot_ids),
            AuditLog.action == "vial.received",
        )
        .order_by(AuditLog.created_at.asc())
        .all()
    )
    # First received event per lot
    received_by_lot: dict[UUID, UUID] = {}
    for entity_id, user_id in received_audit:
        if entity_id not in received_by_lot:
            received_by_lot[entity_id] = user_id

    # Batch: QC approved-by user
    approver_ids = {l.qc_approved_by for l in lots if l.qc_approved_by}
    all_user_ids = set(received_by_lot.values()) | approver_ids
    user_map = _resolve_user_map(db, all_user_ids)

    # Resolve antibody names (short for column, full for PDF headers)
    ab_ids = {l.antibody_id for l in lots}
    ab_map = _antibody_name_map(db, ab_ids)
    ab_full = _antibody_full_map(db, ab_ids)

    result = []
    for lot in lots:
        lot_vials = vials_by_lot.get(lot.id, [])
        opened_dates = [v.opened_at for v in lot_vials if v.opened_at]
        received_dates = [v.received_at for v in lot_vials if v.received_at]

        result.append({
            "antibody": ab_map.get(lot.antibody_id, ""),
            "antibody_full": ab_full.get(lot.antibody_id, ""),
            "lot_number": lot.lot_number,
            "expiration": _fmt_date(lot.expiration_date),
            "received": _fmt_date(min(received_dates)) if received_dates else "",
            "received_by": user_map.get(received_by_lot.get(lot.id), ""),
            "qc_doc": "Yes" if lot.id in qc_doc_lot_ids else "No",
            "qc_approved": _fmt_date(lot.qc_approved_at),
            "qc_approved_by": user_map.get(lot.qc_approved_by, "") if lot.qc_approved_by else "",
            "first_opened": _fmt_date(min(opened_dates)) if opened_dates else "",
            "last_opened": _fmt_date(max(opened_dates)) if opened_dates else "",
        })

    return result


def get_lot_activity_range(
    db: Session,
    *,
    lab_id: UUID,
    antibody_id: UUID | None = None,
) -> tuple[datetime | None, datetime | None]:
    """Min/max lot.created_at, optionally filtered by antibody."""
    q = db.query(sa_func.min(Lot.created_at), sa_func.max(Lot.created_at)).filter(
        Lot.lab_id == lab_id
    )
    if antibody_id:
        q = q.filter(Lot.antibody_id == antibody_id)
    row = q.one()
    return row[0], row[1]


# ── Usage Report ──────────────────────────────────────────────────────────


def get_usage_data(
    db: Session,
    *,
    lab_id: UUID,
    antibody_id: UUID | None = None,
    lot_id: UUID | None = None,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    """Consumption analytics: one row per lot with rate and status."""
    lots_q = db.query(Lot).filter(Lot.lab_id == lab_id)
    if antibody_id:
        lots_q = lots_q.filter(Lot.antibody_id == antibody_id)
    if lot_id:
        lots_q = lots_q.filter(Lot.id == lot_id)
    if date_from:
        lots_q = lots_q.filter(Lot.created_at >= date_from)
    if date_to:
        lots_q = lots_q.filter(Lot.created_at < _make_date_inclusive(date_to))
    lots = lots_q.order_by(Lot.created_at.desc()).all()
    if not lots:
        return []

    lot_ids = [l.id for l in lots]
    vials = db.query(Vial).filter(Vial.lot_id.in_(lot_ids)).all()
    vials_by_lot: dict[UUID, list[Vial]] = {}
    for v in vials:
        vials_by_lot.setdefault(v.lot_id, []).append(v)

    # Resolve antibody names
    ab_ids = {l.antibody_id for l in lots}
    ab_map = _antibody_name_map(db, ab_ids)
    ab_full = _antibody_full_map(db, ab_ids)

    now = datetime.now(timezone.utc)
    result = []
    for lot in lots:
        lot_vials = vials_by_lot.get(lot.id, [])
        total = len(lot_vials)
        consumed = sum(1 for v in lot_vials if v.status in (VialStatus.OPENED, VialStatus.DEPLETED))
        opened_dates = [v.opened_at for v in lot_vials if v.opened_at]
        depleted_dates = [v.depleted_at for v in lot_vials if v.depleted_at]
        received_dates = [v.received_at for v in lot_vials if v.received_at]

        first_opened = min(opened_dates) if opened_dates else None
        last_opened = max(opened_dates) if opened_dates else None

        # Avg consumption per week
        avg_week = ""
        if first_opened and consumed > 0:
            end_point = max(depleted_dates) if depleted_dates else now
            weeks = max(1, (end_point - first_opened).days / 7)
            avg_week = f"{consumed / weeks:.1f}"

        # Status
        sealed = sum(1 for v in lot_vials if v.status == VialStatus.SEALED)
        opened_count = sum(1 for v in lot_vials if v.status == VialStatus.OPENED)
        if lot.is_archived:
            status = "Archived"
        elif sealed == 0 and opened_count == 0 and total > 0:
            status = "Depleted"
        elif total == 0:
            status = "Empty"
        else:
            status = "Active"

        result.append({
            "antibody": ab_map.get(lot.antibody_id, ""),
            "antibody_full": ab_full.get(lot.antibody_id, ""),
            "lot_number": lot.lot_number,
            "lot_id": str(lot.id),
            "expiration_raw": lot.expiration_date,
            "is_archived": lot.is_archived,
            "sealed_count": sealed,
            "_first_opened_dt": first_opened,
            "_last_opened_dt": last_opened,
            "expiration": _fmt_date(lot.expiration_date),
            "received": _fmt_date(min(received_dates)) if received_dates else "",
            "vials_received": total,
            "vials_consumed": consumed,
            "first_opened": _fmt_date(first_opened),
            "last_opened": _fmt_date(last_opened),
            "avg_week": avg_week,
            "status": status,
        })

    # FEFO Current/New badges per antibody: among non-archived lots with
    # sealed vials, the one with the earliest expiration date is "Current",
    # rest are "New".  Group by antibody so cross-antibody lots don't clash.
    by_ab: dict[str, list[dict]] = {}
    for r in result:
        if not r["is_archived"] and r["sealed_count"] > 0:
            by_ab.setdefault(r["antibody"], []).append(r)

    def _exp_key(r: dict):
        return (r["expiration_raw"] is None, r["expiration_raw"] or "")

    for eligible in by_ab.values():
        if len(eligible) >= 2:
            eligible.sort(key=_exp_key)
            current_id = eligible[0]["lot_id"]
            for r in result:
                if r["lot_id"] == current_id:
                    r["status"] = "Current"
                elif r in eligible:
                    r["status"] = "New"

    # Antibody-level weighted average: total consumed / weeks between
    # earliest first_opened and latest last_opened across lots in this report
    ab_stats: dict[str, dict] = {}
    for r in result:
        ab = r["antibody"]
        if ab not in ab_stats:
            ab_stats[ab] = {"consumed": 0, "first_opened": None, "last_opened": None}
        ab_stats[ab]["consumed"] += r["vials_consumed"]
        fo = r["_first_opened_dt"]
        lo = r["_last_opened_dt"]
        if fo:
            cur = ab_stats[ab]["first_opened"]
            if cur is None or fo < cur:
                ab_stats[ab]["first_opened"] = fo
        if lo:
            cur = ab_stats[ab]["last_opened"]
            if cur is None or lo > cur:
                ab_stats[ab]["last_opened"] = lo

    ab_avg: dict[str, str] = {}
    for ab, stats in ab_stats.items():
        if stats["first_opened"] and stats["last_opened"] and stats["consumed"] > 0:
            weeks = max(1, (stats["last_opened"] - stats["first_opened"]).days / 7)
            ab_avg[ab] = f"{stats['consumed'] / weeks:.1f}"
        else:
            ab_avg[ab] = ""

    for r in result:
        r["ab_avg_week"] = ab_avg.get(r["antibody"], "")

    # Remove internal fields before returning
    for r in result:
        del r["lot_id"]
        del r["expiration_raw"]
        del r["is_archived"]
        del r["sealed_count"]
        del r["_first_opened_dt"]
        del r["_last_opened_dt"]

    return result


# ── Admin Activity Report ─────────────────────────────────────────────────

ADMIN_ACTIONS = [
    "user.created",
    "user.role_changed",
    "user.updated",
    "user.password_reset",
    "user.password_changed",
    "user.password_set_via_invite",
    "lab.settings_updated",
    "lab.suspended",
    "lab.reactivated",
    "lab.billing_updated",
    "support.impersonate_start",
    "support.impersonate_end",
    "fluorochrome.updated",
    "fluorochrome.archived",
    "storage_unit.created",
    "storage_unit.deleted",
]

ACTION_LABELS = {
    "user.created": "User Created",
    "user.role_changed": "Role Changed",
    "user.updated": "User Updated",
    "user.password_reset": "Password Reset",
    "user.password_changed": "Password Changed",
    "user.password_set_via_invite": "Invite Accepted",
    "lab.settings_updated": "Settings Updated",
    "lab.suspended": "Lab Suspended",
    "lab.reactivated": "Lab Reactivated",
    "lab.billing_updated": "Billing Updated",
    "support.impersonate_start": "Support Session Started",
    "support.impersonate_end": "Support Session Ended",
    "fluorochrome.updated": "Fluorochrome Updated",
    "fluorochrome.archived": "Fluorochrome Archived",
    "storage_unit.created": "Storage Unit Created",
    "storage_unit.deleted": "Storage Unit Deleted",
}


def get_admin_activity_data(
    db: Session,
    *,
    lab_id: UUID,
    date_from: date | None = None,
    date_to: date | None = None,
) -> list[dict]:
    """Admin/settings audit events with human-readable labels."""
    q = db.query(AuditLog).filter(
        AuditLog.lab_id == lab_id,
        AuditLog.action.in_(ADMIN_ACTIONS),
    )
    if date_from:
        q = q.filter(AuditLog.created_at >= date_from)
    if date_to:
        q = q.filter(AuditLog.created_at < _make_date_inclusive(date_to))

    logs = q.order_by(AuditLog.created_at.desc()).limit(MAX_AUDIT_ROWS).all()
    if not logs:
        return []

    user_map = _resolve_user_map(db, {log.user_id for log in logs})
    labels_map, _ = batch_resolve_audit_logs(db, logs)

    return [
        {
            "timestamp": log.created_at.isoformat() if log.created_at else "",
            "action": ACTION_LABELS.get(log.action, log.action),
            "performed_by": user_map.get(log.user_id, str(log.user_id)),
            "target": labels_map.get(log.entity_id, str(log.entity_id)),
            "details": log.note or "",
        }
        for log in logs
    ]


def get_admin_activity_range(
    db: Session,
    *,
    lab_id: UUID,
) -> tuple[datetime | None, datetime | None]:
    row = (
        db.query(sa_func.min(AuditLog.created_at), sa_func.max(AuditLog.created_at))
        .filter(AuditLog.lab_id == lab_id, AuditLog.action.in_(ADMIN_ACTIONS))
        .one()
    )
    return row[0], row[1]


# ── Audit Trail Export ────────────────────────────────────────────────────


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
        q = q.filter(AuditLog.created_at < _make_date_inclusive(date_to))
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
