from __future__ import annotations

"""
Product Name Parser

Extracts target and fluorochrome from product brand names like:
    "CyFlow™ CD45 Pacific Orange™" → target=CD45, fluorochrome=PACIFIC ORANGE
    "BV421 Mouse Anti-Human CD3"   → target=CD3, fluorochrome=BV421
    "PE/Cy7 anti-human CD19"       → target=CD19, fluorochrome=PE-CY7

Uses the fluorochrome catalog for matching known fluorochromes.
"""

import re
from dataclasses import dataclass

from app.services.fluorochrome_catalog import (
    FLUOROCHROME_CANONICAL,
    normalize_fluorochrome,
    _normalize_for_lookup as normalize_fluoro_key,
)

# ── Target patterns ───────────────────────────────────────────────────────────
# Common flow cytometry target patterns

TARGET_PATTERNS = [
    # CD markers: CD3, CD4, CD8, CD19, CD45, CD45RA, CD45RO, etc.
    r'\b(CD\d+[A-Z]*)\b',
    # HLA markers: HLA-DR, HLA-ABC, HLA-A2, etc.
    r'\b(HLA[-\s]?[A-Z0-9]+)\b',
    # TCR markers: TCR alpha/beta, TCR gamma/delta, etc.
    r'\b(TCR[-\s]?[A-Za-z/]+)\b',
    # Ig markers: IgG, IgM, IgA, IgD, IgE, Ig kappa, Ig lambda
    r'\b(Ig[GMAED]|Ig[-\s]?(?:kappa|lambda|κ|λ))\b',
    # Ki-67, Ki67
    r'\b(Ki[-\s]?67)\b',
    # FoxP3, FOXP3
    r'\b(Fox[-\s]?P3)\b',
    # Granzyme markers
    r'\b(Granzyme[-\s]?[AB])\b',
    # Perforin
    r'\b(Perforin)\b',
    # Cytokines: IL-2, IL-4, IL-6, IFN-gamma, TNF-alpha, etc.
    r'\b(IL[-\s]?\d+)\b',
    r'\b(IFN[-\s]?(?:gamma|α|β|γ))\b',
    r'\b(TNF[-\s]?(?:alpha|α))\b',
    # Other common markers
    r'\b(PD[-\s]?1|PD[-\s]?L1)\b',
    r'\b(CTLA[-\s]?4)\b',
    r'\b(CCR\d+|CXCR\d+)\b',
]

# Words to strip from product names before parsing
STRIP_WORDS = [
    r'\b(?:Mouse|Rat|Rabbit|Human|Anti[-\s]?Human|Anti[-\s]?Mouse)\b',
    r'\b(?:Monoclonal|Polyclonal|Antibody|Ab|mAb)\b',
    r'\b(?:Conjugated|Conjugate)\b',
    r'[™®©]',  # Trademark symbols
]

# Product line prefixes to remove (be careful not to strip fluorochrome names!)
PRODUCT_PREFIXES = [
    r'^CyFlow\s*',
    r'^Ultra[-\s]?Bright\s*',
    r'^Super[-\s]?Bright\s*',
    # Note: Do NOT strip "Brilliant" as it's part of "Brilliant Violet/Blue/UV" fluorochromes
]


@dataclass
class ParsedProduct:
    """Result of parsing a product name."""
    target: str | None = None
    fluorochrome: str | None = None
    target_raw: str | None = None  # Original extracted string
    fluorochrome_raw: str | None = None  # Original extracted string
    product_name: str | None = None  # Full product name (for multitest/IVD products)
    is_multitest: bool = False  # True if this is a multi-target panel


def _clean_name(name: str) -> str:
    """Clean product name for parsing."""
    cleaned = name

    # Remove trademark symbols
    cleaned = re.sub(r'[™®©]', '', cleaned)

    # Remove product prefixes
    for prefix in PRODUCT_PREFIXES:
        cleaned = re.sub(prefix, '', cleaned, flags=re.IGNORECASE)

    return cleaned.strip()


def _find_fluorochrome(name: str) -> tuple[str | None, str | None]:
    """
    Find a fluorochrome in the product name.

    Returns (canonical_name, raw_match) or (None, None) if not found.
    """
    # Strategy: tokenize and check each token/combination against our catalog
    # We need to handle multi-word fluorochromes like "Pacific Orange", "Alexa Fluor 647"

    cleaned = _clean_name(name).upper()

    # Try progressively longer phrases (up to 4 words)
    words = re.split(r'[\s/]+', cleaned)

    best_match: tuple[str | None, str | None] = (None, None)
    best_length = 0

    for i in range(len(words)):
        for length in range(1, min(5, len(words) - i + 1)):
            phrase = ' '.join(words[i:i + length])
            # Also try without spaces (e.g., "PACIFICORANGE")
            phrase_no_space = ''.join(words[i:i + length])

            # Check if this matches a known fluorochrome
            key = normalize_fluoro_key(phrase)
            if key in FLUOROCHROME_CANONICAL:
                if length > best_length:
                    canonical = FLUOROCHROME_CANONICAL[key]
                    raw = ' '.join(words[i:i + length])
                    best_match = (canonical, raw)
                    best_length = length

            # Also check the no-space version
            key_no_space = normalize_fluoro_key(phrase_no_space)
            if key_no_space in FLUOROCHROME_CANONICAL:
                if length > best_length:
                    canonical = FLUOROCHROME_CANONICAL[key_no_space]
                    raw = ''.join(words[i:i + length])
                    best_match = (canonical, raw)
                    best_length = length

    return best_match


