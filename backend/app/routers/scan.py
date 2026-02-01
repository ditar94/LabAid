from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.models import Antibody, Lot, QCStatus, StorageCell, StorageUnit, User, UserRole, Vial, VialStatus
from app.routers.storage import _build_cell_out
from app.schemas.schemas import (
    AntibodyOut,
    LotOut,
    ScanLookupRequest,
    ScanLookupResult,
    StorageGridOut,
    VialOut,
)

router = APIRouter(prefix="/api/scan", tags=["scan"])


@router.post("/lookup", response_model=ScanLookupResult)
def scan_lookup(
    body: ScanLookupRequest,
    lab_id: UUID | None = None,
    db: Session = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """
    Core workflow: scan a vendor barcode, find the lot, its vials, and their
    storage locations. Returns grid data with highlighted cells.
    """
    if current_user.role == UserRole.SUPER_ADMIN:
        target_lab_id = lab_id
    else:
        target_lab_id = current_user.lab_id

    q = db.query(Lot).filter(Lot.vendor_barcode == body.barcode)
    if target_lab_id:
        q = q.filter(Lot.lab_id == target_lab_id)
    lot = q.first()

    if not lot:
        raise HTTPException(status_code=404, detail="No lot found for this barcode")

    antibody = db.query(Antibody).filter(Antibody.id == lot.antibody_id).first()

    # Get all sealed vials for this lot (the ones that can be opened)
    vials = (
        db.query(Vial)
        .filter(
            Vial.lot_id == lot.id,
            Vial.status == VialStatus.SEALED,
        )
        .all()
    )

    # Get all opened vials for this lot (for deplete / return-to-storage)
    opened_vials = (
        db.query(Vial)
        .filter(
            Vial.lot_id == lot.id,
            Vial.status == VialStatus.OPENED,
        )
        .all()
    )

    # Find storage grids containing these vials
    storage_grid = None
    cell_ids = [v.location_cell_id for v in vials if v.location_cell_id]

    if cell_ids:
        first_cell = db.query(StorageCell).filter(StorageCell.id == cell_ids[0]).first()
        if first_cell:
            unit = (
                db.query(StorageUnit)
                .filter(StorageUnit.id == first_cell.storage_unit_id)
                .first()
            )
            if unit:
                all_cells = (
                    db.query(StorageCell)
                    .filter(StorageCell.storage_unit_id == unit.id)
                    .order_by(StorageCell.row, StorageCell.col)
                    .all()
                )
                storage_grid = StorageGridOut(
                    unit=unit,
                    cells=[_build_cell_out(db, cell) for cell in all_cells],
                )

    # QC warning
    qc_warning = None
    if lot.qc_status != QCStatus.APPROVED:
        qc_warning = f"WARNING: Lot QC status is '{lot.qc_status.value}'. Lot must be approved before opening vials."

    return ScanLookupResult(
        lot=lot,
        antibody=antibody,
        vials=vials,
        opened_vials=opened_vials,
        storage_grid=storage_grid,
        qc_warning=qc_warning,
    )
