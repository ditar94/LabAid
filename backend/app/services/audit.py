import json
from uuid import UUID

from sqlalchemy.orm import Session

from app.models.models import AuditLog


def is_support(user) -> bool:
    """Check if the current action is being performed by an impersonating super admin."""
    return getattr(user, "_is_impersonating", False)


def log_audit(
    db: Session,
    *,
    lab_id: UUID,
    user_id: UUID,
    action: str,
    entity_type: str,
    entity_id: UUID,
    before_state: dict | None = None,
    after_state: dict | None = None,
    note: str | None = None,
    is_support_action: bool = False,
) -> AuditLog:
    entry = AuditLog(
        lab_id=lab_id,
        user_id=user_id,
        action=action,
        entity_type=entity_type,
        entity_id=entity_id,
        before_state=json.dumps(before_state, default=str) if before_state else None,
        after_state=json.dumps(after_state, default=str) if after_state else None,
        note=note,
        is_support_action=is_support_action,
    )
    db.add(entry)
    return entry


def snapshot_vial(vial, *, db=None) -> dict:
    d = {
        "id": str(vial.id),
        "lot_id": str(vial.lot_id),
        "status": vial.status.value if vial.status else None,
        "location_cell_id": str(vial.location_cell_id) if vial.location_cell_id else None,
        "opened_at": str(vial.opened_at) if vial.opened_at else None,
        "opened_by": str(vial.opened_by) if vial.opened_by else None,
        "depleted_at": str(vial.depleted_at) if vial.depleted_at else None,
    }
    # Resolve storage location if db session provided
    if db and vial.location_cell_id:
        from app.models.models import StorageCell, StorageUnit
        cell = db.get(StorageCell, vial.location_cell_id)
        if cell:
            unit = db.get(StorageUnit, cell.storage_unit_id)
            d["storage_unit"] = unit.name if unit else None
            d["storage_cell"] = cell.label or f"R{cell.row + 1}C{cell.col + 1}"
    return d


def snapshot_user(user) -> dict:
    return {
        "id": str(user.id),
        "email": user.email,
        "full_name": user.full_name,
        "role": user.role.value if user.role else None,
        "is_active": user.is_active,
        "lab_id": str(user.lab_id) if user.lab_id else None,
    }


def snapshot_lab(lab) -> dict:
    return {
        "id": str(lab.id),
        "name": lab.name,
        "is_active": lab.is_active,
        "settings": lab.settings or {},
    }


def snapshot_fluorochrome(fluoro) -> dict:
    return {
        "id": str(fluoro.id),
        "name": fluoro.name,
        "color": fluoro.color,
        "is_active": fluoro.is_active,
        "lab_id": str(fluoro.lab_id),
    }


def snapshot_antibody(ab) -> dict:
    return {
        "id": str(ab.id),
        "target": ab.target,
        "fluorochrome": ab.fluorochrome,
        "clone": ab.clone,
        "vendor": ab.vendor,
        "catalog_number": ab.catalog_number,
        "designation": ab.designation.value if ab.designation else None,
        "name": ab.name,
        "stability_days": ab.stability_days,
        "low_stock_threshold": ab.low_stock_threshold,
        "approved_low_threshold": ab.approved_low_threshold,
        "is_active": ab.is_active,
        "components": [
            {"target": c.target, "fluorochrome": c.fluorochrome, "clone": c.clone, "ordinal": c.ordinal}
            for c in (ab.components or [])
        ],
    }


def snapshot_lot(lot) -> dict:
    return {
        "id": str(lot.id),
        "lot_number": lot.lot_number,
        "qc_status": lot.qc_status.value if lot.qc_status else None,
        "qc_approved_by": str(lot.qc_approved_by) if lot.qc_approved_by else None,
        "is_archived": lot.is_archived,
    }