def _find_target(name: str) -> tuple[str | None, str | None]:
    """
    Find a target antigen in the product name.

    Returns (normalized_target, raw_match) or (None, None) if not found.
    """
    cleaned = _clean_name(name)

    for pattern in TARGET_PATTERNS:
        match = re.search(pattern, cleaned, re.IGNORECASE)
        if match:
            raw = match.group(1)
            # Normalize: uppercase, remove spaces/hyphens for CD markers
            normalized = raw.upper().replace(' ', '').replace('-', '')
            # But keep hyphens for HLA (e.g., HLA-DR)
            if raw.upper().startswith('HLA'):
                normalized = 'HLA-' + normalized[3:].lstrip('-')
            return (normalized, raw)

    return (None, None)


def _is_multitest_product(name: str) -> bool:
    """
    Detect if a product is a multi-target panel (Multitest, cocktail, etc.).

    These products have multiple targets and should be treated as IVD products
    with the full product name preserved rather than parsing individual targets.

    Examples:
        "Multitest CD3/CD16+CD56/CD45/CD19" → True
        "BD Multitest 6-Color TBNK" → True
        "CD3/CD4/CD8/CD45" → True (multiple slash-separated targets)
        "CD45 FITC" → False (single target)
        "PE/Cy7 anti-human CD19" → False (slash is in fluorochrome name)
    """
    upper = name.upper()

    # Explicit multitest products
    if "MULTITEST" in upper or "MULTI-TEST" in upper:
        return True

    # Count CD markers separated by slashes
    # Pattern: CD followed by digits, separated by / or +
    cd_markers = re.findall(r'\bCD\d+[A-Z]*\b', upper)
    if len(cd_markers) >= 3:
        # Check if they're in a slash/plus separated format (panel notation)
        if re.search(r'CD\d+[A-Z]*[/+].*CD\d+', upper):
            return True

    return False


def parse_product_name(name: str | None) -> ParsedProduct:
    """
    Parse target and fluorochrome from a product brand name.

    Examples:
        "CyFlow™ CD45 Pacific Orange™"
            → target="CD45", fluorochrome="PACIFIC ORANGE"

        "BV421 Mouse Anti-Human CD3"
            → target="CD3", fluorochrome="BV421"

        "PE/Cy7 anti-human CD19"
            → target="CD19", fluorochrome="PE-CY7"

        "Brilliant Violet 421™ anti-human CD4"
            → target="CD4", fluorochrome="BV421"

        "Multitest CD3/CD16+CD56/CD45/CD19"
            → is_multitest=True, product_name="Multitest CD3/CD16+CD56/CD45/CD19"

    Returns ParsedProduct with extracted values (None if not found).
    """
    if not name:
        return ParsedProduct()

    # Check for multi-target products first
    if _is_multitest_product(name):
        # Clean up product name but preserve the full panel info
        clean_name = re.sub(r'[™®©]', '', name).strip()
        return ParsedProduct(
            target=None,
            fluorochrome=None,
            product_name=clean_name,
            is_multitest=True,
        )

    fluoro_canonical, fluoro_raw = _find_fluorochrome(name)
    target_normalized, target_raw = _find_target(name)

    return ParsedProduct(
        target=target_normalized,
        fluorochrome=fluoro_canonical,
        target_raw=target_raw,
        fluorochrome_raw=fluoro_raw,
    )


def enrich_from_brand_name(
    brand_name: str | None,
    existing_target: str | None = None,
    existing_fluorochrome: str | None = None,
) -> dict[str, str | None]:
    """
    Enrich scan data by parsing brand name, filling in missing fields.

    Only returns values for fields that are currently empty.

    Args:
        brand_name: Product brand name to parse
        existing_target: Current target value (won't override if set)
        existing_fluorochrome: Current fluorochrome value (won't override if set)

    Returns:
        Dict with 'target' and 'fluorochrome' keys (None if not extracted or already exists)
    """
    result: dict[str, str | None] = {
        'target': None,
        'fluorochrome': None,
    }

    if not brand_name:
        return result

    parsed = parse_product_name(brand_name)

    # Only fill in missing values
    if not existing_target and parsed.target:
        result['target'] = parsed.target

    if not existing_fluorochrome and parsed.fluorochrome:
        result['fluorochrome'] = parsed.fluorochrome

    return result


def parse_product_fields(
    brand_name: str | None,
    description: str | None,
) -> ParsedProduct:
    """
    Parse target and fluorochrome from product brand name AND description.

    Some vendors (e.g., BD) put "N/A" in brand name and put the actual
    product info in the description field. This function tries both.

    For multitest/IVD products with multiple targets, returns is_multitest=True
    and sets product_name to the full description instead of parsing targets.

    Args:
        brand_name: Product brand name (may be "N/A" or empty)
        description: Product description (fallback source)

    Returns:
        ParsedProduct with best extracted values from either field.
    """
    # Try description first for multitest detection (more reliable source)
    if description:
        desc_result = parse_product_name(description)
        if desc_result.is_multitest:
            return desc_result

    # Try brand name (unless it's "N/A" or similar)
    result = ParsedProduct()

    if brand_name and brand_name.upper() not in ("N/A", "NA", "NONE", ""):
        result = parse_product_name(brand_name)
        if result.is_multitest:
            return result

    # If we didn't get both fields, try description
    if (not result.target or not result.fluorochrome) and description:
        desc_result = parse_product_name(description)

        # Fill in missing values from description
        if not result.target and desc_result.target:
            result.target = desc_result.target
            result.target_raw = desc_result.target_raw

        if not result.fluorochrome and desc_result.fluorochrome:
            result.fluorochrome = desc_result.fluorochrome
            result.fluorochrome_raw = desc_result.fluorochrome_raw

    return result
