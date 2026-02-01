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

    # Find empty cells if storage unit specified
    empty_cells: list[StorageCell] = []
    if storage_unit_id:
        unit = (
            db.query(StorageUnit)
            .filter(StorageUnit.id == storage_unit_id, StorageUnit.lab_id == user.lab_id)
            .first()
        )
        if not unit:
            raise HTTPException(status_code=404, detail="Storage unit not found")

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
        if len(empty_cells) < quantity:
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

    for vial in vials:
        log_audit(
            db,
            lab_id=user.lab_id,
            user_id=user.id,
            action="vial.received",
            entity_type="vial",
            entity_id=vial.id,
            after_state=snapshot_vial(vial),
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

    before = snapshot_vial(vial)

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
        log_audit(
            db,
            lab_id=user.lab_id,
            user_id=user.id,
            action="vial.depleted",
            entity_type="vial",
            entity_id=vial.id,
            before_state=before,
            after_state=snapshot_vial(vial),
            note="Sealed counts only — direct deplete" + (
                f"; QC override: lot status was '{lot.qc_status.value}'" if qc_override else ""
            ),
        )
    else:
        vial.status = VialStatus.OPENED
        if qc_override:
            vial.opened_for_qc = True
        vial.opened_at = now
        vial.opened_by = user.id
        vial.location_cell_id = None  # free the cell

        # Calculate stability-based open expiration
        if lot:
            antibody = db.query(Antibody).filter(Antibody.id == lot.antibody_id).first()
            if antibody and antibody.stability_days:
                vial.open_expiration = (vial.opened_at + timedelta(days=antibody.stability_days)).date()

        log_audit(
            db,
            lab_id=user.lab_id,
            user_id=user.id,
            action="vial.opened",
            entity_type="vial",
            entity_id=vial.id,
            before_state=before,
            after_state=snapshot_vial(vial),
            note=f"QC override: lot status was '{lot.qc_status.value}'" if qc_override else None,
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

    before = snapshot_vial(vial)

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
        after_state=snapshot_vial(vial),
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
        before = snapshot_vial(vial)
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
            after_state=snapshot_vial(vial),
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
        before = snapshot_vial(vial)
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
            after_state=snapshot_vial(vial),
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
    opened_for_qc: bool | None = None,
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

    before = snapshot_vial(vial)

    vial.location_cell_id = cell_id
    if opened_for_qc is not None:
        vial.opened_for_qc = opened_for_qc

    log_audit(
        db,
        lab_id=user.lab_id,
        user_id=user.id,
        action="vial.returned_to_storage",
        entity_type="vial",
        entity_id=vial.id,
        before_state=before,
        after_state=snapshot_vial(vial),
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

    before = snapshot_vial(vial)

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
        after_state=snapshot_vial(vial),
        note=note,
    )

    db.commit()
    db.refresh(vial)
    return vial
