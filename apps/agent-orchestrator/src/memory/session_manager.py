"""
Enhanced session management with write-through Redis+MongoDB strategy.

Replaces the older SessionMemory for the new supervisor graph.
Uses agent_sessions collection (not chat_history).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from config.settings import settings

logger = logging.getLogger("memory.session_manager")


class SessionManager:
    """Write-through session manager: Redis (fast) + MongoDB (durable)."""

    def __init__(self, redis_client: Any, memory_db: AsyncIOMotorDatabase) -> None:
        self._redis = redis_client
        self._db = memory_db
        self._collection = self._db["agent_sessions"]
        self._ttl = settings.session_ttl_seconds

    def _redis_key(self, session_id: str) -> str:
        return f"session:{session_id}"

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        """Load session: Redis first, MongoDB fallback, repopulate Redis on miss."""
        key = self._redis_key(session_id)

        # Try Redis
        try:
            raw = await self._redis.get(key)
            if raw:
                logger.debug("Session Redis hit [session_id=%s]", session_id)
                return json.loads(raw)
        except Exception as exc:
            logger.warning("Redis get failed: %s", exc)

        # MongoDB fallback
        doc = await self._collection.find_one(
            {"session_id": session_id}, {"_id": 0}
        )
        if doc:
            # Repopulate Redis
            try:
                await self._redis.setex(key, self._ttl, json.dumps(doc, default=str))
            except Exception:
                pass
            return doc
        return None

    async def save_session(
        self,
        session_id: str,
        rm_id: str,
        conversation_id: str,
        messages: list[dict[str, Any]],
        active_client: dict | None = None,
        metadata: dict | None = None,
    ) -> None:
        """Save session: MongoDB first (durable), then Redis (cache)."""
        now = datetime.now(timezone.utc)
        doc = {
            "session_id": session_id,
            "rm_id": rm_id,
            "conversation_id": conversation_id,
            "messages": messages[-settings.max_conversation_history:],
            "active_client": active_client,
            "metadata": metadata or {},
            "updated_at": now,
            "expires_at": now + timedelta(seconds=self._ttl),
        }

        # MongoDB first
        await self._collection.update_one(
            {"session_id": session_id},
            {"$set": doc, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )

        # Redis second
        key = self._redis_key(session_id)
        try:
            await self._redis.setex(key, self._ttl, json.dumps(doc, default=str))
        except Exception as exc:
            logger.warning("Redis set failed (non-fatal): %s", exc)

    async def append_message(
        self, session_id: str, message: dict[str, Any]
    ) -> None:
        """Append a single message to a session, creating it if needed."""
        now = datetime.now(timezone.utc)
        await self._collection.update_one(
            {"session_id": session_id},
            {
                "$push": {"messages": message},
                "$set": {"updated_at": now},
                "$setOnInsert": {
                    "created_at": now,
                    "rm_id": message.get("rm_id", ""),
                    "expires_at": now + timedelta(seconds=self._ttl),
                },
            },
            upsert=True,
        )
        # Invalidate Redis cache so next get_session picks up the new message
        try:
            await self._redis.delete(self._redis_key(session_id))
        except Exception:
            pass
