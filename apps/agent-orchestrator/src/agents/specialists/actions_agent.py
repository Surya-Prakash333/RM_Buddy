"""
actions_agent.py — Daily Actions Specialist Agent for RM Buddy.

Generates a ranked list of today's top priority actions for an RM.

Fetches: pipeline aging, proposals pending, follow-ups due, idle cash clients
         — all via GET /api/v1/daily-actions/ranked on the Core API.

Produces: ranked top-5 action list with LLM-generated reasoning +
          an ActionCard (action_card) widget via build_action_list.

Called when the RM says:
    "What should I do today?"
    "Show my priority actions."
    "What are my top priorities?"

Graph:  fetch_actions → prioritize_actions → END
"""

from __future__ import annotations

import base64
import json
import logging
import os
from typing import Any

import httpx
from langchain_core.tools import BaseTool
from langgraph.graph import END, StateGraph

from agents.base_agent import BaseAgent
from graphs.state import AgentState
from tools.widget_tool import build_action_list

logger = logging.getLogger("agent.actions_agent")

_HTTP_TIMEOUT = 10.0  # seconds

# Widget tools available during the prioritize phase
_WIDGET_TOOLS: list[BaseTool] = [
    build_action_list,
]


def _make_llm(tools: list[BaseTool]):
    """Instantiate a ChatOpenAI client bound to the given tools."""
    from langchain_openai import ChatOpenAI

    llm = ChatOpenAI(
        base_url=f"{settings.litellm_url}/v1",
        api_key=settings.litellm_master_key,
        model="claude-default",
    )
    return llm.bind_tools(tools)


def _build_identity_header(rm_id: str, rm_context: dict[str, Any]) -> str:
    """
    Build base64-encoded JSON identity header for the Core API AuthGuard.

    Args:
        rm_id:      The RM's unique identifier.
        rm_context: State's rm_context dict (may contain rm_name, role, etc.).

    Returns:
        Base64-encoded JSON string suitable for the X-RM-Identity header.
    """
    identity = {
        "rm_id": rm_id,
        "rm_name": rm_context.get("rm_name", "RM"),
        "role": rm_context.get("role", "RM"),
    }
    return base64.b64encode(json.dumps(identity).encode()).decode()


