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


def batch_resolve_audit_logs(
    db: "Session", logs: list
) -> tuple[dict["UUID", str], dict["UUID", dict]]:
    """Batch-resolve entity labels and lineage for a list of audit log rows.

    Returns (labels_map, lineage_map) keyed by entity_id.
    """
    from app.models.models import (
        Antibody,
        Fluorochrome,
        Lab,
        Lot,
        LotDocument,
        StorageCell,
        StorageUnit,
        User,
        Vial,
    )

    # Group entity IDs by type
    ids_by_type: dict[str, set] = {}
    for log in logs:
        ids_by_type.setdefault(log.entity_type, set()).add(log.entity_id)

    labels: dict = {}
    lineage: dict = {}

    # ── Bulk-load each entity type ──

    ab_ids = ids_by_type.get("antibody", set())
    ab_map: dict = {}
    if ab_ids:
        rows = db.query(Antibody).filter(Antibody.id.in_(ab_ids)).all()
        ab_map = {a.id: a for a in rows}
        for a in rows:
            labels[a.id] = f"{a.target} - {a.fluorochrome}"
            lineage[a.id] = {"lot_id": None, "antibody_id": a.id}

    lot_ids_direct = ids_by_type.get("lot", set())
    lot_map: dict = {}
    if lot_ids_direct:
        rows = db.query(Lot).filter(Lot.id.in_(lot_ids_direct)).all()
        lot_map = {l.id: l for l in rows}
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
        vial_lot_ids = {v.lot_id for v in vials} - set(lot_map.keys())
        if vial_lot_ids:
            extra = db.query(Lot).filter(Lot.id.in_(vial_lot_ids)).all()
            lot_map.update({l.id: l for l in extra})
        extra_ab_ids = {lot_map[v.lot_id].antibody_id for v in vials if v.lot_id in lot_map and lot_map[v.lot_id].antibody_id} - set(ab_map.keys())
        if extra_ab_ids:
            extra = db.query(Antibody).filter(Antibody.id.in_(extra_ab_ids)).all()
            ab_map.update({a.id: a for a in extra})
        cell_ids = [v.location_cell_id for v in vials if v.location_cell_id]
        cell_map: dict = {}
        unit_map: dict = {}
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
        doc_lot_ids = {d.lot_id for d in docs} - set(lot_map.keys())
        if doc_lot_ids:
            extra = db.query(Lot).filter(Lot.id.in_(doc_lot_ids)).all()
            lot_map.update({l.id: l for l in extra})
        doc_ab_ids = {lot_map[d.lot_id].antibody_id for d in docs if d.lot_id in lot_map and lot_map[d.lot_id].antibody_id} - set(ab_map.keys())
        if doc_ab_ids:
            extra = db.query(Antibody).filter(Antibody.id.in_(doc_ab_ids)).all()
            ab_map.update({a.id: a for a in extra})

        found_doc_ids = set()
        for d in docs:
            lot = lot_map.get(d.lot_id)
            ab = ab_map.get(lot.antibody_id) if lot and lot.antibody_id else None
            if ab and lot:
                labels[d.id] = f"{ab.target} {ab.fluorochrome} — Lot {lot.lot_number}"
            elif lot:
                labels[d.id] = f"Lot {lot.lot_number}"
            else:
                labels[d.id] = d.file_name
            lineage[d.id] = {"lot_id": d.lot_id, "antibody_id": lot.antibody_id if lot else None}
            found_doc_ids.add(d.id)

        # Fallback for deleted documents: parse state JSON from audit log entries
        missing_doc_ids = doc_ids - found_doc_ids
        if missing_doc_ids:
            for log in logs:
                if log.entity_id not in missing_doc_ids:
                    continue
                if log.entity_id in labels:
                    continue
                state_lot_id = None
                for state_json in (log.before_state, log.after_state):
                    if not state_json:
                        continue
                    try:
                        state = json.loads(state_json) if isinstance(state_json, str) else state_json
                        if not state_lot_id and state.get("lot_id"):
                            from uuid import UUID as _UUID
                            state_lot_id = _UUID(state["lot_id"]) if isinstance(state["lot_id"], str) else state["lot_id"]
                    except (json.JSONDecodeError, ValueError, TypeError):
                        continue
                if state_lot_id:
                    if state_lot_id not in lot_map:
                        lot_obj = db.query(Lot).filter(Lot.id == state_lot_id).first()
                        if lot_obj:
                            lot_map[state_lot_id] = lot_obj
                    lot = lot_map.get(state_lot_id)
                    if lot and lot.antibody_id:
                        if lot.antibody_id not in ab_map:
                            ab_obj = db.query(Antibody).filter(Antibody.id == lot.antibody_id).first()
                            if ab_obj:
                                ab_map[lot.antibody_id] = ab_obj
                        ab = ab_map.get(lot.antibody_id)
                        if ab:
                            labels[log.entity_id] = f"{ab.target} {ab.fluorochrome} — Lot {lot.lot_number}"
                        else:
                            labels[log.entity_id] = f"Lot {lot.lot_number}"
                    elif lot:
                        labels[log.entity_id] = f"Lot {lot.lot_number}"
                    lineage[log.entity_id] = {"lot_id": state_lot_id, "antibody_id": lot.antibody_id if lot else None}
                else:
                    lineage[log.entity_id] = {"lot_id": None, "antibody_id": None}

    return labels, lineage


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
        "billing_status": getattr(lab, "billing_status", None),
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
