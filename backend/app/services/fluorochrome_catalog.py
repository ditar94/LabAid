"""
Canonical Fluorochrome Catalog

Maps fluorochrome name variations to canonical names for consistent storage.
Built from BD Biosciences, BioLegend, Thermo Fisher, and other vendor catalogs.

Usage:
    from app.services.fluorochrome_catalog import normalize_fluorochrome
    canonical = normalize_fluorochrome("BV 786")  # Returns "BV786"
"""

import re

# ── Canonical Fluorochrome Names ─────────────────────────────────────────────
# Keys are normalized (uppercase, no spaces/hyphens) for lookup
# Values are the canonical display names

FLUOROCHROME_CANONICAL: dict[str, str] = {
    # ── Basic Fluorochromes ──────────────────────────────────────────────────
    "FITC": "FITC",
    "PE": "PE",
    "PHYCOERYTHRIN": "PE",
    "APC": "APC",
    "ALLOPHYCOCYANIN": "APC",
    "PERCP": "PERCP",
    "PERIDININCHLOROPHYLLPROTEIN": "PERCP",

    # ── PerCP Tandems ────────────────────────────────────────────────────────
    "PERCPCY55": "PERCP-CY5.5",
    "PERCPCY5.5": "PERCP-CY5.5",
    "PERCPCYANINE55": "PERCP-CY5.5",
    "PERCPEF710": "PERCP-EF710",

    # ── PE Tandems ───────────────────────────────────────────────────────────
    "PECY5": "PE-CY5",
    "PECYANINE5": "PE-CY5",
    "PECY55": "PE-CY5.5",
    "PECY5.5": "PE-CY5.5",
    "PECY7": "PE-CY7",
    "PECYANINE7": "PE-CY7",
    "PECF594": "PE-CF594",
    "PETXRED": "PE-TEXAS RED",
    "PETEXASRED": "PE-TEXAS RED",
    "PEEF610": "PE-EF610",
    "PEDAZZLE594": "PE-DAZZLE 594",
    "PEDAZZLE": "PE-DAZZLE 594",
    "PEFIRE640": "PE-FIRE 640",
    "PEFIRE700": "PE-FIRE 700",
    "PEFIRE810": "PE-FIRE 810",

    # ── APC Tandems ──────────────────────────────────────────────────────────
    "APCCY7": "APC-CY7",
    "APCCYANINE7": "APC-CY7",
    "APCR700": "APC-R700",
    "APCFIRE750": "APC-FIRE 750",
    "APCFIRE810": "APC-FIRE 810",
    "APCEF780": "APC-EF780",
    "APCH7": "APC-H7",

    # ── BD Brilliant Violet (BV) Series ──────────────────────────────────────
    "BV421": "BV421",
    "BRILLIANTVIOLET421": "BV421",
    "BV480": "BV480",
    "BRILLIANTVIOLET480": "BV480",
    "BV510": "BV510",
    "BRILLIANTVIOLET510": "BV510",
    "BV570": "BV570",
    "BRILLIANTVIOLET570": "BV570",
    "BV605": "BV605",
    "BRILLIANTVIOLET605": "BV605",
    "BV650": "BV650",
    "BRILLIANTVIOLET650": "BV650",
    "BV711": "BV711",
    "BRILLIANTVIOLET711": "BV711",
    "BV750": "BV750",
    "BRILLIANTVIOLET750": "BV750",
    "BV785": "BV785",
    "BRILLIANTVIOLET785": "BV785",
    "BV786": "BV786",
    "BRILLIANTVIOLET786": "BV786",

    # ── BD Brilliant Blue (BB) Series ────────────────────────────────────────
    "BB515": "BB515",
    "BRILLIANTBLUE515": "BB515",
    "BB630": "BB630",
    "BRILLIANTBLUE630": "BB630",
    "BB660": "BB660",
    "BRILLIANTBLUE660": "BB660",
    "BB700": "BB700",
    "BRILLIANTBLUE700": "BB700",
    "BB755": "BB755",
    "BRILLIANTBLUE755": "BB755",
    "BB790": "BB790",
    "BRILLIANTBLUE790": "BB790",

    # ── BD Brilliant Ultraviolet (BUV) Series ────────────────────────────────
    "BUV395": "BUV395",
    "BRILLIANTULTRAVIOLET395": "BUV395",
    "BUV496": "BUV496",
    "BRILLIANTULTRAVIOLET496": "BUV496",
    "BUV563": "BUV563",
    "BRILLIANTULTRAVIOLET563": "BUV563",
    "BUV615": "BUV615",
    "BRILLIANTULTRAVIOLET615": "BUV615",
    "BUV661": "BUV661",
    "BRILLIANTULTRAVIOLET661": "BUV661",
    "BUV737": "BUV737",
    "BRILLIANTULTRAVIOLET737": "BUV737",
    "BUV805": "BUV805",
    "BRILLIANTULTRAVIOLET805": "BUV805",

    # ── Alexa Fluor Series ───────────────────────────────────────────────────
    "AF350": "ALEXA FLUOR 350",
    "ALEXAFLUOR350": "ALEXA FLUOR 350",
    "ALEXA350": "ALEXA FLUOR 350",
    "AF405": "ALEXA FLUOR 405",
    "ALEXAFLUOR405": "ALEXA FLUOR 405",
    "ALEXA405": "ALEXA FLUOR 405",
    "AF430": "ALEXA FLUOR 430",
    "ALEXAFLUOR430": "ALEXA FLUOR 430",
    "ALEXA430": "ALEXA FLUOR 430",
    "AF488": "ALEXA FLUOR 488",
    "ALEXAFLUOR488": "ALEXA FLUOR 488",
    "ALEXA488": "ALEXA FLUOR 488",
    "AF532": "ALEXA FLUOR 532",
    "ALEXAFLUOR532": "ALEXA FLUOR 532",
    "ALEXA532": "ALEXA FLUOR 532",
    "AF546": "ALEXA FLUOR 546",
    "ALEXAFLUOR546": "ALEXA FLUOR 546",
    "ALEXA546": "ALEXA FLUOR 546",
    "AF555": "ALEXA FLUOR 555",
    "ALEXAFLUOR555": "ALEXA FLUOR 555",
    "ALEXA555": "ALEXA FLUOR 555",
    "AF568": "ALEXA FLUOR 568",
    "ALEXAFLUOR568": "ALEXA FLUOR 568",
    "ALEXA568": "ALEXA FLUOR 568",
    "AF594": "ALEXA FLUOR 594",
    "ALEXAFLUOR594": "ALEXA FLUOR 594",
    "ALEXA594": "ALEXA FLUOR 594",
    "AF633": "ALEXA FLUOR 633",
    "ALEXAFLUOR633": "ALEXA FLUOR 633",
    "ALEXA633": "ALEXA FLUOR 633",
    "AF647": "ALEXA FLUOR 647",
    "ALEXAFLUOR647": "ALEXA FLUOR 647",
    "ALEXA647": "ALEXA FLUOR 647",
    "AF660": "ALEXA FLUOR 660",
    "ALEXAFLUOR660": "ALEXA FLUOR 660",
    "ALEXA660": "ALEXA FLUOR 660",
    "AF680": "ALEXA FLUOR 680",
    "ALEXAFLUOR680": "ALEXA FLUOR 680",
    "ALEXA680": "ALEXA FLUOR 680",
    "AF700": "ALEXA FLUOR 700",
    "ALEXAFLUOR700": "ALEXA FLUOR 700",
    "ALEXA700": "ALEXA FLUOR 700",
    "AF750": "ALEXA FLUOR 750",
    "ALEXAFLUOR750": "ALEXA FLUOR 750",
    "ALEXA750": "ALEXA FLUOR 750",
    "AF790": "ALEXA FLUOR 790",
    "ALEXAFLUOR790": "ALEXA FLUOR 790",
    "ALEXA790": "ALEXA FLUOR 790",

    # ── Pacific Dyes ─────────────────────────────────────────────────────────
    "PACIFICBLUE": "PACIFIC BLUE",
    "PB": "PACIFIC BLUE",
    "PACIFICORANGE": "PACIFIC ORANGE",
    "PO": "PACIFIC ORANGE",

    # ── BioLegend Spark Series ───────────────────────────────────────────────
    "SPARKBLUE550": "SPARK BLUE 550",
    "SB550": "SPARK BLUE 550",
    "SPARKNIR685": "SPARK NIR 685",
    "SNIR685": "SPARK NIR 685",
    "SPARKVIOLET500": "SPARK VIOLET 500",
    "SV500": "SPARK VIOLET 500",
    "SPARKUV387": "SPARK UV 387",
    "SUV387": "SPARK UV 387",
    "SPARKYG570": "SPARK YG 570",
    "SYG570": "SPARK YG 570",
    "SPARKYG581": "SPARK YG 581",
    "SYG581": "SPARK YG 581",

    # ── eFluor Series (Thermo Fisher) ────────────────────────────────────────
    "EFLUOR450": "EFLUOR 450",
    "EF450": "EFLUOR 450",
    "EFLUOR506": "EFLUOR 506",
    "EF506": "EFLUOR 506",
    "EFLUOR660": "EFLUOR 660",
    "EF660": "EFLUOR 660",
    "EFLUOR710": "EFLUOR 710",
    "EF710": "EFLUOR 710",
    "EFLUOR780": "EFLUOR 780",
    "EF780": "EFLUOR 780",

    # ── Super Bright Series (Thermo Fisher) ──────────────────────────────────
    "SUPERBRIGHT436": "SUPER BRIGHT 436",
    "SB436": "SUPER BRIGHT 436",
    "SUPERBRIGHT600": "SUPER BRIGHT 600",
    "SB600": "SUPER BRIGHT 600",
    "SUPERBRIGHT645": "SUPER BRIGHT 645",
    "SB645": "SUPER BRIGHT 645",
    "SUPERBRIGHT702": "SUPER BRIGHT 702",
    "SB702": "SUPER BRIGHT 702",
    "SUPERBRIGHT780": "SUPER BRIGHT 780",
    "SB780": "SUPER BRIGHT 780",

    # ── Cyanine Dyes ─────────────────────────────────────────────────────────
    "CY3": "CY3",
    "CYANINE3": "CY3",
    "CY5": "CY5",
    "CYANINE5": "CY5",
    "CY55": "CY5.5",
    "CY5.5": "CY5.5",
    "CYANINE55": "CY5.5",
    "CY7": "CY7",
    "CYANINE7": "CY7",

    # ── Other Common Fluorochromes ───────────────────────────────────────────
    "DAPI": "DAPI",
    "HOECHST": "HOECHST",
    "HOECHST33342": "HOECHST 33342",
    "PI": "PI",
    "PROPIDIUMIODIDE": "PI",
    "7AAD": "7-AAD",
    "7ADD": "7-AAD",
    "SYTOX": "SYTOX",
    "CFSE": "CFSE",
    "CELLTRACEVIOLET": "CELLTRACE VIOLET",
    "CTV": "CELLTRACE VIOLET",
    "CELLTRACEYELLOW": "CELLTRACE YELLOW",
    "CTY": "CELLTRACE YELLOW",
    "VIOLETFLUORESCENTREACTIVEDYE": "VFRD",
    "VFRD": "VFRD",
    "ZOMBIE": "ZOMBIE",
    "ZOMBIEAQUA": "ZOMBIE AQUA",
    "ZOMBIEGREEN": "ZOMBIE GREEN",
    "ZOMBIENIR": "ZOMBIE NIR",
    "ZOMBIERED": "ZOMBIE RED",
    "ZOMBIEUV": "ZOMBIE UV",
    "ZOMBIEVIOLET": "ZOMBIE VIOLET",
    "ZOMBIEYELLOW": "ZOMBIE YELLOW",

    # ── Qdot Series ──────────────────────────────────────────────────────────
    "QDOT525": "QDOT 525",
    "QD525": "QDOT 525",
    "QDOT545": "QDOT 545",
    "QD545": "QDOT 545",
    "QDOT565": "QDOT 565",
    "QD565": "QDOT 565",
    "QDOT585": "QDOT 585",
    "QD585": "QDOT 585",
    "QDOT605": "QDOT 605",
    "QD605": "QDOT 605",
    "QDOT625": "QDOT 625",
    "QD625": "QDOT 625",
    "QDOT655": "QDOT 655",
    "QD655": "QDOT 655",
    "QDOT705": "QDOT 705",
    "QD705": "QDOT 705",
    "QDOT800": "QDOT 800",
    "QD800": "QDOT 800",

    # ── LIVE/DEAD Dyes ───────────────────────────────────────────────────────
    "LIVEDEADAQUA": "LIVE/DEAD AQUA",
    "LIVEDEADBLUE": "LIVE/DEAD BLUE",
    "LIVEDEADFIXABLEAQUA": "LIVE/DEAD AQUA",
    "LIVEDEADFIXABLEBLUE": "LIVE/DEAD BLUE",
    "LIVEDEADGREEN": "LIVE/DEAD GREEN",
    "LIVEDEADNIR": "LIVE/DEAD NIR",
    "LIVEDEADRED": "LIVE/DEAD RED",
    "LIVEDEADVIOLET": "LIVE/DEAD VIOLET",
    "LIVEDEADYELLOW": "LIVE/DEAD YELLOW",
}

