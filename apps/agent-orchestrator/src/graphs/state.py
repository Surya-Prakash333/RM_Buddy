"""
state.py — AgentState TypedDict for the LangGraph orchestrator.

LangGraph requires a TypedDict to define the shape of state flowing through
the graph.  The `messages` field uses the `add_messages` reducer so that
appending to conversation history is safe across parallel branches.

All Optional fields start as None and are populated by the graph nodes.
Fields are populated in order:

  input_guard       → validates message, populates guardrail_flags on violation
  classify_intent   → intent, intent_confidence
  route_agent       → (no state change; routing only)
  execute_agent     → tool_results, response, widgets
  output_guard      → may set error, redact response
  compose_response  → final response ready for serialisation
"""

from __future__ import annotations

from typing import Annotated, Optional

from langgraph.graph import add_messages
from typing_extensions import TypedDict


class AgentState(TypedDict):
    """Full state bag passed between every node in the orchestrator graph."""

    # ------------------------------------------------------------------
    # Input — populated from AgentRequest before graph invocation
    # ------------------------------------------------------------------
    rm_id: str
    rm_role: str           # 'RM' | 'BM' | 'ADMIN'
    session_id: str
    message: str
    message_type: str      # 'text' | 'voice_transcript'

    # ------------------------------------------------------------------
    # Processing — enriched by classification / context nodes
    # ------------------------------------------------------------------
    intent: Optional[str]           # IntentType string value
    intent_confidence: float        # 0.0 – 1.0
    rm_context: Optional[dict]      # RM's branch, client_count, AUM, etc.
    client_context: Optional[dict]  # Active client being discussed (if any)

    # ------------------------------------------------------------------
    # Results — populated by execute_agent
    # ------------------------------------------------------------------
    tool_results: list[dict]        # Raw results from tool calls
    response: Optional[str]         # Final prose text
    widgets: list[dict]             # List of WidgetPayload-compatible dicts

    # ------------------------------------------------------------------
    # Control flow
    # ------------------------------------------------------------------
    guardrail_flags: list[str]      # Non-empty triggers output_guard action
    error: Optional[str]            # Set when an unrecoverable error occurs

    # ------------------------------------------------------------------
    # LangGraph conversation history
    # Annotated with add_messages reducer — appends rather than overwrites.
    # ------------------------------------------------------------------
    messages: Annotated[list, add_messages]
