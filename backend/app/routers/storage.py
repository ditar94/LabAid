from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user, require_role
from app.models.models import Antibody, Lot, StorageCell, StorageUnit, User, UserRole, Vial, VialStatus, Fluorochrome
from app.schemas.schemas import (
    StorageCellOut,
    StorageGridOut,
    StorageUnitCreate,
    StorageUnitOut,
    VialSummary,
)
from app.services.audit import log_audit, snapshot_vial

router = APIRouter(prefix="/api/storage", tags=["storage"])


def _build_cell_out(db: Session, cell: StorageCell, fluorochromes: list[Fluorochrome] = []) -> StorageCellOut:
    """Build a StorageCellOut with enriched vial details."""
    vial = db.query(Vial).filter(Vial.location_cell_id == cell.id).first()
    vial_summary = None
    if vial:
        lot = db.query(Lot).filter(Lot.id == vial.lot_id).first()
        antibody = db.query(Antibody).filter(Antibody.id == lot.antibody_id).first() if lot else None
        color = None
        if antibody:
            fluoro = next((f for f in fluorochromes if f.name.lower() == antibody.fluorochrome.lower()), None)
            if fluoro:
                color = fluoro.color
        vial_summary = VialSummary(
            id=vial.id,
            lot_id=vial.lot_id,
            status=vial.status,
            lot_number=lot.lot_number if lot else None,
            expiration_date=lot.expiration_date if lot else None,
            antibody_target=antibody.target if antibody else None,
            antibody_fluorochrome=antibody.fluorochrome if antibody else None,
            color=color,
            qc_status=lot.qc_status.value if lot and lot.qc_status else None,
        )
    return StorageCellOut(
        id=cell.id,
        storage_unit_id=cell.storage_unit_id,
        row=cell.row,
        col=cell.col,
        label=cell.label,
        vial_id=vial.id if vial else None,
        vial=vial_summary,
    )


@router.get("/units", response_model=list[StorageUnitOut])
def list_storage_units(
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(StorageUnit)
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        q = q.filter(StorageUnit.lab_id == lab_id)
    else:
        q = q.filter(StorageUnit.lab_id == current_user.lab_id)

    return q.filter(StorageUnit.is_active.is_(True)).order_by(StorageUnit.name).all()


@router.post("/units", response_model=StorageUnitOut)
def create_storage_unit(
    body: StorageUnitCreate,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN)),
):
    if body.rows < 1 or body.rows > 26 or body.cols < 1 or body.cols > 26:
        raise HTTPException(status_code=400, detail="Rows and cols must be between 1 and 26")

    target_lab_id = current_user.lab_id
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        target_lab_id = lab_id

    unit = StorageUnit(
        lab_id=target_lab_id,
        name=body.name,
        rows=body.rows,
        cols=body.cols,
        temperature=body.temperature,
    )
    db.add(unit)
    db.flush()

    for r in range(body.rows):
        for c in range(body.cols):
            label = f"{chr(65 + r)}{c + 1}"
            cell = StorageCell(
                storage_unit_id=unit.id,
                row=r,
                col=c,
                label=label,
            )
            db.add(cell)

    log_audit(
        db,
        lab_id=target_lab_id,
        user_id=current_user.id,
        action="storage_unit.created",
        entity_type="storage_unit",
        entity_id=unit.id,
        after_state={"name": unit.name, "rows": unit.rows, "cols": unit.cols},
    )

    db.commit()
    db.refresh(unit)
    return unit


