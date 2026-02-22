# Sysmex Barcode Support + Shared Vendor Catalog

## Overview

Add support for Sysmex QR code barcodes with automatic learning via a cross-lab shared catalog. The system will parse Sysmex barcodes, auto-populate registration fields, and build a shared product database over time.

---

## Part 1: Sysmex Barcode Parsing

### Format Analysis

Sysmex QR codes are 23-character strings:

```
AX750746908957260826ASR
├──────┬──────┬──────┬──┘
│      │      │      └── Designation (3 chars): ASR, RUO, IVD
│      │      └── Expiration YYMMDD (6 chars): 260826 → 2026-08-26
│      └── Lot Number (6 chars): 908957
└── Catalog Number (8 chars): AX750746
```

### Detection Logic

In `backend/app/routers/scan.py` or new `backend/app/services/barcode_parser.py`:

```python
import re
from datetime import datetime

# Support ASR, RUO, IVD, and CE-IVD (European) designations
SYSMEX_PATTERN = re.compile(r'^([A-Z]{2}\d{6})(\d{6})(\d{6})(ASR|RUO|IVD|CE)$')

def parse_sysmex_barcode(barcode: str) -> dict | None:
    """Parse Sysmex QR code format. Returns None if not Sysmex format."""
    match = SYSMEX_PATTERN.match(barcode.upper().strip())
    if not match:
        return None

    catalog, lot, exp_raw, designation = match.groups()

    # Parse YYMMDD expiration
    # Note: 2-digit years pivot around 1968/1969 in Python's strptime.
    # For reagent expiration dates, this is safe for the next ~40 years.
    try:
        exp_date = datetime.strptime(exp_raw, "%y%m%d").date()
    except ValueError:
        exp_date = None

    # Normalize CE-IVD to IVD for internal consistency
    if designation == "CE":
        designation = "IVD"

    return {
        "format": "sysmex",
        "catalog_number": catalog,
        "lot_number": lot,
        "expiration_date": exp_date.isoformat() if exp_date else None,
        "designation": designation.lower(),  # Store as lowercase to match Designation enum
    }
```

### Integration with Existing Flow

Modify `/scan/enrich` endpoint:

```python
@router.post("/enrich")
async def enrich_barcode(payload: BarcodeLookup, ...):
    barcode = payload.barcode.strip()

    # 1. Try Sysmex format first (fast regex check)
    sysmex = parse_sysmex_barcode(barcode)
    if sysmex:
        return await enrich_sysmex(sysmex, db)

    # 2. Try GS1 format (existing logic)
    gs1 = parse_gs1_barcode(barcode)
    if gs1:
        return await enrich_gs1(gs1, db)

    # 3. No enrichment available
    return ScanEnrichResult(parsed=False, ...)
```

---

## Part 2: Shared Vendor Catalog

### Database Schema

New table `vendor_catalog` (NOT scoped by lab_id):

```sql
CREATE TABLE vendor_catalog (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Composite unique constraint: same catalog # can exist for different vendors
    vendor VARCHAR(255) NOT NULL,                 -- e.g., "Sysmex"
    catalog_number VARCHAR(50) NOT NULL,          -- e.g., "AX750746"
    UNIQUE(vendor, catalog_number),

    -- Product attributes
    designation VARCHAR(10),                      -- "asr", "ruo", "ivd"

    -- For RUO/ASR products
    target VARCHAR(100),                          -- Display: "CD-45"
    target_normalized VARCHAR(100),               -- Match: "CD45"
    fluorochrome VARCHAR(100),                    -- Display: "APC-R700"
    fluorochrome_normalized VARCHAR(100),         -- Match: "APCR700"
    clone VARCHAR(100),

    -- For IVD products
    product_name VARCHAR(255),                    -- Display name
    product_name_normalized VARCHAR(255),         -- Match value

    -- Confidence tracking
    use_count INTEGER DEFAULT 1,                  -- Labs that AGREED with this data
    conflict_count INTEGER DEFAULT 0,             -- Labs that DISAGREED (entered different data)
    first_seen_at TIMESTAMP DEFAULT NOW(),
    last_used_at TIMESTAMP DEFAULT NOW(),
    created_by_lab_id UUID REFERENCES lab(id),    -- Audit: which lab first entered

    -- Indexes for fast matching
    INDEX idx_vendor_catalog_lookup (vendor, catalog_number),
    INDEX idx_vendor_catalog_normalized (target_normalized, fluorochrome_normalized)
);
```

### Key Schema Decisions

