from datetime import datetime, timedelta, timezone
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy.orm import Session

from app.models.models import (
    Antibody,
    Lab,
    Lot,
    QCStatus,
    StorageCell,
    StorageUnit,
    User,
    Vial,
    VialStatus,
)
from app.services.audit import log_audit, snapshot_vial
from app.services.storage import (
    ensure_temporary_storage_capacity,
    get_temporary_storage,
)


def receive_vials(
    db: Session,
    *,
    lot_id: UUID,
    quantity: int,
    storage_unit_id: UUID | None,
    user: User,
) -> list[Vial]:
    lot = (
        db.query(Lot)
        .filter(Lot.id == lot_id, Lot.lab_id == user.lab_id)
        .first()
    )
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")

    # Find empty cells if storage unit specified, or auto-assign to temporary storage
    empty_cells: list[StorageCell] = []
    unit: StorageUnit | None = None

    if storage_unit_id:
        unit = (
            db.query(StorageUnit)
            .filter(StorageUnit.id == storage_unit_id, StorageUnit.lab_id == user.lab_id)
            .first()
        )
        if not unit:
            raise HTTPException(status_code=404, detail="Storage unit not found")
    else:
        # Auto-assign to temporary storage
        unit = get_temporary_storage(db, user.lab_id)
        if unit:
            storage_unit_id = unit.id

    if unit:
        # For temporary storage, ensure we have enough capacity
        if unit.is_temporary:
            # Count current vials + new quantity
            current_vial_count = (
                db.query(Vial)
                .join(StorageCell, Vial.location_cell_id == StorageCell.id)
                .filter(StorageCell.storage_unit_id == unit.id)
                .count()
            )
            ensure_temporary_storage_capacity(db, unit, current_vial_count + quantity)
            db.flush()

        # Get cells that don't have a vial assigned
        occupied_cell_ids = (
            db.query(Vial.location_cell_id)
            .filter(Vial.location_cell_id.isnot(None))
            .subquery()
        )
        empty_cells = (
            db.query(StorageCell)
            .filter(
                StorageCell.storage_unit_id == storage_unit_id,
                StorageCell.id.notin_(occupied_cell_ids),
            )
            .order_by(StorageCell.row, StorageCell.col)
            .limit(quantity)
            .all()
        )
        if len(empty_cells) < quantity and not unit.is_temporary:
            raise HTTPException(
                status_code=400,
                detail=f"Only {len(empty_cells)} empty cells available, need {quantity}",
            )

    vials = []
    for i in range(quantity):
        vial = Vial(
            lot_id=lot_id,
            lab_id=user.lab_id,
            status=VialStatus.SEALED,
            location_cell_id=empty_cells[i].id if i < len(empty_cells) else None,
        )
        db.add(vial)
        vials.append(vial)

    db.flush()

    # Build storage location description for the note
    storage_note = ""
    if empty_cells:
        unit = db.get(StorageUnit, empty_cells[0].storage_unit_id)
        unit_name = unit.name if unit else "Unknown"

        def _cell_label(c: StorageCell) -> str:
            return c.label or f"R{c.row + 1}C{c.col + 1}"

        def _cell_sort_key(c: StorageCell) -> tuple[int, int]:
            return (c.row, c.col)

        # Group consecutive cells into ranges
        sorted_cells = sorted(empty_cells, key=_cell_sort_key)
        runs: list[list[StorageCell]] = []
        for cell in sorted_cells:
            if runs and cell.row == runs[-1][-1].row and cell.col == runs[-1][-1].col + 1:
                runs[-1].append(cell)
            else:
                runs.append([cell])

        parts = []
        for run in runs:
            if len(run) == 1:
                parts.append(_cell_label(run[0]))
            else:
                parts.append(f"{_cell_label(run[0])}–{_cell_label(run[-1])}")

        storage_note = f" → {unit_name} [{', '.join(parts)}]"

    # Look up antibody for audit context
    ab = db.query(Antibody).filter(Antibody.id == lot.antibody_id).first()

    # Log a single batch event on the lot
    log_audit(
        db,
        lab_id=user.lab_id,
        user_id=user.id,
        action="vial.received",
        entity_type="lot",
        entity_id=lot_id,
        after_state={
            "lot_number": lot.lot_number,
            "antibody_target": ab.target if ab else None,
            "antibody_fluorochrome": ab.fluorochrome if ab else None,
            "quantity": quantity,
            "vial_ids": [str(v.id) for v in vials],
        },
        note=f"Received {quantity} vial{'s' if quantity != 1 else ''}{storage_note}",
    )

    db.commit()
    for v in vials:
        db.refresh(v)
    return vials


