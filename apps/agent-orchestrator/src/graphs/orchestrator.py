"""
orchestrator.py — Main LangGraph StateGraph for the RM Buddy Agent Orchestrator.

Graph topology (linear for INFRA-AGENT-01; conditional branching added in S1/S2):

    input_guard → classify_intent → route_agent → execute_agent
                                                       ↓
                                   END ← compose_response ← output_guard

Node responsibilities:
    input_guard       Sanitise input; flag guardrail violations.
    classify_intent   Two-stage intent classification (keyword + LLM).
    route_agent       Determine which specialist agent to invoke (stub in this story).
    execute_agent     Invoke the routed agent and collect tool_results / response.
    output_guard      Check response for policy violations before returning.
    compose_response  Assemble the final AgentResponse from state.

All nodes are async to avoid blocking the FastAPI event loop.
"""

from __future__ import annotations

import logging
import time
import uuid
from typing import Any

from langgraph.graph import END, StateGraph

from config.llm_config import get_llm_client
from config.prompts import ARIA_SYSTEM_PROMPT, VIKRAM_SYSTEM_PROMPT
from config.settings import settings
from models.schemas import AgentRequest, AgentResponse, WidgetPayload
from models.types import AgentRole, IntentType, WidgetType

from .intent_classifier import IntentClassifier
from .state import AgentState
from tools.crm_tool import set_rm_context

logger = logging.getLogger(__name__)


