"""
Barcode parsing utilities for various vendor formats.

Supports:
- Sysmex QR codes (23-char format: catalog[8] + lot[6] + expiration[6] + designation[3])
- GS1 DataMatrix (via gs1_parser.py)
"""
import re
import unicodedata
from datetime import datetime


# ── Sysmex QR Code Format ─────────────────────────────────────────────────
# Example: AX750746908957260826ASR
#          ├──────┬──────┬──────┬──┘
#          │      │      │      └── Designation (3 chars): ASR, RUO, IVD, CE
#          │      │      └── Expiration YYMMDD (6 chars): 260826 → 2026-08-26
#          │      └── Lot Number (6 chars): 908957
#          └── Catalog Number (8 chars): AX750746

# Support ASR, RUO, IVD, and CE-IVD (European) designations
SYSMEX_PATTERN = re.compile(r'^([A-Z]{2}\d{6})(\d{6})(\d{6})(ASR|RUO|IVD|CE)$')


def parse_sysmex_barcode(barcode: str) -> dict | None:
    """
    Parse Sysmex QR code format.

    Returns dict with parsed fields if valid Sysmex format, None otherwise.

    Example:
        >>> parse_sysmex_barcode("AX750746908957260826ASR")
        {
            "format": "sysmex",
            "vendor": "Sysmex",
            "catalog_number": "AX750746",
            "lot_number": "908957",
            "expiration_date": "2026-08-26",
            "designation": "asr",
        }
    """
    if not barcode:
        return None

    match = SYSMEX_PATTERN.match(barcode.upper().strip())
    if not match:
        return None

    catalog, lot, exp_raw, designation = match.groups()

    # Parse YYMMDD expiration
    # Note: 2-digit years pivot around 1968/1969 in Python's strptime.
    # For reagent expiration dates, this is safe for the next ~40 years.
    exp_date = None
    try:
        exp_date = datetime.strptime(exp_raw, "%y%m%d").date()
    except ValueError:
        pass

    # Normalize CE-IVD to IVD for internal consistency
    if designation == "CE":
        designation = "IVD"

    return {
        "format": "sysmex",
        "vendor": "Sysmex",
        "catalog_number": catalog,
        "lot_number": lot,
        "expiration_date": exp_date.isoformat() if exp_date else None,
        "designation": designation.lower(),  # Store as lowercase to match Designation enum
    }


# ── Normalization ─────────────────────────────────────────────────────────

# Pattern to remove: spaces, hyphens, underscores, periods
_STRIP_PATTERN = re.compile(r'[\s\-_\.]+')


def normalize_target(value: str | None) -> str | None:
    """
    Normalize antibody target for display: UPPERCASE + remove spaces and hyphens.

    Targets are simple patterns like CD45, CD19, HLADR.

    Examples:
        "cd 45"   → "CD45"
        "CD-45"   → "CD45"
        "hla-dr"  → "HLADR"
        "Ki-67"   → "KI67"
    """
    if not value:
        return None

    value = unicodedata.normalize('NFKD', value).strip().upper()
    # Remove spaces and hyphens for targets
    value = re.sub(r'[\s\-]+', '', value)
    return value or None


def normalize_display(value: str | None) -> str | None:
    """
    Normalize a string for display: UPPERCASE only, keep structure (spaces, hyphens).

    Used for fluorochromes and IVD product names where spacing matters.

    Examples:
        "pacific orange"       → "PACIFIC ORANGE"
        "brilliant violet 421" → "BRILLIANT VIOLET 421"
        "BV-786"               → "BV-786"
        "apc-r700"             → "APC-R700"
    """
    if not value:
        return None

    value = unicodedata.normalize('NFKD', value).strip().upper()
    return value or None


def normalize_for_matching(value: str | None) -> str | None:
    """
    Normalize a string for matching across labs.

    Transformations:
    - Unicode normalization (handles copy-paste from PDFs with non-breaking spaces, etc.)
    - Remove spaces, hyphens, underscores, periods
    - Convert to UPPERCASE

    Examples:
        "CD-45"       → "CD45"
        "CD 45"       → "CD45"
        "APC-R700"    → "APCR700"
        "APC R 700"   → "APCR700"
        "PerCP-Cy5.5" → "PERCPCY55"
        "BB-515"      → "BB515"
        "CD45\xa0"    → "CD45"  (non-breaking space stripped)
    """
    if not value:
        return None

    # Normalize unicode (handles non-breaking spaces, different hyphen chars, etc.)
    value = unicodedata.normalize('NFKD', value)

    # Remove spaces, hyphens, underscores, periods; uppercase
    return _STRIP_PATTERN.sub('', value.strip().upper()) or None


def detect_barcode_format(barcode: str) -> str:
    """
    Detect the format of a barcode string.

    Returns:
        "sysmex" - Sysmex QR code format
        "gs1"    - GS1 DataMatrix format (starts with ]d2 or has AI structure)
        "unknown" - Unknown format
    """
    if not barcode:
        return "unknown"

    cleaned = barcode.strip()

    # Check Sysmex format first (fast regex)
    if SYSMEX_PATTERN.match(cleaned.upper()):
        return "sysmex"

    # GS1 format indicators
    # - Starts with ]d2 (GS1 symbology identifier)
    # - Starts with 01 followed by 14 digits (GTIN)
    # - Contains FNC1 (ASCII 29 / \x1d)
    if (
        cleaned.startswith("]d2") or
        cleaned.startswith("]C1") or
        "\x1d" in cleaned or
        (cleaned[:2] == "01" and len(cleaned) >= 16 and cleaned[2:16].isdigit())
    ):
        return "gs1"

    return "unknown"
