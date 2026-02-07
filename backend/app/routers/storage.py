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
from app.services.storage import ensure_temporary_storage_capacity

router = APIRouter(prefix="/api/storage", tags=["storage"])


def build_grid_cells(db: Session, cells: list[StorageCell], fluorochromes: list[Fluorochrome] | None = None) -> list[StorageCellOut]:
    """Batch-build StorageCellOut list. Preloads all vials/lots/antibodies in 3 queries instead of N per cell."""
    if not cells:
        return []

    cell_ids = [c.id for c in cells]

    # 1. Batch-load all vials in these cells (excluding archived lots) — single query
    vials = (
        db.query(Vial)
        .join(Lot, Vial.lot_id == Lot.id)
        .filter(Vial.location_cell_id.in_(cell_ids), Lot.is_archived.is_(False))
        .all()
    )
    vial_by_cell: dict[UUID, Vial] = {v.location_cell_id: v for v in vials}

    # 2. Batch-load lots and antibodies for occupied cells
    lot_ids = list({v.lot_id for v in vials})
    lots_map: dict[UUID, Lot] = {}
    ab_map: dict[UUID, Antibody] = {}
    if lot_ids:
        lots = db.query(Lot).filter(Lot.id.in_(lot_ids)).all()
        lots_map = {l.id: l for l in lots}
        ab_ids = list({l.antibody_id for l in lots if l.antibody_id})
        if ab_ids:
            antibodies = db.query(Antibody).filter(Antibody.id.in_(ab_ids)).all()
            ab_map = {a.id: a for a in antibodies}

    # 3. Build fluorochrome lookup (case-insensitive name -> color)
    fluoro_color: dict[str, str] = {}
    if fluorochromes:
        fluoro_color = {f.name.lower(): f.color for f in fluorochromes}

    # 4. Assemble results
    results: list[StorageCellOut] = []
    for cell in cells:
        vial = vial_by_cell.get(cell.id)
        vial_summary = None
        if vial:
            lot = lots_map.get(vial.lot_id)
            antibody = ab_map.get(lot.antibody_id) if lot and lot.antibody_id else None
            color = None
            if antibody:
                if antibody.fluorochrome:
                    color = fluoro_color.get(antibody.fluorochrome.lower())
                if not color and antibody.color:
                    color = antibody.color
            vial_summary = VialSummary(
                id=vial.id,
                lot_id=vial.lot_id,
                antibody_id=lot.antibody_id if lot else None,
                status=vial.status,
                lot_number=lot.lot_number if lot else None,
                expiration_date=lot.expiration_date if lot else None,
                antibody_target=antibody.target if antibody else None,
                antibody_fluorochrome=antibody.fluorochrome if antibody else None,
                antibody_name=antibody.name if antibody else None,
                antibody_short_code=antibody.short_code if antibody else None,
                color=color,
                qc_status=lot.qc_status.value if lot and lot.qc_status else None,
            )
        results.append(StorageCellOut(
            id=cell.id,
            storage_unit_id=cell.storage_unit_id,
            row=cell.row,
            col=cell.col,
            label=cell.label,
            vial_id=vial.id if vial else None,
            vial=vial_summary,
        ))
    return results


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

    # Order by is_temporary DESC (temp first), then by name
    units = (
        q.filter(StorageUnit.is_active.is_(True))
        .order_by(StorageUnit.is_temporary.desc(), StorageUnit.name)
        .all()
    )
    return units


