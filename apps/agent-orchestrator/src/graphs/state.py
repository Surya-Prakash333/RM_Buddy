"""
state.py — AgentState TypedDict for the supervisor graph.

Expanded from the original orchestrator state to support:
- Parallel specialist dispatch (active_specialists, specialist_results)
- Context builder output (loaded_context)
- New intent taxonomy (Intent enum)
- Guardrail results (guardrail_blocked, guardrail_reason)
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from langgraph.graph import add_messages
from typing_extensions import TypedDict


class AgentState(TypedDict):
    """Full state bag passed between every node in the supervisor graph."""

    # ------------------------------------------------------------------
    # Input — populated from request before graph invocation
    # ------------------------------------------------------------------
    rm_id: str
    rm_role: str                        # 'RM' | 'BM' | 'ADMIN'
    session_id: str
    conversation_id: str
    message: str
    message_type: str                   # 'text' | 'voice_transcript'

    # ------------------------------------------------------------------
    # Context — populated by build_context node
    # ------------------------------------------------------------------
    rm_context: Optional[dict]          # RM identity from request header
    client_context: Optional[dict]      # Active client being discussed
    loaded_context: Optional[dict]      # Full context from ContextBuilder:
                                        #   session, clients, alerts, preferences,
                                        #   memories, summaries

    # ------------------------------------------------------------------
    # Classification — populated by classify_intent node
    # ------------------------------------------------------------------
    intent: Optional[str]               # Intent enum value
    intent_confidence: float            # 0.0 – 1.0
    active_specialists: list[str]       # Which specialist agents to dispatch

    # ------------------------------------------------------------------
    # Specialist results — populated by dispatch_specialists node
    # ------------------------------------------------------------------
    specialist_results: dict[str, str]  # {"alert": "text", "portfolio": "text", ...}

    # ------------------------------------------------------------------
    # Final output — populated by compose_response node
    # ------------------------------------------------------------------
    tool_results: list[dict]            # Raw results from tool calls
    response: Optional[str]             # Final prose text
    widgets: list[dict]                 # List of WidgetPayload-compatible dicts

    # ------------------------------------------------------------------
    # Control flow
    # ------------------------------------------------------------------
    guardrail_blocked: bool
    guardrail_reason: Optional[str]
    guardrail_flags: list[str]          # Detailed flags for metadata
    error: Optional[str]

    # ------------------------------------------------------------------
    # LangGraph conversation history
    # ------------------------------------------------------------------
    messages: Annotated[list, add_messages]
