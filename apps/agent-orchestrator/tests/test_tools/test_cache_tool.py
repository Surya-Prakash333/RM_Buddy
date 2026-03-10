"""
test_cache_tool.py — Unit tests for the Redis cache tool interface layer.

All tests inject a mock Redis client via set_redis_client() so no real
Redis process is required.

Coverage:
    set_redis_client    — injection propagates to all tools.
    get_cached_data     — hit, miss, JSON error, client not initialised.
    set_cached_data     — success, invalid JSON input, client not initialised.
    get_working_memory  — hit, miss, client not initialised.
    update_working_memory — new key, merge with existing, invalid JSON, client not initialised.
"""

from __future__ import annotations

import sys
import os
import json
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

import tools.cache_tool as cache_module
from tools.cache_tool import (
    get_cached_data,
    get_working_memory,
    set_cached_data,
    set_redis_client,
    update_working_memory,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_mock_redis(get_return: str | None = None) -> AsyncMock:
    """Build an AsyncMock Redis client with controllable .get() return value."""
    mock = AsyncMock()
    mock.get = AsyncMock(return_value=get_return)
    mock.set = AsyncMock(return_value=True)
    return mock


def _reset_redis_client() -> None:
    """Reset the module-level client to None between tests."""
    set_redis_client(None)  # type: ignore[arg-type]


# ---------------------------------------------------------------------------
# set_redis_client
# ---------------------------------------------------------------------------


def test_set_redis_client_stores_client() -> None:
    """set_redis_client must update the module-level _redis_client."""
    mock_redis = _make_mock_redis()
    set_redis_client(mock_redis)
    assert cache_module._redis_client is mock_redis
    _reset_redis_client()


# ---------------------------------------------------------------------------
# get_cached_data
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_cached_data_hit_returns_parsed_json() -> None:
    """On a cache hit, get_cached_data returns the parsed JSON dict."""
    payload = {"total_clients": 42, "active_alerts": 3}
    mock_redis = _make_mock_redis(get_return=json.dumps(payload))
    set_redis_client(mock_redis)

    result = await get_cached_data.ainvoke({"key": "dashboard:rm:RM001"})

    assert result["found"] is True
    assert result["total_clients"] == 42
    _reset_redis_client()


@pytest.mark.asyncio
async def test_get_cached_data_miss_returns_found_false() -> None:
    """On a cache miss (Redis returns None), get_cached_data returns {'found': False}."""
    mock_redis = _make_mock_redis(get_return=None)
    set_redis_client(mock_redis)

    result = await get_cached_data.ainvoke({"key": "dashboard:rm:RM001"})

    assert result == {"found": False}
    _reset_redis_client()


@pytest.mark.asyncio
async def test_get_cached_data_invalid_json_returns_error() -> None:
    """If the cached value is not valid JSON, an error dict is returned."""
    mock_redis = _make_mock_redis(get_return="not-json{{")
    set_redis_client(mock_redis)

    result = await get_cached_data.ainvoke({"key": "bad:key"})

    assert result["found"] is False
    assert "error" in result
    _reset_redis_client()


@pytest.mark.asyncio
async def test_get_cached_data_without_client_returns_error() -> None:
    """Calling get_cached_data before set_redis_client returns an error dict."""
    _reset_redis_client()
    result = await get_cached_data.ainvoke({"key": "any:key"})
    assert result["found"] is False
    assert "error" in result


# ---------------------------------------------------------------------------
# set_cached_data
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_set_cached_data_success() -> None:
    """set_cached_data returns {"success": True} on a successful Redis SET."""
    mock_redis = _make_mock_redis()
    set_redis_client(mock_redis)

    result = await set_cached_data.ainvoke(
        {"key": "dashboard:rm:RM001", "value": '{"x": 1}', "ttl_seconds": 60}
    )

    assert result == {"success": True}
    mock_redis.set.assert_called_once_with("dashboard:rm:RM001", '{"x": 1}', ex=60)
    _reset_redis_client()


@pytest.mark.asyncio
async def test_set_cached_data_invalid_json_returns_error() -> None:
    """set_cached_data rejects invalid JSON values before calling Redis."""
    mock_redis = _make_mock_redis()
    set_redis_client(mock_redis)

    result = await set_cached_data.ainvoke(
        {"key": "some:key", "value": "not-json{{"}
    )

    assert result["success"] is False
    assert "error" in result
    mock_redis.set.assert_not_called()
    _reset_redis_client()


@pytest.mark.asyncio
async def test_set_cached_data_without_client_returns_error() -> None:
    """Calling set_cached_data before set_redis_client returns an error dict."""
    _reset_redis_client()
    result = await set_cached_data.ainvoke(
        {"key": "k", "value": '{"a": 1}'}
    )
    assert result["success"] is False
    assert "error" in result


# ---------------------------------------------------------------------------
# get_working_memory
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_working_memory_hit_returns_dict() -> None:
    """On a memory hit, get_working_memory returns the stored dict."""
    memory_data = {"active_client_id": "CLT001", "last_intent": "view_alerts"}
    mock_redis = _make_mock_redis(get_return=json.dumps(memory_data))
    set_redis_client(mock_redis)

    result = await get_working_memory.ainvoke(
        {"rm_id": "RM001", "session_id": "sess-abc"}
    )

    assert result["active_client_id"] == "CLT001"
    assert result["last_intent"] == "view_alerts"
    _reset_redis_client()


@pytest.mark.asyncio
async def test_get_working_memory_miss_returns_empty_dict() -> None:
    """On a memory miss, get_working_memory returns an empty dict."""
    mock_redis = _make_mock_redis(get_return=None)
    set_redis_client(mock_redis)

    result = await get_working_memory.ainvoke(
        {"rm_id": "RM001", "session_id": "sess-new"}
    )

    assert result == {}
    _reset_redis_client()


@pytest.mark.asyncio
async def test_get_working_memory_uses_correct_key_format() -> None:
    """get_working_memory reads from the expected key pattern."""
    mock_redis = _make_mock_redis(get_return=None)
    set_redis_client(mock_redis)

    await get_working_memory.ainvoke({"rm_id": "RM001", "session_id": "sess-xyz"})

    mock_redis.get.assert_called_once_with("memory:rm:RM001:session:sess-xyz")
    _reset_redis_client()


@pytest.mark.asyncio
async def test_get_working_memory_without_client_returns_error() -> None:
    """Calling get_working_memory before set_redis_client returns an error dict."""
    _reset_redis_client()
    result = await get_working_memory.ainvoke(
        {"rm_id": "RM001", "session_id": "sess-abc"}
    )
    assert "error" in result


# ---------------------------------------------------------------------------
# update_working_memory
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_update_working_memory_creates_new_entry() -> None:
    """update_working_memory writes merged data when no prior memory exists."""
    mock_redis = _make_mock_redis(get_return=None)  # cache miss
    set_redis_client(mock_redis)

    updates = json.dumps({"active_client_id": "CLT042"})
    result = await update_working_memory.ainvoke(
        {"rm_id": "RM001", "session_id": "sess-abc", "updates": updates}
    )

    assert result == {"success": True}
    stored_call = mock_redis.set.call_args
    stored_json = stored_call.args[1]
    stored = json.loads(stored_json)
    assert stored["active_client_id"] == "CLT042"
    _reset_redis_client()


@pytest.mark.asyncio
async def test_update_working_memory_merges_with_existing() -> None:
    """update_working_memory merges updates with existing memory data."""
    existing = {"active_client_id": "CLT001", "last_intent": "view_alerts"}
    mock_redis = _make_mock_redis(get_return=json.dumps(existing))
    set_redis_client(mock_redis)

    updates = json.dumps({"last_intent": "portfolio_analysis", "new_flag": True})
    result = await update_working_memory.ainvoke(
        {"rm_id": "RM001", "session_id": "sess-abc", "updates": updates}
    )

    assert result == {"success": True}
    stored_call = mock_redis.set.call_args
    stored = json.loads(stored_call.args[1])
    # Existing key preserved
    assert stored["active_client_id"] == "CLT001"
    # Updated key overwritten
    assert stored["last_intent"] == "portfolio_analysis"
    # New key added
    assert stored["new_flag"] is True
    _reset_redis_client()


@pytest.mark.asyncio
async def test_update_working_memory_invalid_updates_json_returns_error() -> None:
    """update_working_memory rejects non-JSON updates strings."""
    mock_redis = _make_mock_redis()
    set_redis_client(mock_redis)

    result = await update_working_memory.ainvoke(
        {"rm_id": "RM001", "session_id": "sess-abc", "updates": "not-json{{"}
    )

    assert result["success"] is False
    assert "error" in result
    mock_redis.set.assert_not_called()
    _reset_redis_client()


@pytest.mark.asyncio
async def test_update_working_memory_without_client_returns_error() -> None:
    """Calling update_working_memory before set_redis_client returns an error dict."""
    _reset_redis_client()
    result = await update_working_memory.ainvoke(
        {"rm_id": "RM001", "session_id": "sess-abc", "updates": '{"k": "v"}'}
    )
    assert result["success"] is False
    assert "error" in result
