"""Alert specialist — retrieves and summarizes portfolio anomalies and alerts."""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.messages import ToolMessage
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from config.settings import settings
from graphs.state import AgentState
from prompts.specialist_prompts import ALERT_AGENT_PROMPT
from tools.crm_tool import get_alerts

logger = logging.getLogger(__name__)

_SEVERITY_COLOURS: dict[str, str] = {
    "critical": "red",
    "high": "orange",
    "medium": "yellow",
    "low": "blue",
}


def _make_agent():
    llm = ChatOpenAI(
        base_url=f"{settings.litellm_url}/v1",
        api_key=settings.litellm_master_key,
        model=settings.llm_fast_model,
    )
    return create_react_agent(llm, tools=[get_alerts], prompt=ALERT_AGENT_PROMPT)


def _extract_alert_widgets(messages: list) -> list[dict[str, Any]]:
    """Build alert_card widgets programmatically from get_alerts tool results."""
    widgets: list[dict[str, Any]] = []

    for msg in messages:
        if not isinstance(msg, ToolMessage):
            continue

        content = msg.content
        if isinstance(content, str):
            try:
                content = json.loads(content)
            except (json.JSONDecodeError, TypeError):
                continue
        if not isinstance(content, dict):
            continue

        if "alerts" in content and isinstance(content["alerts"], list):
            for alert in content["alerts"]:
                severity = str(alert.get("severity", alert.get("priority", "medium"))).lower()
                colour = _SEVERITY_COLOURS.get(severity, "blue")
                alert_type = alert.get("alert_type", alert.get("type", "alert"))
                client_name = alert.get("client_name", "Unknown")
                message = alert.get("message", alert.get("description", ""))

                widgets.append({
                    "widget_type": "alert_card",
                    "title": f"{str(alert_type).replace('_', ' ').title()} — {client_name}",
                    "data": {
                        "alert_type": alert_type,
                        "client_name": client_name,
                        "message": message,
                        "severity": severity,
                        "colour": colour,
                        "action_suggestion": alert.get("action_suggestion", ""),
                    },
                })

    return widgets


async def run_alert_agent(state: AgentState) -> dict[str, Any]:
    """Run alert specialist and return result text."""
    agent = _make_agent()
    result = await agent.ainvoke({"messages": state["messages"]})
    messages = result.get("messages", [])
    text = messages[-1].content if messages else ""

    widgets = _extract_alert_widgets(messages)

    logger.info(
        "Alert agent completed [text_len=%d, widgets=%d]",
        len(text) if text else 0,
        len(widgets),
    )
    return {"specialist_results": {"alert": text}, "widgets": widgets}