1. **`UNIQUE(vendor, catalog_number)`** - Composite key allows for future vendors who might reuse catalog number formats
2. **`use_count` vs `conflict_count`** - Track agreement and disagreement separately for data quality monitoring
3. **Normalized columns** - Enable fuzzy matching across labs with different formatting preferences

### Normalization Function

```python
import re
import unicodedata

def normalize_for_matching(value: str | None) -> str | None:
    """
    Normalize a string for matching:
    - Unicode normalization (handles copy-paste from PDFs)
    - Uppercase
    - Remove spaces, hyphens, underscores, periods
    """
    if not value:
        return None

    # Normalize unicode (handles non-breaking spaces, different hyphen chars, etc.)
    value = unicodedata.normalize('NFKD', value)

    # Remove spaces, hyphens, underscores, periods; uppercase
    return re.sub(r'[\s\-_\.]+', '', value.strip().upper())

# Examples:
# "CD-45"      → "CD45"
# "CD 45"      → "CD45"
# "APC-R700"   → "APCR700"
# "APC R 700"  → "APCR700"
# "PerCP-Cy5.5" → "PERCPCY55"
# "BB-515"     → "BB515"
# "CD45\xa0"   → "CD45"  (non-breaking space stripped)
```

### SQLAlchemy Model

```python
# backend/app/models/vendor_catalog.py

from sqlalchemy import Column, String, Integer, DateTime, ForeignKey, UniqueConstraint, Index
from sqlalchemy.dialects.postgresql import UUID
import uuid
from datetime import datetime

class VendorCatalog(Base):
    __tablename__ = "vendor_catalog"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)

    vendor = Column(String(255), nullable=False)
    catalog_number = Column(String(50), nullable=False)

    designation = Column(String(10))

    # RUO/ASR fields
    target = Column(String(100))
    target_normalized = Column(String(100))
    fluorochrome = Column(String(100))
    fluorochrome_normalized = Column(String(100))
    clone = Column(String(100))

    # IVD fields
    product_name = Column(String(255))
    product_name_normalized = Column(String(255))

    # Confidence tracking
    use_count = Column(Integer, default=1)
    conflict_count = Column(Integer, default=0)
    first_seen_at = Column(DateTime, default=datetime.utcnow)
    last_used_at = Column(DateTime, default=datetime.utcnow)
    created_by_lab_id = Column(UUID(as_uuid=True), ForeignKey("lab.id"))

    __table_args__ = (
        UniqueConstraint('vendor', 'catalog_number', name='uq_vendor_catalog'),
        Index('idx_vendor_catalog_normalized', 'target_normalized', 'fluorochrome_normalized'),
    )
```

---

## Part 3: Enrichment Flow

### Sysmex Enrichment Function

```python
async def enrich_sysmex(parsed: dict, db: Session) -> ScanEnrichResult:
    """Enrich a Sysmex barcode with shared catalog data."""
    catalog_number = parsed["catalog_number"]
    vendor = "Sysmex"

    # Look up in shared catalog
    catalog_entry = db.query(VendorCatalog).filter(
        VendorCatalog.vendor == vendor,
        VendorCatalog.catalog_number == catalog_number
    ).first()

    if catalog_entry:
        # Don't update counts here - only on registration when we can verify match
        return ScanEnrichResult(
            parsed=True,
            format="sysmex",
            catalog_number=catalog_number,
            lot_number=parsed["lot_number"],
            expiration_date=parsed["expiration_date"],
            suggested_designation=parsed["designation"],
            vendor=catalog_entry.vendor,
            # RUO/ASR
            target=catalog_entry.target,
            fluorochrome=catalog_entry.fluorochrome,
            clone=catalog_entry.clone,
            # IVD
            product_name=catalog_entry.product_name,
            # Normalized values for matching
            target_normalized=catalog_entry.target_normalized,
            fluorochrome_normalized=catalog_entry.fluorochrome_normalized,
            # Confidence info for frontend
            catalog_use_count=catalog_entry.use_count,
            catalog_conflict_count=catalog_entry.conflict_count,
            from_shared_catalog=True,  # Flag for UI indicator
        )
    else:
        # No catalog entry yet - return parsed data only
        return ScanEnrichResult(
            parsed=True,
            format="sysmex",
            catalog_number=catalog_number,
            lot_number=parsed["lot_number"],
            expiration_date=parsed["expiration_date"],
            suggested_designation=parsed["designation"],
            vendor="Sysmex",  # Known vendor for this format
            catalog_use_count=0,
            catalog_conflict_count=0,
            from_shared_catalog=False,
        )
```

