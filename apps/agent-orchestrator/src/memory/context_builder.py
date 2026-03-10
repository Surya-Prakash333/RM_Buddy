"""
context_builder.py — Builds rich context dicts for agent processing.

The ContextBuilder fetches data from the Core API (NestJS) over HTTP and
assembles normalised context dicts that are injected into AgentState.

Two context types:
    RM context     — branch, client_count, active_alerts_count, AUM totals.
    Client context — individual client profile for conversations about one client.

HTTP errors and timeouts are handled gracefully: on failure, an empty dict
is returned so the agent can still respond with degraded (but safe) output.

Callers inject an httpx.AsyncClient so the connection pool is shared with
other components and properly closed during FastAPI shutdown.
"""

from __future__ import annotations

import logging
from typing import Any

import httpx

from config.settings import settings

logger = logging.getLogger(__name__)


class ContextBuilder:
    """
    Builds rich context for agent processing from Core API data.

    Args:
        http_client: A shared httpx.AsyncClient instance.
                     Base URL and auth headers should be pre-configured.
    """

    _DASHBOARD_SUMMARY_PATH = "/api/v1/dashboard/summary"
    _CLIENT_DETAIL_PATH = "/api/v1/clients/{client_id}"

    def __init__(self, http_client: httpx.AsyncClient) -> None:
        self.http = http_client

    async def build_rm_context(self, rm_id: str) -> dict[str, Any]:
        """
        Build RM-level context for agent state enrichment.

        Fetches:
            GET {CORE_API_URL}/api/v1/dashboard/summary?rm_id=<rm_id>

        Returns dict with keys (all optional — present only if API succeeds):
            rm_id              str
            name               str
            branch             str
            client_count       int
            active_alerts_count int
            aum_cr             float   (AUM in crores)

        Returns an empty dict on any HTTP or network error.
        """
        url = f"{settings.core_api_url}{self._DASHBOARD_SUMMARY_PATH}"
        try:
            response = await self.http.get(
                url,
                params={"rm_id": rm_id},
                timeout=10.0,
            )
            response.raise_for_status()
            data: dict[str, Any] = response.json()
            logger.debug(
                "RM context fetched [rm_id=%s, client_count=%s]",
                rm_id,
                data.get("client_count"),
            )
            return data
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Core API returned error for RM context "
                "[rm_id=%s, status=%s, url=%s]",
                rm_id,
                exc.response.status_code,
                url,
            )
        except httpx.RequestError as exc:
            logger.error(
                "Network error fetching RM context [rm_id=%s, error=%s]",
                rm_id,
                exc,
            )
        except Exception as exc:
            logger.error(
                "Unexpected error building RM context [rm_id=%s, error=%s]",
                rm_id,
                exc,
            )
        return {}

    async def build_client_context(
        self, rm_id: str, client_id: str
    ) -> dict[str, Any]:
        """
        Build client-level context for conversations about a specific client.

        Fetches:
            GET {CORE_API_URL}/api/v1/clients/{client_id}

        The rm_id is sent as a query parameter so the Core API can enforce
        ownership — an RM can only request clients assigned to them.

        Returns dict with keys (all optional — present only if API succeeds):
            client_id   str
            name        str
            tier        str   ('Platinum' | 'Gold' | 'Silver' | 'Bronze')
            aum_cr      float
            phone       str
            email       str
            birthdate   str   (ISO date)
            last_contact str  (ISO datetime)

        Returns an empty dict on any HTTP or network error.
        """
        url = f"{settings.core_api_url}{self._CLIENT_DETAIL_PATH.format(client_id=client_id)}"
        try:
            response = await self.http.get(
                url,
                params={"rm_id": rm_id},
                timeout=10.0,
            )
            response.raise_for_status()
            data: dict[str, Any] = response.json()
            logger.debug(
                "Client context fetched [rm_id=%s, client_id=%s]",
                rm_id,
                client_id,
            )
            return data
        except httpx.HTTPStatusError as exc:
            logger.warning(
                "Core API returned error for client context "
                "[rm_id=%s, client_id=%s, status=%s]",
                rm_id,
                client_id,
                exc.response.status_code,
            )
        except httpx.RequestError as exc:
            logger.error(
                "Network error fetching client context "
                "[rm_id=%s, client_id=%s, error=%s]",
                rm_id,
                client_id,
                exc,
            )
        except Exception as exc:
            logger.error(
                "Unexpected error building client context "
                "[rm_id=%s, client_id=%s, error=%s]",
                rm_id,
                client_id,
                exc,
            )
        return {}
