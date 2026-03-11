"""
Supervisor graph — replaces the sequential orchestrator with parallel specialist dispatch.

Flow: input_guard → build_context → classify_intent → dispatch_specialists → compose_response → output_guard
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

from config.settings import settings
from graphs.state import AgentState
from graphs.specialists import SPECIALIST_REGISTRY
from guardrails.input_guardrails import check_input
from guardrails.output_guardrails import check_output
from memory.context_builder import ContextBuilder
from prompts.supervisor_prompt import (
    ARIA_SYSTEM_PROMPT,
    VIKRAM_SYSTEM_PROMPT,
    COMPOSE_PROMPT,
    INTENT_CLASSIFY_PROMPT,
)
from tools.crm_tool import set_rm_context

logger = logging.getLogger("graphs.supervisor")

# Keyword map for specialist selection
KEYWORD_MAP: dict[str, list[str]] = {
    "portfolio": ["portfolio", "holding", "nav", "rebalance", "drift", "aum", "client", "how many"],
    "alert": ["alert", "anomaly", "risk", "warning", "drawdown", "attention", "pending"],
    "revenue": ["revenue", "commission", "fee", "income", "brokerage"],
    "scoring": ["score", "rating", "risk profile", "risk score"],
    "engagement": ["engagement", "interaction", "last contact", "meeting", "dormant", "inactive"],
    "document": ["document", "policy", "compliance", "product", "fund", "scheme"],
}


class SupervisorGraph:
    """Parallel-dispatch supervisor graph for the RM Buddy agent orchestrator."""

    def __init__(self, context_builder: ContextBuilder) -> None:
        self._context_builder = context_builder
        self._graph = self._build_graph()
        logger.info("SupervisorGraph compiled successfully")

    def _build_graph(self):
        graph = StateGraph(AgentState)
        graph.add_node("input_guard", self._input_guard)
        graph.add_node("build_context", self._build_context)
        graph.add_node("classify_intent", self._classify_intent)
        graph.add_node("dispatch_specialists", self._dispatch_specialists)
        graph.add_node("compose_response", self._compose_response)
        graph.add_node("output_guard", self._output_guard)
        graph.add_node("blocked", self._blocked_response)

        graph.set_entry_point("input_guard")
        graph.add_conditional_edges(
            "input_guard",
            lambda s: "blocked" if s.get("guardrail_blocked") else "build_context",
        )
        graph.add_edge("build_context", "classify_intent")
        graph.add_edge("classify_intent", "dispatch_specialists")
        graph.add_edge("dispatch_specialists", "compose_response")
        graph.add_edge("compose_response", "output_guard")
        graph.add_edge("output_guard", END)
        graph.add_edge("blocked", END)

        return graph.compile()

    # ------------------------------------------------------------------
    # Nodes
    # ------------------------------------------------------------------

    async def _input_guard(self, state: AgentState) -> dict:
        result = check_input(state["message"], state["rm_id"])
        if result.is_blocked:
            return {
                "guardrail_blocked": True,
                "guardrail_reason": result.reason,
                "guardrail_flags": [f"input:{result.reason}"],
            }
        return {
            "guardrail_blocked": False,
            "guardrail_reason": None,
            "guardrail_flags": [],
            "tool_results": [],
            "widgets": [],
            "specialist_results": {},
        }

    async def _build_context(self, state: AgentState) -> dict:
        # Set RM identity for CRM tools
        rm_identity = state.get("rm_context") or {"rm_id": state["rm_id"], "role": "RM"}
        set_rm_context(rm_identity)

        loaded = await self._context_builder.build(
            session_id=state["session_id"],
            rm_id=state["rm_id"],
            query=state["message"],
        )
        return {"loaded_context": loaded}

    async def _classify_intent(self, state: AgentState) -> dict:
        # Stage 1: keyword scan for specialist selection
        message_lower = state["message"].lower()
        active: list[str] = []
        for specialist, keywords in KEYWORD_MAP.items():
            if any(kw in message_lower for kw in keywords):
                active.append(specialist)
        if not active:
            active = ["portfolio"]  # default

        # Stage 2: LLM intent classification
        try:
            llm = ChatOpenAI(
                base_url=f"{settings.litellm_url}/v1",
                api_key=settings.litellm_master_key,
                model=settings.llm_fast_model,
                temperature=0.0,
            )
            response = await llm.ainvoke([
                {"role": "system", "content": INTENT_CLASSIFY_PROMPT},
                {"role": "user", "content": state["message"]},
            ])
            intent_str = response.content.strip().lower() if hasattr(response, "content") else "unknown"
            if intent_str not in ("qa", "action", "proactive", "widget", "unknown"):
                intent_str = "qa"
        except Exception as exc:
            logger.warning("Intent classification failed: %s", exc)
            intent_str = "qa"

        # PROACTIVE intent activates all specialists
        if intent_str == "proactive":
            active = list(SPECIALIST_REGISTRY.keys())

        return {
            "intent": intent_str,
            "intent_confidence": 0.8,
            "active_specialists": active,
        }

    async def _dispatch_specialists(self, state: AgentState) -> dict:
        active = state.get("active_specialists", ["portfolio"])

        # Ensure RM context is set for all parallel tasks
        rm_identity = state.get("rm_context") or {"rm_id": state["rm_id"], "role": "RM"}
        set_rm_context(rm_identity)

        async def _run_one(name: str) -> tuple[str, str, list]:
            try:
                run_fn = SPECIALIST_REGISTRY[name]
                result = await run_fn(state)
                text = result.get("specialist_results", {}).get(name, "")
                widgets = result.get("widgets", [])
                return name, text, widgets
            except Exception as exc:
                logger.warning("Specialist %s failed: %s", name, exc)
                return name, "", []

        tasks = [_run_one(name) for name in active if name in SPECIALIST_REGISTRY]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        specialist_results: dict[str, str] = {}
        all_widgets: list[dict] = []
        for r in results:
            if isinstance(r, tuple):
                name, text, widgets = r
                if text:
                    specialist_results[name] = text
                if widgets:
                    all_widgets.extend(widgets)
            elif isinstance(r, Exception):
                logger.warning("Specialist gather exception: %s", r)

        return {"specialist_results": specialist_results, "widgets": all_widgets}

    async def _compose_response(self, state: AgentState) -> dict:
        specialist_results = state.get("specialist_results", {})
        loaded_context = state.get("loaded_context", {})

        # Format specialist findings
        findings = "\n\n".join(
            f"### {name.title()} Agent:\n{text}"
            for name, text in specialist_results.items()
            if text
        )
        if not findings:
            findings = "No specialist data available."

        # Format memory context
        memory_parts = []
        prefs = loaded_context.get("preferences", [])
        if prefs:
            memory_parts.append("**RM Preferences:**\n" + "\n".join(f"- {p.get('content', '')}" for p in prefs))
        memories = loaded_context.get("memories", [])
        if memories:
            memory_parts.append("**Relevant Memories:**\n" + "\n".join(f"- {m.get('content', '')}" for m in memories))
        summaries = loaded_context.get("summaries", [])
        if summaries:
            memory_parts.append("**Recent Conversations:**\n" + "\n".join(f"- {s.get('summary', '')}" for s in summaries))
        memory_context = "\n\n".join(memory_parts) if memory_parts else "No memory context available."

        # Choose persona
        rm_role = state.get("rm_role", "RM")
        persona = VIKRAM_SYSTEM_PROMPT if rm_role == "BM" else ARIA_SYSTEM_PROMPT

        compose_instruction = COMPOSE_PROMPT.format(
            specialist_findings=findings,
            memory_context=memory_context,
        )

        # Build conversation history for compose LLM (prior messages)
        conversation_history = []
        messages = state.get("messages", [])
        # Include prior messages (exclude the last HumanMessage which is the current one)
        for msg in messages[:-1]:
            if hasattr(msg, "content") and hasattr(msg, "type"):
                role = "user" if msg.type == "human" else "assistant"
                conversation_history.append({"role": role, "content": msg.content})

        try:
            llm = ChatOpenAI(
                base_url=f"{settings.litellm_url}/v1",
                api_key=settings.litellm_master_key,
                model=settings.llm_smart_model,
                temperature=settings.agent_temperature,
            )
            llm_messages = [{"role": "system", "content": persona}]
            # Add prior conversation for context (last 10 messages max)
            llm_messages.extend(conversation_history[-10:])
            llm_messages.extend([
                {"role": "user", "content": state["message"]},
                {"role": "assistant", "content": compose_instruction},
                {"role": "user", "content": "Now compose the final response for the RM."},
            ])
            response = await llm.ainvoke(llm_messages)
            text = response.content if hasattr(response, "content") else str(response)
        except Exception as exc:
            logger.error("Compose response failed: %s", exc)
            text = findings if findings != "No specialist data available." else "I encountered an error processing your request."

        return {"response": text}

    async def _output_guard(self, state: AgentState) -> dict:
        response = state.get("response") or ""
        result = check_output(response)
        return {
            "response": result.cleaned_text,
            "guardrail_flags": list(state.get("guardrail_flags", [])) + result.flags,
        }

    async def _blocked_response(self, state: AgentState) -> dict:
        return {
            "response": state.get("guardrail_reason") or "I can't help with that request.",
            "widgets": [],
        }

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def run(self, initial_state: AgentState) -> dict:
        """Run the supervisor graph and return the final state."""
        return await self._graph.ainvoke(initial_state)
