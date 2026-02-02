"""
AccessGUDID (FDA) device lookup client.

Queries the FDA's AccessGUDID API by GTIN (Device Identifier) to retrieve
device metadata such as company name, catalog number, and description.
Results are cached in-memory with a 1-hour TTL.
"""

import logging
import time
from typing import Any

import httpx

logger = logging.getLogger(__name__)

GUDID_BASE_URL = "https://accessgudid.nlm.nih.gov/api/v3/devices/lookup.json"
CACHE_TTL = 3600  # 1 hour
REQUEST_TIMEOUT = 5.0  # seconds

# Simple in-memory cache: gtin -> (timestamp, result_list)
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
    # Check cache
    cached = _cache.get(gtin)
    if cached is not None:
        ts, result = cached
        if time.time() - ts < CACHE_TTL:
            return result

    try:
        async with httpx.AsyncClient(timeout=REQUEST_TIMEOUT) as client:
            resp = await client.get(GUDID_BASE_URL, params={"di": gtin})
            resp.raise_for_status()

        data = resp.json()

        # The API returns a single device under gudid.device
        device_data = data.get("gudid", {}).get("device")
        if device_data:
            devices = [_extract_device(device_data)]
        else:
            devices = []

        _cache[gtin] = (time.time(), devices)
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


def clear_cache() -> None:
    """Clear the GUDID response cache (for testing)."""
    _cache.clear()
