from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.middleware.auth import get_current_user
from app.models.models import Antibody, Lot, QCStatus, StorageCell, StorageUnit, User, UserRole, Vial, VialStatus
from app.routers.storage import build_grid_cells
from sqlalchemy import func as sa_func

from app.schemas.schemas import (
    AntibodyOut,
    GUDIDDevice,
    LotOut,
    OlderLotSummary,
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

    # Find all storage grids containing vials from this lot
    storage_grids: list[StorageGridOut] = []

    # Collect cell IDs from both sealed and opened vials
    all_vial_cell_ids = [v.location_cell_id for v in vials + opened_vials if v.location_cell_id]

    if all_vial_cell_ids:
        # Get all unique storage unit IDs that contain vials from this lot
        cells_with_vials = (
            db.query(StorageCell)
            .filter(StorageCell.id.in_(all_vial_cell_ids))
            .all()
        )
        unit_ids = list(set(c.storage_unit_id for c in cells_with_vials))

        # Batch-load all storage units
        units = db.query(StorageUnit).filter(StorageUnit.id.in_(unit_ids)).all()
        for unit in units:
            all_cells = (
                db.query(StorageCell)
                .filter(StorageCell.storage_unit_id == unit.id)
                .order_by(StorageCell.row, StorageCell.col)
                .all()
            )
            storage_grids.append(StorageGridOut(
                unit=unit,
                cells=build_grid_cells(db, all_cells),
            ))

    # QC warning
    qc_warning = None
    if lot.qc_status != QCStatus.APPROVED:
        qc_warning = f"WARNING: Lot QC status is '{lot.qc_status.value}'. Lot must be approved before opening vials."

    # Older lots of the same antibody that still have sealed vials
    older_lot_summaries: list[OlderLotSummary] = []
    older_lot_rows = (
        db.query(Lot)
        .filter(
            Lot.antibody_id == lot.antibody_id,
            Lot.lab_id == lot.lab_id,
            Lot.id != lot.id,
            Lot.is_archived == False,  # noqa: E712
            Lot.created_at < lot.created_at,
        )
        .order_by(Lot.created_at.asc())
        .all()
    )
    if older_lot_rows:
        older_lot_ids = [ol.id for ol in older_lot_rows]

        # Batch: sealed counts per lot
        sealed_counts = dict(
            db.query(Vial.lot_id, sa_func.count(Vial.id))
            .filter(Vial.lot_id.in_(older_lot_ids), Vial.status == VialStatus.SEALED)
            .group_by(Vial.lot_id)
            .all()
        )

        # Only process lots that have sealed vials
        lots_with_sealed = [ol for ol in older_lot_rows if sealed_counts.get(ol.id, 0) > 0]

        # Batch: storage summary for all relevant lots at once
        storage_summaries: dict[UUID, str] = {}
        if lots_with_sealed:
            lots_with_sealed_ids = [ol.id for ol in lots_with_sealed]
            unit_counts_rows = (
                db.query(Vial.lot_id, StorageUnit.name, sa_func.count(Vial.id))
                .join(StorageCell, Vial.location_cell_id == StorageCell.id)
                .join(StorageUnit, StorageCell.storage_unit_id == StorageUnit.id)
                .filter(
                    Vial.lot_id.in_(lots_with_sealed_ids),
                    Vial.status == VialStatus.SEALED,
                    Vial.location_cell_id.isnot(None),
                )
                .group_by(Vial.lot_id, StorageUnit.name)
                .all()
            )
            for lot_id_val, unit_name, count in unit_counts_rows:
                parts = storage_summaries.get(lot_id_val, [])
                if isinstance(parts, str):
                    parts = []
                parts.append(f"{count} in {unit_name}")
                storage_summaries[lot_id_val] = parts

        for older_lot in lots_with_sealed:
            parts = storage_summaries.get(older_lot.id, [])
            summary = ", ".join(parts) if isinstance(parts, list) and parts else "not stored"
            older_lot_summaries.append(
                OlderLotSummary(
                    id=older_lot.id,
                    lot_number=older_lot.lot_number,
                    vendor_barcode=older_lot.vendor_barcode,
                    created_at=older_lot.created_at,
                    sealed_count=sealed_counts[older_lot.id],
                    storage_summary=summary,
                )
            )

    # Determine if this is the "current" (oldest active) lot
    is_current = False
    if not older_lot_summaries:
        # Check if newer lots with sealed vials exist
        newer_with_sealed = (
            db.query(Lot.id)
            .join(Vial, Vial.lot_id == Lot.id)
            .filter(
                Lot.antibody_id == lot.antibody_id,
                Lot.lab_id == lot.lab_id,
                Lot.id != lot.id,
                Lot.is_archived == False,  # noqa: E712
                Lot.created_at > lot.created_at,
                Vial.status == VialStatus.SEALED,
            )
            .first()
        )
        if newer_with_sealed:
            is_current = True

    return ScanLookupResult(
        lot=lot,
        antibody=antibody,
        vials=vials,
        opened_vials=opened_vials,
        storage_grids=storage_grids,
        qc_warning=qc_warning,
        older_lots=older_lot_summaries,
        is_current_lot=is_current,
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

    # If a GUDID device was found, it's likely an FDA-registered IVD product
    suggested_designation = "ivd" if gudid_devices else None

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
        suggested_designation=suggested_designation,
        warnings=warnings,
    )