@router.get("/units/{unit_id}/grid", response_model=StorageGridOut)
def get_storage_grid(
    unit_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    q = db.query(StorageUnit).filter(StorageUnit.id == unit_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(StorageUnit.lab_id == current_user.lab_id)
    unit = q.first()

    if not unit:
        raise HTTPException(status_code=404, detail="Storage unit not found")

    fluorochromes = db.query(Fluorochrome).filter(Fluorochrome.lab_id == unit.lab_id).all()

    cells = (
        db.query(StorageCell)
        .filter(StorageCell.storage_unit_id == unit_id)
        .order_by(StorageCell.row, StorageCell.col)
        .all()
    )

    return StorageGridOut(
        unit=unit,
        cells=[_build_cell_out(db, cell, fluorochromes) for cell in cells],
    )


# ── Stocking workflow ────────────────────────────────────────────────────


class StockVialRequest(BaseModel):
    barcode: str


@router.get("/units/{unit_id}/next-empty", response_model=StorageCellOut | None)
def get_next_empty_cell(
    unit_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return the first empty cell in row-major order for the stocking workflow."""
    q = db.query(StorageUnit).filter(StorageUnit.id == unit_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(StorageUnit.lab_id == current_user.lab_id)
    unit = q.first()

    if not unit:
        raise HTTPException(status_code=404, detail="Storage unit not found")

    occupied_cell_ids = (
        db.query(Vial.location_cell_id)
        .filter(Vial.location_cell_id.isnot(None))
        .subquery()
    )
    cell = (
        db.query(StorageCell)
        .filter(
            StorageCell.storage_unit_id == unit_id,
            StorageCell.id.notin_(occupied_cell_ids),
        )
        .order_by(StorageCell.row, StorageCell.col)
        .first()
    )
    if not cell:
        return None
    return _build_cell_out(db, cell)


@router.post("/units/{unit_id}/stock", response_model=StorageCellOut)
def stock_vial(
    unit_id: UUID,
    body: StockVialRequest,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR, UserRole.TECH)),
):
    """
    Stocking workflow: scan a vial's lot barcode, place one sealed vial
    from that lot into the next available cell.
    """
    target_lab_id = current_user.lab_id
    q = db.query(StorageUnit).filter(StorageUnit.id == unit_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(StorageUnit.lab_id == current_user.lab_id)
    else:
        # If super admin, we need to know which lab to stock for.
        # We can infer this from the storage unit.
        unit_for_lab = q.first()
        if not unit_for_lab:
            raise HTTPException(status_code=404, detail="Storage unit not found")
        target_lab_id = unit_for_lab.lab_id

    unit = (
        db.query(StorageUnit)
        .filter(StorageUnit.id == unit_id, StorageUnit.lab_id == target_lab_id)
        .first()
    )
    if not unit:
        raise HTTPException(status_code=404, detail="Storage unit not found")

    # Find the lot by barcode
    lot = (
        db.query(Lot)
        .filter(Lot.vendor_barcode == body.barcode, Lot.lab_id == target_lab_id)
        .first()
    )
    if not lot:
        raise HTTPException(status_code=404, detail="No lot found for this barcode in the selected lab")

    # Find an unassigned sealed vial from this lot
    vial = (
        db.query(Vial)
        .filter(
            Vial.lot_id == lot.id,
            Vial.lab_id == target_lab_id,
            Vial.status == VialStatus.SEALED,
            Vial.location_cell_id.is_(None),
        )
        .order_by(Vial.received_at)
        .first()
    )
    if not vial:
        raise HTTPException(status_code=400, detail="No unassigned sealed vials for this lot")

    # Find next empty cell
    occupied_cell_ids = (
        db.query(Vial.location_cell_id)
        .filter(Vial.location_cell_id.isnot(None))
        .subquery()
    )
    cell = (
        db.query(StorageCell)
        .filter(
            StorageCell.storage_unit_id == unit_id,
            StorageCell.id.notin_(occupied_cell_ids),
        )
        .order_by(StorageCell.row, StorageCell.col)
        .first()
    )
    if not cell:
        raise HTTPException(status_code=400, detail="No empty cells in this storage unit")

    before = snapshot_vial(vial)
    vial.location_cell_id = cell.id

    log_audit(
        db,
        lab_id=target_lab_id,
        user_id=current_user.id,
        action="vial.stocked",
        entity_type="vial",
        entity_id=vial.id,
        before_state=before,
        after_state=snapshot_vial(vial),
    )

    db.commit()
    db.refresh(vial)
    return _build_cell_out(db, cell)
