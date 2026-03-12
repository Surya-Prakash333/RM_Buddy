"""
crm_tool.py — LangChain tools for CRM data access via Core API.

Uses contextvars.ContextVar for thread-safe RM identity context, enabling
parallel specialist agent dispatch via asyncio.gather().
"""

from __future__ import annotations

import contextvars
import json
import logging
from typing import Any, Optional

import httpx
from langchain_core.tools import tool

from config.settings import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# RM identity context — ContextVar for async-safe parallel dispatch
# ---------------------------------------------------------------------------

_rm_context_var: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "rm_context", default={}
)

_HTTP_TIMEOUT = 10.0  # seconds


def set_rm_context(rm_identity: dict[str, Any]) -> None:
    """
    Set the RM identity context for the current async task.

    Thread/task safe: uses contextvars so parallel asyncio.gather() tasks
    each get their own copy.
    """
    _rm_context_var.set(rm_identity)


def _get_identity_header() -> str:
    """Serialise the current RM identity to a JSON string for X-RM-Identity header."""
    return json.dumps(_rm_context_var.get())


def _build_headers() -> dict[str, str]:
    """Return the base HTTP headers for all Core API requests."""
    return {
        "Content-Type": "application/json",
        "X-RM-Identity": _get_identity_header(),
    }


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@tool
async def get_client_list(
    tier: Optional[str] = None,
    search: Optional[str] = None,
    city: Optional[str] = None,
    page: int = 1,
    limit: int = 100,
) -> dict[str, Any]:
    """Get list of clients for the current RM.

    Args:
        tier: Filter by client tier (DIAMOND/PLATINUM/GOLD/SILVER/BLACK). Optional.
        search: Search by client name (partial match supported). Optional.
        city: Filter by city (e.g. Mumbai, Bangalore, Delhi, Chennai, Pune, Hyderabad). Optional.
        page: Page number, 1-based. Default 1.
        limit: Results per page. Default 100, max 100.

    Returns:
        Dict with 'clients' list and 'total' count, or an 'error' key on failure.
    """
    params: dict[str, Any] = {"page": page, "limit": limit}
    if tier:
        params["tier"] = tier
    if search:
        params["search"] = search
    if city:
        params["city"] = city

    url = f"{settings.core_api_url}/api/v1/clients"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, params=params, headers=_build_headers())

        if resp.status_code >= 400:
            logger.error(
                "get_client_list HTTP error [status=%s, url=%s]",
                resp.status_code,
                url,
            )
            return {"error": f"HTTP {resp.status_code}: {resp.text}", "clients": []}

        raw: dict[str, Any] = resp.json()
        # Unwrap NestJS APIResponse envelope { status, data, timestamp }
        # data is a list of clients directly (not a dict with 'clients' key)
        unwrapped = raw.get("data", raw)
        if isinstance(unwrapped, list):
            clients = unwrapped
        elif isinstance(unwrapped, dict):
            clients = unwrapped.get("clients", [])
        else:
            clients = []
        total = len(clients)
        logger.debug(
            "get_client_list success [tier=%s, search=%s, page=%s, total=%s]",
            tier,
            search,
            page,
            total,
        )
        return {"clients": clients, "total": total}

    except httpx.ConnectError as exc:
        logger.error("get_client_list connection error [url=%s, error=%s]", url, exc)
        return {"error": "Core API unavailable", "clients": []}
    except httpx.TimeoutException as exc:
        logger.error("get_client_list timeout [url=%s, error=%s]", url, exc)
        return {"error": "Core API request timed out", "clients": []}
    except Exception as exc:
        logger.error("get_client_list unexpected error [url=%s, error=%s]", url, exc)
        return {"error": str(exc), "clients": []}


