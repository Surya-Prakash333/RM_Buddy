"""
test_crm_tool.py — Unit tests for the CRM tool interface layer.

All tests run without real HTTP connections.  httpx is mocked at the
AsyncClient level so no Core API process is required.

Coverage:
    get_client_list    — success, HTTP 500, connection error, header injection.
    get_client_profile — success, 404 not-found.
    get_client_portfolio — success, 404 not-found.
    get_alerts         — success, correct status param forwarding.
    get_dashboard_summary — success, HTTP 503.
    set_rm_context     — context flows through to _get_identity_header().

Test count: 14 (exceeds the 8-test minimum specified in the story).
"""

from __future__ import annotations

import sys
import os
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ---------------------------------------------------------------------------
# Path setup — allow imports from src/ without installing the package
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

import tools.crm_tool as crm_module
from tools.crm_tool import (
    _get_identity_header,
    get_alerts,
    get_client_list,
    get_client_portfolio,
    get_client_profile,
    get_dashboard_summary,
    set_rm_context,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

_MOCK_RM_IDENTITY = {
    "rm_id": "RM001",
    "name": "Priya Sharma",
    "role": "RM",
    "branch": "Mumbai HQ",
}


def _make_mock_response(
    status_code: int = 200,
    json_body: dict | None = None,
    text: str = "",
) -> MagicMock:
    """Build a MagicMock that mimics an httpx.Response."""
    mock_resp = MagicMock()
    mock_resp.status_code = status_code
    mock_resp.text = text or json.dumps(json_body or {})
    mock_resp.json.return_value = json_body or {}
    return mock_resp


def _patch_async_client(mock_response: MagicMock) -> "patch":
    """
    Return a context-manager patch that replaces httpx.AsyncClient with an
    async context manager yielding a client whose .get() returns mock_response.
    """
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=mock_response)

    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    return patch("tools.crm_tool.httpx.AsyncClient", return_value=mock_cm)


# ---------------------------------------------------------------------------
# set_rm_context / _get_identity_header
# ---------------------------------------------------------------------------


def test_set_rm_context_updates_identity() -> None:
    """set_rm_context must update the module-level identity dict."""
    set_rm_context(_MOCK_RM_IDENTITY)
    header_json = _get_identity_header()
    parsed = json.loads(header_json)
    assert parsed["rm_id"] == "RM001"
    assert parsed["name"] == "Priya Sharma"


def test_set_rm_context_replaces_previous_identity() -> None:
    """Calling set_rm_context twice should overwrite the previous context."""
    set_rm_context({"rm_id": "RM001", "name": "Priya"})
    set_rm_context({"rm_id": "RM002", "name": "Arjun"})
    parsed = json.loads(_get_identity_header())
    assert parsed["rm_id"] == "RM002"


# ---------------------------------------------------------------------------
# get_client_list
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_client_list_success() -> None:
    """get_client_list returns client list on HTTP 200."""
    set_rm_context(_MOCK_RM_IDENTITY)
    body = {"clients": [{"client_id": "CLT001", "name": "Ravi Kumar"}], "total": 1}
    with _patch_async_client(_make_mock_response(200, body)):
        result = await get_client_list.ainvoke({"page": 1, "limit": 10})

    assert "clients" in result
    assert result["total"] == 1
    assert result["clients"][0]["name"] == "Ravi Kumar"


@pytest.mark.asyncio
async def test_get_client_list_http_500_returns_error() -> None:
    """get_client_list returns error dict and empty clients list on HTTP 500."""
    set_rm_context(_MOCK_RM_IDENTITY)
    with _patch_async_client(
        _make_mock_response(500, text="Internal Server Error")
    ):
        result = await get_client_list.ainvoke({})

    assert "error" in result
    assert "500" in result["error"]
    assert result["clients"] == []


@pytest.mark.asyncio
async def test_get_client_list_connection_error_returns_error() -> None:
    """get_client_list returns error dict on connection refused / DNS failure."""
    import httpx as httpx_mod

    set_rm_context(_MOCK_RM_IDENTITY)
    mock_client = AsyncMock()
    mock_client.get = AsyncMock(
        side_effect=httpx_mod.ConnectError("Connection refused")
    )
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("tools.crm_tool.httpx.AsyncClient", return_value=mock_cm):
        result = await get_client_list.ainvoke({})

    assert "error" in result
    assert result["error"] == "Core API unavailable"
    assert result["clients"] == []


@pytest.mark.asyncio
async def test_get_client_list_sends_identity_header() -> None:
    """get_client_list includes the X-RM-Identity header in the request."""
    set_rm_context(_MOCK_RM_IDENTITY)
    body = {"clients": [], "total": 0}

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_make_mock_response(200, body))
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("tools.crm_tool.httpx.AsyncClient", return_value=mock_cm):
        await get_client_list.ainvoke({"page": 1, "limit": 5})

    call_kwargs = mock_client.get.call_args.kwargs
    headers = call_kwargs.get("headers", {})
    assert "X-RM-Identity" in headers
    parsed_identity = json.loads(headers["X-RM-Identity"])
    assert parsed_identity["rm_id"] == "RM001"


