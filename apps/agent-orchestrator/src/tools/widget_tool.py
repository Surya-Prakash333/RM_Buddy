"""
widget_tool.py — LangChain tools for building structured frontend widget payloads.

These are synchronous pure-function tools (no I/O) that construct
WidgetPayload-compatible dicts.  The frontend maps widget_type strings to
React components on the dashboard.

Widget types produced here correspond to the WidgetType enum in models/types.py:
    metric_card     — Single KPI with optional trend indicator.
    table           — Tabular client data with column headers.
    alert_card      — Actionable alert with severity colour coding.
    briefing_panel  — Rich morning-briefing panel with sections.
    action_card     — Prioritised action list with client context.

Design notes:
    - All tools are synchronous (no async/await) — no I/O involved.
    - Data fields that accept lists are passed as JSON strings to satisfy
      LangChain's requirement that @tool arguments be simple scalar types or
      Pydantic-serialisable values.
    - JSON parse errors in list arguments return a graceful error widget
      rather than raising an exception, keeping the agent pipeline running.
    - All returned dicts match the WidgetPayload schema exactly:
          {widget_type, title, data, actions?}
"""

from __future__ import annotations

import json
import logging
from typing import Any

from langchain_core.tools import tool

logger = logging.getLogger(__name__)

# Severity → CSS colour token mapping consumed by the frontend
_SEVERITY_COLOURS: dict[str, str] = {
    "critical": "red",
    "high": "orange",
    "medium": "yellow",
    "low": "blue",
}


# ---------------------------------------------------------------------------
# Tools
# ---------------------------------------------------------------------------


@tool
def build_metric_card(
    title: str,
    value: str,
    subtitle: str = "",
    trend: str = "",
) -> dict[str, Any]:
    """Build a metric card widget for displaying a single KPI.

    Args:
        title: Card title (e.g., 'Total AUM').
        value: Main display value (e.g., '₹125 Cr').
        subtitle: Optional supporting text below the value (e.g., 'as of today').
        trend: Optional trend indicator — 'up', 'down', or 'flat'.

    Returns:
        WidgetPayload dict with widget_type='metric_card'.
    """
    payload: dict[str, Any] = {
        "widget_type": "metric_card",
        "title": title,
        "data": {
            "value": value,
            "subtitle": subtitle,
            "trend": trend,
        },
    }
    logger.debug("build_metric_card [title=%s, value=%s, trend=%s]", title, value, trend)
    return payload


@tool
def build_client_table(clients: str, title: str = "Clients") -> dict[str, Any]:
    """Build a client table widget from a list of clients.

    Args:
        clients: JSON string of client list.  Each entry should contain:
                 name (str), tier (str), aum (str), last_interaction (str).
                 Example: '[{"name":"Ravi Kumar","tier":"Platinum","aum":"₹42 Cr","last_interaction":"3 days ago"}]'
        title: Table title shown as the widget header.

    Returns:
        WidgetPayload dict with widget_type='table', or an error widget
        if the clients JSON cannot be parsed.
    """
    try:
        rows: list[dict[str, Any]] = json.loads(clients)
    except json.JSONDecodeError as exc:
        logger.error("build_client_table JSON parse error [error=%s]", exc)
        return {
            "widget_type": "text",
            "title": "Error",
            "data": {"text": f"Could not build client table: invalid data ({exc})"},
        }

    columns = [
        {"key": "name", "label": "Client Name"},
        {"key": "tier", "label": "Tier"},
        {"key": "aum", "label": "AUM"},
        {"key": "last_interaction", "label": "Last Contact"},
    ]

    payload: dict[str, Any] = {
        "widget_type": "table",
        "title": title,
        "data": {
            "columns": columns,
            "rows": rows,
            "row_count": len(rows),
        },
    }
    logger.debug("build_client_table [title=%s, row_count=%s]", title, len(rows))
    return payload


@tool
def build_alert_card(
    alert_type: str,
    client_name: str,
    message: str,
    severity: str,
    action_suggestion: str = "",
) -> dict[str, Any]:
    """Build an alert card widget for a single actionable alert.

    Args:
        alert_type: Type of alert — e.g., 'birthday', 'idle_cash', 'maturity',
                    'sip_stop', 'large_redemption'.
        client_name: Display name of the client the alert concerns.
        message: Human-readable alert message.
        severity: Alert severity — 'critical', 'high', 'medium', or 'low'.
        action_suggestion: Optional recommended action for the RM to take.

    Returns:
        WidgetPayload dict with widget_type='alert_card'.
    """
    colour = _SEVERITY_COLOURS.get(severity.lower(), "blue")

    payload: dict[str, Any] = {
        "widget_type": "alert_card",
        "title": f"{alert_type.replace('_', ' ').title()} — {client_name}",
        "data": {
            "alert_type": alert_type,
            "client_name": client_name,
            "message": message,
            "severity": severity,
            "colour": colour,
            "action_suggestion": action_suggestion,
        },
    }
    logger.debug(
        "build_alert_card [alert_type=%s, client=%s, severity=%s]",
        alert_type,
        client_name,
        severity,
    )
    return payload


@tool
def build_briefing_panel(sections: str) -> dict[str, Any]:
    """Build a morning briefing panel widget with multiple content sections.

    Args:
        sections: JSON string of briefing sections.  Each section has the form:
                  {"title": str, "items": [{"text": str, "priority": "high"|"medium"|"low"}]}
                  Example:
                  '[{"title":"Today\\'s Alerts","items":[{"text":"Ravi birthday","priority":"high"}]}]'

    Returns:
        WidgetPayload dict with widget_type='briefing_panel', or an error
        widget if the sections JSON cannot be parsed.
    """
    try:
        section_list: list[dict[str, Any]] = json.loads(sections)
    except json.JSONDecodeError as exc:
        logger.error("build_briefing_panel JSON parse error [error=%s]", exc)
        return {
            "widget_type": "text",
            "title": "Error",
            "data": {"text": f"Could not build briefing panel: invalid data ({exc})"},
        }

    payload: dict[str, Any] = {
        "widget_type": "briefing_panel",
        "title": "Morning Briefing",
        "data": {
            "sections": section_list,
            "section_count": len(section_list),
        },
    }
    logger.debug(
        "build_briefing_panel [section_count=%s]", len(section_list)
    )
    return payload


@tool
def build_action_list(
    actions: str, title: str = "Today's Actions"
) -> dict[str, Any]:
    """Build an action list widget with prioritised RM actions.

    Args:
        actions: JSON string of action items.  Each item should contain:
                 client_name (str), action (str), priority ('high'|'medium'|'low'),
                 reason (str).
                 Example:
                 '[{"client_name":"Sunita Rao","action":"Follow up on SIP renewal","priority":"high","reason":"SIP stops next week"}]'
        title: Widget header title.

    Returns:
        WidgetPayload dict with widget_type='action_card', or an error
        widget if the actions JSON cannot be parsed.
    """
    try:
        action_list: list[dict[str, Any]] = json.loads(actions)
    except json.JSONDecodeError as exc:
        logger.error("build_action_list JSON parse error [error=%s]", exc)
        return {
            "widget_type": "text",
            "title": "Error",
            "data": {"text": f"Could not build action list: invalid data ({exc})"},
        }

    payload: dict[str, Any] = {
        "widget_type": "action_card",
        "title": title,
        "data": {
            "actions": action_list,
            "action_count": len(action_list),
        },
    }
    logger.debug(
        "build_action_list [title=%s, action_count=%s]", title, len(action_list)
    )
    return payload
