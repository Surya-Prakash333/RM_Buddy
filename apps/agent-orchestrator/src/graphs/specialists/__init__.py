"""Specialist agent registry — maps agent names to run functions."""

from .alert_agent import run_alert_agent
from .portfolio_agent import run_portfolio_agent
from .revenue_agent import run_revenue_agent
from .engagement_agent import run_engagement_agent
from .scoring_agent import run_scoring_agent
from .document_agent import run_document_agent

SPECIALIST_REGISTRY = {
    "alert": run_alert_agent,
    "portfolio": run_portfolio_agent,
    "revenue": run_revenue_agent,
    "engagement": run_engagement_agent,
    "scoring": run_scoring_agent,
    "document": run_document_agent,
}
