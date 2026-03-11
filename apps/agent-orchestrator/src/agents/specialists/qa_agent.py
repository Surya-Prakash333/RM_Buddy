"""
qa_agent.py — Q&A Specialist Agent for RM Buddy.

Handles natural language questions about the RM's book of business:
    - "How many Diamond clients do I have?"
    - "Show me clients with AUM above 1 crore"
    - "What is my total AUM?"
    - "Tell me about Rajesh Mehta"
    - "Show pending alerts"

Follows the two-phase approach:
    1. fetch_data_node   — LLM + CRM/search tools to retrieve real data
    2. format_response_node — LLM + widget tools to compose the final answer

The graph is intentionally linear (fetch → format → END) to keep latency
under the <3 s acceptance criterion.
"""

from __future__ import annotations

import json
import logging
import os
from config.settings import settings
from typing import Any

from langchain_core.tools import BaseTool
from langgraph.graph import StateGraph, END

from agents.base_agent import BaseAgent
from graphs.state import AgentState
from tools.crm_tool import (
    get_client_list,
    get_client_profile,
    get_client_portfolio,
    get_alerts,
)
from tools.search_tool import search_clients_by_name
from tools.widget_tool import build_metric_card, build_client_table, build_alert_card

logger = logging.getLogger("agent.qa_agent")

# All tools available during the data-fetch phase
_DATA_TOOLS: list[BaseTool] = [
    get_client_list,
    get_client_profile,
    get_client_portfolio,
    get_alerts,
    search_clients_by_name,
]

# Widget-building tools available during the format phase
_WIDGET_TOOLS: list[BaseTool] = [
    build_metric_card,
    build_client_table,
    build_alert_card,
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


class QAAgent(BaseAgent):
    """
    Q&A specialist: answers client count, filter, and portfolio value queries.

    Extends BaseAgent with:
        get_specialist_prompt() — Q&A persona and output rules
        process()               — orchestrates the two-node LangGraph

    Constructor follows BaseAgent's signature:
        agent_id   — fixed to 'qa_agent'
        llm_client — optional; created lazily inside nodes if None
        tools      — pre-populated with all Q&A tools
    """

    def __init__(
        self,
        rm_id: str,
        llm_client: Any = None,
        tools: list[Any] | None = None,
    ) -> None:
        super().__init__(
            agent_id="qa_agent",
            llm_client=llm_client,
            tools=tools if tools is not None else _DATA_TOOLS + _WIDGET_TOOLS,
        )
        self.rm_id = rm_id

    # ------------------------------------------------------------------
    # BaseAgent abstract methods
    # ------------------------------------------------------------------

    def get_specialist_prompt(self) -> str:
        """Return the Q&A specialist instructions appended to the RM identity block."""
        return (
            "You are Aria, an AI assistant specialised in answering questions about "
            "the RM's clients, portfolio, and business data.\n\n"
            "Rules:\n"
            "1. ALWAYS use the provided tools to fetch real data — never fabricate numbers.\n"
            "2. Format all financial amounts in Indian notation: ₹1.5 Cr, ₹25 L, ₹50K.\n"
            "3. After fetching data, ALWAYS build a widget using build_metric_card (for "
            "counts/totals) or build_client_table (for lists) or build_alert_card (for alerts).\n"
            "4. Be concise — answer the question directly without unnecessary preamble.\n"
            "5. If asked about topics outside wealth management, politely decline."
        )

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

    def get_tools(self) -> list[BaseTool]:
        """Return all tools registered on this agent (data + widget tools)."""
        return _DATA_TOOLS + _WIDGET_TOOLS

    def create_graph(self) -> StateGraph:
        """Build the two-node LangGraph: fetch_data → format_response → END."""
        graph = StateGraph(AgentState)
        graph.add_node("fetch_data", self.fetch_data_node)
        graph.add_node("format_response", self.format_response_node)
        graph.set_entry_point("fetch_data")
        graph.add_edge("fetch_data", "format_response")
        graph.add_edge("format_response", END)
        return graph

    # ------------------------------------------------------------------
    # Graph nodes
    # ------------------------------------------------------------------

    async def fetch_data_node(self, state: AgentState) -> AgentState:
        """
        Phase 1: use the LLM + CRM/search tools to retrieve data relevant to
        the user's question.  Tool call results are stored in state['tool_results'].
        """
        llm = _make_llm(_DATA_TOOLS)

        rm_identity = state.get("rm_context") or {}
        system_prompt = self.build_system_prompt(
            rm_identity=rm_identity,
            client_context=state.get("client_context"),
        )

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": state["message"]},
        ]

        response = await llm.ainvoke(messages)

        tool_results: list[dict[str, Any]] = []
        if hasattr(response, "tool_calls") and response.tool_calls:
            tool_map = {t.name: t for t in _DATA_TOOLS}
            for tool_call in response.tool_calls:
                tool = tool_map.get(tool_call["name"])
                if tool:
                    try:
                        result = await tool.ainvoke(tool_call["args"])
                    except TypeError:
                        # Fall back to sync invoke for sync tools
                        result = tool.invoke(tool_call["args"])
                    tool_results.append(
                        {"tool": tool_call["name"], "result": result}
                    )
                    logger.debug(
                        "fetch_data_node tool executed [tool=%s]", tool_call["name"]
                    )

        return {
            **state,
            "tool_results": tool_results,
            "messages": list(state.get("messages", [])) + [response],
        }

    async def format_response_node(self, state: AgentState) -> AgentState:
        """
        Phase 2: format the raw tool results into a human-readable prose
        response and build the appropriate dashboard widget.
        """
        llm = _make_llm(_WIDGET_TOOLS)

        rm_identity = state.get("rm_context") or {}
        system_prompt = self.build_system_prompt(
            rm_identity=rm_identity,
            client_context=state.get("client_context"),
        )

        tool_summary = "\n".join(
            f"Tool: {r['tool']}\nResult: {r['result']}"
            for r in state.get("tool_results", [])
        )

        messages: list[dict[str, Any]] = [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": state["message"]},
            {
                "role": "assistant",
                "content": (
                    f"I found the following data:\n{tool_summary}\n\n"
                    "Now I'll format this as a response and build the appropriate widget."
                ),
            },
        ]

        response = await llm.ainvoke(messages)

        widgets: list[dict[str, Any]] = list(state.get("widgets", []))
        if hasattr(response, "tool_calls") and response.tool_calls:
            widget_tool_map = {t.name: t for t in _WIDGET_TOOLS}
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
                                    "format_response_node: could not parse widget JSON"
                                )
                        elif isinstance(widget_result, dict):
                            widgets.append(widget_result)
                    except Exception as exc:
                        logger.error(
                            "format_response_node widget build error [tool=%s, error=%s]",
                            tool_call["name"],
                            exc,
                        )

        # Use content if present; otherwise synthesise from widget data
        if hasattr(response, "content") and response.content:
            response_text = response.content
        elif widgets:
            w = widgets[0]
            val = w.get("data", {}).get("value", "")
            title = w.get("title", "")
            response_text = f"{title}: {val}" if val else title
        else:
            response_text = "Here is the data you requested." if state.get("tool_results") else "No data found."

        return {
            **state,
            "response": response_text,
            "widgets": widgets,
            "messages": list(state.get("messages", [])) + [response],
        }
