"""
alert_agent.py — Unified specialist agent for all 16 alert types.

Receives an alert dict from orchestrator context, generates a type-specific
recommendation using LLM, returns the recommendation text + AlertCard widget.
"""

from __future__ import annotations

import json
import logging
import os
from typing import Any

from agents.base_agent import BaseAgent
from graphs.state import AgentState

logger = logging.getLogger("agent.alert_agent")

# ---------------------------------------------------------------------------
# Type-specific prompt templates
# ---------------------------------------------------------------------------

ALERT_PROMPTS: dict[str, str] = {
    "IDLE_CASH": (
        "Client {client_name} ({client_tier}) has {amount} sitting idle in cash "
        "for over {days} days. As Aria, explain why this is a missed opportunity and "
        "suggest 2-3 suitable investment options based on a typical {client_tier} risk "
        "profile. Keep it concise and actionable for the RM. Max 100 words."
    ),
    "MATURITY_PROCEEDS": (
        "{client_name}'s investment of {amount} matures in {days} days. "
        "As Aria, help the RM prepare a reinvestment conversation — suggest suitable "
        "reinvestment options and key talking points for the client meeting. Max 100 words."
    ),
    "CROSS_SELL": (
        "{client_name} ({client_tier}, AUM {aum}) has only {product_count} product types. "
        "As Aria, identify 2-3 suitable cross-sell opportunities and suggest the best "
        "approach for the RM to bring it up naturally. Max 100 words."
    ),
    "HIGH_CASH_ALLOCATION": (
        "{client_name} has {cash_pct}% of their portfolio in cash ({amount}). "
        "As Aria, suggest how the RM can have a productive conversation about deploying "
        "this cash into suitable instruments. Max 100 words."
    ),
    "HIGH_TRADING_FREQ": (
        "{client_name} has made {trade_count} trades this week, above the typical threshold. "
        "As Aria, help the RM understand if this indicates anxiety or over-trading, "
        "and suggest how to have a productive review conversation. Max 80 words."
    ),
    "CONCENTRATION_RISK": (
        "{client_name} has {concentration_pct}% of their portfolio in {instrument_name}. "
        "As Aria, help the RM explain diversification benefits and suggest a gentle "
        "rebalancing conversation approach. Max 100 words."
    ),
    "DORMANT_CLIENT": (
        "{client_name} has had no meaningful interaction in {days} days. "
        "As Aria, suggest re-engagement strategies — what to say, what value to offer, "
        "and the best channel to reach out. Max 100 words."
    ),
    "ENGAGEMENT_DROP": (
        "{client_name}'s engagement has dropped {drop_pct}% in the last 2 weeks. "
        "As Aria, help the RM identify possible reasons (market anxiety, competitor "
        "offers, life events) and suggest a proactive check-in approach. Max 80 words."
    ),
    "REBALANCING_DUE": (
        "{client_name}'s portfolio has drifted {drift_pct}% from target allocation. "
        "As Aria, prepare the RM with a simple explanation of why rebalancing matters "
        "now and what trades would restore the target. Max 100 words."
    ),
    "GOALS_NOT_MET": (
        "{client_name} is at {progress_pct}% of their {goal_horizon}-year investment goal. "
        "As Aria, help the RM have a productive goal review conversation — adjusting "
        "contributions, timeline, or risk appetite — without causing alarm. Max 100 words."
    ),
    "BIRTHDAY": (
        "It is {client_name}'s birthday in {days} days! "
        "As Aria, suggest a warm personal birthday message for the RM to send, "
        "and mention if there is a good reason to combine it with a brief portfolio review. "
        "Max 80 words."
    ),
    "CASHFLOW_REINVEST": (
        "{client_name} has received {amount} in dividends/proceeds sitting idle. "
        "As Aria, suggest how the RM can proactively offer to reinvest these proceeds "
        "and which reinvestment options suit this client's profile. Max 100 words."
    ),
    "PORTFOLIO_DRIFT": (
        "{client_name}'s asset allocation has drifted from target "
        "(current: {current_alloc}, target: {target_alloc}). "
        "As Aria, explain the drift in simple terms and suggest what rebalancing actions "
        "the RM should propose. Max 100 words."
    ),
    "TAX_LOSS_HARVESTING": (
        "{client_name} has unrealized losses of {loss_amount} with {days} days left "
        "in the financial year. As Aria, explain the tax-loss harvesting opportunity "
        "in simple terms and suggest specific holdings for harvesting. Max 100 words."
    ),
    "DIVIDEND_COLLECTION": (
        "{client_name} has a dividend record date approaching for {instrument_name}. "
        "As Aria, brief the RM on this opportunity and whether the client should hold "
        "or sell before record date, based on their tax situation. Max 80 words."
    ),
    "BENEFICIARY_UPDATES": (
        "{client_name} has investments worth {aum} but beneficiary/nomination details "
        "may be outdated. As Aria, help the RM sensitively raise this compliance matter "
        "and explain why updated nominations protect the client's family. Max 100 words."
    ),
}

DEFAULT_PROMPT = (
    "Alert: {alert_type} for client {client_name}. "
    "As Aria, provide a brief actionable recommendation for the RM. Max 80 words."
)


