from __future__ import annotations

"""
Canonical Vendor Name Catalog

Maps vendor name variations to canonical names for consistent storage.
Covers major flow cytometry reagent manufacturers.

Usage:
    from app.services.vendor_catalog_names import normalize_vendor, get_vendor_suggestion
    canonical = normalize_vendor("Becton Dickinson & Company")  # Returns "BD"
    suggestion = get_vendor_suggestion("Becton Dickenson")  # Returns "BD" (fuzzy match)
"""

import re
from difflib import get_close_matches

# ── Canonical Vendor Names ───────────────────────────────────────────────────
# Keys are normalized (uppercase, no spaces/punctuation) for lookup
# Values are the canonical display names

VENDOR_CANONICAL: dict[str, str] = {
    # ── BD Biosciences (Becton Dickinson) ────────────────────────────────────
    "BD": "BD",
    "BDBIOSCIENCES": "BD",
    "BECTONDICKINSON": "BD",
    "BECTONDICKINSONCOMPANY": "BD",
    "BECTONDICKINSONCO": "BD",
    "BECTONDICKINSONANDCOMPANY": "BD",
    "BDBIO": "BD",
    "BDBIOSCIENCE": "BD",
    # Common misspellings
    "BECTONDICKENSON": "BD",
    "BECTONDICKENSON COMPANY": "BD",
    "BECKTONDICKINSON": "BD",
    "BECKTONDICKENSON": "BD",
    "BECTONDICKENSONCOMPANY": "BD",
    "BECTONDICKENSONANDCOMPANY": "BD",

    # ── BioLegend ────────────────────────────────────────────────────────────
    "BIOLEGEND": "BIOLEGEND",
    "BIOLEGENDLLC": "BIOLEGEND",
    "BIOLEGENDINC": "BIOLEGEND",

    # ── Thermo Fisher Scientific ─────────────────────────────────────────────
    # (includes eBioscience, Invitrogen, Life Technologies acquisitions)
    "THERMOFISHER": "THERMO FISHER",
    "THERMOFISHERSCIENTIFIC": "THERMO FISHER",
    "THERMOFISHERSCI": "THERMO FISHER",
    "THERMOSCIENTIFIC": "THERMO FISHER",
    "EBIOSCIENCE": "THERMO FISHER",
    "EBIOSCIENCEINC": "THERMO FISHER",
    "INVITROGEN": "THERMO FISHER",
    "INVITROGENLLC": "THERMO FISHER",
    "LIFETECHNOLOGIES": "THERMO FISHER",
    "LIFETECHNOLOGIESCORP": "THERMO FISHER",
    "LIFETECHNOLOGIESCORPORATION": "THERMO FISHER",

    # ── Sysmex ───────────────────────────────────────────────────────────────
    "SYSMEX": "SYSMEX",
    "SYSMEXCORP": "SYSMEX",
    "SYSMEXCORPORATION": "SYSMEX",
    "SYSMEXINC": "SYSMEX",
    "SYSMEXAMERICA": "SYSMEX",
    "SYSMEXAMERICAINC": "SYSMEX",

    # ── Miltenyi Biotec ──────────────────────────────────────────────────────
    "MILTENYI": "MILTENYI",
    "MILTENYIBIOTEC": "MILTENYI",
    "MILTENYIBIOTECGMBH": "MILTENYI",
    "MILTENYIBIOTECBV": "MILTENYI",
    "MILTENYIBIOTECLLC": "MILTENYI",
    "MILTENYIBIOTECINCORP": "MILTENYI",

    # ── Beckman Coulter ──────────────────────────────────────────────────────
    "BECKMAN": "BECKMAN COULTER",
    "BECKMANCOULTER": "BECKMAN COULTER",
    "BECKMANCOULTERINC": "BECKMAN COULTER",
    "BECKMANCOULTERLLC": "BECKMAN COULTER",

    # ── Sony Biotechnology ───────────────────────────────────────────────────
    "SONY": "SONY",
    "SONYBIOTECHNOLOGY": "SONY",
    "SONYBIOTECHNOLOGYINC": "SONY",

    # ── Bio-Rad ──────────────────────────────────────────────────────────────
    "BIORAD": "BIO-RAD",
    "BIORADLABORATORIES": "BIO-RAD",
    "BIORADLABORATORIESINC": "BIO-RAD",
    "BIORADLABS": "BIO-RAD",

    # ── Cytek Biosciences ────────────────────────────────────────────────────
    "CYTEK": "CYTEK",
    "CYTEKBIOSCIENCES": "CYTEK",
    "CYTEKBIOSCIENCESINC": "CYTEK",
    "CYTEKBIO": "CYTEK",

    # ── Agilent Technologies ─────────────────────────────────────────────────
    # (includes Dako acquisition)
    "AGILENT": "AGILENT",
    "AGILENTTECHNOLOGIES": "AGILENT",
    "AGILENTTECHNOLOGIESINC": "AGILENT",
    "DAKO": "AGILENT",
    "DAKOCYTOMATION": "AGILENT",

    # ── R&D Systems / BioTechne ──────────────────────────────────────────────
    "RDSYSTEMS": "R&D SYSTEMS",
    "RANDSYSTEMS": "R&D SYSTEMS",
    "RDSY": "R&D SYSTEMS",
    "RDSYSTEMSINC": "R&D SYSTEMS",
    "BIOTECHNE": "R&D SYSTEMS",
    "BIOTECHNECORP": "R&D SYSTEMS",
    "NOVUSBIOLOGICALS": "R&D SYSTEMS",

    # ── Cell Signaling Technology ────────────────────────────────────────────
    "CST": "CST",
    "CELLSIGNALING": "CST",
    "CELLSIGNALINGTECHNOLOGY": "CST",
    "CELLSIGNALINGTECHNOLOGYINC": "CST",

    # ── Santa Cruz Biotechnology ─────────────────────────────────────────────
    "SANTACRUZ": "SANTA CRUZ",
    "SANTACRUZBIOTECHNOLOGY": "SANTA CRUZ",
    "SANTACRUZBIOTECHNOLOGYINC": "SANTA CRUZ",
    "SCBT": "SANTA CRUZ",

    # ── Abcam ────────────────────────────────────────────────────────────────
    "ABCAM": "ABCAM",
    "ABCAMPLC": "ABCAM",
    "ABCAMINC": "ABCAM",

    # ── Southern Biotech ─────────────────────────────────────────────────────
    "SOUTHERNBIOTECH": "SOUTHERN BIOTECH",
    "SOUTHERNBIOTECHNOLOGY": "SOUTHERN BIOTECH",
    "SOUTHERNBIOTECHNOLOGYASSOCIATES": "SOUTHERN BIOTECH",

    # ── STEMCELL Technologies ────────────────────────────────────────────────
    "STEMCELL": "STEMCELL",
    "STEMCELLTECHNOLOGIES": "STEMCELL",
    "STEMCELLTECHNOLOGIESINC": "STEMCELL",

    # ── PerkinElmer ──────────────────────────────────────────────────────────
    "PERKINELMER": "PERKINELMER",
    "PERKINELMERINC": "PERKINELMER",
    "PERKINELMERLASSAS": "PERKINELMER",

    # ── Luminex / DiaSorin ───────────────────────────────────────────────────
    "LUMINEX": "LUMINEX",
    "LUMINEXCORP": "LUMINEX",
    "LUMINEXCORPORATION": "LUMINEX",
    "DIASORIN": "LUMINEX",

    # ── ProteinTech ──────────────────────────────────────────────────────────
    "PROTEINTECH": "PROTEINTECH",
    "PROTEINTECHGROUP": "PROTEINTECH",
    "PROTEINTECHGROUPINC": "PROTEINTECH",

    # ── Sigma-Aldrich / Merck ────────────────────────────────────────────────
    "SIGMA": "SIGMA-ALDRICH",
    "SIGMAALDRICH": "SIGMA-ALDRICH",
    "SIGMAALDRICHCO": "SIGMA-ALDRICH",
    "MERCK": "SIGMA-ALDRICH",
    "MERCKKGAA": "SIGMA-ALDRICH",
    "MERCKMILLIPORE": "SIGMA-ALDRICH",
    "EMDMILLIPORE": "SIGMA-ALDRICH",
    "MILLIPORE": "SIGMA-ALDRICH",
    "MILLIPORESIGMA": "SIGMA-ALDRICH",

    # ── ImmunoResearch ───────────────────────────────────────────────────────
    "JACKSONIMMUNORESEARCH": "JACKSON IMMUNORESEARCH",
    "JACKSONIMMUNO": "JACKSON IMMUNORESEARCH",
    "JACKSONIR": "JACKSON IMMUNORESEARCH",

    # ── Tonbo Biosciences (now part of Cytek) ────────────────────────────────
    "TONBO": "CYTEK",
    "TONBOBIOSCIENCES": "CYTEK",
    "TONBOBIO": "CYTEK",

    # ── Exbio ────────────────────────────────────────────────────────────────
    "EXBIO": "EXBIO",
    "EXBIOPRAHA": "EXBIO",

    # ── ImmunoTools ──────────────────────────────────────────────────────────
    "IMMUNOTOOLS": "IMMUNOTOOLS",
    "IMMUNOTOOLSGMBH": "IMMUNOTOOLS",

    # ── Ancell ───────────────────────────────────────────────────────────────
    "ANCELL": "ANCELL",
    "ANCELLCORP": "ANCELL",
    "ANCELLCORPORATION": "ANCELL",

    # ── Leinco Technologies ──────────────────────────────────────────────────
    "LEINCO": "LEINCO",
    "LEINCOTECHNOLOGIES": "LEINCO",
    "LEINCOTECHNOLOGIESINC": "LEINCO",

    # ── Caprico Biotechnologies ──────────────────────────────────────────────
    "CAPRICO": "CAPRICO",
    "CAPRICOBIOTECHNOLOGIES": "CAPRICO",

    # ── Standard BioTools (Fluidigm) ─────────────────────────────────────────
    "FLUIDIGM": "STANDARD BIOTOOLS",
    "FLUIDIGMCORP": "STANDARD BIOTOOLS",
    "STANDARDBIOTOOLS": "STANDARD BIOTOOLS",

    # ── Biosynth ─────────────────────────────────────────────────────────────
    "BIOSYNTH": "BIOSYNTH",
    "BIOSYNTHAG": "BIOSYNTH",
    "BIOSYNTHCARBOSYNTH": "BIOSYNTH",
}

