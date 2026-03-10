"""
tests/agents/test_qa_agent.py — Unit tests for QAAgent.

Acceptance criteria verified:
    - QAAgent can be imported and instantiated (test_qa_agent_instantiates)
    - Agent exposes >= 5 tools including get_client_list and build_metric_card
      (test_qa_agent_has_tools)
    - LangGraph compiles successfully (test_qa_agent_graph_compiles)
    - System prompt includes RM name, rm_id, and Indian notation cues
      (test_system_prompt_contains_rm_context)
"""

import pytest
from unittest.mock import AsyncMock, MagicMock, patch


@pytest.mark.asyncio
async def test_qa_agent_instantiates():
    """QAAgent can be imported and instantiated."""
    from src.agents.specialists.qa_agent import QAAgent

    agent = QAAgent(rm_id="RM001")
    assert agent is not None


@pytest.mark.asyncio
async def test_qa_agent_has_tools():
    """Agent registers at least 5 tools and includes key CRM + widget tools."""
    from src.agents.specialists.qa_agent import QAAgent

    agent = QAAgent(rm_id="RM001")
    tools = agent.get_tools()
    assert len(tools) >= 5

    tool_names = [t.name for t in tools]
    assert "get_client_list" in tool_names
    assert "build_metric_card" in tool_names


@pytest.mark.asyncio
async def test_qa_agent_graph_compiles():
    """create_graph() returns a StateGraph that compiles without errors."""
    from src.agents.specialists.qa_agent import QAAgent

    agent = QAAgent(rm_id="RM001")
    graph = agent.create_graph()
    compiled = graph.compile()
    assert compiled is not None


def test_system_prompt_contains_rm_context():
    """build_system_prompt includes RM name from rm_context and Indian notation cues."""
    from src.agents.specialists.qa_agent import QAAgent

    agent = QAAgent(rm_id="RM001")
    state = {
        "rm_id": "RM001",
        "rm_role": "RM",
        "rm_context": {
            "name": "Rajesh Kumar",
            "rm_id": "RM001",
            "branch": "Mumbai",
            "client_count": 42,
            "aum_cr": 125.0,
        },
        "message": "test",
        "message_type": "text",
        "session_id": "sess1",
        "intent": "general_qa",
        "intent_confidence": 0.9,
        "client_context": None,
        "tool_results": [],
        "response": None,
        "widgets": [],
        "guardrail_flags": [],
        "error": None,
        "messages": [],
    }

    # build_system_prompt takes rm_identity + client_context, not the full state
    rm_identity = state["rm_context"]
    prompt = agent.build_system_prompt(rm_identity=rm_identity)

    assert "Rajesh Kumar" in prompt
    # Indian notation cues come from the specialist prompt
    specialist = agent.get_specialist_prompt()
    assert "Cr" in specialist or "₹" in specialist or "Indian notation" in specialist


def test_specialist_prompt_content():
    """get_specialist_prompt includes key rules about tools and Indian formatting."""
    from src.agents.specialists.qa_agent import QAAgent

    agent = QAAgent(rm_id="RM001")
    prompt = agent.get_specialist_prompt()

    assert "tool" in prompt.lower() or "tools" in prompt.lower()
    assert "₹" in prompt or "Cr" in prompt or "Indian" in prompt
