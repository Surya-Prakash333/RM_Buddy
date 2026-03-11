"""Document specialist — RAG search over knowledge base (stub)."""

from __future__ import annotations
from typing import Any

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from config.settings import settings
from graphs.state import AgentState
from prompts.specialist_prompts import DOCUMENT_AGENT_PROMPT
from tools.rag_tool import search_knowledge_base


def _make_agent():
    llm = ChatOpenAI(
        base_url=f"{settings.litellm_url}/v1",
        api_key=settings.litellm_master_key,
        model=settings.llm_fast_model,
    )
    return create_react_agent(
        llm,
        tools=[search_knowledge_base],
        prompt=DOCUMENT_AGENT_PROMPT,
    )


async def run_document_agent(state: AgentState) -> dict[str, Any]:
    agent = _make_agent()
    result = await agent.ainvoke({"messages": state["messages"]})
    text = result["messages"][-1].content if result["messages"] else ""
    return {"specialist_results": {"document": text}}