---

## Part 4: Auto-Population on Registration (with Conflict Detection)

### Backend: Atomic Upsert with Conflict Tracking

When a lot is registered with a Sysmex catalog number, use PostgreSQL's `ON CONFLICT` for atomic updates:

```python
from sqlalchemy.dialects.postgresql import insert
from datetime import datetime

def update_shared_catalog_on_registration(
    db: Session,
    vendor: str,
    catalog_number: str,
    antibody: Antibody,
    lab_id: UUID,
    enrichment_data: dict | None,  # What was auto-filled from shared catalog
):
    """
    Update shared catalog after lot registration.

    - If new entry: create it
    - If existing entry and data MATCHES: increment use_count (verification)
    - If existing entry and data DIFFERS: increment conflict_count (disagreement)
    """
    # Normalize the incoming data
    target_norm = normalize_for_matching(antibody.target)
    fluoro_norm = normalize_for_matching(antibody.fluorochrome)
    name_norm = normalize_for_matching(antibody.name)

    # Check if entry exists and if data matches
    existing = db.query(VendorCatalog).filter(
        VendorCatalog.vendor == vendor,
        VendorCatalog.catalog_number == catalog_number
    ).first()

    if existing:
        # Compare normalized values to detect conflict
        data_matches = (
            existing.target_normalized == target_norm and
            existing.fluorochrome_normalized == fluoro_norm
        )

        if data_matches:
            # User agreed with existing data - increment confidence
            existing.use_count += 1
            existing.last_used_at = datetime.utcnow()
        else:
            # User disagreed - track the conflict
            existing.conflict_count += 1
            existing.last_used_at = datetime.utcnow()
            # TODO: Could log the conflict details for admin review

        db.commit()
    else:
        # New entry - use upsert to handle race condition
        stmt = insert(VendorCatalog).values(
            vendor=vendor,
            catalog_number=catalog_number,
            designation=antibody.designation,
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
        )

        # Handle race condition: if another lab inserted first, just increment
        do_update = stmt.on_conflict_do_update(
            constraint='uq_vendor_catalog',
            set_={
                'use_count': VendorCatalog.use_count + 1,
                'last_used_at': datetime.utcnow(),
            }
        )

        db.execute(do_update)
        db.commit()
```

### Integration in Lot Service

```python
def create_lot(
    db: Session,
    lot_data: LotCreate,
    antibody: Antibody,
    lab_id: UUID,
    barcode_metadata: dict | None = None,  # From enrichment
):
    # Create lot as normal
    lot = Lot(**lot_data.dict(), antibody_id=antibody.id)
    db.add(lot)
    db.flush()

    # If Sysmex barcode, update shared catalog
    if barcode_metadata and barcode_metadata.get("format") == "sysmex":
        update_shared_catalog_on_registration(
            db=db,
            vendor=barcode_metadata.get("vendor", "Sysmex"),
            catalog_number=barcode_metadata["catalog_number"],
            antibody=antibody,
            lab_id=lab_id,
            enrichment_data=barcode_metadata,
        )

    db.commit()
    return lot
```

---

## Part 5: Frontend - Auto-Match with Visual Indicator

### Updated Types

```typescript
// frontend/src/api/types.ts

export interface ScanEnrichResult {
  parsed: boolean;
  format?: "gs1" | "sysmex";
  catalog_number?: string;
  lot_number?: string;
  expiration_date?: string;
  suggested_designation?: string;
  vendor?: string;

  // RUO/ASR
  target?: string;
  fluorochrome?: string;
  clone?: string;
  target_normalized?: string;
  fluorochrome_normalized?: string;

  // IVD
  product_name?: string;

  // Confidence indicators
  catalog_use_count?: number;
  catalog_conflict_count?: number;
  from_shared_catalog?: boolean;  // True if data came from shared catalog

  // Existing GS1 fields...
  gtin?: string;
  gudid_devices?: GUDIDDevice[];
}
```

### Match Logic with Normalization

```typescript
// frontend/src/utils/normalize.ts

export function normalizeForMatching(value: string | null | undefined): string {
  if (!value) return '';
  // Match backend: uppercase, remove spaces/hyphens/underscores/periods
  return value
    .normalize('NFKD')  // Unicode normalization
    .toUpperCase()
    .replace(/[\s\-_\.]+/g, '');
}

export function findMatchingAntibody(
  antibodies: Antibody[],
  targetNormalized: string | undefined,
  fluoroNormalized: string | undefined,
): Antibody | null {
  if (!targetNormalized || !fluoroNormalized) {
    return null;
  }

  return antibodies.find(ab => {
    const abTargetNorm = normalizeForMatching(ab.target);
    const abFluoroNorm = normalizeForMatching(ab.fluorochrome);
    return abTargetNorm === targetNormalized && abFluoroNorm === fluoroNormalized;
  }) || null;
}
```

