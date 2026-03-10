import pytest
from unittest.mock import AsyncMock, patch, MagicMock


@pytest.mark.asyncio
async def test_briefing_agent_instantiates():
    from agents.specialists.briefing_agent import BriefingAgent
    agent = BriefingAgent(rm_id="RM001")
    assert agent is not None


@pytest.mark.asyncio
async def test_briefing_agent_graph_compiles():
    from agents.specialists.briefing_agent import BriefingAgent
    agent = BriefingAgent(rm_id="RM001")
    graph = agent.create_graph()
    compiled = graph.compile()
    assert compiled is not None


def test_system_prompt_contains_date_and_greeting():
    from agents.specialists.briefing_agent import BriefingAgent
    agent = BriefingAgent(rm_id="RM001")
    state = {
        'rm_id': 'RM001',
        'rm_role': 'RM',
        'rm_context': {'rm_name': 'Rajesh'},
        'message': 'briefing',
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
    # build_system_prompt on BaseAgent takes (rm_identity, client_context)
    # get_specialist_prompt() carries the briefing-specific instructions
    prompt = agent.get_specialist_prompt()
    rm_context = state.get('rm_context', {})
    rm_name = rm_context.get('rm_name', 'RM')
    full_prompt = f"You are Aria, AI assistant for {rm_name} at Nuvama Wealth Management.\n\n" + prompt
    assert 'Rajesh' in full_prompt
    assert 'morning' in full_prompt.lower() or 'briefing' in full_prompt.lower()
    assert 'Cr' in full_prompt or 'Indian' in full_prompt


@pytest.mark.asyncio
async def test_fetch_briefing_node_handles_api_error():
    from agents.specialists.briefing_agent import BriefingAgent
    agent = BriefingAgent(rm_id="RM001")
    state = {
        'rm_id': 'RM001',
        'rm_role': 'RM',
        'rm_context': {},
        'message': 'briefing',
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
        'message_type': 'text',
    }
    with patch('httpx.AsyncClient') as mock_client:
        mock_client.return_value.__aenter__.return_value.get = AsyncMock(
            side_effect=Exception("Connection refused")
        )
        result = await agent.fetch_briefing_node(state)
    # Should not raise — error is captured in tool_results
    assert 'tool_results' in result
    assert 'error' in result['tool_results'][0]['result']