def open_vial(
    db: Session,
    *,
    vial_id: UUID,
    cell_id: UUID,
    user: User,
    force: bool = False,
    skip_older_lot_note: str | None = None,
) -> Vial:
    vial = (
        db.query(Vial)
        .filter(Vial.id == vial_id, Vial.lab_id == user.lab_id)
        .first()
    )
    if not vial:
        raise HTTPException(status_code=404, detail="Vial not found")

    if vial.status != VialStatus.SEALED:
        raise HTTPException(status_code=400, detail=f"Vial is '{vial.status.value}', expected 'sealed'")

    # Confirm the user clicked the correct cell
    if vial.location_cell_id != cell_id:
        raise HTTPException(
            status_code=400,
            detail="Selected cell does not match vial location. Please select the correct cell.",
        )

    # QC enforcement
    lot = db.query(Lot).filter(Lot.id == vial.lot_id).first()
    if lot and lot.qc_status != QCStatus.APPROVED and not force:
        raise HTTPException(
            status_code=409,
            detail=f"QC status is '{lot.qc_status.value}'. Lot must be approved before opening vials.",
        )

    before = snapshot_vial(vial, db=db)

    qc_override = lot and lot.qc_status != QCStatus.APPROVED and force

    # Check sealed_counts_only lab setting
    lab = db.query(Lab).filter(Lab.id == user.lab_id).first()
    sealed_only = lab and (lab.settings or {}).get("sealed_counts_only", False)

    now = datetime.now(timezone.utc)

    if sealed_only:
        # Direct SEALED → DEPLETED
        vial.status = VialStatus.DEPLETED
        vial.opened_at = now
        vial.opened_by = user.id
        vial.depleted_at = now
        vial.depleted_by = user.id
        vial.location_cell_id = None
        note_parts = ["Sealed counts only — direct deplete"]
        if qc_override:
            note_parts.append(f"QC override: lot status was '{lot.qc_status.value}'")
        if skip_older_lot_note:
            note_parts.append(f"Skipped older lot: {skip_older_lot_note}")
        log_audit(
            db,
            lab_id=user.lab_id,
            user_id=user.id,
            action="vial.depleted",
            entity_type="vial",
            entity_id=vial.id,
            before_state=before,
            after_state=snapshot_vial(vial, db=db),
            note="; ".join(note_parts),
        )
    else:
        vial.status = VialStatus.OPENED
        vial.opened_at = now
        vial.opened_by = user.id
        vial.location_cell_id = None  # free the cell

        # Calculate open expiration: min(stability expiration, lot expiration)
        if lot:
            antibody = db.query(Antibody).filter(Antibody.id == lot.antibody_id).first()
            stability_exp = None
            if antibody and antibody.stability_days:
                stability_exp = (vial.opened_at + timedelta(days=antibody.stability_days)).date()
            lot_exp = lot.expiration_date
            if stability_exp and lot_exp:
                vial.open_expiration = min(stability_exp, lot_exp)
            elif stability_exp:
                vial.open_expiration = stability_exp
            elif lot_exp:
                vial.open_expiration = lot_exp

        note_parts: list[str] = []
        if qc_override:
            note_parts.append(f"QC override: lot status was '{lot.qc_status.value}'")
        if skip_older_lot_note:
            note_parts.append(f"Skipped older lot: {skip_older_lot_note}")
        log_audit(
            db,
            lab_id=user.lab_id,
            user_id=user.id,
            action="vial.opened",
            entity_type="vial",
            entity_id=vial.id,
            before_state=before,
            after_state=snapshot_vial(vial, db=db),
            note="; ".join(note_parts) if note_parts else None,
        )

    db.commit()
    db.refresh(vial)
    return vial


