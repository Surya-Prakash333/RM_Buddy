"""
daily_review_agent.py — Daily Status Review specialist agent (S1-F6-L3).

Reviews daily activity metrics for all RMs in a branch.
BM persona — Vikram. Authoritative, data-driven coaching.

Handles:
    "How is my team doing today?"
    "Show me team activity"
    "Who is underperforming?"

Produces:
    - coaching narrative text (response field)
    - team performance analysis via Core API daily-status endpoint
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

logger = logging.getLogger("agent.daily_review_agent")


class DailyReviewAgent(BaseAgent):
    """
    Reviews daily activity metrics for all RMs in a branch.
    BM persona — Vikram. Authoritative, data-driven coaching.

    Fetches team daily status from Core API, analyzes performance gaps,
    and produces a coaching narrative identifying top performers and
    underperformers relative to branch average.

    Constructor accepts either the BaseAgent signature
        DailyReviewAgent(agent_id, llm_client, tools)
    or a convenience shorthand used in tests:
        DailyReviewAgent(rm_id="RM003")
    """

    def __init__(
        self,
        agent_id: str = "daily_review_agent",
        llm_client: Any = None,
        tools: list[Any] | None = None,
        *,
        rm_id: str | None = None,
    ) -> None:
        super().__init__(
            agent_id=agent_id,
            llm_client=llm_client,
            tools=tools or [],
        )
        self._rm_id = rm_id

    # ------------------------------------------------------------------
    # BaseAgent abstract interface
    # ------------------------------------------------------------------

    def get_specialist_prompt(self) -> str:
        """Return the daily-review-specific system prompt addendum."""
        return (
            "When reviewing daily status:\n"
            "1. Compare each RM's activity to branch average\n"
            "2. Identify who is above and below average\n"
            "3. Flag underperformers with specific gaps "
            "(e.g., 'Priya: 2 meetings vs 5 branch avg — needs attention')\n"
            "4. Praise top performers by name\n"
            "5. Suggest specific actions for the BM to take\n\n"
            "Tone: Professional, direct, constructive. Never harsh.\n"
            "Use Indian number formatting for financial metrics (Cr/L)."
        )

    def build_system_prompt(self, state: AgentState) -> str:  # type: ignore[override]
        """
        Compose a BM-persona system prompt using state directly.

        Overrides BaseAgent.build_system_prompt to accept AgentState
        instead of separate rm_identity / client_context dicts, matching
        the BM coaching pattern used by both BM specialist agents.
        """
        rm_context = state.get("rm_context") or {}
        rm_name = rm_context.get("rm_name", "BM")
        branch = rm_context.get("rm_branch", "Branch")
        return (
            f"You are Vikram, AI chief of staff for {rm_name}, Branch Manager "
            f"at Nuvama Wealth Management - {branch}.\n\n"
            "Your role: Provide data-driven coaching insights about team performance.\n\n"
            + self.get_specialist_prompt()
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
        """Build a three-node LangGraph: fetch_team_data → analyze_performance → generate_coaching."""
        from langgraph.graph import StateGraph, END

        graph = StateGraph(AgentState)
        graph.add_node("fetch_team_data", self.fetch_team_data_node)
        graph.add_node("analyze_performance", self.analyze_performance_node)
        graph.add_node("generate_coaching", self.generate_coaching_node)
        graph.set_entry_point("fetch_team_data")
        graph.add_edge("fetch_team_data", "analyze_performance")
        graph.add_edge("analyze_performance", "generate_coaching")
        graph.add_edge("generate_coaching", END)
        return graph

    # ------------------------------------------------------------------
    # Graph nodes
    # ------------------------------------------------------------------

    async def fetch_team_data_node(self, state: AgentState) -> dict:
        """Fetch daily status for all RMs in the branch from Core API."""
        from datetime import datetime

        rm_id = state.get("rm_id", self._rm_id or "")
        date = datetime.now().strftime("%Y-%m-%d")
        core_api = os.getenv("CORE_API_URL", "http://localhost:3001")

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{core_api}/api/v1/dashboard/daily-status",
                    params={"date": date},
                    headers={"X-RM-Identity": self._build_identity_header(state)},
                )
                data: dict[str, Any] = (
                    resp.json() if resp.status_code == 200 else {"error": f"HTTP {resp.status_code}"}
                )
        except Exception as exc:
            logger.warning(
                "fetch_team_data_node error [rm_id=%s, error=%s]", rm_id, exc
            )
            data = {"error": str(exc)}

        return {**state, "tool_results": [{"tool": "daily_status", "result": data}]}

    async def analyze_performance_node(self, state: AgentState) -> dict:
        """Identify gaps, top performers, and underperformers from raw data."""
        raw_data = state.get("tool_results", [{}])[0].get("result", {})

        # Extract structured insights if available; otherwise pass through raw data.
        team_data = raw_data.get("team", []) if isinstance(raw_data, dict) else []
        branch_avg = raw_data.get("branch_avg", {}) if isinstance(raw_data, dict) else {}

        top_performers: list[str] = []
        underperformers: list[str] = []

        if team_data and branch_avg:
            avg_meetings = branch_avg.get("meetings", 0)
            for rm in team_data:
                name = rm.get("rm_name", "Unknown RM")
                meetings = rm.get("meetings_today", 0)
                if avg_meetings > 0:
                    if meetings >= avg_meetings:
                        top_performers.append(name)
                    else:
                        underperformers.append(name)

        analysis: dict[str, Any] = {
            "has_gaps": bool(underperformers),
            "top_performers": top_performers,
            "underperformers": underperformers,
            "raw_data": raw_data,
        }

        # Store analysis in client_context so generate_coaching_node can access it.
        return {**state, "client_context": analysis}

    async def generate_coaching_node(self, state: AgentState) -> dict:
        """Use LLM to generate coaching narrative from team performance data."""
        from langchain_openai import ChatOpenAI

        analysis = state.get("client_context") or {}
        raw_data = analysis.get("raw_data", {})

        if self.llm is not None:
            llm = self.llm
        else:
            llm = ChatOpenAI(
                base_url=os.getenv("LITELLM_URL", "http://localhost:4000") + "/v1",
                api_key=os.getenv("LITELLM_MASTER_KEY", "sk-dummy"),
                model="claude-default",
            )

        messages = [
            {"role": "system", "content": self.build_system_prompt(state)},
            {
                "role": "user",
                "content": (
                    f"Team daily status data:\n"
                    f"{json.dumps(raw_data, indent=2, default=str)}\n\n"
                    "Provide coaching insights for the branch."
                ),
            },
        ]

        try:
            response = await llm.ainvoke(messages)
        except Exception as exc:
            logger.error("generate_coaching_node LLM error [error=%s]", exc)
            return {**state, "response": None, "widgets": [], "error": str(exc)}

        return {
            **state,
            "response": response.content if hasattr(response, "content") else str(response),
            "widgets": [],
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_identity_header(self, state: AgentState) -> str:
        """Encode BM identity as a base64 JSON string for X-RM-Identity header."""
        rm_context = state.get("rm_context") or {}
        identity = {
            "rm_id": state.get("rm_id", self._rm_id or ""),
            "rm_name": rm_context.get("rm_name", "BM"),
            "role": state.get("rm_role", "BM"),
            "rm_branch": rm_context.get("rm_branch", ""),
        }
        return base64.b64encode(json.dumps(identity).encode()).decode()