### Visual Indicator for Shared Catalog Data

In `ScanSearchPage.tsx`, show when data comes from the community catalog:

```tsx
{enrichResult?.from_shared_catalog && (
  <div className="shared-catalog-indicator">
    <span className="badge badge-info" style={{
      background: 'linear-gradient(135deg, #8b5cf6 0%, #06b6d4 100%)',
      color: '#fff',
      fontSize: '0.75em',
      display: 'inline-flex',
      alignItems: 'center',
      gap: '4px',
    }}>
      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M12 2L2 7l10 5 10-5-10-5z"/>
        <path d="M2 17l10 5 10-5"/>
        <path d="M2 12l10 5 10-5"/>
      </svg>
      Auto-filled from Community Catalog
    </span>
    {enrichResult.catalog_use_count > 1 && (
      <span className="confidence-note" style={{ fontSize: '0.8em', color: 'var(--text-muted)', marginLeft: '8px' }}>
        Verified by {enrichResult.catalog_use_count} labs
      </span>
    )}
    {enrichResult.catalog_conflict_count > 0 && (
      <span className="conflict-warning" style={{ fontSize: '0.8em', color: 'var(--warning-500)', marginLeft: '8px' }}>
        ⚠️ {enrichResult.catalog_conflict_count} lab(s) entered different data
      </span>
    )}
  </div>
)}
```

### Form Pre-fill with Indicator

```tsx
// When enrichment data arrives
useEffect(() => {
  if (!enrichResult?.from_shared_catalog) return;

  // Try to match existing antibody first
  const matched = findMatchingAntibody(
    antibodies,
    enrichResult.target_normalized,
    enrichResult.fluorochrome_normalized
  );

  if (matched) {
    // Auto-select existing antibody
    setRegForm(prev => ({ ...prev, antibody_id: matched.id }));
    addToast("Matched existing antibody from catalog data", "info");
  } else {
    // Pre-fill new antibody form
    setNewAbForm(prev => ({
      ...prev,
      target: enrichResult.target || prev.target,
      fluorochrome_choice: enrichResult.fluorochrome || prev.fluorochrome_choice,
      vendor: enrichResult.vendor || prev.vendor,
      designation: enrichResult.suggested_designation || prev.designation,
      name: enrichResult.product_name || prev.name,
    }));
  }
}, [enrichResult, antibodies]);
```

---

## Part 6: Normalize Lab Antibodies on Save

### Add Normalized Columns to Antibody Table

Migration:

```sql
ALTER TABLE antibody ADD COLUMN target_normalized VARCHAR(100);
ALTER TABLE antibody ADD COLUMN fluorochrome_normalized VARCHAR(100);
ALTER TABLE antibody ADD COLUMN name_normalized VARCHAR(255);

CREATE INDEX idx_antibody_normalized ON antibody(lab_id, target_normalized, fluorochrome_normalized);
```

### Update on Create/Edit

```python
# In antibody service

def create_antibody(db: Session, data: AntibodyCreate, lab_id: UUID) -> Antibody:
    antibody = Antibody(
        **data.dict(),
        lab_id=lab_id,
        target_normalized=normalize_for_matching(data.target),
        fluorochrome_normalized=normalize_for_matching(data.fluorochrome),
        name_normalized=normalize_for_matching(data.name),
    )
    db.add(antibody)
    db.commit()
    return antibody

def update_antibody(db: Session, antibody: Antibody, data: AntibodyUpdate) -> Antibody:
    for key, value in data.dict(exclude_unset=True).items():
        setattr(antibody, key, value)

    # Re-normalize if relevant fields changed
    if data.target is not None:
        antibody.target_normalized = normalize_for_matching(data.target)
    if data.fluorochrome is not None:
        antibody.fluorochrome_normalized = normalize_for_matching(data.fluorochrome)
    if data.name is not None:
        antibody.name_normalized = normalize_for_matching(data.name)

    db.commit()
    return antibody
```

### Backfill Existing Data

Migration script:

```python
def backfill_normalized_fields():
    antibodies = db.query(Antibody).all()
    for ab in antibodies:
        ab.target_normalized = normalize_for_matching(ab.target)
        ab.fluorochrome_normalized = normalize_for_matching(ab.fluorochrome)
        ab.name_normalized = normalize_for_matching(ab.name)
    db.commit()
```

