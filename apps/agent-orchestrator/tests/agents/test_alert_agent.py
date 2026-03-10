"""Tests for AlertAgent — all 16 alert types."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, MagicMock


@pytest.fixture
def base_state() -> dict:
    return {
        "rm_id": "RM001",
        "rm_role": "RM",
        "session_id": "sess-001",
        "message": "Tell me about this alert",
        "intent": "view_alerts",
        "context": {},
        "tool_results": [],
        "response": None,
        "widgets": [],
        "confidence": 0.9,
        "guardrail_flags": [],
    }


def make_alert(alert_type: str, **meta) -> dict:
    return {
        "alert_id": f"A-{alert_type}",
        "alert_type": alert_type,
        "title": f"Test {alert_type} Alert",
        "body": "Test alert body",
        "client_name": "Priya Sharma",
        "client_tier": "HNI",
        "severity": "HIGH",
        "created_at": "2025-01-01T10:00:00Z",
        "status": "PENDING",
        "metadata": meta,
    }


def _make_mock_llm(content: str = "Recommendation text.") -> MagicMock:
    mock_resp = MagicMock()
    mock_resp.content = content
    llm = MagicMock()
    llm.ainvoke = AsyncMock(return_value=mock_resp)
    return llm


ALERT_TYPES = [
    "IDLE_CASH",
    "MATURITY_PROCEEDS",
    "CROSS_SELL",
    "HIGH_CASH_ALLOCATION",
    "HIGH_TRADING_FREQ",
    "CONCENTRATION_RISK",
    "DORMANT_CLIENT",
    "ENGAGEMENT_DROP",
    "REBALANCING_DUE",
    "GOALS_NOT_MET",
    "BIRTHDAY",
    "CASHFLOW_REINVEST",
    "PORTFOLIO_DRIFT",
    "TAX_LOSS_HARVESTING",
    "DIVIDEND_COLLECTION",
    "BENEFICIARY_UPDATES",
]


@pytest.mark.asyncio
@pytest.mark.parametrize("alert_type", ALERT_TYPES)
async def test_alert_agent_handles_all_types(base_state: dict, alert_type: str) -> None:
    """AlertAgent should handle all 16 alert types without crashing."""
    from agents.specialists.alert_agent import AlertAgent

    agent = AlertAgent(rm_id="RM001", llm_client=_make_mock_llm(f"Recommendation for {alert_type}."))
    state = {
        **base_state,
        "context": {
            "alert": make_alert(
                alert_type,
                amount=500_000,
                days=7,
                aum=2_500_000,
                cash_pct=35,
                trade_count=6,
                concentration_pct=28,
                drop_pct=35,
                drift_pct=12,
                progress_pct=55,
                goal_horizon=5,
                loss_amount=75_000,
                instrument_name="INFY",
                product_count=2,
            )
        },
    }
    result = await agent.process(state)

    assert result["response"] is not None, f"No response for {alert_type}"
    assert len(result["widgets"]) == 1, f"Expected 1 widget for {alert_type}"
    assert result["widgets"][0]["widget_type"] == "alert_card"
    assert result["widgets"][0]["data"]["alert_type"] == alert_type


@pytest.mark.asyncio
async def test_alert_agent_falls_back_on_llm_error(base_state: dict) -> None:
    """AlertAgent returns a fallback response when LLM fails."""
    from agents.specialists.alert_agent import AlertAgent

    mock_llm = MagicMock()
    mock_llm.ainvoke = AsyncMock(side_effect=Exception("LLM unavailable"))

    agent = AlertAgent(rm_id="RM001", llm_client=mock_llm)
    state = {**base_state, "context": {"alert": make_alert("IDLE_CASH", amount=500_000)}}
    result = await agent.process(state)

    assert result["response"] is not None
    assert len(result["widgets"]) == 1


@pytest.mark.asyncio
async def test_alert_agent_empty_context(base_state: dict) -> None:
    """AlertAgent should not crash when context is empty."""
    from agents.specialists.alert_agent import AlertAgent

    agent = AlertAgent(rm_id="RM001", llm_client=_make_mock_llm())
    result = await agent.process(base_state)

    assert result["response"] is not None
    assert len(result["widgets"]) == 1


@pytest.mark.asyncio
async def test_alert_widget_structure(base_state: dict) -> None:
    """AlertCard widget must have all required fields."""
    from agents.specialists.alert_agent import AlertAgent

    agent = AlertAgent(rm_id="RM001", llm_client=_make_mock_llm("Take action immediately."))
    state = {**base_state, "context": {"alert": make_alert("BIRTHDAY", days=3)}}
    result = await agent.process(state)

    widget = result["widgets"][0]
    assert widget["widget_type"] == "alert_card"
    assert widget["title"] == "Test BIRTHDAY Alert"
    data = widget["data"]
    assert data["alert_type"] == "BIRTHDAY"
    assert data["client_name"] == "Priya Sharma"
    assert data["severity"] == "high"  # lowercased
    assert data["recommendation"] == "Take action immediately."


def test_fmt_inr() -> None:
    """_fmt_inr should format numbers in Indian style."""
    from agents.specialists.alert_agent import _fmt_inr

    assert _fmt_inr(15_000_000) == "₹1.5 Cr"
    assert _fmt_inr(250_000) == "₹2.5 L"
    assert _fmt_inr(50_000) == "₹50K"
    assert _fmt_inr(500) == "₹500"
    assert _fmt_inr("invalid") == "invalid"


def test_all_16_alert_types_have_prompts() -> None:
    """ALERT_PROMPTS must cover all 16 specified alert types."""
    from agents.specialists.alert_agent import ALERT_PROMPTS

    assert set(ALERT_PROMPTS.keys()) == set(ALERT_TYPES)
