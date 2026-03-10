"""
cache_tool.py — LangChain tools for Redis working memory access.

These tools give specialist agents direct read/write access to the Redis
cache layer — both for arbitrary keyed cache entries and for the structured
per-session working memory used across a conversation.

Key namespacing:
    Arbitrary cache   : caller-supplied key (e.g. 'dashboard:rm:RM001')
    Working memory    : memory:rm:{rm_id}:session:{session_id}

Client injection:
    set_redis_client(client) must be called during FastAPI startup lifespan
    before any cache tool is invoked.

Error handling:
    All tools swallow Redis errors and return degraded-but-safe results
    ({"found": False} or {"success": False, "error": ...}) so that an
    unavailable Redis does not crash the agent pipeline.

Thread-safety note:
    _redis_client is module-level state. Safe for single-process uvicorn
    (one event loop, no concurrent lifespan setup). If multiple workers share
    state, inject the client per-request via a dependency instead.
    TODO: Replace with dependency injection via FastAPI Request.app.state.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.tools import tool

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Redis client — injected at application startup
# ---------------------------------------------------------------------------

_redis_client: Any = None

_WORKING_MEMORY_KEY = "memory:rm:{rm_id}:session:{session_id}"
_WORKING_MEMORY_TTL = 1800  # 30 minutes, matches SessionMemory default


def set_redis_client(client: Any) -> None:
    """
    Inject the shared Redis client instance.

    Must be called once during FastAPI lifespan startup before any cache
    tool is invoked.  The client should be a redis.asyncio.Redis instance
    with decode_responses=True.

    Args:
        client: Connected redis.asyncio.Redis instance.
    """
    global _redis_client
    _redis_client = client


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@tool
async def get_cached_data(key: str) -> dict[str, Any]:
    """Read data from Redis cache by key.

    Args:
        key: Redis key to read (e.g., 'dashboard:rm:RM001').

    Returns:
        Dict parsed from the cached JSON value, or {"found": False} on a
        cache miss. Returns {"found": False, "error": str} on Redis failure.
    """
    if _redis_client is None:
        logger.error("get_cached_data called before Redis client was injected")
        return {"found": False, "error": "Redis client not initialised"}

    try:
        raw: str | None = await _redis_client.get(key)
        if raw is None:
            logger.debug("get_cached_data miss [key=%s]", key)
            return {"found": False}

        data: dict[str, Any] = json.loads(raw)
        logger.debug("get_cached_data hit [key=%s]", key)
        return {"found": True, **data}

    except json.JSONDecodeError as exc:
        logger.error(
            "get_cached_data JSON decode error [key=%s, error=%s]", key, exc
        )
        return {"found": False, "error": "Cached value is not valid JSON"}
    except Exception as exc:
        logger.error("get_cached_data Redis error [key=%s, error=%s]", key, exc)
        return {"found": False, "error": str(exc)}


@tool
async def set_cached_data(
    key: str, value: str, ttl_seconds: int = 300
) -> dict[str, Any]:
    """Write data to Redis cache with a TTL.

    Args:
        key: Redis key to write.
        value: JSON string to store. Must be valid JSON — validated before write.
        ttl_seconds: Cache TTL in seconds. Default 300 (5 minutes).

    Returns:
        {"success": True} on success, or {"success": False, "error": str} on failure.
    """
    if _redis_client is None:
        logger.error("set_cached_data called before Redis client was injected")
        return {"success": False, "error": "Redis client not initialised"}

    # Validate that the value is parseable JSON before storing
    try:
        json.loads(value)
    except json.JSONDecodeError as exc:
        logger.error(
            "set_cached_data received invalid JSON [key=%s, error=%s]", key, exc
        )
        return {"success": False, "error": f"value is not valid JSON: {exc}"}

    try:
        await _redis_client.set(key, value, ex=ttl_seconds)
        logger.debug(
            "set_cached_data success [key=%s, ttl=%ss]", key, ttl_seconds
        )
        return {"success": True}

    except Exception as exc:
        logger.error("set_cached_data Redis error [key=%s, error=%s]", key, exc)
        return {"success": False, "error": str(exc)}


@tool
async def get_working_memory(rm_id: str, session_id: str) -> dict[str, Any]:
    """Get working memory for a conversation session.

    Working memory is a per-session context bag that accumulates facts and
    references across multiple turns (e.g., which client is in focus, which
    alerts were already shown).

    Args:
        rm_id: RM employee identifier (e.g., 'RM001').
        session_id: Conversation session UUID string.

    Returns:
        Working memory dict, or an empty dict if no memory exists yet.
        Returns {"error": str} on Redis failure.
    """
    if _redis_client is None:
        logger.error("get_working_memory called before Redis client was injected")
        return {"error": "Redis client not initialised"}

    key = _WORKING_MEMORY_KEY.format(rm_id=rm_id, session_id=session_id)
    try:
        raw: str | None = await _redis_client.get(key)
        if raw is None:
            logger.debug(
                "get_working_memory miss [rm_id=%s, session_id=%s]",
                rm_id,
                session_id,
            )
            return {}

        data: dict[str, Any] = json.loads(raw)
        logger.debug(
            "get_working_memory hit [rm_id=%s, session_id=%s, keys=%s]",
            rm_id,
            session_id,
            list(data.keys()),
        )
        return data

    except json.JSONDecodeError as exc:
        logger.error(
            "get_working_memory JSON decode error "
            "[rm_id=%s, session_id=%s, error=%s]",
            rm_id,
            session_id,
            exc,
        )
        return {"error": "Working memory is corrupted (invalid JSON)"}
    except Exception as exc:
        logger.error(
            "get_working_memory Redis error [rm_id=%s, session_id=%s, error=%s]",
            rm_id,
            session_id,
            exc,
        )
        return {"error": str(exc)}


@tool
async def update_working_memory(
    rm_id: str, session_id: str, updates: str
) -> dict[str, Any]:
    """Update working memory with new context, merging with existing state.

    Reads the current working memory, shallow-merges the provided updates
    dict into it, and writes the result back with a 30-minute TTL.

    Args:
        rm_id: RM employee identifier.
        session_id: Conversation session UUID string.
        updates: JSON string of key-value pairs to merge into memory.
                 Example: '{"active_client_id": "CLT042", "last_intent": "view_alerts"}'

    Returns:
        {"success": True} on success, or {"success": False, "error": str} on failure.
    """
    if _redis_client is None:
        logger.error("update_working_memory called before Redis client was injected")
        return {"success": False, "error": "Redis client not initialised"}

    # Validate updates JSON
    try:
        update_dict: dict[str, Any] = json.loads(updates)
    except json.JSONDecodeError as exc:
        logger.error(
            "update_working_memory invalid updates JSON "
            "[rm_id=%s, session_id=%s, error=%s]",
            rm_id,
            session_id,
            exc,
        )
        return {"success": False, "error": f"updates is not valid JSON: {exc}"}

    key = _WORKING_MEMORY_KEY.format(rm_id=rm_id, session_id=session_id)
    try:
        # Read existing memory
        raw: str | None = await _redis_client.get(key)
        existing: dict[str, Any] = {}
        if raw:
            try:
                existing = json.loads(raw)
            except json.JSONDecodeError:
                logger.warning(
                    "update_working_memory found corrupted existing memory — "
                    "overwriting [rm_id=%s, session_id=%s]",
                    rm_id,
                    session_id,
                )

        # Shallow merge: updates win on key conflicts
        merged = {**existing, **update_dict}

        await _redis_client.set(key, json.dumps(merged), ex=_WORKING_MEMORY_TTL)
        logger.debug(
            "update_working_memory success [rm_id=%s, session_id=%s, "
            "updated_keys=%s]",
            rm_id,
            session_id,
            list(update_dict.keys()),
        )
        return {"success": True}

    except Exception as exc:
        logger.error(
            "update_working_memory Redis error [rm_id=%s, session_id=%s, error=%s]",
            rm_id,
            session_id,
            exc,
        )
        return {"success": False, "error": str(exc)}
