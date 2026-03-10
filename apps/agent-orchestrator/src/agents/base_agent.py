"""
base_agent.py — Abstract base class for all specialist agents.

Every specialist agent (AlertsAgent, BriefingAgent, ClientQueryAgent, …)
must inherit from BaseAgent and implement exactly two methods:

    process()               — stateful async handler; receives AgentState, returns updated state dict
    get_specialist_prompt() — returns the agent's unique sub-persona instructions

Shared utilities live here to avoid duplication:
    build_system_prompt()   — merge RM identity context with specialist instructions
    create_widget()         — factory for WidgetPayload-compatible dicts
    format_indian_number()  — Indian number formatting (₹ Cr / L / raw)

Logging convention:
    Every specialist gets a named logger: `agent.<agent_id>` so that log
    aggregators can filter per-agent without code changes.
"""

from __future__ import annotations

import logging
from abc import ABC, abstractmethod
from typing import Any

from graphs.state import AgentState


class BaseAgent(ABC):
    """
    Abstract base for all RM Buddy specialist agents.

    Args:
        agent_id:   Unique snake_case identifier (e.g. 'alerts_agent').
        llm_client: Async OpenAI-compatible client pointing at LiteLLM proxy.
        tools:      List of LangChain-compatible tools this agent may invoke.
    """

    def __init__(self, agent_id: str, llm_client: Any, tools: list[Any]) -> None:
        self.agent_id = agent_id
        self.llm = llm_client
        self.tools = tools
        self.logger = logging.getLogger(f"agent.{agent_id}")

    # ------------------------------------------------------------------
    # Abstract interface — every specialist must implement these
    # ------------------------------------------------------------------

    @abstractmethod
    async def process(self, state: AgentState) -> dict:
        """
        Process the current graph state and return a partial state update.

        The returned dict is merged by LangGraph into the existing state —
        only keys that are changing need to be included.

        Args:
            state: Current AgentState snapshot.

        Returns:
            Partial state dict with updated fields.
        """

    @abstractmethod
    def get_specialist_prompt(self) -> str:
        """
        Return the agent-specific system prompt addendum.

        This is appended to the base RM/BM identity context built by
        build_system_prompt() to form the full system message.
        """

    # ------------------------------------------------------------------
    # Shared utilities
    # ------------------------------------------------------------------

    def build_system_prompt(
        self,
        rm_identity: dict[str, Any],
        client_context: dict[str, Any] | None = None,
    ) -> str:
        """
        Compose the full system prompt for an LLM call.

        Sections (in order):
          1. RM identity paragraph (name, branch, client count, AUM)
          2. Specialist instructions from get_specialist_prompt()
          3. Optional active client context block

        Args:
            rm_identity:    Dict with keys: name, rm_id, branch, client_count, aum_cr.
            client_context: Optional dict with keys: client_id, name, tier, aum_cr.

        Returns:
            Complete system prompt string.
        """
        name = rm_identity.get("name", "RM")
        branch = rm_identity.get("branch", "Unknown Branch")
        client_count = rm_identity.get("client_count", 0)
        aum_cr = rm_identity.get("aum_cr", 0.0)

        identity_block = (
            f"You are assisting {name}, a Relationship Manager at Nuvama Wealth "
            f"Management ({branch} branch). They manage {client_count} clients with "
            f"a total AUM of {self.format_indian_number(aum_cr * 10_000_000)}.\n\n"
        )

        specialist_block = self.get_specialist_prompt()

        client_block = ""
        if client_context:
            client_block = (
                f"\n\nActive client context:\n"
                f"  Name  : {client_context.get('name', 'Unknown')}\n"
                f"  Tier  : {client_context.get('tier', 'N/A')}\n"
                f"  AUM   : {self.format_indian_number(client_context.get('aum_cr', 0) * 10_000_000)}\n"
            )

        return identity_block + specialist_block + client_block

    def create_widget(
        self,
        widget_type: str,
        title: str,
        data: dict[str, Any],
        actions: list[dict[str, Any]] | None = None,
    ) -> dict[str, Any]:
        """
        Create a WidgetPayload-compatible dict.

        Args:
            widget_type: WidgetType string value (e.g. 'metric_card').
            title:       Widget header text shown on dashboard.
            data:        Widget-type-specific payload dict.
            actions:     Optional list of CTA button descriptors.

        Returns:
            Dict matching the WidgetPayload schema.
        """
        payload: dict[str, Any] = {
            "widget_type": widget_type,
            "title": title,
            "data": data,
        }
        if actions is not None:
            payload["actions"] = actions
        return payload

    def format_indian_number(self, amount: float) -> str:
        """
        Format a rupee amount in Indian style.

        Thresholds:
            >= 1 Cr  (10,000,000) → "₹X.X Cr"
            >= 1 L   (100,000)    → "₹X.X L"
            otherwise             → "₹X,XXX"

        Args:
            amount: Raw amount in rupees (float).

        Returns:
            Formatted string with ₹ prefix.

        Examples:
            15_000_000 → "₹1.5 Cr"
            250_000    → "₹2.5 L"
            45_000     → "₹45,000"
        """
        if amount >= 10_000_000:  # 1 Crore
            return f"₹{amount / 10_000_000:.1f} Cr"
        elif amount >= 100_000:   # 1 Lakh
            return f"₹{amount / 100_000:.1f} L"
        else:
            return f"₹{amount:,.0f}"