# Pattern to strip for lookup (spaces, hyphens, underscores, periods, slashes)
_STRIP_PATTERN = re.compile(r'[\s\-_\./]+')


def _normalize_for_lookup(value: str) -> str:
    """Normalize a string for catalog lookup (uppercase, no spaces/hyphens/etc.)"""
    return _STRIP_PATTERN.sub('', value.upper().strip())


def normalize_fluorochrome(value: str | None) -> str | None:
    """
    Normalize a fluorochrome name to its canonical form.

    First tries to match against the known catalog of fluorochromes.
    If no match found, returns the uppercased input (preserving structure).

    Examples:
        "BV 786"           → "BV786"
        "BV-786"           → "BV786"
        "brilliant violet 786" → "BV786"
        "APC-R700"         → "APC-R700"
        "apc r 700"        → "APC-R700"
        "alexa fluor 647"  → "ALEXA FLUOR 647"
        "AF647"            → "ALEXA FLUOR 647"
        "Unknown Fluoro"   → "UNKNOWN FLUORO" (fallback to uppercase)
    """
    if not value:
        return None

    # Normalize for lookup
    lookup_key = _normalize_for_lookup(value)

    # Try to find canonical name
    canonical = FLUOROCHROME_CANONICAL.get(lookup_key)
    if canonical:
        return canonical

    # Fallback: return uppercased input (preserve structure)
    return value.strip().upper() or None


def is_known_fluorochrome(value: str | None) -> bool:
    """Check if a fluorochrome is in the known catalog."""
    if not value:
        return False
    lookup_key = _normalize_for_lookup(value)
    return lookup_key in FLUOROCHROME_CANONICAL


def get_canonical_fluorochromes() -> list[str]:
    """Get list of all canonical fluorochrome names (deduplicated)."""
    return sorted(set(FLUOROCHROME_CANONICAL.values()))