# Pattern to strip for lookup (spaces, hyphens, underscores, periods, commas, ampersands, common suffixes)
_STRIP_PATTERN = re.compile(r'[\s\-_\.,&/]+')
_SUFFIX_PATTERN = re.compile(r'\b(INC|LLC|LTD|CORP|CORPORATION|CO|GMBH|PLC|BV|AG|SA)\b', re.IGNORECASE)


def _normalize_for_lookup(value: str) -> str:
    """Normalize a string for catalog lookup (uppercase, no spaces/punctuation, no suffixes)."""
    # Uppercase and strip
    value = value.upper().strip()
    # Remove common business suffixes first
    value = _SUFFIX_PATTERN.sub('', value)
    # Remove spaces, hyphens, punctuation
    return _STRIP_PATTERN.sub('', value)


def normalize_vendor(value: str | None) -> str | None:
    """
    Normalize a vendor name to its canonical form.

    First tries to match against the known catalog of vendor names.
    If no match found, returns the uppercased input with common suffixes removed.

    Examples:
        "Becton Dickinson & Company" → "BD"
        "BD Biosciences"             → "BD"
        "Sysmex Corp"                → "SYSMEX"
        "BioLegend, Inc."            → "BIOLEGEND"
        "Thermo Fisher Scientific"   → "THERMO FISHER"
        "Unknown Vendor LLC"         → "UNKNOWN VENDOR" (fallback)
    """
    if not value:
        return None

    # Normalize for lookup
    lookup_key = _normalize_for_lookup(value)

    # Try to find canonical name
    canonical = VENDOR_CANONICAL.get(lookup_key)
    if canonical:
        return canonical

    # Fallback: return uppercased input with suffixes removed
    cleaned = _SUFFIX_PATTERN.sub('', value.strip().upper()).strip()
    # Clean up any leftover punctuation at the end
    cleaned = re.sub(r'[,&\s]+$', '', cleaned)
    return cleaned or None


