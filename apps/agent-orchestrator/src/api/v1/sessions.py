"""Session history endpoints — list and retrieve past conversations."""

from __future__ import annotations

import logging
from typing import Any

from fastapi import APIRouter, Request

logger = logging.getLogger("api.sessions")
router = APIRouter()


@router.get(
    "/sessions",
    summary="List recent chat sessions for the current RM.",
)
async def list_sessions(
    raw_request: Request,
    rm_id: str,
    limit: int = 20,
) -> dict[str, Any]:
    """Return recent sessions with their first message as a title."""
    memory_db = raw_request.app.state.memory_db
    collection = memory_db["agent_sessions"]

    cursor = collection.find(
        {"rm_id": rm_id},
        {
            "_id": 0,
            "session_id": 1,
            "rm_id": 1,
            "created_at": 1,
            "updated_at": 1,
            "messages": {"$slice": 2},  # first user + assistant msg for title
        },
    ).sort("updated_at", -1).limit(limit)

    sessions = []
    async for doc in cursor:
        messages = doc.get("messages", [])
        # Use first user message as title
        title = "New conversation"
        for msg in messages:
            if msg.get("role") == "user" and msg.get("content"):
                title = msg["content"][:80]
                break

        sessions.append({
            "session_id": doc.get("session_id"),
            "title": title,
            "updated_at": str(doc.get("updated_at", "")),
            "created_at": str(doc.get("created_at", "")),
            "message_count": len(messages),
        })

    return {"sessions": sessions, "total": len(sessions)}


@router.get(
    "/sessions/{session_id}",
    summary="Get full message history for a session.",
)
async def get_session(
    raw_request: Request,
    session_id: str,
) -> dict[str, Any]:
    """Return all messages for a specific session."""
    memory_db = raw_request.app.state.memory_db
    collection = memory_db["agent_sessions"]

    doc = await collection.find_one(
        {"session_id": session_id},
        {"_id": 0},
    )

    if not doc:
        return {"session_id": session_id, "messages": [], "error": "Session not found"}

    return {
        "session_id": doc.get("session_id"),
        "rm_id": doc.get("rm_id"),
        "messages": doc.get("messages", []),
        "created_at": str(doc.get("created_at", "")),
        "updated_at": str(doc.get("updated_at", "")),
    }


@router.delete(
    "/sessions/{session_id}",
    summary="Delete a chat session.",
)
async def delete_session(
    raw_request: Request,
    session_id: str,
) -> dict[str, Any]:
    """Delete a session and its messages from the database."""
    memory_db = raw_request.app.state.memory_db
    collection = memory_db["agent_sessions"]

    result = await collection.delete_one({"session_id": session_id})

    # Also clean up Redis cache if session manager is available
    try:
        session_manager = raw_request.app.state.session_manager
        redis_client = raw_request.app.state.redis_client
        cache_key = f"session:{session_id}"
        await redis_client.delete(cache_key)
    except Exception:
        pass  # Redis cleanup is best-effort

    return {
        "session_id": session_id,
        "deleted": result.deleted_count > 0,
    }
