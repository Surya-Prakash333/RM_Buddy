"""Revenue specialist — AUM, commission, revenue metrics."""

from __future__ import annotations
from typing import Any

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from config.settings import settings
from graphs.state import AgentState
from prompts.specialist_prompts import REVENUE_AGENT_PROMPT
from tools.crm_tool import get_client_list, get_dashboard_summary


def _make_agent():
    llm = ChatOpenAI(
        base_url=f"{settings.litellm_url}/v1",
        api_key=settings.litellm_master_key,
        model=settings.llm_smart_model,
    )
    return create_react_agent(
        llm,
        tools=[get_client_list, get_dashboard_summary],
        prompt=REVENUE_AGENT_PROMPT,
    )


async def run_revenue_agent(state: AgentState) -> dict[str, Any]:
    agent = _make_agent()
    result = await agent.ainvoke({"messages": state["messages"]})
    text = result["messages"][-1].content if result["messages"] else ""
    return {"specialist_results": {"revenue": text}}
