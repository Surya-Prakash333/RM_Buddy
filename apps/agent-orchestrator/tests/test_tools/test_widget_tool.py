"""
test_widget_tool.py — Unit tests for the widget builder tool layer.

All tools are pure synchronous functions with no I/O, so no mocking of
external dependencies is required.

Coverage:
    build_metric_card    — correct widget_type, value and trend forwarding.
    build_client_table   — column structure, row mapping, invalid JSON input.
    build_alert_card     — severity colour mapping, title formatting.
    build_briefing_panel — section count, invalid JSON input.
    build_action_list    — action count, invalid JSON input.
"""

from __future__ import annotations

import sys
import os
import json

import pytest

# ---------------------------------------------------------------------------
# Path setup
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "src"))

from tools.widget_tool import (
    build_action_list,
    build_alert_card,
    build_briefing_panel,
    build_client_table,
    build_metric_card,
)


# ---------------------------------------------------------------------------
# build_metric_card
# ---------------------------------------------------------------------------


def test_build_metric_card_has_correct_widget_type() -> None:
    result = build_metric_card.invoke(
        {"title": "Total AUM", "value": "₹125 Cr"}
    )
    assert result["widget_type"] == "metric_card"


def test_build_metric_card_sets_title_and_value() -> None:
    result = build_metric_card.invoke(
        {"title": "Active Alerts", "value": "7"}
    )
    assert result["title"] == "Active Alerts"
    assert result["data"]["value"] == "7"


def test_build_metric_card_includes_trend() -> None:
    result = build_metric_card.invoke(
        {"title": "Revenue", "value": "₹12 L", "trend": "up"}
    )
    assert result["data"]["trend"] == "up"


def test_build_metric_card_defaults_subtitle_and_trend_to_empty() -> None:
    result = build_metric_card.invoke({"title": "Clients", "value": "42"})
    assert result["data"]["subtitle"] == ""
    assert result["data"]["trend"] == ""


# ---------------------------------------------------------------------------
# build_client_table
# ---------------------------------------------------------------------------


def test_build_client_table_has_correct_widget_type() -> None:
    clients = json.dumps(
        [{"name": "Ravi Kumar", "tier": "Platinum", "aum": "₹42 Cr", "last_interaction": "3 days ago"}]
    )
    result = build_client_table.invoke({"clients": clients})
    assert result["widget_type"] == "table"


def test_build_client_table_includes_rows_and_columns() -> None:
    clients = json.dumps([
        {"name": "Ravi Kumar", "tier": "Platinum", "aum": "₹42 Cr", "last_interaction": "Today"},
        {"name": "Sunita Rao", "tier": "Gold", "aum": "₹18 Cr", "last_interaction": "Yesterday"},
    ])
    result = build_client_table.invoke({"clients": clients, "title": "Top Clients"})
    assert result["title"] == "Top Clients"
    assert result["data"]["row_count"] == 2
    assert len(result["data"]["columns"]) == 4  # name, tier, aum, last_interaction


def test_build_client_table_invalid_json_returns_error_widget() -> None:
    result = build_client_table.invoke({"clients": "not-json{{"})
    # Should degrade gracefully — no exception raised
    assert result["widget_type"] == "text"
    assert "error" in result["title"].lower()


# ---------------------------------------------------------------------------
# build_alert_card
# ---------------------------------------------------------------------------


def test_build_alert_card_has_correct_widget_type() -> None:
    result = build_alert_card.invoke({
        "alert_type": "birthday",
        "client_name": "Ravi Kumar",
        "message": "Birthday tomorrow",
        "severity": "medium",
    })
    assert result["widget_type"] == "alert_card"


def test_build_alert_card_maps_critical_severity_to_red() -> None:
    result = build_alert_card.invoke({
        "alert_type": "large_redemption",
        "client_name": "Arjun Mehta",
        "message": "Large redemption of ₹5 Cr",
        "severity": "critical",
    })
    assert result["data"]["colour"] == "red"


def test_build_alert_card_maps_high_severity_to_orange() -> None:
    result = build_alert_card.invoke({
        "alert_type": "idle_cash",
        "client_name": "Sunita Rao",
        "message": "Idle cash of ₹2 Cr",
        "severity": "high",
    })
    assert result["data"]["colour"] == "orange"


def test_build_alert_card_unknown_severity_defaults_to_blue() -> None:
    result = build_alert_card.invoke({
        "alert_type": "unknown",
        "client_name": "Test Client",
        "message": "Unknown alert",
        "severity": "info",
    })
    assert result["data"]["colour"] == "blue"


def test_build_alert_card_forwards_action_suggestion() -> None:
    result = build_alert_card.invoke({
        "alert_type": "maturity",
        "client_name": "Ravi Kumar",
        "message": "FD matures in 7 days",
        "severity": "high",
        "action_suggestion": "Call client to discuss reinvestment options",
    })
    assert result["data"]["action_suggestion"] == "Call client to discuss reinvestment options"


def test_build_alert_card_formats_title_from_type_and_client() -> None:
    result = build_alert_card.invoke({
        "alert_type": "idle_cash",
        "client_name": "Ravi Kumar",
        "message": "Cash sitting idle",
        "severity": "medium",
    })
    assert "Ravi Kumar" in result["title"]
    assert "Idle Cash" in result["title"]  # snake_case converted to Title Case


# ---------------------------------------------------------------------------
# build_briefing_panel
# ---------------------------------------------------------------------------


def test_build_briefing_panel_has_correct_widget_type() -> None:
    sections = json.dumps([
        {"title": "Alerts", "items": [{"text": "3 pending alerts", "priority": "high"}]}
    ])
    result = build_briefing_panel.invoke({"sections": sections})
    assert result["widget_type"] == "briefing_panel"


def test_build_briefing_panel_section_count_matches_input() -> None:
    sections = json.dumps([
        {"title": "Alerts", "items": []},
        {"title": "Meetings", "items": []},
        {"title": "Cross-sell", "items": []},
    ])
    result = build_briefing_panel.invoke({"sections": sections})
    assert result["data"]["section_count"] == 3


def test_build_briefing_panel_invalid_json_returns_error_widget() -> None:
    result = build_briefing_panel.invoke({"sections": "not-json{{"})
    assert result["widget_type"] == "text"
    assert "error" in result["title"].lower()


# ---------------------------------------------------------------------------
# build_action_list
# ---------------------------------------------------------------------------


def test_build_action_list_has_correct_widget_type() -> None:
    actions = json.dumps([
        {"client_name": "Ravi Kumar", "action": "Call", "priority": "high", "reason": "SIP renewal"}
    ])
    result = build_action_list.invoke({"actions": actions})
    assert result["widget_type"] == "action_card"


def test_build_action_list_action_count_matches_input() -> None:
    actions = json.dumps([
        {"client_name": "Ravi", "action": "Call", "priority": "high", "reason": "FD maturity"},
        {"client_name": "Sunita", "action": "Email", "priority": "medium", "reason": "Portfolio review"},
    ])
    result = build_action_list.invoke({"actions": actions, "title": "My Actions"})
    assert result["data"]["action_count"] == 2
    assert result["title"] == "My Actions"


def test_build_action_list_default_title() -> None:
    actions = json.dumps([])
    result = build_action_list.invoke({"actions": actions})
    assert result["title"] == "Today's Actions"


def test_build_action_list_invalid_json_returns_error_widget() -> None:
    result = build_action_list.invoke({"actions": "not-json{{"})
    assert result["widget_type"] == "text"
    assert "error" in result["title"].lower()
