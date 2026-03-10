"""
search_tool.py — LangChain tools for client search and discovery.

These tools allow specialist agents to find clients by name, filter by AUM
or asset class, and surface cross-sell opportunities — all scoped to the
current RM's book.

All tools delegate to Core API endpoints and rely on the RM identity context
set in crm_tool.set_rm_context().  They import _build_headers() and
_HTTP_TIMEOUT from crm_tool to avoid duplicating authentication logic.

Tools:
    search_clients_by_name    — Text search on client name, returns top 5.
    find_client_by_amount     — Filter by AUM range and / or asset class.
    get_cross_sell_opportunities — Pre-computed cross-sell list from Core API.
"""

from __future__ import annotations

import logging
from typing import Any, Optional

import httpx
from langchain_core.tools import tool

from config.settings import settings
from tools.crm_tool import _HTTP_TIMEOUT, _build_headers

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@tool
async def search_clients_by_name(query: str, rm_id: str) -> dict[str, Any]:
    """Search for clients by name using text search.

    Calls the Core API clients endpoint with a search query and returns at
    most the top 5 matching clients for the specified RM.

    Args:
        query: Client name or partial name to search for.
        rm_id: RM ID to scope the search to the correct book of business.

    Returns:
        Dict with 'results' list of matching clients (up to 5), each
        containing at minimum: client_id, name, tier, aum_cr.
        Returns {"results": [], "error": str} on failure.
    """
    url = f"{settings.core_api_url}/api/v1/clients"
    params: dict[str, Any] = {"search": query, "limit": 5, "page": 1}

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, params=params, headers=_build_headers())

        if resp.status_code >= 400:
            logger.error(
                "search_clients_by_name HTTP error [query=%s, status=%s]",
                query,
                resp.status_code,
            )
            return {
                "results": [],
                "error": f"HTTP {resp.status_code}: {resp.text}",
            }

        raw: dict[str, Any] = resp.json()
        # Core API returns {"clients": [...], "total": N}
        clients: list[dict[str, Any]] = raw.get("clients", [])
        results = clients[:5]  # defensive cap even if API returns more

        logger.debug(
            "search_clients_by_name success [query=%s, rm_id=%s, count=%s]",
            query,
            rm_id,
            len(results),
        )
        return {"results": results, "total": len(results)}

    except httpx.ConnectError as exc:
        logger.error(
            "search_clients_by_name connection error [query=%s, error=%s]",
            query,
            exc,
        )
        return {"results": [], "error": "Core API unavailable"}
    except httpx.TimeoutException as exc:
        logger.error(
            "search_clients_by_name timeout [query=%s, error=%s]", query, exc
        )
        return {"results": [], "error": "Core API request timed out"}
    except Exception as exc:
        logger.error(
            "search_clients_by_name unexpected error [query=%s, error=%s]",
            query,
            exc,
        )
        return {"results": [], "error": str(exc)}


@tool
async def find_client_by_amount(
    min_aum: Optional[float] = None,
    max_aum: Optional[float] = None,
    asset_class: Optional[str] = None,
) -> dict[str, Any]:
    """Find clients matching AUM range or asset class criteria.

    Queries the Core API clients endpoint with filter parameters.  At least
    one of min_aum, max_aum, or asset_class should be provided for a
    meaningful result set.

    Args:
        min_aum: Minimum total AUM in rupees (e.g., 10000000 for 1 Cr). Optional.
        max_aum: Maximum total AUM in rupees. Optional.
        asset_class: Filter by primary asset class — one of 'EQ' (equity),
                     'FI' (fixed income), 'MP' (multi-asset), 'LI' (life
                     insurance). Optional.

    Returns:
        Dict with 'clients' list of matching clients and 'total' count.
        Returns {"clients": [], "error": str} on failure.
    """
    url = f"{settings.core_api_url}/api/v1/clients"
    params: dict[str, Any] = {"page": 1, "limit": 50}

    if min_aum is not None:
        params["min_aum"] = min_aum
    if max_aum is not None:
        params["max_aum"] = max_aum
    if asset_class:
        params["asset_class"] = asset_class

    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, params=params, headers=_build_headers())

        if resp.status_code >= 400:
            logger.error(
                "find_client_by_amount HTTP error [filters=%s, status=%s]",
                params,
                resp.status_code,
            )
            return {
                "clients": [],
                "error": f"HTTP {resp.status_code}: {resp.text}",
            }

        data: dict[str, Any] = resp.json()
        logger.debug(
            "find_client_by_amount success "
            "[min_aum=%s, max_aum=%s, asset_class=%s, total=%s]",
            min_aum,
            max_aum,
            asset_class,
            data.get("total"),
        )
        return data

    except httpx.ConnectError as exc:
        logger.error(
            "find_client_by_amount connection error [error=%s]", exc
        )
        return {"clients": [], "error": "Core API unavailable"}
    except httpx.TimeoutException as exc:
        logger.error("find_client_by_amount timeout [error=%s]", exc)
        return {"clients": [], "error": "Core API request timed out"}
    except Exception as exc:
        logger.error(
            "find_client_by_amount unexpected error [error=%s]", exc
        )
        return {"clients": [], "error": str(exc)}


@tool
async def get_cross_sell_opportunities() -> dict[str, Any]:
    """Get cross-sell opportunities for the current RM's clients.

    Retrieves pre-computed cross-sell recommendations from the Core API.
    Each opportunity includes the client info and one or more suggested
    product categories the client does not currently hold.

    Returns:
        Dict with 'opportunities' list.  Each item contains:
            client_id, client_name, tier, current_products, suggested_products,
            opportunity_score (0–1).
        Returns {"opportunities": [], "error": str} on failure.
    """
    url = f"{settings.core_api_url}/api/v1/cross-sell"
    try:
        async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
            resp = await client.get(url, headers=_build_headers())

        if resp.status_code >= 400:
            logger.error(
                "get_cross_sell_opportunities HTTP error [status=%s]",
                resp.status_code,
            )
            return {
                "opportunities": [],
                "error": f"HTTP {resp.status_code}: {resp.text}",
            }

        data: dict[str, Any] = resp.json()
        logger.debug(
            "get_cross_sell_opportunities success [count=%s]",
            len(data.get("opportunities", [])),
        )
        return data

    except httpx.ConnectError as exc:
        logger.error(
            "get_cross_sell_opportunities connection error [url=%s, error=%s]",
            url,
            exc,
        )
        return {"opportunities": [], "error": "Core API unavailable"}
    except httpx.TimeoutException as exc:
        logger.error(
            "get_cross_sell_opportunities timeout [url=%s, error=%s]", url, exc
        )
        return {"opportunities": [], "error": "Core API request timed out"}
    except Exception as exc:
        logger.error(
            "get_cross_sell_opportunities unexpected error [url=%s, error=%s]",
            url,
            exc,
        )
        return {"opportunities": [], "error": str(exc)}
