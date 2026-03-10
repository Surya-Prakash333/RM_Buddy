"""
schemas.py — Pydantic request/response models for the Agent Orchestrator API.

These are the wire contracts between:
  - The Next.js frontend / Core API  →  AgentRequest  (inbound)
  - The orchestrator                 →  AgentResponse (outbound)

All models use Pydantic v2 semantics with strict typing.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from pydantic import BaseModel, Field


class AgentRequest(BaseModel):
    """
    Inbound message from an RM or BM hitting POST /agent/chat.

    Fields:
        session_id    Unique session identifier (UUID string). Frontend creates
                      a new session per conversation window.
        rm_id         The authenticated RM's employee ID from the JWT.
        message       Raw text (or voice transcript) from the user.
        message_type  'text' or 'voice_transcript'.
        context       Optional caller-supplied context dict (e.g. currently
                      visible client ID in the UI).
        metadata      Optional bag for debugging metadata (client version, etc).
    """

    session_id: str
    rm_id: str
    message: str = Field(..., min_length=1, max_length=4096)
    message_type: str = Field(default="text", pattern="^(text|voice_transcript)$")
    context: Optional[dict[str, Any]] = None
    metadata: Optional[dict[str, Any]] = None


class WidgetPayload(BaseModel):
    """
    A single UI widget returned by an agent.

    The frontend maps widget_type to the appropriate React component.
    The data field schema is widget-type-specific and intentionally open.
    """

    widget_type: str
    title: str
    data: dict[str, Any]
    actions: Optional[list[dict[str, Any]]] = None


class AgentResponse(BaseModel):
    """
    Outbound response from the orchestrator returned by POST /agent/chat.

    Fields:
        session_id    Echoed from the request for client-side correlation.
        message_id    Unique ID for this specific response message.
        agent_id      Which agent produced this response (e.g. 'aria', 'vikram').
        response_type 'text' | 'widget' | 'error'
        text          Prose response text (may be None for pure-widget responses).
        widgets       Zero or more structured UI widgets.
        metadata      Debugging/observability metadata (intent, confidence, latency_ms).
    """

    session_id: str
    message_id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    agent_id: str
    response_type: str = Field(..., pattern="^(text|widget|error)$")
    text: Optional[str] = None
    widgets: list[WidgetPayload] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)
