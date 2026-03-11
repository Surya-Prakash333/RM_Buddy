"""
crm_tool.py — LangChain tools for CRM data access via Core API.

All tools issue authenticated HTTP requests to the NestJS Core API using the
X-RM-Identity header.  The header value is a JSON-serialised RMIdentity dict
set by the orchestrator before invoking any agent tools.

Tools:
    get_client_list      — Paginated, filterable client list.
    get_client_profile   — Full profile for a single client.
    get_client_portfolio — Holdings and AUM summary for a single client.
    get_alerts           — Pending / delivered / acknowledged alerts for the RM.
    get_dashboard_summary— KPI summary (total clients, active alerts, AUM, etc.).

Context injection:
    set_rm_context(rm_identity) must be called by the orchestrator before any
    agent tool is invoked within a request cycle.

Thread-safety note:
    _current_rm_identity is a module-level dict. This is safe for single-process
    uvicorn (one async event loop per worker), because each request awaits
    set_rm_context before the first tool call and no context switch occurs
    between set and read within a single coroutine chain.
    TODO: Migrate to contextvars.ContextVar for multi-worker deployments.
"""

from __future__ import annotations

import json
import logging
from typing import Any, Optional

import httpx
from langchain_core.tools import tool

from config.settings import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# RM identity context — set by orchestrator before agent tool calls
# ---------------------------------------------------------------------------

_current_rm_identity: dict[str, Any] = {}

_HTTP_TIMEOUT = 10.0  # seconds


def set_rm_context(rm_identity: dict[str, Any]) -> None:
    """
    Set the RM identity context used to build the X-RM-Identity header.

    Must be called by the orchestrator before invoking any tool in a
    request cycle.  The identity dict should contain at minimum:
        rm_id, name, role (RM | BM | ADMIN), branch.

    Args:
        rm_identity: RMIdentity-compatible dict.
    """
    global _current_rm_identity
    _current_rm_identity = rm_identity


def _get_identity_header() -> str:
    """
    Serialise the current RM identity to a JSON string for the
    X-RM-Identity header expected by the Core API AuthGuard.

    Returns:
        JSON string of the current RM identity dict.
    """
    return json.dumps(_current_rm_identity)


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
    page: int = 1,
    limit: int = 20,
) -> dict[str, Any]:
    """Get list of clients for the current RM.

    Args:
        tier: Filter by client tier (Diamond/Platinum/Gold/Silver). Optional.
        search: Search by client name (partial match supported). Optional.
        page: Page number, 1-based. Default 1.
        limit: Results per page. Default 20, max 100.

    Returns:
        Dict with 'clients' list and 'total' count, or an 'error' key on failure.
    """
    params: dict[str, Any] = {"page": page, "limit": limit}
    if tier:
        params["tier"] = tier
    if search:
        params["search"] = search

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
        client_id: The unique client ID (e.g., CLT001).

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
        client_id: The unique client ID (e.g., CLT001).

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