def deplete_vial(
    db: Session,
    *,
    vial_id: UUID,
    user: User,
) -> Vial:
    vial = (
        db.query(Vial)
        .filter(Vial.id == vial_id, Vial.lab_id == user.lab_id)
        .first()
    )
    if not vial:
        raise HTTPException(status_code=404, detail="Vial not found")

    if vial.status != VialStatus.OPENED:
        raise HTTPException(status_code=400, detail=f"Vial is '{vial.status.value}', expected 'opened'")

    before = snapshot_vial(vial, db=db)

    vial.status = VialStatus.DEPLETED
    vial.depleted_at = datetime.now(timezone.utc)
    vial.depleted_by = user.id
    vial.location_cell_id = None  # free the cell

    log_audit(
        db,
        lab_id=user.lab_id,
        user_id=user.id,
        action="vial.depleted",
        entity_type="vial",
        entity_id=vial.id,
        before_state=before,
        after_state=snapshot_vial(vial, db=db),
    )

    db.commit()
    db.refresh(vial)
    return vial


def deplete_all_opened(
    db: Session,
    *,
    lot_id: UUID,
    user: User,
) -> list[Vial]:
    """Deplete all opened vials for a lot in one operation."""
    lot = (
        db.query(Lot)
        .filter(Lot.id == lot_id, Lot.lab_id == user.lab_id)
        .first()
    )
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")

    vials = (
        db.query(Vial)
        .filter(
            Vial.lot_id == lot_id,
            Vial.lab_id == user.lab_id,
            Vial.status == VialStatus.OPENED,
        )
        .all()
    )
    if not vials:
        raise HTTPException(status_code=400, detail="No opened vials to deplete")

    now = datetime.now(timezone.utc)
    for vial in vials:
        before = snapshot_vial(vial, db=db)
        vial.status = VialStatus.DEPLETED
        vial.depleted_at = now
        vial.depleted_by = user.id
        vial.location_cell_id = None
        log_audit(
            db,
            lab_id=user.lab_id,
            user_id=user.id,
            action="vial.depleted",
            entity_type="vial",
            entity_id=vial.id,
            before_state=before,
            after_state=snapshot_vial(vial, db=db),
            note="Bulk deplete all",
        )

    db.commit()
    for v in vials:
        db.refresh(v)
    return vials


def deplete_all_lot(
    db: Session,
    *,
    lot_id: UUID,
    user: User,
) -> list[Vial]:
    """Deplete ALL non-depleted vials (sealed + opened) for a lot."""
    lot = (
        db.query(Lot)
        .filter(Lot.id == lot_id, Lot.lab_id == user.lab_id)
        .first()
    )
    if not lot:
        raise HTTPException(status_code=404, detail="Lot not found")

    vials = (
        db.query(Vial)
        .filter(
            Vial.lot_id == lot_id,
            Vial.lab_id == user.lab_id,
            Vial.status.in_([VialStatus.SEALED, VialStatus.OPENED]),
        )
        .all()
    )
    if not vials:
        raise HTTPException(status_code=400, detail="No active vials to deplete")

    now = datetime.now(timezone.utc)
    for vial in vials:
        before = snapshot_vial(vial, db=db)
        was_sealed = vial.status == VialStatus.SEALED
        vial.status = VialStatus.DEPLETED
        vial.depleted_at = now
        vial.depleted_by = user.id
        if was_sealed:
            vial.opened_at = now
            vial.opened_by = user.id
        vial.location_cell_id = None
        log_audit(
            db,
            lab_id=user.lab_id,
            user_id=user.id,
            action="vial.depleted",
            entity_type="vial",
            entity_id=vial.id,
            before_state=before,
            after_state=snapshot_vial(vial, db=db),
            note="Bulk deplete entire lot",
        )

    db.commit()
    for v in vials:
        db.refresh(v)
    return vials


def return_to_storage(
    db: Session,
    *,
    vial_id: UUID,
    cell_id: UUID,
    user: User,
) -> Vial:
    """Place an opened vial back into a storage cell."""
    vial = (
        db.query(Vial)
        .filter(Vial.id == vial_id, Vial.lab_id == user.lab_id)
        .first()
    )
    if not vial:
        raise HTTPException(status_code=404, detail="Vial not found")

    if vial.status != VialStatus.OPENED:
        raise HTTPException(status_code=400, detail=f"Vial is '{vial.status.value}', expected 'opened'")

    # Verify cell exists and is empty
    cell = db.query(StorageCell).filter(StorageCell.id == cell_id).first()
    if not cell:
        raise HTTPException(status_code=404, detail="Storage cell not found")

    # Verify cell's storage unit belongs to user's lab
    unit = (
        db.query(StorageUnit)
        .filter(StorageUnit.id == cell.storage_unit_id, StorageUnit.lab_id == user.lab_id)
        .first()
    )
    if not unit:
        raise HTTPException(status_code=403, detail="Storage unit does not belong to your lab")

    # Check cell is empty
    occupant = (
        db.query(Vial)
        .filter(Vial.location_cell_id == cell_id, Vial.id != vial_id)
        .first()
    )
    if occupant:
        raise HTTPException(status_code=400, detail="Cell is already occupied")

    before = snapshot_vial(vial, db=db)

    vial.location_cell_id = cell_id

    log_audit(
        db,
        lab_id=user.lab_id,
        user_id=user.id,
        action="vial.returned_to_storage",
        entity_type="vial",
        entity_id=vial.id,
        before_state=before,
        after_state=snapshot_vial(vial, db=db),
    )

    db.commit()
    db.refresh(vial)
    return vial


