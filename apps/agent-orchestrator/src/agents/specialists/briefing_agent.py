"""
briefing_agent.py — Morning Briefing specialist agent.

Fetches briefing data from Core API and assembles a personalized narrative
briefing for the RM covering: today's meetings, pending alerts, portfolio
summary, and revenue YTD.

Produces:
    - narrative briefing text (response field)
    - BriefingPanel widget (widgets field)

Triggered when RM says "Good morning", "What's my briefing?", or starts the day.
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

import httpx

from agents.base_agent import BaseAgent
from graphs.state import AgentState
from tools.crm_tool import get_dashboard_summary, get_alerts
from tools.widget_tool import build_briefing_panel

logger = logging.getLogger("agent.briefing_agent")


class BriefingAgent(BaseAgent):
    """
    Generates the morning briefing for an RM.

    Fetches: today's meetings, pending alerts, portfolio summary, revenue YTD.
    Produces: narrative briefing text + BriefingPanel widget.

    Called when RM says "Good morning" or "What's my briefing?" or starts the day.

    Constructor accepts either the BaseAgent signature
        BriefingAgent(agent_id, llm_client, tools)
    or a convenience shorthand used in tests:
        BriefingAgent(rm_id="RM001")
    """

    def __init__(
        self,
        agent_id: str = "briefing_agent",
        llm_client: Any = None,
        tools: list[Any] | None = None,
        *,
        rm_id: str | None = None,
    ) -> None:
        # Allow test-friendly construction: BriefingAgent(rm_id="RM001")
        # In that case agent_id may actually be passed as a keyword; handle both.
        if rm_id is not None and agent_id == "briefing_agent":
            # Called as BriefingAgent(rm_id="RM001")
            pass
        super().__init__(
            agent_id=agent_id,
            llm_client=llm_client,
            tools=tools or [get_dashboard_summary, get_alerts, build_briefing_panel],
        )
        # Store rm_id for convenience (used by tests / standalone invocation)
        self._rm_id = rm_id

    # ------------------------------------------------------------------
    # BaseAgent abstract interface
    # ------------------------------------------------------------------

    def get_specialist_prompt(self) -> str:
        """Return the briefing-specific system prompt addendum."""
        from datetime import datetime

        today = datetime.now().strftime("%A, %B %d, %Y")
        return (
            f"Today is {today}. You are Aria, the AI assistant for Nuvama Wealth "
            f"Management.\n\n"
            "Generate a concise morning briefing. The briefing should:\n"
            "1. Start with a warm good morning greeting\n"
            "2. Mention today's meeting count and first meeting time\n"
            "3. Highlight any CRITICAL or HIGH priority alerts (max 3)\n"
            "4. Give revenue YTD progress "
            "(e.g., \"₹2.3 Cr of ₹5 Cr target — 46% achieved\")\n"
            "5. End with a motivating closing line "
            "(e.g., \"You have 3 priority actions today — let's make it count!\")\n\n"
            "Keep it under 150 words. Use Indian number formatting (Cr/L).\n"
            "After generating the narrative, call build_briefing_panel to create "
            "the structured widget."
        )

    async def process(self, state: AgentState) -> dict:
        """
        Entry point called by the orchestrator.

        Compiles and runs the internal LangGraph, then returns a partial state
        update containing 'response', 'widgets', and 'tool_results'.
        """
        graph = self.create_graph()
        compiled = graph.compile()
        result = await compiled.ainvoke(state)
        return {
            "response": result.get("response"),
            "widgets": result.get("widgets", []),
            "tool_results": result.get("tool_results", []),
        }

    # ------------------------------------------------------------------
    # Internal LangGraph
    # ------------------------------------------------------------------

    def create_graph(self):
        """Build a two-node LangGraph: fetch_briefing → compose_narrative."""
        from langgraph.graph import StateGraph, END

        graph = StateGraph(AgentState)
        graph.add_node("fetch_briefing", self.fetch_briefing_node)
        graph.add_node("compose_narrative", self.compose_narrative_node)
        graph.set_entry_point("fetch_briefing")
        graph.add_edge("fetch_briefing", "compose_narrative")
        graph.add_edge("compose_narrative", END)
        return graph

    # ------------------------------------------------------------------
    # Graph nodes
    # ------------------------------------------------------------------

    async def fetch_briefing_node(self, state: AgentState) -> dict:
        """Fetch today's briefing data from Core API."""
        rm_id = state.get("rm_id", self._rm_id or "")
        core_api = os.getenv("CORE_API_URL", "http://localhost:3001")

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{core_api}/api/v1/briefing/today",
                    headers={"X-RM-Identity": self._build_identity_header(state)},
                )
                briefing_data: dict[str, Any] = (
                    resp.json() if resp.status_code == 200 else {}
                )
        except Exception as exc:
            logger.warning("fetch_briefing_node error [rm_id=%s, error=%s]", rm_id, exc)
            briefing_data = {"error": str(exc)}

        return {**state, "tool_results": [{"tool": "get_briefing", "result": briefing_data}]}

    async def compose_narrative_node(self, state: AgentState) -> dict:
        """Use LLM to compose the narrative briefing, then build the widget."""
        from langchain_openai import ChatOpenAI

        briefing_data = state.get("tool_results", [{}])[0].get("result", {})

        # Use injected llm_client if available; otherwise create one from env.
        if self.llm is not None:
            llm = self.llm
        else:
            llm = ChatOpenAI(
                base_url=os.getenv("LITELLM_URL", "http://localhost:4000") + "/v1",
                api_key=os.getenv("LITELLM_MASTER_KEY", "sk-dummy"),
                model="claude-default",
            )

        llm_with_tools = llm.bind_tools([build_briefing_panel])

        # Build a system prompt that incorporates RM identity from state
        rm_context = state.get("rm_context") or {}
        rm_name = rm_context.get("rm_name", "RM")
        system_content = (
            f"You are Aria, AI assistant for {rm_name} at Nuvama Wealth Management.\n\n"
            + self.get_specialist_prompt()
        )

        messages = [
            {"role": "system", "content": system_content},
            {
                "role": "user",
                "content": (
                    f"Here is today's briefing data:\n"
                    f"{json.dumps(briefing_data, indent=2, default=str)}\n\n"
                    "Generate my morning briefing and build the panel widget."
                ),
            },
        ]

        try:
            response = await llm_with_tools.ainvoke(messages)
        except Exception as exc:
            logger.error("compose_narrative_node LLM error [error=%s]", exc)
            return {**state, "response": None, "widgets": [], "error": str(exc)}

        widgets: list[dict[str, Any]] = []
        if hasattr(response, "tool_calls") and response.tool_calls:
            for tc in response.tool_calls:
                if tc["name"] == "build_briefing_panel":
                    try:
                        result = build_briefing_panel.invoke(tc["args"])
                        widgets.append(
                            json.loads(result) if isinstance(result, str) else result
                        )
                    except Exception as exc:
                        logger.warning(
                            "build_briefing_panel invoke error [error=%s]", exc
                        )

        return {**state, "response": response.content, "widgets": widgets}

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_identity_header(self, state: AgentState) -> str:
        """Encode RM identity as a base64 JSON string for X-RM-Identity header."""
        rm_context = state.get("rm_context") or {}
        identity = {
            "rm_id": state.get("rm_id", self._rm_id or ""),
            "rm_name": rm_context.get("rm_name", "RM"),
            "role": state.get("rm_role", "RM"),
        }
        return base64.b64encode(json.dumps(identity).encode()).decode()