@tool
async def get_client_profile(client_id: str) -> dict[str, Any]:
    """Get detailed profile for a specific client including accounts and recent activity.

    Args:
        client_id: The unique client ID (e.g., CL00001). Use the exact client_id from search results.

    Returns:
        Dict with client profile data, or an 'error' key on failure.
    """
    url = f"{settings.core_api_url}/api/v1/clients/{client_id}"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, headers=_build_headers())

        if resp.status_code == 404:
            logger.warning("get_client_profile not found [client_id=%s]", client_id)
            return {"error": f"Client '{client_id}' not found"}

        if resp.status_code >= 400:
            logger.error(
                "get_client_profile HTTP error [client_id=%s, status=%s]",
                client_id,
                resp.status_code,
            )
            return {"error": f"HTTP {resp.status_code}: {resp.text}"}

        raw: dict[str, Any] = resp.json()
        # Unwrap NestJS APIResponse envelope { status, data, timestamp }
        data: dict[str, Any] = raw.get("data", raw) if isinstance(raw.get("data"), dict) else raw
        logger.debug("get_client_profile success [client_id=%s]", client_id)
        return data

    except httpx.ConnectError as exc:
        logger.error(
            "get_client_profile connection error [client_id=%s, error=%s]",
            client_id,
            exc,
        )
        return {"error": "Core API unavailable"}
    except httpx.TimeoutException as exc:
        logger.error(
            "get_client_profile timeout [client_id=%s, error=%s]", client_id, exc
        )
        return {"error": "Core API request timed out"}
    except Exception as exc:
        logger.error(
            "get_client_profile unexpected error [client_id=%s, error=%s]",
            client_id,
            exc,
        )
        return {"error": str(exc)}


@tool
async def get_client_portfolio(client_id: str) -> dict[str, Any]:
    """Get portfolio holdings and summary for a specific client.

    Args:
        client_id: The unique client ID (e.g., CL00001). Use the exact client_id from search results.

    Returns:
        Dict with portfolio data including holdings, AUM summary, and asset
        allocation breakdown, or an 'error' key on failure.
    """
    url = f"{settings.core_api_url}/api/v1/clients/{client_id}/portfolio"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, headers=_build_headers())

        if resp.status_code == 404:
            logger.warning(
                "get_client_portfolio not found [client_id=%s]", client_id
            )
            return {"error": f"Portfolio for client '{client_id}' not found"}

        if resp.status_code >= 400:
            logger.error(
                "get_client_portfolio HTTP error [client_id=%s, status=%s]",
                client_id,
                resp.status_code,
            )
            return {"error": f"HTTP {resp.status_code}: {resp.text}"}

        data: dict[str, Any] = resp.json()
        logger.debug("get_client_portfolio success [client_id=%s]", client_id)
        return data

    except httpx.ConnectError as exc:
        logger.error(
            "get_client_portfolio connection error [client_id=%s, error=%s]",
            client_id,
            exc,
        )
        return {"error": "Core API unavailable"}
    except httpx.TimeoutException as exc:
        logger.error(
            "get_client_portfolio timeout [client_id=%s, error=%s]", client_id, exc
        )
        return {"error": "Core API request timed out"}
    except Exception as exc:
        logger.error(
            "get_client_portfolio unexpected error [client_id=%s, error=%s]",
            client_id,
            exc,
        )
        return {"error": str(exc)}


@tool
async def get_alerts(status: str = "pending", limit: int = 10) -> dict[str, Any]:
    """Get alerts for the current RM.

    Args:
        status: Alert status filter — one of 'pending', 'delivered',
                'acknowledged'. Default 'pending'.
        limit: Maximum number of alerts to return. Default 10.

    Returns:
        Dict with 'alerts' list, or an 'error' key on failure.
    """
    url = f"{settings.core_api_url}/api/v1/alerts"
    params: dict[str, Any] = {"status": status, "limit": limit}
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, params=params, headers=_build_headers())

        if resp.status_code >= 400:
            logger.error(
                "get_alerts HTTP error [status_filter=%s, http_status=%s]",
                status,
                resp.status_code,
            )
            return {"error": f"HTTP {resp.status_code}: {resp.text}", "alerts": []}

        raw: dict[str, Any] = resp.json()
        # Unwrap NestJS APIResponse envelope
        alerts = raw.get("data", raw) if isinstance(raw.get("data"), list) else raw.get("data", [])
        logger.debug(
            "get_alerts success [status_filter=%s, count=%s]",
            status,
            len(alerts) if isinstance(alerts, list) else 0,
        )
        return {"alerts": alerts, "total": len(alerts) if isinstance(alerts, list) else 0}

    except httpx.ConnectError as exc:
        logger.error("get_alerts connection error [url=%s, error=%s]", url, exc)
        return {"error": "Core API unavailable", "alerts": []}
    except httpx.TimeoutException as exc:
        logger.error("get_alerts timeout [url=%s, error=%s]", url, exc)
        return {"error": "Core API request timed out", "alerts": []}
    except Exception as exc:
        logger.error("get_alerts unexpected error [url=%s, error=%s]", url, exc)
        return {"error": str(exc), "alerts": []}


