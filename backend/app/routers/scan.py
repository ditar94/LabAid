from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.models import Antibody, Lot, QCStatus, StorageCell, StorageUnit, User, UserRole, Vial, VialStatus
from app.routers.storage import _build_cell_out
from app.schemas.schemas import (
    AntibodyOut,
    GUDIDDevice,
    LotOut,
    ScanEnrichRequest,
    ScanEnrichResult,
    ScanLookupRequest,
    ScanLookupResult,
    StorageGridOut,
    VialOut,
)
from app.services.gs1_parser import extract_fields, parse_gs1
from app.services.gudid_client import lookup_gudid

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


@router.post("/enrich", response_model=ScanEnrichResult)
async def scan_enrich(
    body: ScanEnrichRequest,
    current_user: User = Depends(get_current_user),
):
    """
    Parse GS1 AIs from a barcode string and optionally enrich via AccessGUDID.
    Called when /scan/lookup returns 404 (unknown barcode) to auto-populate
    registration form fields.
    """
    warnings: list[str] = []

    parsed = parse_gs1(body.barcode)
    if not parsed:
        return ScanEnrichResult(
            parsed=False,
            warnings=["Could not parse GS1 data from barcode. Enter fields manually."],
        )

    fields = extract_fields(parsed)

    # Look up device info via AccessGUDID if we have a GTIN
    gudid_devices: list[GUDIDDevice] = []
    vendor: str | None = None
    catalog_number: str | None = fields["catalog_number"]

    gtin = fields["gtin"]
    if gtin:
        raw_devices = await lookup_gudid(gtin)
        gudid_devices = [GUDIDDevice(**d) for d in raw_devices]

        if not gudid_devices:
            warnings.append("No device found in FDA database for this GTIN.")
        elif len(gudid_devices) == 1:
            # Single match — auto-populate vendor and catalog
            device = gudid_devices[0]
            vendor = device.company_name
            if device.catalog_number:
                catalog_number = device.catalog_number
    else:
        warnings.append("No GTIN found in barcode; skipping FDA device lookup.")

    return ScanEnrichResult(
        parsed=True,
        gtin=gtin,
        lot_number=fields["lot_number"],
        expiration_date=fields["expiration_date"],
        serial=fields["serial"],
        catalog_number=catalog_number,
        vendor=vendor,
        all_ais=fields["all_ais"],
        gudid_devices=gudid_devices,
        warnings=warnings,
    )