class OrchestratorGraph:
    """
    Main LangGraph orchestrator for RM Buddy agents.

    Instantiate once at application startup and reuse.  The compiled graph
    is thread-safe and can be invoked concurrently.

    Args:
        llm_client: Async OpenAI-compatible LLM client (LiteLLM proxy).
        tools:      List of LangChain-compatible tools available to agents.
                    Empty in this story; populated in S1/S2.
    """

    # Guardrail patterns — messages matching these are flagged before LLM call.
    _INPUT_BLOCKLIST: list[str] = [
        "ignore previous instructions",
        "disregard your system prompt",
        "act as",
        "jailbreak",
        "bypass",
    ]

    def __init__(self, llm_client: Any, tools: list[Any]) -> None:
        self.llm = llm_client
        self.tools = tools
        self.intent_classifier = IntentClassifier()
        self.graph = self._build_graph()
        logger.info("OrchestratorGraph compiled successfully")

    # ------------------------------------------------------------------
    # Graph construction
    # ------------------------------------------------------------------

    def _build_graph(self):
        """Build and compile the LangGraph StateGraph."""
        graph = StateGraph(AgentState)

        graph.add_node("input_guard", self.input_guard_node)
        graph.add_node("classify_intent", self.classify_intent_node)
        graph.add_node("route_agent", self.route_agent_node)
        graph.add_node("execute_agent", self.execute_agent_node)
        graph.add_node("output_guard", self.output_guard_node)
        graph.add_node("compose_response", self.compose_response_node)

        graph.set_entry_point("input_guard")
        graph.add_edge("input_guard", "classify_intent")
        graph.add_edge("classify_intent", "route_agent")
        graph.add_edge("route_agent", "execute_agent")
        graph.add_edge("execute_agent", "output_guard")
        graph.add_edge("output_guard", "compose_response")
        graph.add_edge("compose_response", END)

        return graph.compile()

    # ------------------------------------------------------------------
    # Node implementations
    # ------------------------------------------------------------------

    async def input_guard_node(self, state: AgentState) -> dict:
        """
        Validate and sanitise the incoming message.

        Checks:
          - Message length (already enforced by Pydantic, but double-checked).
          - Prompt injection patterns via blocklist scan.

        Returns a partial state dict; LangGraph merges it with existing state.
        """
        message = state["message"]
        flags: list[str] = []

        message_lower = message.lower()
        for pattern in self._INPUT_BLOCKLIST:
            if pattern in message_lower:
                flags.append(f"prompt_injection:{pattern}")
                logger.warning(
                    "Prompt injection attempt detected [rm_id=%s, pattern=%s]",
                    state["rm_id"],
                    pattern,
                )

        return {
            "guardrail_flags": flags,
            "error": None,
            "tool_results": [],
            "widgets": [],
        }

    async def classify_intent_node(self, state: AgentState) -> dict:
        """
        Classify the user's intent using the two-stage classifier.

        Skips LLM classification if guardrail flags are already set
        (avoid burning tokens on blocked messages).
        """
        if state.get("guardrail_flags"):
            return {
                "intent": IntentType.UNKNOWN.value,
                "intent_confidence": 0.0,
            }

        intent, confidence = await self.intent_classifier.classify(
            state["message"], self.llm
        )
        logger.info(
            "Intent classified [rm_id=%s, intent=%s, confidence=%.2f]",
            state["rm_id"],
            intent,
            confidence,
        )
        return {
            "intent": intent.value,
            "intent_confidence": confidence,
        }

    async def route_agent_node(self, state: AgentState) -> dict:
        """
        Determine which specialist agent should handle the request.

        In INFRA-AGENT-01 this is a stub — routing logic and specialist
        agent dispatch is implemented in Sprint 1 (S1) stories.
        The RM role determines the base persona (Aria vs. Vikram).
        """
        rm_role = state.get("rm_role", AgentRole.RM.value)
        # BM role → Vikram persona; everyone else → Aria
        agent_id = "vikram" if rm_role == AgentRole.BM.value else "aria"
        logger.debug(
            "Routed to agent [rm_id=%s, agent_id=%s, intent=%s]",
            state["rm_id"],
            agent_id,
            state.get("intent"),
        )
        # We store the routing decision in metadata via the response field temporarily;
        # specialist agents will overwrite this in S1.
        return {"response": None}

    async def execute_agent_node(self, state: AgentState) -> dict:
        """
        Dispatch to the appropriate specialist agent based on classified intent.
        Falls back to a direct LLM call for GENERAL_QA / UNKNOWN intents.
        """
        if state.get("guardrail_flags"):
            return {
                "response": "I'm sorry, I can't help with that request.",
                "widgets": [],
                "tool_results": [],
            }

        # Set RM identity context so CRM tools can authenticate with Core API
        rm_identity = state.get("rm_context") or {"rm_id": state["rm_id"], "role": "RM"}
        set_rm_context(rm_identity)

        intent = state.get("intent", IntentType.UNKNOWN.value)
        rm_role = state.get("rm_role", AgentRole.RM.value)

        try:
            # Route to specialist agents
            if intent in (IntentType.CLIENT_QUERY.value, IntentType.PORTFOLIO_ANALYSIS.value):
                from agents.specialists.qa_agent import QAAgent
                agent = QAAgent(rm_id=state["rm_id"])
                return await agent.process(state)

            elif intent == IntentType.VIEW_ALERTS.value:
                from agents.specialists.alert_agent import AlertAgent
                agent = AlertAgent(rm_id=state["rm_id"])
                return await agent.process(state)

            elif intent == IntentType.MORNING_BRIEFING.value:
                from agents.specialists.briefing_agent import BriefingAgent
                agent = BriefingAgent(rm_id=state["rm_id"])
                return await agent.process(state)

            elif intent == IntentType.SCHEDULE_ACTION.value:
                from agents.specialists.actions_agent import ActionsAgent
                agent = ActionsAgent(rm_id=state["rm_id"])
                return await agent.process(state)

            else:
                # GENERAL_QA / UNKNOWN — direct LLM with persona prompt
                system_prompt = (
                    VIKRAM_SYSTEM_PROMPT if rm_role == AgentRole.BM.value else ARIA_SYSTEM_PROMPT
                )
                completion = await self.llm.chat.completions.create(
                    model="claude-default",
                    messages=[
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": state["message"]},
                    ],
                    max_tokens=settings.max_agent_tokens,
                    temperature=settings.agent_temperature,
                    timeout=float(settings.agent_timeout_seconds),
                )
                return {
                    "response": completion.choices[0].message.content,
                    "widgets": [],
                    "tool_results": [],
                }

        except Exception as exc:
            logger.error("Agent execution failed [rm_id=%s, intent=%s, error=%s]", state["rm_id"], intent, exc)
            return {
                "error": str(exc),
                "response": "I encountered an error fetching your data. Please try again.",
                "widgets": [],
                "tool_results": [],
            }

    async def output_guard_node(self, state: AgentState) -> dict:
        """
        Post-process the agent response for policy compliance.

        Checks:
          - Response does not contain investment advice phrases.
          - Response does not leak data outside the RM's scope.

        Returns an updated state dict; sets guardrail_flags if violations found.
        """
        response = state.get("response") or ""
        flags = list(state.get("guardrail_flags") or [])

        # Rudimentary output check — real guardrails expanded in later stories
        advice_patterns = ["buy ", "sell ", "invest in ", "you should purchase"]
        response_lower = response.lower()
        for pattern in advice_patterns:
            if pattern in response_lower:
                flags.append(f"output:investment_advice:{pattern.strip()}")
                logger.warning(
                    "Output guardrail triggered [rm_id=%s, pattern=%s]",
                    state["rm_id"],
                    pattern,
                )

        if any(f.startswith("output:") for f in flags):
            return {
                "guardrail_flags": flags,
                "response": (
                    "I can provide information about portfolios and performance, "
                    "but I'm not able to recommend specific investment actions."
                ),
            }

        return {"guardrail_flags": flags}

    async def compose_response_node(self, state: AgentState) -> dict:
        """
        Assemble the final response dict.  The `run` method reads this back
        and serialises it into an AgentResponse.

        No external calls here — pure data assembly.
        """
        # Nothing to mutate; run() reads state directly after graph completion.
        return {}

    # ------------------------------------------------------------------
    # Public entry point
    # ------------------------------------------------------------------

    async def run(self, request: AgentRequest) -> AgentResponse:
        """
        Process an AgentRequest through the full orchestrator graph.

        Args:
            request: Validated AgentRequest from the FastAPI endpoint.

        Returns:
            AgentResponse ready for JSON serialisation.
        """
        start_ms = time.monotonic()

        # Build initial state from the inbound request
        initial_state: AgentState = {
            "rm_id": request.rm_id,
            "rm_role": (request.context or {}).get("rm_role", AgentRole.RM.value),
            "session_id": request.session_id,
            "message": request.message,
            "message_type": request.message_type,
            "intent": None,
            "intent_confidence": 0.0,
            "rm_context": (request.context or {}).get("rm_context"),
            "client_context": (request.context or {}).get("client_context"),
            "tool_results": [],
            "response": None,
            "widgets": [],
            "guardrail_flags": [],
            "error": None,
            "messages": [],
        }

        try:
            final_state: AgentState = await self.graph.ainvoke(initial_state)
        except Exception as exc:
            logger.error(
                "Orchestrator graph execution failed [rm_id=%s, error=%s]",
                request.rm_id,
                exc,
            )
            return AgentResponse(
                session_id=request.session_id,
                agent_id="system",
                response_type="error",
                text="An internal error occurred. Please try again.",
                metadata={"error": str(exc)},
            )

        elapsed_ms = int((time.monotonic() - start_ms) * 1000)

        has_error = bool(final_state.get("error"))
        rm_role = final_state.get("rm_role", AgentRole.RM.value)
        agent_id = "vikram" if rm_role == AgentRole.BM.value else "aria"

        widgets = [
            WidgetPayload(**w) if isinstance(w, dict) else w
            for w in (final_state.get("widgets") or [])
        ]

        response_type = "error" if has_error else ("widget" if widgets else "text")

        return AgentResponse(
            session_id=request.session_id,
            agent_id=agent_id,
            response_type=response_type,
            text=final_state.get("response"),
            widgets=widgets,
            metadata={
                "intent": final_state.get("intent"),
                "intent_confidence": final_state.get("intent_confidence"),
                "guardrail_flags": final_state.get("guardrail_flags"),
                "latency_ms": elapsed_ms,
            },
        )
