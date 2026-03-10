"""
session_memory.py — Redis + MongoDB write-through session memory for agents.

Read path  : Redis first (sub-millisecond) → MongoDB fallback (durable).
Write path : MongoDB first (durable) → Redis (cache warm-up).

This guarantees:
  - Reads are fast for active sessions (Redis hit).
  - Writes survive Redis restarts (MongoDB is source of truth).
  - TTL-based expiry cleans up abandoned sessions automatically.

Key namespacing:
    Working memory : memory:rm:{rm_id}:session:{session_id}
    Chat history   : Stored in MongoDB collection `chat_history`,
                     indexed on session_id for fast recent-message queries.

Callers should inject pre-created Redis and Motor clients so that connection
pool management (startup / shutdown) stays with the FastAPI lifespan.
"""

from __future__ import annotations

import json
import logging
from typing import Any

logger = logging.getLogger(__name__)


class SessionMemory:
    """
    Redis + MongoDB write-through session memory for agents.

    Args:
        redis_client: A connected redis.asyncio.Redis instance.
        mongo_client: A motor.motor_asyncio.AsyncIOMotorClient instance.
        ttl:          Working memory TTL in seconds (default 30 min).
        db_name:      MongoDB database name (default 'rmbuddy').
    """

    _WORKING_MEMORY_KEY = "memory:rm:{rm_id}:session:{session_id}"
    _HISTORY_COLLECTION = "chat_history"
    _MEMORY_COLLECTION = "session_memory"

    def __init__(
        self,
        redis_client: Any,
        mongo_client: Any,
        ttl: int = 1800,
        db_name: str = "rmbuddy",
    ) -> None:
        self.redis = redis_client
        self.db = mongo_client[db_name]
        self.ttl = ttl

    # ------------------------------------------------------------------
    # Working memory (context bag per session)
    # ------------------------------------------------------------------

    async def get_working_memory(self, rm_id: str, session_id: str) -> dict[str, Any]:
        """
        Retrieve the working memory dict for a session.

        Read strategy:
          1. Try Redis (fast path).
          2. On miss, fall back to MongoDB and repopulate Redis.
          3. Return an empty dict if neither has data.

        Args:
            rm_id:      RM employee ID.
            session_id: Session UUID string.

        Returns:
            Working memory dict (may be empty for brand-new sessions).
        """
        key = self._WORKING_MEMORY_KEY.format(rm_id=rm_id, session_id=session_id)

        try:
            raw = await self.redis.get(key)
            if raw:
                logger.debug("Working memory Redis hit [session_id=%s]", session_id)
                return json.loads(raw)
        except Exception as exc:
            logger.warning("Redis get failed, falling back to MongoDB [error=%s]", exc)

        # MongoDB fallback
        try:
            doc = await self.db[self._MEMORY_COLLECTION].find_one(
                {"rm_id": rm_id, "session_id": session_id},
                {"_id": 0, "data": 1},
            )
            if doc:
                data: dict[str, Any] = doc.get("data", {})
                # Warm up Redis cache
                await self._redis_set(key, data)
                return data
        except Exception as exc:
            logger.error("MongoDB get_working_memory failed [error=%s]", exc)

        return {}

    async def set_working_memory(
        self, rm_id: str, session_id: str, data: dict[str, Any]
    ) -> None:
        """
        Persist working memory for a session (write-through).

        Write strategy:
          1. MongoDB first (source of truth, upsert).
          2. Redis second (cache).

        Args:
            rm_id:      RM employee ID.
            session_id: Session UUID string.
            data:       Arbitrary context dict to store.
        """
        key = self._WORKING_MEMORY_KEY.format(rm_id=rm_id, session_id=session_id)

        # MongoDB first
        try:
            await self.db[self._MEMORY_COLLECTION].update_one(
                {"rm_id": rm_id, "session_id": session_id},
                {"$set": {"data": data, "rm_id": rm_id, "session_id": session_id}},
                upsert=True,
            )
        except Exception as exc:
            logger.error("MongoDB set_working_memory failed [error=%s]", exc)

        # Redis second
        await self._redis_set(key, data)

    # ------------------------------------------------------------------
    # Chat history
    # ------------------------------------------------------------------

    async def append_message(self, session_id: str, message: dict[str, Any]) -> None:
        """
        Append a message to the persistent chat history for a session.

        Args:
            session_id: Session UUID string.
            message:    Dict with at minimum keys: role ('user'|'assistant'), content.
        """
        try:
            await self.db[self._HISTORY_COLLECTION].insert_one(
                {"session_id": session_id, **message}
            )
        except Exception as exc:
            logger.error(
                "append_message failed [session_id=%s, error=%s]", session_id, exc
            )

    async def get_recent_messages(
        self, session_id: str, limit: int = 10
    ) -> list[dict[str, Any]]:
        """
        Retrieve the most recent N messages for a session.

        Messages are returned in ascending chronological order (oldest first),
        suitable for insertion into an LLM messages array.

        Args:
            session_id: Session UUID string.
            limit:      Maximum number of messages to return (default 10).

        Returns:
            List of message dicts, sorted oldest-first.
        """
        try:
            cursor = (
                self.db[self._HISTORY_COLLECTION]
                .find(
                    {"session_id": session_id},
                    {"_id": 0, "session_id": 0},
                )
                .sort("_id", -1)
                .limit(limit)
            )
            messages: list[dict[str, Any]] = await cursor.to_list(length=limit)
            # Reverse to restore chronological order
            messages.reverse()
            return messages
        except Exception as exc:
            logger.error(
                "get_recent_messages failed [session_id=%s, error=%s]", session_id, exc
            )
            return []

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _redis_set(self, key: str, data: dict[str, Any]) -> None:
        """Set a key in Redis with TTL, swallowing connection errors."""
        try:
            await self.redis.setex(key, self.ttl, json.dumps(data))
        except Exception as exc:
            logger.warning("Redis set failed (non-fatal) [key=%s, error=%s]", key, exc)
