"""
AccessGUDID (FDA) device lookup client.

Queries the FDA's AccessGUDID API by GTIN (Device Identifier) or catalog number
to retrieve device metadata such as company name, catalog number, and description.
Results are cached in-memory with a 1-hour TTL.
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GUDID_LOOKUP_URL = "https://accessgudid.nlm.nih.gov/api/v2/devices/lookup.json"
GUDID_SEARCH_URL = "https://accessgudid.nlm.nih.gov/devices/search"
CACHE_TTL = 3600  # 1 hour
REQUEST_TIMEOUT = 5.0  # seconds

# Simple in-memory cache: key -> (timestamp, result_list)
_cache: dict[str, tuple[float, list[dict[str, str]]]] = {}


def _extract_device(device: dict[str, Any]) -> dict[str, str]:
    """Extract relevant fields from a GUDID device record."""
    return {
        "brand_name": device.get("brandName") or "",
        "company_name": device.get("companyName") or "",
        "catalog_number": device.get("catalogNumber") or device.get("versionModelNumber") or "",
        "description": device.get("deviceDescription") or "",
    }


async def lookup_gudid(gtin: str) -> list[dict[str, str]]:
    """Look up a device by GTIN (DI) in the FDA AccessGUDID database.

    Returns a list of device dicts with keys:
        brand_name, company_name, catalog_number, description

    Returns an empty list on any error (network, timeout, 404, etc.)
    so that callers can fall back to manual entry without blocking.
    """
    cache_key = f"gtin:{gtin}"

    # Check cache
    cached = _cache.get(cache_key)
    if cached is not None:
        ts, result = cached
        if time.time() - ts < CACHE_TTL:
            return result

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(GUDID_LOOKUP_URL, params={"di": gtin})
            resp.raise_for_status()

        data = resp.json()

        # The API returns a single device under gudid.device
        device_data = data.get("gudid", {}).get("device")
        if device_data:
            devices = [_extract_device(device_data)]
        else:
            devices = []

        _cache[cache_key] = (time.time(), devices)
        return devices

    except httpx.TimeoutException:
        logger.warning("AccessGUDID lookup timed out for GTIN %s", gtin)
        return []
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "AccessGUDID lookup failed for GTIN %s: HTTP %d",
            gtin,
            exc.response.status_code,
        )
        return []
    except Exception:
        logger.warning("AccessGUDID lookup error for GTIN %s", gtin, exc_info=True)
        return []


async def search_gudid_by_catalog(catalog_number: str) -> list[dict[str, str]]:
    """Search for a device by catalog number in the FDA AccessGUDID database.

    Uses the search endpoint which returns Elasticsearch results.

    Returns a list of device dicts with keys:
        brand_name, company_name, catalog_number, description

    Returns an empty list on any error (network, timeout, no results, etc.)
    so that callers can fall back to manual entry without blocking.
    """
    cache_key = f"catalog:{catalog_number}"

    # Check cache
    cached = _cache.get(cache_key)
    if cached is not None:
        ts, result = cached
        if time.time() - ts < CACHE_TTL:
            return result

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(
                GUDID_SEARCH_URL,
                params={"query": catalog_number},
                headers={"Accept": "application/json"},
            )
            resp.raise_for_status()

        data = resp.json()

        # The search API returns Elasticsearch format with hits.hits[]
        hits = data.get("hits", {}).get("hits", [])
        devices = []
        for hit in hits:
            source = hit.get("_source", {})
            # Verify this is actually a match for our catalog number
            if source.get("catalogNumber") == catalog_number or source.get("versionModelNumber") == catalog_number:
                devices.append({
                    "brand_name": source.get("brandName") or "",
                    "company_name": source.get("companyName") or "",
                    "catalog_number": source.get("catalogNumber") or source.get("versionModelNumber") or "",
                    "description": source.get("deviceDescription") or "",
                    "gtin": source.get("primaryDeviceId") or "",
                })

        _cache[cache_key] = (time.time(), devices)
        return devices

    except httpx.TimeoutException:
        logger.warning("AccessGUDID search timed out for catalog %s", catalog_number)
        return []
    except httpx.HTTPStatusError as exc:
        logger.warning(
            "AccessGUDID search failed for catalog %s: HTTP %d",
            catalog_number,
            exc.response.status_code,
        )
        return []
    except Exception:
        logger.warning("AccessGUDID search error for catalog %s", catalog_number, exc_info=True)
        return []


def clear_cache() -> None:
    """Clear the GUDID response cache (for testing)."""
    _cache.clear()