class AlertAgent(BaseAgent):
    """Unified specialist agent for all 16 alert types."""

    def __init__(
        self,
        agent_id: str = "alert_agent",
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
    # BaseAgent interface
    # ------------------------------------------------------------------

    def get_specialist_prompt(self) -> str:
        return (
            "You are Aria, an AI assistant for Relationship Managers at "
            "Nuvama Wealth Management. Give concise, actionable recommendations "
            "in plain English. Use Indian number formatting (₹ Cr/L/K). "
            "Focus on what the RM should DO next."
        )

    async def process(self, state: AgentState) -> dict:
        """Run two-step pipeline: build prompt → call LLM → return widget."""
        # Step 1: extract alert and build prompt
        state_after_analyze = await self._analyze_alert(state)
        # Step 2: generate recommendation
        return await self._generate_recommendation(state_after_analyze)

    # ------------------------------------------------------------------
    # Internal pipeline steps
    # ------------------------------------------------------------------

    async def _analyze_alert(self, state: AgentState) -> AgentState:
        """Extract alert data from state and build the type-specific prompt."""
        context = state.get("context") or {}
        # Support both context.alert (production) and context dict itself (tests)
        alert = context.get("alert") or context.get("client_context", {}).get("alert", {})
        if not alert:
            alert = {}

        alert_type = alert.get("alert_type", "UNKNOWN")
        template = ALERT_PROMPTS.get(alert_type, DEFAULT_PROMPT)

        meta: dict[str, Any] = alert.get("metadata", {})

        def _fmt(key: str, fallback: Any = 0) -> str:
            v = meta.get(key, fallback)
            return _fmt_inr(v) if isinstance(v, (int, float)) else str(v)

        template_vars: dict[str, Any] = {
            "alert_type": alert_type,
            "client_name": alert.get("client_name", "the client"),
            "client_tier": alert.get("client_tier", ""),
            "amount": _fmt_inr(meta.get("amount", meta.get("idle_amount", meta.get("cash_balance", 0)))),
            "aum": _fmt_inr(meta.get("aum", meta.get("total_aum", 0))),
            "days": meta.get("days", meta.get("idle_days", meta.get("days_until_maturity", 0))),
            "product_count": meta.get("product_count", ""),
            "cash_pct": meta.get("cash_pct", meta.get("cash_percentage", 0)),
            "trade_count": meta.get("trade_count", 0),
            "concentration_pct": meta.get("concentration_pct", 0),
            "instrument_name": meta.get("instrument_name", meta.get("holding_name", "")),
            "drop_pct": meta.get("drop_pct", 0),
            "drift_pct": meta.get("drift_pct", 0),
            "progress_pct": meta.get("progress_pct", 0),
            "goal_horizon": meta.get("goal_horizon", ""),
            "loss_amount": _fmt_inr(meta.get("loss_amount", meta.get("total_unrealized_loss", 0))),
            "current_alloc": meta.get("current_allocation", ""),
            "target_alloc": meta.get("target_allocation", "EQ:60/FI:30/CASH:10"),
        }

        try:
            formatted_prompt = template.format(**template_vars)
        except KeyError:
            formatted_prompt = DEFAULT_PROMPT.format(
                alert_type=alert_type,
                client_name=template_vars["client_name"],
            )

        return {
            **state,
            "context": {**context, "_alert_prompt": formatted_prompt, "_alert": alert},
        }

    async def _generate_recommendation(self, state: AgentState) -> dict:
        """Call LLM with the prepared prompt and return response + widget."""
        context = state.get("context") or {}
        alert_prompt = context.get("_alert_prompt", "")
        alert = context.get("_alert", {})

        messages = [
            {"role": "system", "content": self.get_specialist_prompt()},
            {"role": "user", "content": alert_prompt},
        ]

        recommendation: str
        try:
            if self.llm is not None:
                llm = self.llm
            else:
                from langchain_openai import ChatOpenAI

                llm = ChatOpenAI(
                    base_url=os.getenv("LITELLM_URL", "http://localhost:4000") + "/v1",
                    api_key=os.getenv("LITELLM_MASTER_KEY", "sk-dummy"),
                    model="claude-default",
                )
            response = await llm.ainvoke(messages)
            recommendation = (
                response.content if hasattr(response, "content") else str(response)
            )
        except Exception as exc:
            logger.error("AlertAgent LLM error [alert_type=%s, error=%s]", alert.get("alert_type"), exc)
            recommendation = (
                f"Action required: {alert.get('title', 'Review this alert')} "
                f"for {alert.get('client_name', 'client')}."
            )

        widget = self.create_widget(
            widget_type="alert_card",
            title=alert.get("title", "Alert"),
            data={
                "alert_id": alert.get("alert_id", ""),
                "alert_type": alert.get("alert_type", ""),
                "title": alert.get("title", ""),
                "body": alert.get("body", ""),
                "client_name": alert.get("client_name", ""),
                "client_tier": alert.get("client_tier", ""),
                "severity": alert.get("severity", "MEDIUM").lower(),
                "created_at": alert.get("created_at", ""),
                "metadata": alert.get("metadata", {}),
                "status": alert.get("status", "PENDING"),
                "recommendation": recommendation,
            },
        )

        return {
            "response": recommendation,
            "widgets": [widget],
            "tool_results": state.get("tool_results", []),
        }


# ---------------------------------------------------------------------------
# Indian number formatter (standalone, for use without BaseAgent instance)
# ---------------------------------------------------------------------------

def _fmt_inr(amount: Any) -> str:
    """Format a number as Indian currency string."""
    try:
        n = float(amount)
    except (TypeError, ValueError):
        return str(amount)
    if n >= 10_000_000:
        return f"₹{n / 10_000_000:.1f} Cr"
    if n >= 100_000:
        return f"₹{n / 100_000:.1f} L"
    if n >= 1_000:
        return f"₹{n / 1_000:.0f}K"
    return f"₹{n:.0f}"