def is_known_vendor(value: str | None) -> bool:
    """Check if a vendor is in the known catalog."""
    if not value:
        return False
    lookup_key = _normalize_for_lookup(value)
    return lookup_key in VENDOR_CANONICAL


def get_canonical_vendors() -> list[str]:
    """Get list of all canonical vendor names (deduplicated)."""
    return sorted(set(VENDOR_CANONICAL.values()))


def get_vendor_suggestion(value: str | None, cutoff: float = 0.6) -> str | None:
    """
    Get a suggested canonical vendor name using fuzzy matching.

    Returns a suggestion if:
    1. The input doesn't match any known vendor exactly
    2. A close match is found above the cutoff threshold

    Args:
        value: The vendor name to check
        cutoff: Minimum similarity ratio (0.0 to 1.0). Default 0.6 (60% similar)

    Returns:
        Canonical vendor name if a close match is found, None otherwise.

    Examples:
        "Becton Dickenson"      → "BD" (misspelling)
        "Biolegen"              → "BIOLEGEND" (typo)
        "Thermo Fischer"        → "THERMO FISHER" (misspelling)
        "BD"                    → None (exact match, no suggestion needed)
        "Random Company"        → None (no close match)
    """
    if not value:
        return None

    # First check if it's already a known vendor (no suggestion needed)
    lookup_key = _normalize_for_lookup(value)
    if lookup_key in VENDOR_CANONICAL:
        return None  # Exact match found, no suggestion needed

    # Get all unique lookup keys for fuzzy matching
    all_keys = list(VENDOR_CANONICAL.keys())

    # Find close matches
    matches = get_close_matches(lookup_key, all_keys, n=1, cutoff=cutoff)

    if matches:
        # Return the canonical name for the closest match
        return VENDOR_CANONICAL[matches[0]]

    return None
