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

    # Fallback: try matching by lot_number if no vendor_barcode match
    if not lot:
        q2 = db.query(Lot).filter(Lot.lot_number == body.barcode)
        if target_lab_id:
            q2 = q2.filter(Lot.lab_id == target_lab_id)
        lot = q2.first()

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

        # Batch-load all storage units and their cells in 2 queries (not N+1)
        units = db.query(StorageUnit).filter(StorageUnit.id.in_(unit_ids)).all()
        all_cells = (
            db.query(StorageCell)
            .filter(StorageCell.storage_unit_id.in_(unit_ids))
            .order_by(StorageCell.storage_unit_id, StorageCell.row, StorageCell.col)
            .all()
        )
        cells_by_unit: dict[UUID, list[StorageCell]] = {u.id: [] for u in units}
        for cell in all_cells:
            cells_by_unit[cell.storage_unit_id].append(cell)
        for unit in units:
            storage_grids.append(StorageGridOut(
                unit=unit,
                cells=build_grid_cells(db, cells_by_unit.get(unit.id, [])),
            ))

    # QC warning
    qc_warning = None
    if lot.qc_status != QCStatus.APPROVED:
        qc_warning = f"WARNING: Lot QC status is '{lot.qc_status.value}'. Lot must be approved before opening vials."

    # Use-first lots: same antibody, non-archived, with sealed vials, that should
    # be consumed before this lot (sorted by expiration date — FEFO, matching
    # the inventory page's "Current"/"New" badge logic).
    older_lot_summaries: list[OlderLotSummary] = []
    sibling_lot_rows = (
        db.query(Lot)
        .filter(
            Lot.antibody_id == lot.antibody_id,
            Lot.lab_id == lot.lab_id,
            Lot.id != lot.id,
            Lot.is_archived == False,  # noqa: E712
        )
        .all()
    )

    # Batch: sealed counts per sibling lot
    sibling_ids = [sl.id for sl in sibling_lot_rows]
    sealed_counts: dict = {}
    if sibling_ids:
        sealed_counts = dict(
            db.query(Vial.lot_id, sa_func.count(Vial.id))
            .filter(Vial.lot_id.in_(sibling_ids), Vial.status == VialStatus.SEALED)
            .group_by(Vial.lot_id)
            .all()
        )

    # Filter to only lots with sealed vials, then sort by expiration (FEFO)
    siblings_with_sealed = [sl for sl in sibling_lot_rows if sealed_counts.get(sl.id, 0) > 0]

    def _exp_sort_key(l: Lot):
        """Sort: lots WITH expiration first (ascending), then lots WITHOUT."""
        return (l.expiration_date is None, l.expiration_date or "")

    siblings_with_sealed.sort(key=_exp_sort_key)

    # Determine use-first lots: siblings that sort before this lot
    scanned_lot_key = _exp_sort_key(lot)
    scanned_has_sealed = len(vials) > 0
    use_first_lots = [
        sl for sl in siblings_with_sealed
        if _exp_sort_key(sl) < scanned_lot_key
        or (_exp_sort_key(sl) == scanned_lot_key and sl.created_at < lot.created_at)
    ]

    if use_first_lots:
        use_first_ids = [sl.id for sl in use_first_lots]

        # Batch: storage summary
        storage_summaries: dict[UUID, str] = {}
        unit_counts_rows = (
            db.query(Vial.lot_id, StorageUnit.name, sa_func.count(Vial.id))
            .join(StorageCell, Vial.location_cell_id == StorageCell.id)
            .join(StorageUnit, StorageCell.storage_unit_id == StorageUnit.id)
            .filter(
                Vial.lot_id.in_(use_first_ids),
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

        for use_first in use_first_lots:
            parts = storage_summaries.get(use_first.id, [])
            summary = ", ".join(parts) if isinstance(parts, list) and parts else "not stored"
            older_lot_summaries.append(
                OlderLotSummary(
                    id=use_first.id,
                    lot_number=use_first.lot_number,
                    vendor_barcode=use_first.vendor_barcode,
                    created_at=use_first.created_at,
                    sealed_count=sealed_counts[use_first.id],
                    storage_summary=summary,
                )
            )

    # Determine if this is the "current" lot (soonest-expiring with sealed vials)
    is_current = False
    if not older_lot_summaries and scanned_has_sealed:
        # No use-first lots exist; check if any later-expiring siblings exist
        later_siblings = [
            sl for sl in siblings_with_sealed
            if _exp_sort_key(sl) > scanned_lot_key
            or (_exp_sort_key(sl) == scanned_lot_key and sl.created_at > lot.created_at)
        ]
        if later_siblings:
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