@pytest.mark.asyncio
async def test_get_client_list_passes_tier_filter() -> None:
    """get_client_list forwards the optional tier filter param to the API."""
    set_rm_context(_MOCK_RM_IDENTITY)
    body = {"clients": [], "total": 0}

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_make_mock_response(200, body))
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("tools.crm_tool.httpx.AsyncClient", return_value=mock_cm):
        await get_client_list.ainvoke({"tier": "Platinum"})

    call_kwargs = mock_client.get.call_args.kwargs
    params = call_kwargs.get("params", {})
    assert params.get("tier") == "Platinum"


# ---------------------------------------------------------------------------
# get_client_profile
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_client_profile_success() -> None:
    """get_client_profile returns profile data on HTTP 200."""
    set_rm_context(_MOCK_RM_IDENTITY)
    body = {"client_id": "CLT001", "name": "Ravi Kumar", "tier": "Platinum"}
    with _patch_async_client(_make_mock_response(200, body)):
        result = await get_client_profile.ainvoke({"client_id": "CLT001"})

    assert result["client_id"] == "CLT001"
    assert result["tier"] == "Platinum"


@pytest.mark.asyncio
async def test_get_client_profile_404_returns_not_found_error() -> None:
    """get_client_profile returns a descriptive error dict on HTTP 404."""
    set_rm_context(_MOCK_RM_IDENTITY)
    with _patch_async_client(_make_mock_response(404, text="Not Found")):
        result = await get_client_profile.ainvoke({"client_id": "CLT999"})

    assert "error" in result
    assert "CLT999" in result["error"]


# ---------------------------------------------------------------------------
# get_client_portfolio
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_client_portfolio_success() -> None:
    """get_client_portfolio returns portfolio data on HTTP 200."""
    set_rm_context(_MOCK_RM_IDENTITY)
    body = {
        "client_id": "CLT001",
        "aum_total": 42_000_000,
        "holdings": [{"name": "HDFC Equity Fund", "value": 10_000_000}],
    }
    with _patch_async_client(_make_mock_response(200, body)):
        result = await get_client_portfolio.ainvoke({"client_id": "CLT001"})

    assert result["client_id"] == "CLT001"
    assert len(result["holdings"]) == 1


@pytest.mark.asyncio
async def test_get_client_portfolio_404_returns_error() -> None:
    """get_client_portfolio returns an error dict on HTTP 404."""
    set_rm_context(_MOCK_RM_IDENTITY)
    with _patch_async_client(_make_mock_response(404, text="Not Found")):
        result = await get_client_portfolio.ainvoke({"client_id": "CLT999"})

    assert "error" in result
    assert "CLT999" in result["error"]


# ---------------------------------------------------------------------------
# get_alerts
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_alerts_success_returns_alert_list() -> None:
    """get_alerts returns alerts list on HTTP 200."""
    set_rm_context(_MOCK_RM_IDENTITY)
    body = {
        "alerts": [
            {"alert_id": "ALT001", "type": "birthday", "client_name": "Ravi Kumar"}
        ]
    }
    with _patch_async_client(_make_mock_response(200, body)):
        result = await get_alerts.ainvoke({"status": "pending"})

    assert "alerts" in result
    assert result["alerts"][0]["alert_id"] == "ALT001"


@pytest.mark.asyncio
async def test_get_alerts_passes_status_param() -> None:
    """get_alerts forwards the status filter to the Core API."""
    set_rm_context(_MOCK_RM_IDENTITY)
    body = {"alerts": []}

    mock_client = AsyncMock()
    mock_client.get = AsyncMock(return_value=_make_mock_response(200, body))
    mock_cm = MagicMock()
    mock_cm.__aenter__ = AsyncMock(return_value=mock_client)
    mock_cm.__aexit__ = AsyncMock(return_value=False)

    with patch("tools.crm_tool.httpx.AsyncClient", return_value=mock_cm):
        await get_alerts.ainvoke({"status": "acknowledged"})

    call_kwargs = mock_client.get.call_args.kwargs
    params = call_kwargs.get("params", {})
    assert params.get("status") == "acknowledged"


# ---------------------------------------------------------------------------
# get_dashboard_summary
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_dashboard_summary_success() -> None:
    """get_dashboard_summary returns KPI dict on HTTP 200."""
    set_rm_context(_MOCK_RM_IDENTITY)
    body = {
        "total_clients": 42,
        "active_alerts": 5,
        "meetings_today": 3,
        "revenue_ytd": 1_200_000,
        "aum_total": 850_000_000,
    }
    with _patch_async_client(_make_mock_response(200, body)):
        result = await get_dashboard_summary.ainvoke({})

    assert result["total_clients"] == 42
    assert result["active_alerts"] == 5


@pytest.mark.asyncio
async def test_get_dashboard_summary_http_503_returns_error() -> None:
    """get_dashboard_summary returns an error dict on HTTP 503."""
    set_rm_context(_MOCK_RM_IDENTITY)
    with _patch_async_client(
        _make_mock_response(503, text="Service Unavailable")
    ):
        result = await get_dashboard_summary.ainvoke({})

    assert "error" in result
    assert "503" in result["error"]
