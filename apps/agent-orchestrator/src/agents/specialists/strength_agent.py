"""
strength_agent.py — Strength Identification specialist agent (S1-F33-L3).

Identifies top strengths for each RM relative to peer median.
BM persona — Vikram. Constructive recognition and coaching.

Handles:
    "What are my team's strengths?"
    "Who excels at what?"
    "Show strength report"

Produces:
    - coaching narrative with named recognition and actionable suggestions (response field)
    - strength data fetched from Core API team-strengths endpoint
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

logger = logging.getLogger("agent.strength_agent")


class StrengthAgent(BaseAgent):
    """
    Identifies top strengths for each RM relative to peer median.
    BM persona — Vikram. Constructive recognition and coaching.

    Fetches team strength data from Core API, then produces a coaching
    narrative recognizing specific RMs for their top strength dimensions
    and suggesting actionable peer-learning pairings.

    Constructor accepts either the BaseAgent signature
        StrengthAgent(agent_id, llm_client, tools)
    or a convenience shorthand used in tests:
        StrengthAgent(rm_id="RM003")
    """

    def __init__(
        self,
        agent_id: str = "strength_agent",
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
        """Return the strength-identification-specific system prompt addendum."""
        return (
            "When presenting strength analysis:\n"
            "1. Recognize specific RMs for their top strength dimension "
            "(e.g., 'Rajesh is in the top quartile for client relationships')\n"
            "2. For growth areas, frame positively: 'There's an opportunity to improve X'\n"
            "3. Suggest specific, actionable coaching "
            "(e.g., 'Pair Priya with Rajesh for client meeting techniques')\n"
            "4. End with a team-level insight\n\n"
            "Keep it concise. Focus on actionable coaching, not just data."
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
        return (
            f"You are Vikram, AI chief of staff for {rm_name} "
            f"at Nuvama Wealth Management.\n\n"
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
        """Build a two-node LangGraph: fetch_strengths → generate_coaching_insights."""
        from langgraph.graph import StateGraph, END

        graph = StateGraph(AgentState)
        graph.add_node("fetch_strengths", self.fetch_strengths_node)
        graph.add_node("generate_coaching_insights", self.generate_coaching_insights_node)
        graph.set_entry_point("fetch_strengths")
        graph.add_edge("fetch_strengths", "generate_coaching_insights")
        graph.add_edge("generate_coaching_insights", END)
        return graph

    # ------------------------------------------------------------------
    # Graph nodes
    # ------------------------------------------------------------------

    async def fetch_strengths_node(self, state: AgentState) -> dict:
        """Fetch strength reports for all RMs in branch from Core API."""
        from datetime import datetime

        rm_id = state.get("rm_id", self._rm_id or "")
        period = datetime.now().strftime("%Y-%m")
        core_api = os.getenv("CORE_API_URL", "http://localhost:3001")

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{core_api}/api/v1/performance/team-strengths",
                    params={"period": period},
                    headers={"X-RM-Identity": self._build_identity_header(state)},
                )
                data: dict[str, Any] = (
                    resp.json() if resp.status_code == 200 else {"error": str(resp.status_code)}
                )
        except Exception as exc:
            logger.warning(
                "fetch_strengths_node error [rm_id=%s, error=%s]", rm_id, exc
            )
            data = {"error": str(exc)}

        return {**state, "tool_results": [{"tool": "team_strengths", "result": data}]}

    async def generate_coaching_insights_node(self, state: AgentState) -> dict:
        """Use LLM to generate coaching narrative from strength data."""
        from langchain_openai import ChatOpenAI

        strength_data = state.get("tool_results", [{}])[0].get("result", {})

        if self.llm is not None:
            llm = self.llm
        else:
            llm = ChatOpenAI(
                base_url="http://localhost:4000/v1",
                api_key=os.getenv("LITELLM_MASTER_KEY", ""),
                model="claude-default",
            )

        messages = [
            {"role": "system", "content": self.build_system_prompt(state)},
            {
                "role": "user",
                "content": (
                    f"Team strength data:\n"
                    f"{json.dumps(strength_data, indent=2, default=str)}\n\n"
                    "Generate coaching insights."
                ),
            },
        ]

        try:
            response = await llm.ainvoke(messages)
        except Exception as exc:
            logger.error("generate_coaching_insights_node LLM error [error=%s]", exc)
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
