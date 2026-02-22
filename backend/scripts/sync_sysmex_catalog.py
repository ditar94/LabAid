#!/usr/bin/env python3
"""
Sysmex Catalog Scraper

Scrapes the Sysmex CyFlow antibody catalog and generates a static Python
lookup file for barcode enrichment.

Usage:
    python scripts/sync_sysmex_catalog.py

Output:
    app/services/sysmex_catalog.py - Static lookup dict

This script is designed to be run:
- Manually by developers
- Automatically via GitHub Actions (monthly)
"""
from __future__ import annotations

import re
import sys
import time
from pathlib import Path
from urllib.parse import urljoin

import httpx
from bs4 import BeautifulSoup

BASE_URL = "https://us.sysmex-flowcytometry.com"
CATALOG_URL = f"{BASE_URL}/reagents/flow-cytometry/antibody-reagents/"
OUTPUT_FILE = Path(__file__).parent.parent / "app" / "services" / "sysmex_catalog.py"

# Rate limiting
REQUEST_DELAY = 0.5  # seconds between requests


def fetch_page(url: str, timeout: float = 30.0) -> str | None:
    """Fetch a page with error handling."""
    try:
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get(url, headers={
                "User-Agent": "LabAid-Catalog-Sync/1.0 (contact: support@labaid.io)"
            })
            resp.raise_for_status()
            return resp.text
    except Exception as e:
        print(f"  Error fetching {url}: {e}", file=sys.stderr)
        return None


def parse_product_list(html: str) -> list[dict]:
    """Parse product list from catalog page HTML."""
    soup = BeautifulSoup(html, "html.parser")
    products = []

    # Find product links - they're in a product listing
    for link in soup.select("a[href*='/reagents/flow-cytometry/antibody-reagents/']"):
        href = link.get("href", "")
        # Skip pagination and category links
        if not href or "?" in href or href.endswith("/antibody-reagents/"):
            continue

        # Extract product name from link text
        name = link.get_text(strip=True)
        if not name or len(name) < 5:
            continue

        # Skip if it doesn't look like a product name
        if not name.startswith("CyFlow"):
            continue

        products.append({
            "name": name,
            "url": urljoin(BASE_URL, href),
        })

    return products


def parse_product_detail(html: str, product_name: str) -> dict | None:
    """Parse product detail page for catalog number and specs."""
    soup = BeautifulSoup(html, "html.parser")

    # Try to find catalog number in various places
    catalog_number = None

    # Look for catalog number in product info table or text
    text = soup.get_text(" ", strip=True)

    # Pattern for Sysmex catalog numbers: 2 letters + 6 digits
    catalog_match = re.search(r'\b([A-Z]{2}\d{6})\b', text)
    if catalog_match:
        catalog_number = catalog_match.group(1)

    if not catalog_number:
        return None

    # Parse product name for target and fluorochrome
    # Format: "CyFlow™ CD45 Pacific Orange™" or "CyFlow™ CD45 Purified"
    parsed = parse_product_name(product_name)

    return {
        "catalog_number": catalog_number,
        "name": product_name,
        "target": parsed.get("target"),
        "fluorochrome": parsed.get("fluorochrome"),
        "clone": parsed.get("clone"),
    }


def parse_product_name(name: str) -> dict:
    """
    Parse target, fluorochrome, and clone from product name.

    Examples:
        "CyFlow™ CD45 Pacific Orange™" → target=CD45, fluorochrome=Pacific Orange
        "CyFlow™ CD4 Purified" → target=CD4, fluorochrome=None (purified)
        "CyFlow™ CD10 PE-Cy7" → target=CD10, fluorochrome=PE-Cy7
        "CyFlow™ Beta2-MG FITC" → target=Beta2-MG, fluorochrome=FITC
    """
    result = {"target": None, "fluorochrome": None, "clone": None}

    # Remove CyFlow prefix and trademark symbols
    cleaned = re.sub(r'^CyFlow[™®]?\s*', '', name, flags=re.IGNORECASE)
    cleaned = re.sub(r'[™®]', '', cleaned)

    # Known fluorochromes (order matters - check longer ones first)
    fluorochromes = [
        "Pacific Orange", "Pacific Blue",
        "Alexa Fluor 647", "Alexa Fluor 700", "Alexa Fluor 488",
        "APC-Cy7", "APC-H7", "PE-Cy7", "PE-Cy5", "PE-Cy5.5",
        "PerCP-Cy5.5", "PerCP",
        "PE-DyLight 594", "PE-CF594",
        "APC", "PE", "FITC",
        "Biotin", "HRP", "Purified", "Azide Free",
    ]

    fluoro_found = None
    for fluoro in fluorochromes:
        if fluoro.lower() in cleaned.lower():
            fluoro_found = fluoro
            # Remove fluorochrome from string to get target
            pattern = re.compile(re.escape(fluoro), re.IGNORECASE)
            cleaned = pattern.sub('', cleaned).strip()
            break

    # What remains should be the target
    target = cleaned.strip()

    # Handle "Purified" as no fluorochrome
    if fluoro_found and fluoro_found.lower() in ("purified", "azide free", "biotin", "hrp"):
        fluoro_found = None  # These aren't fluorochromes for flow cytometry

    result["target"] = target if target else None
    result["fluorochrome"] = fluoro_found

    return result


