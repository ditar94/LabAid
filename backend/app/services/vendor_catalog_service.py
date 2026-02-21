"""
Shared Vendor Catalog Service

Manages the cross-lab vendor catalog that learns product info from all labs.
Uses PostgreSQL upsert (ON CONFLICT DO UPDATE) to handle race conditions.
"""
from datetime import datetime, timezone
from uuid import UUID

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.orm import Session

from app.models.models import Antibody, VendorCatalog
from app.services.barcode_parser import normalize_for_matching


def lookup_vendor_catalog(
    db: Session,
    vendor: str,
    catalog_number: str,
) -> VendorCatalog | None:
    """
    Look up a product in the shared vendor catalog.

    Returns the catalog entry if found, None otherwise.
    """
    return db.query(VendorCatalog).filter(
        VendorCatalog.vendor == vendor,
        VendorCatalog.catalog_number == catalog_number,
    ).first()


def update_shared_catalog_on_registration(
    db: Session,
    vendor: str,
    catalog_number: str,
    antibody: Antibody,
    lab_id: UUID,
    enrichment_data: dict | None = None,
) -> None:
    """
    Update shared catalog after lot registration.

    Logic:
    - If new entry: create it with use_count=1
    - If existing entry and data MATCHES: increment use_count (verification)
    - If existing entry and data DIFFERS: increment conflict_count (disagreement)

    Uses PostgreSQL's ON CONFLICT for atomic upsert to handle race conditions.

    Args:
        db: Database session
        vendor: Vendor name (e.g., "Sysmex")
        catalog_number: Catalog/product number from barcode
        antibody: The antibody being registered (provides target, fluorochrome, etc.)
        lab_id: The lab creating this registration
        enrichment_data: Data returned from /enrich endpoint (optional)
    """
    # Normalize the incoming data for matching
    target_norm = normalize_for_matching(antibody.target)
    fluoro_norm = normalize_for_matching(antibody.fluorochrome)
    name_norm = normalize_for_matching(antibody.name)

    # Check if entry exists and if data matches
    existing = db.query(VendorCatalog).filter(
        VendorCatalog.vendor == vendor,
        VendorCatalog.catalog_number == catalog_number,
    ).first()

    now = datetime.now(timezone.utc)

    if existing:
        # Compare normalized values to detect conflict
        # A match means the user accepted the auto-populated data (or their data aligns)
        data_matches = (
            existing.target_normalized == target_norm and
            existing.fluorochrome_normalized == fluoro_norm
        )

        if data_matches:
            # User agreed with existing data - increment confidence
            existing.use_count += 1
            existing.last_used_at = now
        else:
            # User disagreed - track the conflict
            # Note: We don't update the data; first entry wins for now
            existing.conflict_count += 1
            existing.last_used_at = now

    else:
        # New entry - use upsert to handle race condition
        # If another lab inserts first (between our check and insert), just increment
        stmt = insert(VendorCatalog).values(
            vendor=vendor,
            catalog_number=catalog_number,
            designation=antibody.designation.value if antibody.designation else None,
            target=antibody.target,
            target_normalized=target_norm,
            fluorochrome=antibody.fluorochrome,
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

        # Handle race condition: if another lab inserted first, increment use_count
        do_update = stmt.on_conflict_do_update(
            constraint='uq_vendor_catalog',
            set_={
                'use_count': VendorCatalog.use_count + 1,
                'last_used_at': now,
            }
        )

        db.execute(do_update)

    # Don't commit here - let the caller handle transaction


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
    # Entries where conflict_count > threshold * use_count
    # Using raw SQL for the division to avoid issues with integer math
    return db.query(VendorCatalog).filter(
        VendorCatalog.conflict_count > 0,
        VendorCatalog.conflict_count > VendorCatalog.use_count * threshold,
    ).order_by(
        VendorCatalog.conflict_count.desc()
    ).limit(limit).all()
