"""
Pre-chat context assembly pipeline.

Loads session state, RM client summary, pending alerts, RM preferences,
relevant memories, and recent conversation summaries — all concurrently.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

from config.settings import settings
from tools.crm_tool import _build_headers

logger = logging.getLogger("memory.context_builder")


class ContextBuilder:
    """Assembles the full context dict loaded before every chat interaction."""

    def __init__(self, memory_db: AsyncIOMotorDatabase) -> None:
        self._db = memory_db

    async def build(
        self, session_id: str, rm_id: str, query: str = ""
    ) -> dict[str, Any]:
        """
        Load all context sources concurrently and return assembled dict.

        Args:
            session_id: Current session UUID.
            rm_id: RM employee ID.
            query: User's message (used for semantic memory matching).

        Returns:
            Dict with keys: session, clients, alerts, preferences, memories, summaries.
        """
        results = await asyncio.gather(
            self._load_session(session_id),
            self._load_clients_summary(rm_id),
            self._load_pending_alerts(rm_id),
            self._load_preferences(rm_id),
            self._load_relevant_memories(rm_id, query),
            self._load_recent_summaries(rm_id),
            return_exceptions=True,
        )

        context: dict[str, Any] = {}
        keys = ["session", "clients", "alerts", "preferences", "memories", "summaries"]
        for key, result in zip(keys, results):
            if isinstance(result, Exception):
                logger.warning("Context load failed [key=%s, error=%s]", key, result)
                context[key] = [] if key != "session" else {}
            else:
                context[key] = result

        return context

    async def _load_session(self, session_id: str) -> dict[str, Any]:
        """Load session state from MongoDB (Redis handled by SessionManager)."""
        doc = await self._db["agent_sessions"].find_one(
            {"session_id": session_id}, {"_id": 0}
        )
        return doc or {}

    async def _load_clients_summary(self, rm_id: str) -> list[dict]:
        """Load top 10 clients by AUM from Core API."""
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    f"{settings.core_api_url}/api/v1/clients",
                    params={"limit": 10},
                    headers=_build_headers(),
                )
            if resp.status_code < 400:
                raw = resp.json()
                data = raw.get("data", raw)
                return data if isinstance(data, list) else []
        except Exception as exc:
            logger.warning("Failed to load clients summary: %s", exc)
        return []

    async def _load_pending_alerts(self, rm_id: str) -> list[dict]:
        """Load pending alerts from Core API."""
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    f"{settings.core_api_url}/api/v1/alerts",
                    params={"status": "pending"},
                    headers=_build_headers(),
                )
            if resp.status_code < 400:
                raw = resp.json()
                data = raw.get("data", raw)
                return data if isinstance(data, list) else []
        except Exception as exc:
            logger.warning("Failed to load alerts: %s", exc)
        return []

    async def _load_preferences(self, rm_id: str) -> list[dict]:
        """Load RM preference facts from memory DB."""
        cursor = self._db["rm_facts"].find(
            {"rm_id": rm_id, "category": "preference", "active": True},
            {"_id": 0, "content": 1, "confidence": 1},
        ).sort("confidence", -1).limit(settings.max_memory_facts)
        return await cursor.to_list(length=settings.max_memory_facts)

    async def _load_relevant_memories(self, rm_id: str, query: str) -> list[dict]:
        """Load memories relevant to the query (text match for now; vector search future)."""
        if not query:
            return []
        keywords = [w for w in query.lower().split() if len(w) > 3]
        if not keywords:
            return []
        regex_pattern = "|".join(keywords[:5])
        cursor = self._db["rm_facts"].find(
            {
                "rm_id": rm_id,
                "active": True,
                "content": {"$regex": regex_pattern, "$options": "i"},
            },
            {"_id": 0, "category": 1, "content": 1, "confidence": 1},
        ).limit(5)
        return await cursor.to_list(length=5)

    async def _load_recent_summaries(self, rm_id: str) -> list[dict]:
        """Load last N conversation summaries."""
        cursor = self._db["conversation_summaries"].find(
            {"rm_id": rm_id},
            {"_id": 0, "summary": 1, "topics": 1, "clients_discussed": 1, "created_at": 1},
        ).sort("created_at", -1).limit(settings.max_recent_summaries)
        return await cursor.to_list(length=settings.max_recent_summaries)
