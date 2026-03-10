"""
test_actions_agent.py — Tests for S2-F13-L3-Agent: Daily Actions Specialist.
"""

import pytest
from unittest.mock import AsyncMock, patch


@pytest.mark.asyncio
async def test_actions_agent_instantiates():
    from src.agents.specialists.actions_agent import ActionsAgent
    agent = ActionsAgent(rm_id="RM001")
    assert agent is not None


@pytest.mark.asyncio
async def test_actions_agent_graph_compiles():
    from src.agents.specialists.actions_agent import ActionsAgent
    agent = ActionsAgent(rm_id="RM001")
    compiled = agent.create_graph().compile()
    assert compiled is not None


def test_system_prompt_mentions_priority():
    from src.agents.specialists.actions_agent import ActionsAgent
    agent = ActionsAgent(rm_id="RM001")
    state = {
        'rm_id': 'RM001',
        'rm_role': 'RM',
        'rm_context': {'rm_name': 'Test RM'},
        'message': 'actions',
        'session_id': 's1',
        'intent': 'morning_briefing',
        'intent_confidence': 0.9,
        'client_context': None,
        'tool_results': [],
        'response': None,
        'widgets': [],
        'guardrail_flags': [],
        'error': None,
        'messages': [],
    }
    prompt = agent.build_system_prompt(state)
    assert 'Diamond' in prompt or 'priority' in prompt.lower()
    assert 'Indian' in prompt or 'Cr' in prompt or '₹' in prompt


@pytest.mark.asyncio
async def test_fetch_actions_handles_api_error():
    from src.agents.specialists.actions_agent import ActionsAgent
    agent = ActionsAgent(rm_id="RM001")
    state = {
        'rm_id': 'RM001',
        'rm_role': 'RM',
        'rm_context': {},
        'message': 'actions',
        'session_id': 's1',
        'intent': 'morning_briefing',
        'intent_confidence': 0.9,
        'client_context': None,
        'tool_results': [],
        'response': None,
        'widgets': [],
        'guardrail_flags': [],
        'error': None,
        'messages': [],
    }
    with patch('httpx.AsyncClient') as mock:
        mock.return_value.__aenter__.return_value.get = AsyncMock(side_effect=Exception("timeout"))
        result = await agent.fetch_actions_node(state)
    assert result['tool_results'][0]['result'].get('error') is not None
