"""
types.py — Enumerations and type aliases shared across the agent orchestrator.

All enums inherit from (str, Enum) so they serialise cleanly to/from JSON
strings without requiring an extra .value call in Pydantic models.
"""

from __future__ import annotations

from enum import Enum


class Intent(str, Enum):
    """Unified 4-category intent taxonomy for the supervisor graph."""
    QA = "qa"
    ACTION = "action"
    PROACTIVE = "proactive"
    WIDGET = "widget"
    UNKNOWN = "unknown"


class FactCategory(str, Enum):
    """Categories for long-term memory facts extracted post-conversation."""
    PREFERENCE = "preference"
    CLIENT_NOTE = "client_note"
    DECISION = "decision"
    PATTERN = "pattern"
    RELATIONSHIP = "relationship"


class IntentType(str, Enum):
    """DEPRECATED: Use Intent enum instead. Kept for backward compat during migration."""

    VIEW_ALERTS = "view_alerts"
    MORNING_BRIEFING = "morning_briefing"
    CLIENT_QUERY = "client_query"
    PORTFOLIO_ANALYSIS = "portfolio_analysis"
    SCHEDULE_ACTION = "schedule_action"
    GENERAL_QA = "general_qa"
    UNKNOWN = "unknown"


class AgentRole(str, Enum):
    """User roles that determine which agent persona and data scope applies."""

    RM = "RM"       # Relationship Manager — sees own clients only
    BM = "BM"       # Branch Manager — sees entire branch
    ADMIN = "ADMIN" # System admin — unrestricted


class WidgetType(str, Enum):
    """
    Dashboard widget types rendered by the frontend.

    Each value maps to a React component on the Next.js dashboard.
    """

    METRIC_CARD = "metric_card"       # Single KPI number with optional trend
    TABLE = "table"                   # Tabular data with sortable columns
    BAR_CHART = "bar_chart"           # Comparative bar chart
    PIE_CHART = "pie_chart"           # Portfolio allocation / category splits
    ALERT_CARD = "alert_card"         # Single actionable alert
    ACTION_CARD = "action_card"       # CTA card with buttons
    BRIEFING_PANEL = "briefing_panel" # Rich morning-briefing panel
    CLIENT_SUMMARY = "client_summary" # Compact client profile card
    MEETING_LIST = "meeting_list"     # Upcoming meetings / tasks list
    TEXT = "text"                     # Plain markdown text block