@router.post("/units", response_model=StorageUnitOut)
def create_storage_unit(
    body: StorageUnitCreate,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(require_role(UserRole.SUPER_ADMIN, UserRole.LAB_ADMIN, UserRole.SUPERVISOR)),
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

    # For temporary storage, ensure capacity matches vial count
    if unit.is_temporary:
        vial_count = (
            db.query(Vial)
            .join(StorageCell, Vial.location_cell_id == StorageCell.id)
            .filter(StorageCell.storage_unit_id == unit_id)
            .count()
        )
        # Ensure we have at least 1 cell, or enough for all vials
        ensure_temporary_storage_capacity(db, unit, max(1, vial_count))
        db.commit()
        db.refresh(unit)

    cells = (
        db.query(StorageCell)
        .filter(StorageCell.storage_unit_id == unit_id)
        .order_by(StorageCell.row, StorageCell.col)
        .all()
    )

    return StorageGridOut(
        unit=unit,
        cells=build_grid_cells(db, cells, fluorochromes),
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

    # Only count vials from non-archived lots as occupying cells
    occupied_cell_ids = (
        db.query(Vial.location_cell_id)
        .join(Lot, Vial.lot_id == Lot.id)
        .filter(Vial.location_cell_id.isnot(None), Lot.is_archived.is_(False))
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
    return build_grid_cells(db, [cell])[0]


class AvailableSlotsOut(BaseModel):
    unit_id: UUID
    unit_name: str
    total_cells: int
    occupied_cells: int
    available_cells: int
    is_temporary: bool


@router.get("/units/{unit_id}/available-slots", response_model=AvailableSlotsOut)
def get_available_slots(
    unit_id: UUID,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return how many slots are available in a storage unit."""
    q = db.query(StorageUnit).filter(StorageUnit.id == unit_id)
    if current_user.role != UserRole.SUPER_ADMIN:
        q = q.filter(StorageUnit.lab_id == current_user.lab_id)
    unit = q.first()
    if not unit:
        raise HTTPException(status_code=404, detail="Storage unit not found")

    total = unit.rows * unit.cols

    occupied_cell_ids = (
        db.query(Vial.location_cell_id)
        .join(Lot, Vial.lot_id == Lot.id)
        .filter(Vial.location_cell_id.isnot(None), Lot.is_archived.is_(False))
        .subquery()
    )
    occupied = (
        db.query(StorageCell)
        .filter(
            StorageCell.storage_unit_id == unit_id,
            StorageCell.id.in_(occupied_cell_ids),
        )
        .count()
    )

    return AvailableSlotsOut(
        unit_id=unit.id,
        unit_name=unit.name,
        total_cells=total,
        occupied_cells=occupied,
        available_cells=total - occupied,
        is_temporary=unit.is_temporary,
    )


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
    if lot.is_archived:
        raise HTTPException(status_code=400, detail="Cannot stock vials from an archived lot")

    # Find an unassigned sealed vial from this lot (prefer sealed, fall back to opened)
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
        # Try opened vials not in storage
        vial = (
            db.query(Vial)
            .filter(
                Vial.lot_id == lot.id,
                Vial.lab_id == target_lab_id,
                Vial.status == VialStatus.OPENED,
                Vial.location_cell_id.is_(None),
            )
            .order_by(Vial.opened_at)
            .first()
        )
    if not vial:
        raise HTTPException(status_code=400, detail="No unassigned vials for this lot")

    # Find next empty cell (only count vials from non-archived lots as occupying)
    occupied_cell_ids = (
        db.query(Vial.location_cell_id)
        .join(Lot, Vial.lot_id == Lot.id)
        .filter(Vial.location_cell_id.isnot(None), Lot.is_archived.is_(False))
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

    before = snapshot_vial(vial, db=db)
    vial.location_cell_id = cell.id

    antibody = db.query(Antibody).filter(Antibody.id == lot.antibody_id).first() if lot else None
    cell_label = cell.label or f"R{cell.row + 1}C{cell.col + 1}"
    note = f"Stored in {unit.name} [{cell_label}]"
    if vial.status == VialStatus.OPENED:
        note = f"Open vial stored in {unit.name} [{cell_label}]"

    log_audit(
        db,
        lab_id=target_lab_id,
        user_id=current_user.id,
        action="vial.stocked",
        entity_type="vial",
        entity_id=vial.id,
        before_state=before,
        after_state=snapshot_vial(vial, db=db),
        note=note,
    )

    db.commit()
    db.refresh(vial)
    return build_grid_cells(db, [cell])[0]


# ── Temporary storage summary ────────────────────────────────────────────


class TempStorageSummaryItem(BaseModel):
    lot_id: UUID
    lot_number: str
    vendor_barcode: str | None = None
    antibody_target: str | None = None
    antibody_fluorochrome: str | None = None
    antibody_name: str | None = None
    vial_count: int
    vial_ids: list[UUID] = []


class TempStorageSummary(BaseModel):
    total_vials: int
    unit_id: UUID | None = None
    lots: list[TempStorageSummaryItem]


@router.get("/temp-storage/summary", response_model=TempStorageSummary)
def get_temp_storage_summary(
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get a summary of vials in temporary storage, grouped by lot."""
    from sqlalchemy import func

    target_lab_id = current_user.lab_id
    if current_user.role == UserRole.SUPER_ADMIN and lab_id:
        target_lab_id = lab_id

    # Get the temporary storage unit for this lab
    temp_unit = (
        db.query(StorageUnit)
        .filter(StorageUnit.lab_id == target_lab_id, StorageUnit.is_temporary == True)
        .first()
    )
    if not temp_unit:
        return TempStorageSummary(total_vials=0, lots=[])

    # Query vials in temp storage grouped by lot (exclude archived lots)
    results = (
        db.query(
            Lot.id.label("lot_id"),
            Lot.lot_number,
            Lot.vendor_barcode,
            Antibody.target.label("antibody_target"),
            Antibody.fluorochrome.label("antibody_fluorochrome"),
            Antibody.name.label("antibody_name"),
            func.count(Vial.id).label("vial_count"),
        )
        .join(StorageCell, Vial.location_cell_id == StorageCell.id)
        .join(Lot, Vial.lot_id == Lot.id)
        .join(Antibody, Lot.antibody_id == Antibody.id)
        .filter(
            StorageCell.storage_unit_id == temp_unit.id,
            Vial.status.in_([VialStatus.SEALED, VialStatus.OPENED]),
            Lot.is_archived.is_(False),
        )
        .group_by(Lot.id, Lot.lot_number, Lot.vendor_barcode, Antibody.target, Antibody.fluorochrome, Antibody.name)
        .order_by(func.coalesce(Antibody.target, Antibody.name), Antibody.fluorochrome)
        .all()
    )

    # Collect vial IDs per lot
    vial_ids_by_lot: dict[UUID, list[UUID]] = {}
    if results:
        lot_ids = [r.lot_id for r in results]
        vial_rows = (
            db.query(Vial.id, Vial.lot_id)
            .join(StorageCell, Vial.location_cell_id == StorageCell.id)
            .join(Lot, Vial.lot_id == Lot.id)
            .filter(
                StorageCell.storage_unit_id == temp_unit.id,
                Vial.status.in_([VialStatus.SEALED, VialStatus.OPENED]),
                Vial.lot_id.in_(lot_ids),
                Lot.is_archived.is_(False),
            )
            .all()
        )
        for row in vial_rows:
            vial_ids_by_lot.setdefault(row.lot_id, []).append(row.id)

    lots = [
        TempStorageSummaryItem(
            lot_id=r.lot_id,
            lot_number=r.lot_number,
            vendor_barcode=r.vendor_barcode,
            antibody_target=r.antibody_target,
            antibody_fluorochrome=r.antibody_fluorochrome,
            antibody_name=r.antibody_name,
            vial_count=r.vial_count,
            vial_ids=vial_ids_by_lot.get(r.lot_id, []),
        )
        for r in results
    ]
    total = sum(l.vial_count for l in lots)

    return TempStorageSummary(total_vials=total, unit_id=temp_unit.id, lots=lots)
