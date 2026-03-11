"""Portfolio specialist — client queries, holdings, allocation drift, AUM."""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from config.settings import settings
from graphs.state import AgentState
from prompts.specialist_prompts import PORTFOLIO_AGENT_PROMPT
from tools.crm_tool import get_client_list, get_client_profile, get_client_portfolio
from tools.search_tool import search_clients_by_name

logger = logging.getLogger(__name__)


def _make_agent():
    llm = ChatOpenAI(
        base_url=f"{settings.litellm_url}/v1",
        api_key=settings.litellm_master_key,
        model=settings.llm_smart_model,
    )
    return create_react_agent(
        llm,
        tools=[
            get_client_list, get_client_profile, get_client_portfolio,
            search_clients_by_name,
        ],
        prompt=PORTFOLIO_AGENT_PROMPT,
    )


def _extract_widgets_from_tool_results(messages: list) -> list[dict[str, Any]]:
    """Build widgets programmatically from CRM tool call results.

    Instead of relying on the LLM to call widget tools, we inspect
    the ToolMessage results from CRM tools and auto-generate widgets.
    """
    widgets: list[dict[str, Any]] = []

    for msg in messages:
        if not isinstance(msg, ToolMessage):
            continue

        # Parse tool result content
        content = msg.content
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except (json.JSONDecodeError, TypeError):
                continue
        if not isinstance(content, dict):
            continue

        # Auto-generate client table widget from get_client_list results
        if "clients" in content and isinstance(content["clients"], list) and content["clients"]:
            clients = content["clients"]
            rows = []
            for c in clients:
                rows.append({
                    "client_name": c.get("client_name", ""),
                    "tier": c.get("tier", ""),
                    "aum": c.get("aum", c.get("total_aum", "")),
                    "last_interaction": c.get("last_interaction", "N/A"),
                    "client_id": c.get("client_id", ""),
                    "city": c.get("city", ""),
                })
            widgets.append({
                "widget_type": "table",
                "title": f"Clients ({len(rows)})",
                "data": {
                    "columns": [
                        {"key": "client_name", "label": "Client Name"},
                        {"key": "tier", "label": "Tier"},
                        {"key": "aum", "label": "AUM"},
                        {"key": "last_interaction", "label": "Last Contact"},
                        {"key": "city", "label": "City"},
                    ],
                    "rows": rows,
                    "row_count": len(rows),
                },
            })

        # Auto-generate metric card from dashboard summary or total counts
        if "total" in content and isinstance(content["total"], (int, float)):
            total = content["total"]
            if total > 0 and "clients" in content:
                widgets.append({
                    "widget_type": "metric_card",
                    "title": "Total Clients",
                    "data": {
                        "value": str(total),
                        "subtitle": "matching your query",
                        "trend": "",
                    },
                })

    return widgets


async def run_portfolio_agent(state: AgentState) -> dict[str, Any]:
    agent = _make_agent()
    result = await agent.ainvoke({"messages": state["messages"]})
    messages = result.get("messages", [])
    text = messages[-1].content if messages else ""

    # Programmatically build widgets from tool results
    widgets = _extract_widgets_from_tool_results(messages)

    logger.info(
        "Portfolio agent completed [text_len=%d, widgets=%d]",
        len(text) if text else 0,
        len(widgets),
    )
    return {"specialist_results": {"portfolio": text}, "widgets": widgets}
