"""
engagement_agent.py — Engagement Consistency specialist agent.

Reviews CRM engagement patterns for RMs in a branch.
BM persona — Vikram. Identifies RMs with declining CRM engagement.

Produces:
    - engagement coaching insights text (response field)
    - raw tool_results with engagement data

Handles: "Who has low CRM engagement?" "Show login patterns" "Engagement report"
"""

from __future__ import annotations

import base64
import json
import logging
import os
from datetime import datetime
from typing import Any

import httpx

from agents.base_agent import BaseAgent
from graphs.state import AgentState

logger = logging.getLogger("agent.engagement_agent")


class EngagementAgent(BaseAgent):
    """
    Reviews CRM engagement consistency for RMs in a branch.
    BM persona — Vikram. Identifies RMs with declining engagement.

    Handles: "Who has low CRM engagement?" "Show login patterns" "Engagement report"

    Constructor accepts either the BaseAgent signature
        EngagementAgent(agent_id, llm_client, tools)
    or a convenience shorthand used in tests:
        EngagementAgent(rm_id="RM003")
    """

    def __init__(
        self,
        agent_id: str = "engagement_agent",
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
        """Return the engagement-specific system prompt addendum."""
        return (
            "You are Vikram, AI chief of staff at Nuvama Wealth Management.\n\n"
            "When reviewing engagement data:\n"
            "1. Identify RMs with consistency_score below 60 (below acceptable)\n"
            "2. For declining RMs, mention the trend and key metric that dropped\n"
            "3. For strong performers, briefly acknowledge\n"
            "4. Suggest specific actions: 1-on-1 check-in, CRM training, or process review\n"
            "5. Flag if any RM hasn't logged in for 3+ consecutive days (serious concern)\n\n"
            "Tone: Supportive but direct. Engagement issues often signal broader problems.\n"
            "Keep insights actionable and specific to each RM."
        )

    async def process(self, state: AgentState) -> dict:
        """
        Entry point called by the orchestrator.

        Compiles and runs the internal LangGraph, then returns a partial state
        update containing 'response' and 'tool_results'.
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
        """Build a two-node LangGraph: fetch_engagement → generate_insights."""
        from langgraph.graph import StateGraph, END

        graph = StateGraph(AgentState)
        graph.add_node("fetch_engagement", self.fetch_engagement_node)
        graph.add_node("generate_insights", self.generate_insights_node)
        graph.set_entry_point("fetch_engagement")
        graph.add_edge("fetch_engagement", "generate_insights")
        graph.add_edge("generate_insights", END)
        return graph

    # ------------------------------------------------------------------
    # Graph nodes
    # ------------------------------------------------------------------

    async def fetch_engagement_node(self, state: AgentState) -> dict:
        """Fetch engagement data for all RMs in branch."""
        period = datetime.now().strftime("%Y-%m")
        core_api = os.getenv("CORE_API_URL", "http://localhost:3001")

        try:
            async with httpx.AsyncClient(timeout=10.0) as client:
                resp = await client.get(
                    f"{core_api}/api/v1/engagement/data",
                    params={"period": period},
                    headers={"X-RM-Identity": self._build_identity_header(state)},
                )
                data: dict[str, Any] = (
                    resp.json() if resp.status_code == 200 else {"error": f"HTTP {resp.status_code}"}
                )
        except Exception as exc:
            logger.warning("fetch_engagement_node error [rm_id=%s, error=%s]", state.get("rm_id"), exc)
            data = {"error": str(exc)}

        return {**state, "tool_results": [{"tool": "engagement_data", "result": data}]}

    async def generate_insights_node(self, state: AgentState) -> dict:
        """Use LLM to generate engagement coaching insights."""
        from langchain_openai import ChatOpenAI

        data = state.get("tool_results", [{}])[0].get("result", {})

        # Use injected llm_client if available; otherwise create one from env.
        if self.llm is not None:
            llm = self.llm
        else:
            llm = ChatOpenAI(
                base_url="http://localhost:4000/v1",
                api_key=os.getenv("LITELLM_MASTER_KEY", ""),
                model="claude-default",
            )

        rm_context = state.get("rm_context") or {}
        rm_name = rm_context.get("rm_name", "BM")

        messages = [
            {
                "role": "system",
                "content": (
                    f"You are Vikram, AI chief of staff for {rm_name} at Nuvama Wealth Management.\n\n"
                    + self.get_specialist_prompt()
                ),
            },
            {
                "role": "user",
                "content": (
                    f"Engagement data:\n{json.dumps(data, indent=2, default=str)}\n\n"
                    "Provide engagement coaching insights."
                ),
            },
        ]

        try:
            response = await llm.ainvoke(messages)
        except Exception as exc:
            logger.error("generate_insights_node LLM error [error=%s]", exc)
            return {**state, "response": None, "error": str(exc)}

        return {
            **state,
            "response": response.content if hasattr(response, "content") else str(response),
        }

    # ------------------------------------------------------------------
    # Helpers
    # ------------------------------------------------------------------

    def _build_identity_header(self, state: AgentState) -> str:
        """Encode RM identity as a base64 JSON string for X-RM-Identity header."""
        rm_context = state.get("rm_context") or {}
        identity = {
            "rm_id": state.get("rm_id", self._rm_id or ""),
            "rm_name": rm_context.get("rm_name", "BM"),
            "role": state.get("rm_role", "BM"),
            "rm_branch": rm_context.get("rm_branch", ""),
        }
        return base64.b64encode(json.dumps(identity).encode()).decode()
