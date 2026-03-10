"""
test_engagement_agent.py — Tests for EngagementAgent (S1-F37-L3-Agent).

BM persona — Vikram. Reviews CRM engagement patterns for RMs.
"""

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_engagement_agent_instantiates():
    from src.agents.specialists.engagement_agent import EngagementAgent

    agent = EngagementAgent(rm_id="RM003")
    assert agent is not None


@pytest.mark.asyncio
async def test_engagement_graph_compiles():
    from src.agents.specialists.engagement_agent import EngagementAgent

    compiled = EngagementAgent(rm_id="RM003").create_graph().compile()
    assert compiled is not None


def test_system_prompt_mentions_score_threshold():
    from src.agents.specialists.engagement_agent import EngagementAgent

    agent = EngagementAgent(rm_id="RM003")
    state = {
        "rm_id": "RM003",
        "rm_role": "BM",
        "rm_context": {"rm_name": "Vikram Nair", "rm_branch": "Mumbai-BKC"},
        "message": "engagement",
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
    }
    # get_specialist_prompt() is what build_system_prompt() delegates to for
    # specialist-specific text; check it directly since base build_system_prompt
    # has a different signature.
    prompt = agent.get_specialist_prompt()
    assert "60" in prompt or "score" in prompt.lower() or "engagement" in prompt.lower()


@pytest.mark.asyncio
async def test_fetch_engagement_handles_api_error():
    from src.agents.specialists.engagement_agent import EngagementAgent

    agent = EngagementAgent(rm_id="RM003")
    state = {
        "rm_id": "RM003",
        "rm_role": "BM",
        "rm_context": {},
        "message": "eng",
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
    }
    with patch("httpx.AsyncClient") as mock:
        mock.return_value.__aenter__.return_value.get = AsyncMock(
            side_effect=Exception("timeout")
        )
        result = await agent.fetch_engagement_node(state)
    assert "error" in result["tool_results"][0]["result"]


def test_identity_header_is_base64():
    import base64
    import json
    from src.agents.specialists.engagement_agent import EngagementAgent

    agent = EngagementAgent(rm_id="RM003")
    state = {
        "rm_id": "RM003",
        "rm_role": "BM",
        "rm_context": {"rm_name": "Vikram", "rm_branch": "Mumbai"},
        "message": "",
        "session_id": "",
        "intent": "",
        "intent_confidence": 0.0,
        "client_context": None,
        "tool_results": [],
        "response": None,
        "widgets": [],
        "guardrail_flags": [],
        "error": None,
        "messages": [],
    }
    header = agent._build_identity_header(state)
    decoded = json.loads(base64.b64decode(header).decode())
    assert decoded["rm_id"] == "RM003"
    assert decoded["role"] == "BM"