def scrape_catalog_from_listing(html: str) -> list[dict]:
    """
    Parse products from the listing page.

    The product data is in a JavaScript ecommerce impressions array:
    {"name":"CyFlow™ ABRA1 Purified","id":"AP667270","price":120,...}
    """
    products = []

    # Find the impressions array in the ecommerce data layer
    # Pattern: "impressions":[{...},{...},...]
    match = re.search(r'"impressions"\s*:\s*\[(\{[^\]]+)\]', html)
    if not match:
        return products

    impressions_str = "[" + match.group(1) + "]"

    # Parse each product object - they look like:
    # {"name":"CyFlow™ CD3 FITC","id":"BA030994","price":245,...}
    for prod_match in re.finditer(
        r'\{"name":"([^"]+)","id":"([A-Z]{2}\d{6})"[^}]*\}',
        impressions_str
    ):
        product_name = prod_match.group(1)
        catalog_number = prod_match.group(2)

        # Clean up product name (remove trademark symbols, unescape)
        product_name = product_name.replace("\\u2122", "").replace("™", "").strip()
        product_name = re.sub(r'[™®]', '', product_name).strip()

        # Parse target and fluorochrome from name
        parsed = parse_product_name(product_name)

        products.append({
            "catalog_number": catalog_number,
            "name": product_name,
            "target": parsed.get("target"),
            "fluorochrome": parsed.get("fluorochrome"),
            "clone": parsed.get("clone"),
        })

    return products


def fetch_all_pages() -> list[dict]:
    """Fetch all pages of the catalog."""
    all_products = []
    page = 1

    while True:
        url = f"{CATALOG_URL}?p={page}&n=100"
        print(f"Fetching page {page}...")

        html = fetch_page(url)
        if not html:
            print("  Failed to fetch page")
            break

        products = scrape_catalog_from_listing(html)

        if not products:
            print("  No products found on page")
            break

        all_products.extend(products)
        print(f"  Found {len(products)} products on page {page}")

        # Check if there are more pages (less than 100 = last page)
        if len(products) < 100:
            break

        page += 1
        time.sleep(REQUEST_DELAY)

    return all_products


def generate_catalog_file(products: list[dict]) -> str:
    """Generate the Python catalog file content."""
    # Deduplicate by catalog number
    by_catalog = {}
    for p in products:
        cat = p["catalog_number"]
        if cat not in by_catalog:
            by_catalog[cat] = p

    # Sort by catalog number
    sorted_products = sorted(by_catalog.values(), key=lambda x: x["catalog_number"])

    lines = [
        '"""',
        "Sysmex CyFlow Antibody Catalog",
        "",
        "Auto-generated static lookup for Sysmex barcode enrichment.",
        "Maps catalog numbers to product details (target, fluorochrome, clone).",
        "",
        "DO NOT EDIT MANUALLY - regenerate with:",
        "    python scripts/sync_sysmex_catalog.py",
        "",
        f"Last updated: {time.strftime('%Y-%m-%d')}",
        f"Products: {len(sorted_products)}",
        '"""',
        "",
        "from __future__ import annotations",
        "",
        "from dataclasses import dataclass",
        "",
        "",
        "@dataclass(frozen=True)",
        "class SysmexProduct:",
        '    """A product from the Sysmex CyFlow catalog."""',
        "    catalog_number: str",
        "    name: str",
        "    target: str | None",
        "    fluorochrome: str | None",
        "    clone: str | None = None",
        "",
        "",
        "# Catalog number → product details",
        "SYSMEX_CATALOG: dict[str, SysmexProduct] = {",
    ]

    for p in sorted_products:
        cat = p["catalog_number"]
        name = p["name"].replace('"', '\\"')
        target = f'"{p["target"]}"' if p["target"] else "None"
        fluoro = f'"{p["fluorochrome"]}"' if p["fluorochrome"] else "None"
        clone = f'"{p["clone"]}"' if p["clone"] else "None"

        lines.append(
            f'    "{cat}": SysmexProduct("{cat}", "{name}", {target}, {fluoro}, {clone}),'
        )

    lines.extend([
        "}",
        "",
        "",
        "def lookup_sysmex_catalog(catalog_number: str) -> SysmexProduct | None:",
        '    """Look up a product by catalog number."""',
        "    return SYSMEX_CATALOG.get(catalog_number.upper())",
        "",
        "",
        "def get_sysmex_catalog_count() -> int:",
        '    """Get the number of products in the catalog."""',
        "    return len(SYSMEX_CATALOG)",
        "",
    ])

    return "\n".join(lines)


def main():
    print("Sysmex Catalog Sync")
    print("=" * 40)

    # Fetch all products
    products = fetch_all_pages()

    if not products:
        print("ERROR: No products found! Check if the website structure changed.", file=sys.stderr)
        print("The existing catalog file was NOT modified.", file=sys.stderr)
        sys.exit(1)

    print(f"\nTotal products scraped: {len(products)}")

    # Safety check: don't overwrite if we got significantly fewer products
    # (indicates parsing failure, not actual catalog shrinkage)
    MIN_EXPECTED_PRODUCTS = 100
    if len(products) < MIN_EXPECTED_PRODUCTS:
        print(f"ERROR: Only {len(products)} products found (expected {MIN_EXPECTED_PRODUCTS}+).", file=sys.stderr)
        print("This likely indicates a website structure change.", file=sys.stderr)
        print("The existing catalog file was NOT modified.", file=sys.stderr)
        sys.exit(1)

    # Generate catalog file
    content = generate_catalog_file(products)

    # Write output
    OUTPUT_FILE.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT_FILE.write_text(content)

    print(f"Wrote catalog to: {OUTPUT_FILE}")
    print("Done!")


if __name__ == "__main__":
    main()
