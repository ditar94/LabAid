"""Tests for AccessGUDID client."""

import time
from unittest.mock import AsyncMock, patch

import httpx
import pytest

from app.services.gudid_client import clear_cache, lookup_gudid

# Sample API response matching AccessGUDID v3 structure
SAMPLE_RESPONSE = {
    "gudid": {
        "device": {
            "brandName": "BD Horizon",
            "companyName": "BECTON DICKINSON AND CO",
            "catalogNumber": "562400",
            "versionModelNumber": "562400",
            "deviceDescription": "BD Horizon BV421 Mouse Anti-Human CD4",
        }
    }
}

EXPECTED_DEVICE = {
    "brand_name": "BD Horizon",
    "company_name": "BECTON DICKINSON AND CO",
    "catalog_number": "562400",
    "description": "BD Horizon BV421 Mouse Anti-Human CD4",
}


@pytest.fixture(autouse=True)
def _clear_cache():
    """Clear cache before each test."""
    clear_cache()
    yield
    clear_cache()


def _mock_response(status_code=200, json_data=None):
    """Create a mock httpx.Response."""
    resp = httpx.Response(
        status_code=status_code,
        json=json_data or {},
        request=httpx.Request("GET", "https://example.com"),
    )
    return resp


@pytest.mark.asyncio
async def test_successful_lookup():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=_mock_response(200, SAMPLE_RESPONSE))

    with patch("app.services.gudid_client.httpx.AsyncClient", return_value=mock_client):
        result = await lookup_gudid("00362400562400")

    assert len(result) == 1
    assert result[0] == EXPECTED_DEVICE


@pytest.mark.asyncio
async def test_404_returns_empty_list():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=_mock_response(404))

    with patch("app.services.gudid_client.httpx.AsyncClient", return_value=mock_client):
        result = await lookup_gudid("00000000000000")

    assert result == []


@pytest.mark.asyncio
async def test_timeout_returns_empty_list():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(side_effect=httpx.TimeoutException("timeout"))

    with patch("app.services.gudid_client.httpx.AsyncClient", return_value=mock_client):
        result = await lookup_gudid("00362400562400")

    assert result == []


@pytest.mark.asyncio
async def test_cache_hit_avoids_second_call():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=_mock_response(200, SAMPLE_RESPONSE))

    with patch("app.services.gudid_client.httpx.AsyncClient", return_value=mock_client):
        result1 = await lookup_gudid("00362400562400")
        result2 = await lookup_gudid("00362400562400")

    assert result1 == result2
    # Only one HTTP call should have been made
    assert mock_client.get.call_count == 1


@pytest.mark.asyncio
async def test_cache_expiry_causes_refetch():
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=_mock_response(200, SAMPLE_RESPONSE))

    with patch("app.services.gudid_client.httpx.AsyncClient", return_value=mock_client):
        await lookup_gudid("00362400562400")

        # Expire the cache entry
        with patch("app.services.gudid_client.time") as mock_time:
            mock_time.time.return_value = time.time() + 7200  # 2 hours later
            await lookup_gudid("00362400562400")

    assert mock_client.get.call_count == 2


@pytest.mark.asyncio
async def test_missing_device_in_response():
    response_no_device = {"gudid": {}}
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=_mock_response(200, response_no_device))

    with patch("app.services.gudid_client.httpx.AsyncClient", return_value=mock_client):
        result = await lookup_gudid("00362400562400")

    assert result == []


@pytest.mark.asyncio
async def test_catalog_number_falls_back_to_version_model():
    response = {
        "gudid": {
            "device": {
                "brandName": "Test",
                "companyName": "Test Co",
                "catalogNumber": None,
                "versionModelNumber": "MODEL-99",
                "deviceDescription": "A test device",
            }
        }
    }
    mock_client = AsyncMock()
    mock_client.__aenter__ = AsyncMock(return_value=mock_client)
    mock_client.__aexit__ = AsyncMock(return_value=False)
    mock_client.get = AsyncMock(return_value=_mock_response(200, response))

    with patch("app.services.gudid_client.httpx.AsyncClient", return_value=mock_client):
        result = await lookup_gudid("00000000000001")

    assert result[0]["catalog_number"] == "MODEL-99"