class ActionsAgent(BaseAgent):
    """
    Generates ranked daily priority actions for an RM.

    Fetches: pipeline aging, proposals pending, follow-ups due, idle cash clients.
    Produces: ranked action list with reasoning + ActionList widget.

    Called when RM says "What should I do today?" or "Show my priority actions."
    """

    def __init__(
        self,
        rm_id: str,
        llm_client: Any = None,
        tools: list[Any] | None = None,
    ) -> None:
        super().__init__(
            agent_id="actions_agent",
            llm_client=llm_client,
            tools=tools if tools is not None else _WIDGET_TOOLS,
        )
        self.rm_id = rm_id

    # ------------------------------------------------------------------
    # BaseAgent abstract methods
    # ------------------------------------------------------------------

    def get_specialist_prompt(self) -> str:
        """Return the Actions specialist instructions appended to the RM identity block."""
        return (
            "You are Aria, an AI assistant specialised in generating daily priority "
            "actions for the RM's wealth management clients.\n\n"
            "Rules:\n"
            "1. Prioritize actions by client tier: Diamond > Platinum > Gold > Silver.\n"
            "2. For each action, explain WHY it is urgent (e.g., proposal pending 8 days).\n"
            "3. Suggest WHAT to do (call, visit, send proposal, etc.).\n"
            "4. Use Indian notation for financial amounts: ₹1.5 Cr, ₹25 L.\n"
            "5. Focus on actions that protect or grow AUM.\n"
            "6. After generating the narrative list, call build_action_list to create "
            "the structured widget with the top 5 priority actions."
        )

    def build_system_prompt(self, state: AgentState) -> str:  # type: ignore[override]
        """
        Build the system prompt for the actions agent using the state's rm_context.

        This overrides BaseAgent.build_system_prompt with a state-based signature
        to match the story's specification.

        Args:
            state: Current AgentState snapshot.

        Returns:
            System prompt string.
        """
        rm_name = state.get("rm_context", {}).get("rm_name", "RM")
        return f"""You are Aria, AI assistant for {rm_name} at Nuvama Wealth Management.

Generate a concise list of today's top priority actions for {rm_name}.

For each action:
1. Start with the client tier and name
2. Explain WHY this is urgent (e.g., "Proposal pending 8 days — risk of losing to competitor")
3. Suggest WHAT to do (call, visit, send proposal, etc.)
4. Use financial amounts in Indian notation (₹1.5 Cr, ₹25 L)

Focus on actions that protect or grow AUM. Prioritize Diamond > Platinum > Gold > Silver.
After generating the narrative list, call build_action_list to create the structured widget."""

    async def process(self, state: AgentState) -> dict:
        """
        Run the two-node LangGraph and return a partial state update.

        Returns:
            Dict with keys: response, widgets, tool_results (partial update).
        """
        graph = self.create_graph()
        compiled = graph.compile()
        result: AgentState = await compiled.ainvoke(state)
        return {
            "response": result.get("response"),
            "widgets": result.get("widgets", []),
            "tool_results": result.get("tool_results", []),
            "messages": result.get("messages", []),
        }

    # ------------------------------------------------------------------
    # Graph construction
    # ------------------------------------------------------------------

    def create_graph(self) -> StateGraph:
        """Build the two-node LangGraph: fetch_actions → prioritize_actions → END."""
        graph = StateGraph(AgentState)
        graph.add_node("fetch_actions", self.fetch_actions_node)
        graph.add_node("prioritize_actions", self.prioritize_actions_node)
        graph.set_entry_point("fetch_actions")
        graph.add_edge("fetch_actions", "prioritize_actions")
        graph.add_edge("prioritize_actions", END)
        return graph

    # ------------------------------------------------------------------
    # Graph nodes
    # ------------------------------------------------------------------

    async def fetch_actions_node(self, state: AgentState) -> dict:
        """
        Phase 1: Call GET /api/v1/daily-actions/ranked on Core API and store
        the ranked actions data in state['tool_results'].

        On failure (network error, timeout, HTTP error), stores an error result
        rather than raising — keeping the pipeline running.
        """
        from config.settings import settings

        rm_context = state.get("rm_context") or {}
        identity_header = _build_identity_header(self.rm_id, rm_context)

        headers = {
            "Content-Type": "application/json",
            "X-RM-Identity": identity_header,
        }

        url = f"{settings.core_api_url}/api/v1/daily-actions/ranked"

        try:
            async with httpx.AsyncClient(timeout=_HTTP_TIMEOUT) as client:
                resp = await client.get(url, headers=headers)

            if resp.status_code >= 400:
                logger.error(
                    "fetch_actions_node HTTP error [status=%s, url=%s]",
                    resp.status_code,
                    url,
                )
                result = {
                    "error": f"HTTP {resp.status_code}: {resp.text}",
                    "actions": [],
                }
            else:
                result = resp.json()
                logger.debug(
                    "fetch_actions_node success [action_count=%s]",
                    len(result.get("actions", [])) if isinstance(result, dict) else "?",
                )

        except Exception as exc:
            logger.error(
                "fetch_actions_node error [url=%s, error=%s]", url, exc
            )
            result = {"error": str(exc), "actions": []}

        tool_results = list(state.get("tool_results", []))
        tool_results.append({"tool": "get_daily_actions_ranked", "result": result})

        return {
            **state,
            "tool_results": tool_results,
        }

    async def prioritize_actions_node(self, state: AgentState) -> dict:
        """
        Phase 2: Use LLM to review ranked actions from Core API, add reasoning
        for the top 5, and call build_action_list to produce the widget.
        """
        llm = _make_llm(_WIDGET_TOOLS)

        system_prompt = self.build_system_prompt(state)

        # Summarise tool results for the LLM
        tool_summary = "\n".join(
            f"Tool: {r['tool']}\nResult: {json.dumps(r['result'], indent=2)}"
            for r in state.get("tool_results", [])
        )

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": state.get("message", "What should I do today?")},
            {
                "role": "assistant",
                "content": (
                    f"I retrieved today's ranked actions from the system:\n\n"
                    f"{tool_summary}\n\n"
                    "Let me review these, identify the top 5 priority actions with "
                    "clear reasoning, and build the action list widget."
                ),
            },
        ]

        response = await llm.ainvoke(messages)

        widgets: list[dict[str, Any]] = list(state.get("widgets", []))
        widget_tool_map = {t.name: t for t in _WIDGET_TOOLS}

        if hasattr(response, "tool_calls") and response.tool_calls:
            for tool_call in response.tool_calls:
                widget_tool = widget_tool_map.get(tool_call["name"])
                if widget_tool:
                    try:
                        widget_result = widget_tool.invoke(tool_call["args"])
                        if isinstance(widget_result, str):
                            try:
                                widgets.append(json.loads(widget_result))
                            except json.JSONDecodeError:
                                logger.warning(
                                    "prioritize_actions_node: could not parse widget JSON"
                                )
                        elif isinstance(widget_result, dict):
                            widgets.append(widget_result)
                    except Exception as exc:
                        logger.error(
                            "prioritize_actions_node widget build error [tool=%s, error=%s]",
                            tool_call["name"],
                            exc,
                        )

        # If LLM didn't call the tool, build a fallback widget from the raw data
        if not widgets:
            raw_actions = []
            for tr in state.get("tool_results", []):
                if tr.get("tool") == "get_daily_actions_ranked":
                    raw_actions = tr.get("result", {}).get("actions", [])
                    break

            top_5 = raw_actions[:5]
            if top_5:
                fallback_items = [
                    {
                        "client_name": a.get("client_name", "Unknown"),
                        "action": a.get("action", "Follow up"),
                        "priority": a.get("urgency", "high").lower(),
                        "reason": a.get("reasoning", a.get("reason", "")),
                    }
                    for a in top_5
                ]
                fallback_widget = build_action_list.invoke(
                    {
                        "actions": json.dumps(fallback_items),
                        "title": "Today's Priority Actions",
                    }
                )
                if isinstance(fallback_widget, dict):
                    widgets.append(fallback_widget)

        response_text = (
            response.content
            if hasattr(response, "content") and response.content
            else str(response)
        )

        return {
            **state,
            "response": response_text,
            "widgets": widgets,
            "messages": list(state.get("messages", [])) + [response],
        }
