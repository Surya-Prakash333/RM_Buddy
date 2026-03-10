"""
test_bm_agents.py — Tests for BM specialist agents: DailyReviewAgent and StrengthAgent.

Tests cover:
    - Agent instantiation
    - LangGraph compilation
    - BM persona / coaching tone in system prompts
    - API error handling in fetch nodes
"""

import pytest
from unittest.mock import AsyncMock, patch


# ---------------------------------------------------------------------------
# Shared test state fixture
# ---------------------------------------------------------------------------

BM_STATE = {
    "rm_id": "RM003",
    "rm_role": "BM",
    "rm_context": {"rm_name": "Vikram Nair", "rm_branch": "Mumbai-BKC"},
    "message": "team review",
    "session_id": "s1",
    "intent": "morning_briefing",
    "intent_confidence": 0.9,
    "client_context": None,
    "tool_results": [],
    "response": None,
    "widgets": [],
    "guardrail_flags": [],
    "error": None,
    "messages": [],
    "message_type": "text",
}


# ---------------------------------------------------------------------------
# DailyReviewAgent tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_daily_review_agent_instantiates():
    from agents.specialists.daily_review_agent import DailyReviewAgent

    agent = DailyReviewAgent(rm_id="RM003")
    assert agent is not None


@pytest.mark.asyncio
async def test_daily_review_graph_compiles():
    from agents.specialists.daily_review_agent import DailyReviewAgent

    compiled = DailyReviewAgent(rm_id="RM003").create_graph().compile()
    assert compiled is not None


def test_daily_review_prompt_is_bm_persona():
    from agents.specialists.daily_review_agent import DailyReviewAgent

    agent = DailyReviewAgent(rm_id="RM003")
    state = {**BM_STATE}
    prompt = agent.build_system_prompt(state)
    assert "Vikram" in prompt or "BM" in prompt or "Branch Manager" in prompt
    assert "coaching" in prompt.lower() or "performance" in prompt.lower()


def test_daily_review_prompt_contains_branch():
    from agents.specialists.daily_review_agent import DailyReviewAgent

    agent = DailyReviewAgent(rm_id="RM003")
    state = {**BM_STATE}
    prompt = agent.build_system_prompt(state)
    assert "Mumbai-BKC" in prompt


def test_daily_review_specialist_prompt_content():
    from agents.specialists.daily_review_agent import DailyReviewAgent

    agent = DailyReviewAgent(rm_id="RM003")
    prompt = agent.get_specialist_prompt()
    assert "branch average" in prompt.lower() or "average" in prompt.lower()
    assert "underperform" in prompt.lower() or "above" in prompt.lower()


@pytest.mark.asyncio
async def test_fetch_team_data_node_handles_api_error():
    from agents.specialists.daily_review_agent import DailyReviewAgent

    agent = DailyReviewAgent(rm_id="RM003")
    state = {**BM_STATE}

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(
            side_effect=Exception("Connection refused")
        )
        result = await agent.fetch_team_data_node(state)

    assert "tool_results" in result
    assert "error" in result["tool_results"][0]["result"]


@pytest.mark.asyncio
async def test_analyze_performance_node_returns_analysis():
    from agents.specialists.daily_review_agent import DailyReviewAgent

    agent = DailyReviewAgent(rm_id="RM003")
    state = {
        **BM_STATE,
        "tool_results": [
            {
                "tool": "daily_status",
                "result": {
                    "team": [
                        {"rm_name": "Priya", "meetings_today": 2},
                        {"rm_name": "Rajesh", "meetings_today": 7},
                    ],
                    "branch_avg": {"meetings": 5},
                },
            }
        ],
    }
    result = await agent.analyze_performance_node(state)

    analysis = result.get("client_context", {})
    assert "has_gaps" in analysis
    assert "top_performers" in analysis
    assert "underperformers" in analysis
    assert "Rajesh" in analysis["top_performers"]
    assert "Priya" in analysis["underperformers"]


def test_daily_review_identity_header_encodes_bm_role():
    import base64, json
    from agents.specialists.daily_review_agent import DailyReviewAgent

    agent = DailyReviewAgent(rm_id="RM003")
    state = {**BM_STATE}
    header = agent._build_identity_header(state)
    decoded = json.loads(base64.b64decode(header).decode())
    assert decoded["role"] == "BM"
    assert decoded["rm_id"] == "RM003"
    assert decoded["rm_branch"] == "Mumbai-BKC"


# ---------------------------------------------------------------------------
# StrengthAgent tests
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_strength_agent_instantiates():
    from agents.specialists.strength_agent import StrengthAgent

    agent = StrengthAgent(rm_id="RM003")
    assert agent is not None


@pytest.mark.asyncio
async def test_strength_graph_compiles():
    from agents.specialists.strength_agent import StrengthAgent

    compiled = StrengthAgent(rm_id="RM003").create_graph().compile()
    assert compiled is not None


def test_strength_prompt_is_constructive():
    from agents.specialists.strength_agent import StrengthAgent

    agent = StrengthAgent(rm_id="RM003")
    state = {
        **BM_STATE,
        "message": "strengths",
    }
    prompt = agent.build_system_prompt(state)
    assert "coaching" in prompt.lower() or "strength" in prompt.lower() or "opportunity" in prompt.lower()


def test_strength_prompt_contains_vikram_persona():
    from agents.specialists.strength_agent import StrengthAgent

    agent = StrengthAgent(rm_id="RM003")
    state = {**BM_STATE}
    prompt = agent.build_system_prompt(state)
    assert "Vikram" in prompt
    assert "Vikram Nair" in prompt


def test_strength_specialist_prompt_mentions_pairing():
    from agents.specialists.strength_agent import StrengthAgent

    agent = StrengthAgent(rm_id="RM003")
    prompt = agent.get_specialist_prompt()
    # Should encourage actionable peer-learning suggestions
    assert "coaching" in prompt.lower() or "pair" in prompt.lower() or "actionable" in prompt.lower()


@pytest.mark.asyncio
async def test_fetch_strengths_node_handles_api_error():
    from agents.specialists.strength_agent import StrengthAgent

    agent = StrengthAgent(rm_id="RM003")
    state = {**BM_STATE}

    with patch("httpx.AsyncClient") as mock_client:
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(
            side_effect=Exception("Connection refused")
        )
        result = await agent.fetch_strengths_node(state)

    assert "tool_results" in result
    assert "error" in result["tool_results"][0]["result"]


def test_strength_identity_header_encodes_bm_role():
    import base64, json
    from agents.specialists.strength_agent import StrengthAgent

    agent = StrengthAgent(rm_id="RM003")
    state = {**BM_STATE}
    header = agent._build_identity_header(state)
    decoded = json.loads(base64.b64decode(header).decode())
    assert decoded["role"] == "BM"
    assert decoded["rm_id"] == "RM003"
    assert decoded["rm_branch"] == "Mumbai-BKC"