def correct_vial(
    db: Session,
    *,
    vial_id: UUID,
    note: str,
    user: User,
    revert_to: VialStatus,
    restore_cell_id: UUID | None = None,
) -> Vial:
    """Revert a vial status change (undo open or deplete)."""
    vial = (
        db.query(Vial)
        .filter(Vial.id == vial_id, Vial.lab_id == user.lab_id)
        .first()
    )
    if not vial:
        raise HTTPException(status_code=404, detail="Vial not found")

    before = snapshot_vial(vial, db=db)

    vial.status = revert_to
    if revert_to == VialStatus.SEALED:
        vial.opened_at = None
        vial.opened_by = None
        if restore_cell_id:
            # Verify cell is empty
            existing = (
                db.query(Vial)
                .filter(Vial.location_cell_id == restore_cell_id, Vial.id != vial_id)
                .first()
            )
            if existing:
                raise HTTPException(status_code=400, detail="Cell is occupied by another vial")
            vial.location_cell_id = restore_cell_id
    elif revert_to == VialStatus.OPENED:
        vial.depleted_at = None
        vial.depleted_by = None

    log_audit(
        db,
        lab_id=user.lab_id,
        user_id=user.id,
        action="vial.corrected",
        entity_type="vial",
        entity_id=vial.id,
        before_state=before,
        after_state=snapshot_vial(vial, db=db),
        note=note,
    )

    db.commit()
    db.refresh(vial)
    return vial


