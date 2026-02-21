"""
Shared Vendor Catalog Service

Manages the cross-lab vendor catalog that learns product info from all labs.
Uses PostgreSQL upsert (ON CONFLICT DO UPDATE) to handle race conditions.

Lookup strategies:
- GS1 barcodes: lookup by GTIN (globally unique)
- Vendor-specific formats (Sysmex, etc.): lookup by catalog_number
"""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.models import Antibody, VendorCatalog
from app.services.barcode_parser import normalize_for_matching, normalize_target
from app.services.fluorochrome_catalog import normalize_fluorochrome


def lookup_by_gtin(db: Session, gtin: str) -> VendorCatalog | None:
    """
    Look up a product by GTIN (for GS1 barcodes).

    Returns the catalog entry if found, None otherwise.
    """
    return db.query(VendorCatalog).filter(
        VendorCatalog.gtin == gtin,
    ).first()


def lookup_by_catalog_number(db: Session, catalog_number: str) -> VendorCatalog | None:
    """
    Look up a product by catalog number (for vendor-specific barcodes like Sysmex).

    Returns the catalog entry if found, None otherwise.
    """
    return db.query(VendorCatalog).filter(
        VendorCatalog.catalog_number == catalog_number,
    ).first()


def lookup_vendor_catalog(
    db: Session,
    gtin: str | None = None,
    catalog_number: str | None = None,
) -> VendorCatalog | None:
    """
    Look up a product in the shared vendor catalog.

    Prioritizes GTIN lookup (more globally unique) over catalog_number.

    Returns the catalog entry if found, None otherwise.
    """
    if gtin:
        result = lookup_by_gtin(db, gtin)
        if result:
            return result

    if catalog_number:
        return lookup_by_catalog_number(db, catalog_number)

    return None


def update_shared_catalog_from_gtin(
    db: Session,
    gtin: str,
    antibody: Antibody,
    lab_id: UUID,
    vendor: str | None = None,
) -> None:
    """
    Update shared catalog after lot registration with GS1 barcode.

    Uses GTIN as the unique key.

    Args:
        db: Database session
        gtin: GTIN from barcode
        antibody: The antibody being registered
        lab_id: The lab creating this registration
        vendor: Vendor name from GUDID (informational only)
    """
    _update_shared_catalog(
        db=db,
        gtin=gtin,
        catalog_number=None,
        antibody=antibody,
        lab_id=lab_id,
        vendor=vendor,
    )


def update_shared_catalog_from_catalog_number(
    db: Session,
    catalog_number: str,
    antibody: Antibody,
    lab_id: UUID,
    vendor: str | None = None,
) -> None:
    """
    Update shared catalog after lot registration with vendor-specific barcode.

    Uses catalog_number as the unique key.

    Args:
        db: Database session
        catalog_number: Catalog number from barcode
        antibody: The antibody being registered
        lab_id: The lab creating this registration
        vendor: Inferred vendor name (informational only)
    """
    _update_shared_catalog(
        db=db,
        gtin=None,
        catalog_number=catalog_number,
        antibody=antibody,
        lab_id=lab_id,
        vendor=vendor,
    )


def _update_shared_catalog(
    db: Session,
    gtin: str | None,
    catalog_number: str | None,
    antibody: Antibody,
    lab_id: UUID,
    vendor: str | None = None,
) -> None:
    """
    Internal: Update shared catalog after lot registration.

    Logic:
    - If new entry: create it with use_count=1
    - If existing entry and data MATCHES: increment use_count (verification)
    - If existing entry and data DIFFERS: increment conflict_count (disagreement)
    """
    if not gtin and not catalog_number:
        return  # Nothing to key on

    # Normalize the incoming data for matching
    target_norm = normalize_for_matching(antibody.target)
    fluoro_norm = normalize_for_matching(antibody.fluorochrome)
    name_norm = normalize_for_matching(antibody.name)

    # Check if entry exists
    if gtin:
        existing = db.query(VendorCatalog).filter(VendorCatalog.gtin == gtin).first()
    else:
        existing = db.query(VendorCatalog).filter(VendorCatalog.catalog_number == catalog_number).first()

    now = datetime.now(timezone.utc)

    if existing:
        # Compare normalized values to detect conflict
        data_matches = (
            existing.target_normalized == target_norm and
            existing.fluorochrome_normalized == fluoro_norm
        )

        if data_matches:
            existing.use_count += 1
            existing.last_used_at = now
        else:
            existing.conflict_count += 1
            existing.last_used_at = now

    else:
        # New entry - insert (normalize: targets remove spaces/hyphens, fluorochromes → canonical)
        entry = VendorCatalog(
            gtin=gtin,
            catalog_number=catalog_number,
            vendor=vendor,
            designation=antibody.designation.value if antibody.designation else None,
            target=normalize_target(antibody.target),
            target_normalized=target_norm,
            fluorochrome=normalize_fluorochrome(antibody.fluorochrome),
            fluorochrome_normalized=fluoro_norm,
            clone=antibody.clone,
            product_name=antibody.name,
            product_name_normalized=name_norm,
            created_by_lab_id=lab_id,
            use_count=1,
            conflict_count=0,
            first_seen_at=now,
            last_used_at=now,
        )
        db.add(entry)


# Legacy function for backwards compatibility
def update_shared_catalog_on_registration(
    db: Session,
    vendor: str,
    catalog_number: str,
    antibody: Antibody,
    lab_id: UUID,
    enrichment_data: dict | None = None,
) -> None:
    """
    Legacy wrapper - update shared catalog using catalog_number as key.

    Deprecated: Use update_shared_catalog_from_gtin or update_shared_catalog_from_catalog_number.
    """
    update_shared_catalog_from_catalog_number(
        db=db,
        catalog_number=catalog_number,
        antibody=antibody,
        lab_id=lab_id,
        vendor=vendor,
    )


def get_fluorochrome_variations(
    db: Session,
    fluorochrome_normalized: str,
) -> list[str]:
    """
    Get all unique display variations for a normalized fluorochrome.

    Used to show users alternative formatting options entered by other labs.

    Example: fluorochrome_normalized="BV786" might return ["BV-786", "BV 786", "BV786"]
    """
    if not fluorochrome_normalized:
        return []

    results = db.query(VendorCatalog.fluorochrome).filter(
        VendorCatalog.fluorochrome_normalized == fluorochrome_normalized,
        VendorCatalog.fluorochrome.isnot(None),
    ).distinct().all()

    return sorted(set(r[0] for r in results if r[0]))


def get_dirty_catalog_entries(
    db: Session,
    threshold: float = 0.3,
    limit: int = 100,
) -> list[VendorCatalog]:
    """
    Find catalog entries with high conflict rates.

    These need admin review because multiple labs have entered different data.

    Args:
        db: Database session
        threshold: Conflict ratio threshold (conflict_count / use_count)
        limit: Maximum entries to return

    Returns:
        List of VendorCatalog entries that exceed the conflict threshold
    """
    return db.query(VendorCatalog).filter(
        VendorCatalog.conflict_count > 0,
        VendorCatalog.conflict_count > VendorCatalog.use_count * threshold,
    ).order_by(
        VendorCatalog.conflict_count.desc()
    ).limit(limit).all()
