"""
Canonical Vendor Name Catalog

Maps vendor name variations to canonical names for consistent storage.
Covers major flow cytometry reagent manufacturers.

Usage:
    from app.services.vendor_catalog_names import normalize_vendor
    canonical = normalize_vendor("Becton Dickinson & Company")  # Returns "BD"
"""

import re

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