def move_vials(
    db: Session,
    *,
    vial_ids: list[UUID],
    target_unit_id: UUID,
    start_cell_id: UUID | None,
    target_cell_ids: list[UUID] | None = None,
    user: User,
) -> list[Vial]:
    """
    Move vials to a different storage unit.
    If target_cell_ids is provided, vials are placed into exactly those cells.
    Elif start_cell_id is provided, vials are placed starting from that cell.
    Otherwise, they're placed in the next available cells in row-major order.
    """
    if not vial_ids:
        raise HTTPException(status_code=400, detail="No vials specified")

    # Verify target unit belongs to user's lab
    target_unit = (
        db.query(StorageUnit)
        .filter(StorageUnit.id == target_unit_id, StorageUnit.lab_id == user.lab_id)
        .first()
    )
    if not target_unit:
        raise HTTPException(status_code=404, detail="Target storage unit not found")

    # Get all vials and verify they belong to user's lab
    vials = (
        db.query(Vial)
        .filter(Vial.id.in_(vial_ids), Vial.lab_id == user.lab_id)
        .all()
    )
    if len(vials) != len(vial_ids):
        raise HTTPException(status_code=404, detail="One or more vials not found")

    # Verify all vials are not depleted and not from archived lots
    for vial in vials:
        if vial.status == VialStatus.DEPLETED:
            raise HTTPException(status_code=400, detail="Cannot move depleted vials")
        lot = db.query(Lot).filter(Lot.id == vial.lot_id).first()
        if lot and lot.is_archived:
            raise HTTPException(status_code=400, detail="Cannot move vials from archived lots")

    # For temporary storage, ensure capacity
    if target_unit.is_temporary:
        current_vial_count = (
            db.query(Vial)
            .join(StorageCell, Vial.location_cell_id == StorageCell.id)
            .filter(StorageCell.storage_unit_id == target_unit_id)
            .count()
        )
        # Count vials not already in this unit
        vials_to_add = sum(1 for v in vials if v.location_cell_id is None or
            db.query(StorageCell).filter(StorageCell.id == v.location_cell_id, StorageCell.storage_unit_id != target_unit_id).first())
        ensure_temporary_storage_capacity(db, target_unit, current_vial_count + vials_to_add)
        db.flush()

    # Get available cells in target unit
    occupied_cell_ids = (
        db.query(Vial.location_cell_id)
        .filter(
            Vial.location_cell_id.isnot(None),
            ~Vial.id.in_(vial_ids),  # Exclude vials being moved
        )
        .subquery()
    )

    # If target_cell_ids specified, place vials into exactly those cells
    if target_cell_ids:
        if len(target_cell_ids) != len(vials):
            raise HTTPException(
                status_code=400,
                detail=f"Number of target cells ({len(target_cell_ids)}) must match number of vials ({len(vials)})",
            )
        target_cells = (
            db.query(StorageCell)
            .filter(
                StorageCell.id.in_(target_cell_ids),
                StorageCell.storage_unit_id == target_unit_id,
                StorageCell.id.notin_(occupied_cell_ids),
            )
            .all()
        )
        if len(target_cells) != len(target_cell_ids):
            raise HTTPException(
                status_code=400,
                detail="One or more target cells are invalid or occupied",
            )
        # Preserve the order from target_cell_ids
        cell_by_id = {c.id: c for c in target_cells}
        empty_cells = [cell_by_id[cid] for cid in target_cell_ids]
    else:
        cells_query = (
            db.query(StorageCell)
            .filter(
                StorageCell.storage_unit_id == target_unit_id,
                StorageCell.id.notin_(occupied_cell_ids),
            )
            .order_by(StorageCell.row, StorageCell.col)
        )

        # If start_cell_id specified, filter to cells at or after that position
        if start_cell_id:
            start_cell = db.query(StorageCell).filter(StorageCell.id == start_cell_id).first()
            if not start_cell or start_cell.storage_unit_id != target_unit_id:
                raise HTTPException(status_code=400, detail="Invalid start cell")
            cells_query = cells_query.filter(
                (StorageCell.row > start_cell.row) |
                ((StorageCell.row == start_cell.row) & (StorageCell.col >= start_cell.col))
            )

        empty_cells = cells_query.limit(len(vials)).all()

    if len(empty_cells) < len(vials):
        raise HTTPException(
            status_code=400,
            detail=f"Not enough empty cells in target unit. Need {len(vials)}, have {len(empty_cells)}",
        )

    # Snapshot before state and track source locations per vial
    before_snapshots: list[dict] = []
    source_labels: list[str] = []
    for vial in vials:
        before_snapshots.append(snapshot_vial(vial, db=db))
        if vial.location_cell_id:
            old_cell = db.query(StorageCell).filter(StorageCell.id == vial.location_cell_id).first()
            if old_cell:
                old_unit = db.query(StorageUnit).filter(StorageUnit.id == old_cell.storage_unit_id).first()
                source_labels.append(f"{old_unit.name if old_unit else 'Unknown'} [{old_cell.label}]")
            else:
                source_labels.append("unassigned")
        else:
            source_labels.append("unassigned")

    # Move vials to new cells
    for i, vial in enumerate(vials):
        vial.location_cell_id = empty_cells[i].id

    # Consolidated audit: one entry per lot
    from collections import defaultdict
    lots_vials: dict[UUID, list[int]] = defaultdict(list)
    for i, vial in enumerate(vials):
        lots_vials[vial.lot_id].append(i)

    for lot_id, indices in lots_vials.items():
        lot = db.query(Lot).filter(Lot.id == lot_id).first()
        lot_label = lot.lot_number if lot else str(lot_id)[:8]

        # Collect unique source descriptions
        sources = list(dict.fromkeys(source_labels[i] for i in indices))
        target_cells = [empty_cells[i].label for i in indices]
        source_desc = ", ".join(sources)
        target_desc = f"{target_unit.name} [{', '.join(target_cells)}]"

        log_audit(
            db,
            lab_id=user.lab_id,
            user_id=user.id,
            action="vials.moved",
            entity_type="lot",
            entity_id=lot_id,
            before_state={
                "lot_number": lot_label,
                "vial_count": len(indices),
                "vials": [before_snapshots[i] for i in indices],
            },
            after_state={
                "lot_number": lot_label,
                "vial_count": len(indices),
                "vials": [snapshot_vial(vials[i], db=db) for i in indices],
            },
            note=f"Moved {len(indices)} vial(s) of lot {lot_label} from {source_desc} to {target_desc}",
        )

    db.commit()
    for v in vials:
        db.refresh(v)
    return vials
