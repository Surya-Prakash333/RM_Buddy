"""
tools/__init__.py — Public exports for the LangChain tool interface layer.

All tools are LangChain-compatible (@tool decorated or StructuredTool) and
are called by specialist agents within the LangGraph graph.

Tool groups:
    crm_tool     — Core API calls: clients, portfolio, alerts, dashboard.
    cache_tool   — Redis working memory: get/set cached data and session memory.
    search_tool  — Client search: by name, AUM range, cross-sell opportunities.
    widget_tool  — Widget builders: construct WidgetPayload dicts for the frontend.

Context injection (must be called before agent tool invocation):
    set_rm_context()   — sets the X-RM-Identity header for crm_tool / search_tool.
    set_redis_client() — injects the shared Redis client for cache_tool.
"""

from __future__ import annotations

# CRM tools
from tools.crm_tool import (
    get_alerts,
    get_client_list,
    get_client_portfolio,
    get_client_profile,
    get_dashboard_summary,
    set_rm_context,
)

# Cache tools
from tools.cache_tool import (
    get_cached_data,
    get_working_memory,
    set_cached_data,
    set_redis_client,
    update_working_memory,
)

# Search tools
from tools.search_tool import (
    find_client_by_amount,
    get_cross_sell_opportunities,
    search_clients_by_name,
)

# Widget builder tools
from tools.widget_tool import (
    build_action_list,
    build_alert_card,
    build_briefing_panel,
    build_client_table,
    build_metric_card,
)

__all__ = [
    # crm_tool
    "set_rm_context",
    "get_client_list",
    "get_client_profile",
    "get_client_portfolio",
    "get_alerts",
    "get_dashboard_summary",
    # cache_tool
    "set_redis_client",
    "get_cached_data",
    "set_cached_data",
    "get_working_memory",
    "update_working_memory",
    # search_tool
    "search_clients_by_name",
    "find_client_by_amount",
    "get_cross_sell_opportunities",
    # widget_tool
    "build_metric_card",
    "build_client_table",
    "build_alert_card",
    "build_briefing_panel",
    "build_action_list",
]