@tool
async def get_meetings() -> dict[str, Any]:
    """Get today's meetings for the current RM.

    Returns:
        Dict with 'meetings' list. Each meeting has: id, time, client_id,
        client_name, agenda, location, duration_min.
        Returns {"meetings": [], "error": str} on failure.
    """
    url = f"{settings.core_api_url}/api/v1/meetings"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, headers=_build_headers())

        if resp.status_code >= 400:
            logger.error("get_meetings HTTP error [status=%s]", resp.status_code)
            return {"error": f"HTTP {resp.status_code}: {resp.text}", "meetings": []}

        raw: dict[str, Any] = resp.json()
        meetings = raw.get("data", raw) if isinstance(raw.get("data"), list) else raw.get("data", [])
        logger.debug("get_meetings success [count=%s]", len(meetings) if isinstance(meetings, list) else 0)
        return {"meetings": meetings, "total": len(meetings) if isinstance(meetings, list) else 0}

    except httpx.ConnectError as exc:
        logger.error("get_meetings connection error [url=%s, error=%s]", url, exc)
        return {"error": "Core API unavailable", "meetings": []}
    except httpx.TimeoutException as exc:
        logger.error("get_meetings timeout [url=%s, error=%s]", url, exc)
        return {"error": "Core API request timed out", "meetings": []}
    except Exception as exc:
        logger.error("get_meetings unexpected error [url=%s, error=%s]", url, exc)
        return {"error": str(exc), "meetings": []}


@tool
async def get_leads() -> dict[str, Any]:
    """Get leads assigned to the current RM.

    Returns:
        Dict with 'leads' list. Each lead has: id, name, stage (HOT/WARM/COLD/LOST),
        potential_aum, source, last_contact.
        Returns {"leads": [], "error": str} on failure.
    """
    url = f"{settings.core_api_url}/api/v1/leads"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, headers=_build_headers())

        if resp.status_code >= 400:
            logger.error("get_leads HTTP error [status=%s]", resp.status_code)
            return {"error": f"HTTP {resp.status_code}: {resp.text}", "leads": []}

        raw: dict[str, Any] = resp.json()
        leads = raw.get("data", raw) if isinstance(raw.get("data"), list) else raw.get("data", [])
        logger.debug("get_leads success [count=%s]", len(leads) if isinstance(leads, list) else 0)
        return {"leads": leads, "total": len(leads) if isinstance(leads, list) else 0}

    except httpx.ConnectError as exc:
        logger.error("get_leads connection error [url=%s, error=%s]", url, exc)
        return {"error": "Core API unavailable", "leads": []}
    except httpx.TimeoutException as exc:
        logger.error("get_leads timeout [url=%s, error=%s]", url, exc)
        return {"error": "Core API request timed out", "leads": []}
    except Exception as exc:
        logger.error("get_leads unexpected error [url=%s, error=%s]", url, exc)
        return {"error": str(exc), "leads": []}


@tool
async def get_dashboard_summary() -> dict[str, Any]:
    """Get dashboard KPI summary for the current RM.

    Returns:
        Dict with keys: total_clients, active_alerts, meetings_today,
        revenue_ytd, aum_total — or an 'error' key on failure.
    """
    url = f"{settings.core_api_url}/api/v1/dashboard/summary"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, headers=_build_headers())

        if resp.status_code >= 400:
            logger.error(
                "get_dashboard_summary HTTP error [status=%s]", resp.status_code
            )
            return {"error": f"HTTP {resp.status_code}: {resp.text}"}

        raw: dict[str, Any] = resp.json()
        # Unwrap NestJS APIResponse envelope
        data = raw.get("data", raw) if isinstance(raw.get("data"), dict) else raw
        logger.debug(
            "get_dashboard_summary success [total_clients=%s, active_alerts=%s]",
            data.get("total_clients"),
            data.get("active_alerts"),
        )
        return data

    except httpx.ConnectError as exc:
        logger.error("get_dashboard_summary connection error [url=%s, error=%s]", url, exc)
        return {"error": "Core API unavailable"}
    except httpx.TimeoutException as exc:
        logger.error("get_dashboard_summary timeout [url=%s, error=%s]", url, exc)
        return {"error": "Core API request timed out"}
    except Exception as exc:
        logger.error(
            "get_dashboard_summary unexpected error [url=%s, error=%s]", url, exc
        )
        return {"error": str(exc)}
