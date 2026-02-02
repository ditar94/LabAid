"""
GS1 DataMatrix barcode parser for flow cytometry reagent barcodes.

Parses GS1 Application Identifiers (AIs) from DataMatrix barcode strings,
normalizes scanner input, and extracts semantic fields for lot registration.
"""

import calendar
import re
from datetime import date

# GS separator character (ASCII 29) used to delimit variable-length AIs
GS = "\x1d"

# AI table: prefix -> (label, fixed_data_length or None for variable-length)
# Variable-length AIs are terminated by GS separator or end-of-string.
# When parsing, longest prefix match wins (try 4-digit, then 3-digit, then 2-digit).
GS1_AI_TABLE: dict[str, tuple[str, int | None]] = {
    # Identification
    "00": ("SSCC", 18),
    "01": ("GTIN", 14),
    "02": ("GTIN of contained items", 14),
    # Dates (all YYMMDD = 6 digits)
    "11": ("Production date", 6),
    "12": ("Due date", 6),
    "13": ("Packaging date", 6),
    "15": ("Best before date", 6),
    "16": ("Sell by date", 6),
    "17": ("Expiration date", 6),
    # Quantity / counts
    "30": ("Count of items", None),
    "37": ("Count of trade items", None),
    # Lot, serial, additional ID
    "10": ("Lot/Batch number", None),
    "21": ("Serial number", None),
    "22": ("Secondary data", None),
    "240": ("Additional product ID", None),
    "241": ("Customer part number", None),
    "242": ("Made-to-order variation", None),
    "250": ("Secondary serial number", None),
    "251": ("Reference to source entity", None),
    # Regulatory / reference
    "710": ("National Healthcare Reimbursement Number (DE)", None),
    "711": ("National Healthcare Reimbursement Number (FR)", None),
    "712": ("National Healthcare Reimbursement Number (ES)", None),
    "713": ("National Healthcare Reimbursement Number (BR)", None),
    "714": ("National Healthcare Reimbursement Number (PT)", None),
    # Internal / mutual
    "90": ("Mutually agreed info", None),
    "91": ("Company internal info 1", None),
    "92": ("Company internal info 2", None),
    "93": ("Company internal info 3", None),
    "94": ("Company internal info 4", None),
    "95": ("Company internal info 5", None),
    "96": ("Company internal info 6", None),
    "97": ("Company internal info 7", None),
    "98": ("Company internal info 8", None),
    "99": ("Company internal info 9", None),
}

# Precompute sorted prefixes: longest first so greedy match works
_SORTED_PREFIXES = sorted(GS1_AI_TABLE.keys(), key=len, reverse=True)

# Symbology identifier prefixes that scanners prepend (ISO/IEC 15424)
_SYMBOLOGY_PREFIXES = re.compile(r"^\](?:[A-Za-z]\d)")

# Common GS placeholder patterns that some scanners emit instead of ASCII 29
_GS_PLACEHOLDERS = re.compile(r"\{GS}|<GS>|\u241d", re.IGNORECASE)


def normalize_barcode(raw: str) -> str:
    """Normalize raw scanner output for GS1 parsing.

    - Strips leading/trailing whitespace, CR, LF
    - Removes symbology identifier prefixes (e.g. ]d2, ]C1, ]e0)
    - Replaces non-ASCII GS placeholders with actual ASCII 29
    """
    s = raw.strip().strip("\r\n").strip()
    s = _SYMBOLOGY_PREFIXES.sub("", s)
    s = _GS_PLACEHOLDERS.sub(GS, s)
    return s


def parse_gs1(raw: str) -> dict[str, str]:
    """Parse GS1 Application Identifiers from a barcode string.

    Returns a dict mapping AI codes to their values, e.g.:
        {"01": "00888888888888", "10": "ABC123", "17": "261231"}

    Returns an empty dict if the string does not start with a valid AI prefix
    (i.e., it's not a GS1-formatted barcode).
    """
    s = normalize_barcode(raw)
    if not s:
        return {}

    result: dict[str, str] = {}
    pos = 0

    while pos < len(s):
        # Skip GS separators
        if s[pos] == GS:
            pos += 1
            continue

        # Try to match an AI prefix (longest first)
        matched = False
        for prefix in _SORTED_PREFIXES:
            if s[pos:].startswith(prefix):
                ai = prefix
                _, fixed_len = GS1_AI_TABLE[ai]
                data_start = pos + len(ai)

                if fixed_len is not None:
                    # Fixed-length: read exactly fixed_len characters
                    data_end = data_start + fixed_len
                    value = s[data_start:data_end]
                    pos = data_end
                else:
                    # Variable-length: read until GS separator or end-of-string
                    gs_pos = s.find(GS, data_start)
                    if gs_pos == -1:
                        data_end = len(s)
                    else:
                        data_end = gs_pos
                    value = s[data_start:data_end]
                    pos = data_end

                result[ai] = value
                matched = True
                break

        if not matched:
            # No valid AI prefix at this position — not a GS1 barcode
            # or we've hit unparseable data. Stop parsing.
            if not result:
                # Nothing parsed at all — not GS1 format
                return {}
            # Partial parse: we got some AIs but hit unknown data.
            # Return what we have rather than losing everything.
            break

    return result


def _parse_yymmdd(value: str) -> date | None:
    """Convert a GS1 YYMMDD date string to a Python date.

    Handles the GS1 convention where DD=00 means the last day of the month.
    Years are mapped: 00-49 → 2000-2049, 50-99 → 1950-1999.
    """
    if len(value) != 6 or not value.isdigit():
        return None

    yy = int(value[0:2])
    mm = int(value[2:4])
    dd = int(value[4:6])

    year = 2000 + yy if yy < 50 else 1900 + yy

    if mm < 1 or mm > 12:
        return None

    if dd == 0:
        # GS1 convention: day 00 = last day of the month
        dd = calendar.monthrange(year, mm)[1]

    try:
        return date(year, mm, dd)
    except ValueError:
        return None


def extract_fields(parsed: dict[str, str]) -> dict:
    """Extract semantic fields from parsed GS1 AIs.

    Returns a dict with:
        gtin: str | None
        lot_number: str | None
        expiration_date: date | None
        serial: str | None
        catalog_number: str | None   (from AI 240)
        production_date: date | None
        all_ais: dict[str, str]       (full parsed AI map for JSONB storage)
    """
    return {
        "gtin": parsed.get("01"),
        "lot_number": parsed.get("10"),
        "expiration_date": _parse_yymmdd(parsed.get("17", "")),
        "serial": parsed.get("21"),
        "catalog_number": parsed.get("240"),
        "production_date": _parse_yymmdd(parsed.get("11", "")),
        "all_ais": parsed if parsed else None,
    }