---

## Part 7: Duplicate Detection (Bonus)

When creating a new antibody, warn if a similar one exists:

```python
def check_duplicate_antibody(
    db: Session,
    lab_id: UUID,
    target: str | None,
    fluorochrome: str | None,
) -> Antibody | None:
    """Check if lab already has an antibody with same target/fluorochrome."""
    target_norm = normalize_for_matching(target)
    fluoro_norm = normalize_for_matching(fluorochrome)

    if not target_norm or not fluoro_norm:
        return None

    return db.query(Antibody).filter(
        Antibody.lab_id == lab_id,
        Antibody.target_normalized == target_norm,
        Antibody.fluorochrome_normalized == fluoro_norm,
        Antibody.is_active == True,
    ).first()
```

Frontend can call this before creating and show:
> "You already have **CD-45 APC-R700**. Use existing antibody?"

---

## Part 8: Admin Monitoring (Future)

For entries with high `conflict_count` relative to `use_count`:

```python
def get_dirty_catalog_entries(db: Session, threshold: float = 0.3) -> list[VendorCatalog]:
    """
    Find catalog entries where conflict_count > threshold * use_count.
    These need admin review.
    """
    return db.query(VendorCatalog).filter(
        VendorCatalog.conflict_count > 0,
        VendorCatalog.conflict_count > VendorCatalog.use_count * threshold
    ).all()
```

Could expose this in a super_admin dashboard for manual review/correction.

---

## File Changes Summary

| File | Action | Description |
|------|--------|-------------|
| `backend/app/models/vendor_catalog.py` | CREATE | VendorCatalog model with composite unique |
| `backend/app/services/barcode_parser.py` | CREATE | Sysmex + GS1 parsing logic |
| `backend/app/services/vendor_catalog_service.py` | CREATE | Shared catalog upsert with conflict tracking |
| `backend/app/routers/scan.py` | MODIFY | Add Sysmex detection to /enrich |
| `backend/app/models/antibody.py` | MODIFY | Add normalized columns |
| `backend/app/services/antibody_service.py` | MODIFY | Normalize on save |
| `backend/app/services/lot_service.py` | MODIFY | Update shared catalog on lot creation |
| `alembic/versions/xxx_vendor_catalog.py` | CREATE | Migration for new table |
| `alembic/versions/xxx_antibody_normalized.py` | CREATE | Migration for normalized columns + backfill |
| `frontend/src/api/types.ts` | MODIFY | Add ScanEnrichResult fields |
| `frontend/src/utils/normalize.ts` | CREATE | Normalization utility |
| `frontend/src/pages/ScanSearchPage.tsx` | MODIFY | Auto-match + visual indicator |
| `frontend/src/App.css` | MODIFY | Styles for shared catalog indicator |

---

## Testing Plan

1. **Unit tests for barcode parsing**
   - Valid Sysmex formats (ASR, RUO, IVD, CE)
   - Invalid formats (wrong length, bad designation)
   - Edge cases (lowercase input, extra whitespace)

2. **Unit tests for normalization**
   - Various input formats → expected normalized output
   - Unicode edge cases (non-breaking space, en-dash vs hyphen)
   - Null/empty handling

3. **Integration tests for shared catalog**
   - First scan creates entry with use_count=1
   - Second scan with SAME data → use_count=2
   - Second scan with DIFFERENT data → conflict_count=1
   - Race condition: two simultaneous first scans → no duplicate, count=2

4. **Integration tests for upsert**
   - Verify ON CONFLICT handles race condition
   - Verify counts increment atomically

5. **E2E test for full flow**
   - Lab A scans new Sysmex barcode, registers antibody
   - Lab B scans same barcode, sees "Community Catalog" indicator
   - Lab B's existing antibody is auto-matched via normalized values
   - Lab C enters different data → conflict tracked

---

## Resolved Design Decisions

| Question | Decision |
|----------|----------|
| Vendor uniqueness | `UNIQUE(vendor, catalog_number)` - composite key |
| Conflict resolution | Track separately; first entry wins for auto-fill |
| Race conditions | PostgreSQL `ON CONFLICT DO UPDATE` (upsert) |
| Normalization | UPPERCASE, strip `[\s\-_\.]+`, Unicode NFKD |
| GS1 in shared catalog | No - GS1 uses GUDID which is already universal |
| European designations | Support `CE` → normalize to `IVD` |
| User feedback | Visual "Community Catalog" badge with confidence count |
