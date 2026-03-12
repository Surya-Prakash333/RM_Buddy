"""
Supervisor graph — optimised for speed with deterministic tool routing.

Flow: input_guard → build_context → classify_intent → fetch_data → format_response → output_guard

Key optimisation: NO ReAct agents. Instead of the LLM deciding which tool to call
(3-4 LLM calls × 20s = 60s), we deterministically route to the right CRM tool
based on keywords, then use a single fast LLM call to format the raw data (~2s).
"""

from __future__ import annotations

import asyncio
import json
import logging
import re
from typing import Any

from langchain_openai import ChatOpenAI
from langgraph.graph import END, StateGraph

from config.settings import settings
from graphs.state import AgentState
from guardrails.input_guardrails import check_input
from guardrails.output_guardrails import check_output
from memory.context_builder import ContextBuilder
from prompts.supervisor_prompt import (
    ARIA_SYSTEM_PROMPT,
    VIKRAM_SYSTEM_PROMPT,
    COMPOSE_PROMPT,
)
from tools.crm_tool import (
    set_rm_context,
    get_client_list,
    get_client_profile,
    get_client_portfolio,
    get_dashboard_summary,
    get_alerts,
    get_meetings,
    get_leads,
)
from tools.search_tool import search_clients_by_name

logger = logging.getLogger("graphs.supervisor")

# ---------------------------------------------------------------------------
# Intent & routing constants
# ---------------------------------------------------------------------------

GREETING_WORDS: set[str] = {
    "hi", "hello", "hey", "hii", "hiii", "hola", "howdy",
    "good morning", "good afternoon", "good evening",
    "gm", "morning", "namaste", "sup", "yo",
    "thanks", "thank you", "ok", "okay", "cool", "great",
    "bye", "goodbye", "see you", "talk later",
}

META_PATTERNS: list[str] = [
    "last question", "previous question", "what did i ask",
    "what was my last", "what did i say", "repeat that",
    "say that again", "what were we talking", "what did you say",
    "summarize our conversation", "conversation so far",
]

# Maps query intent to data-fetching strategy
ROUTE_PATTERNS: dict[str, list[str]] = {
    "client_search": ["tell me about", "who is", "details of", "profile of", "about client"],
    "client_portfolio": ["portfolio", "holding", "allocation", "drift", "rebalance", "nav"],
    "client_list_city": ["in mumbai", "in bangalore", "in delhi", "in chennai", "in pune", "in hyderabad", "in kolkata"],
    "client_list_tier": ["diamond client", "platinum client", "gold client", "silver client", "black client"],
    "client_count": ["how many client", "total client", "number of client", "count of client"],
    "dashboard": ["total aum", "aum total", "my aum", "summary", "overview", "dashboard", "revenue", "commission"],
    "alerts": ["alert", "anomaly", "risk", "warning", "drawdown", "attention", "pending alert"],
    "meetings": ["meeting", "schedule", "calendar", "today's meeting", "appointment"],
    "leads": ["lead", "pipeline", "prospect", "follow up", "follow-up"],
    "dormant": ["dormant", "inactive", "not contacted", "last contact"],
}

# City extraction regex
CITY_RE = re.compile(
    r"\b(?:in|from|at)\s+(mumbai|bangalore|bengaluru|delhi|chennai|pune|hyderabad|kolkata|noida|gurgaon|gurugram)\b",
    re.IGNORECASE,
)

# Tier extraction regex
TIER_RE = re.compile(
    r"\b(diamond|platinum|gold|silver|black)\b",
    re.IGNORECASE,
)

# Client name extraction — "about <Name>" or "of <Name>" or "details of <Name>"
CLIENT_NAME_RE = re.compile(
    r"(?:about|of|for|details\s+of|profile\s+of|portfolio\s+of|tell\s+me\s+about)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)*)",
    re.IGNORECASE,
)


def _detect_routes(message: str) -> list[str]:
    """Return list of matched route keys based on message keywords."""
    msg_lower = message.lower()
    routes = []
    for route, keywords in ROUTE_PATTERNS.items():
        if any(kw in msg_lower for kw in keywords):
            routes.append(route)
    return routes


def _extract_city(message: str) -> str | None:
    m = CITY_RE.search(message)
    if m:
        city = m.group(1).title()
        if city == "Bengaluru":
            city = "Bangalore"
        if city == "Gurugram":
            city = "Gurgaon"
        return city
    return None


def _extract_tier(message: str) -> str | None:
    m = TIER_RE.search(message)
    return m.group(1).upper() if m else None


def _extract_client_name(message: str) -> str | None:
    m = CLIENT_NAME_RE.search(message)
    return m.group(1).strip() if m else None


# ---------------------------------------------------------------------------
# Widget builders
# ---------------------------------------------------------------------------

def _build_client_table_widget(clients: list[dict], title: str = "Clients") -> dict:
    rows = []
    for c in clients:
        rows.append({
            "client_name": c.get("client_name", ""),
            "tier": c.get("tier", ""),
            "aum": c.get("aum", c.get("total_aum", "")),
            "last_interaction": c.get("last_interaction", "N/A"),
            "client_id": c.get("client_id", ""),
            "city": c.get("city", ""),
        })
    return {
        "widget_type": "table",
        "title": f"{title} ({len(rows)})",
        "data": {
            "columns": [
                {"key": "client_name", "label": "Client Name"},
                {"key": "tier", "label": "Tier"},
                {"key": "aum", "label": "AUM"},
                {"key": "last_interaction", "label": "Last Contact"},
                {"key": "city", "label": "City"},
            ],
            "rows": rows,
            "row_count": len(rows),
        },
    }


def _build_alert_widgets(alerts: list[dict]) -> list[dict]:
    severity_colours = {"critical": "red", "high": "orange", "medium": "yellow", "low": "blue"}
    widgets = []
    for alert in alerts:
        severity = str(alert.get("severity", alert.get("priority", "medium"))).lower()
        widgets.append({
            "widget_type": "alert_card",
            "title": f"{str(alert.get('alert_type', 'alert')).replace('_', ' ').title()} — {alert.get('client_name', 'Unknown')}",
            "data": {
                "alert_type": alert.get("alert_type", "alert"),
                "client_name": alert.get("client_name", "Unknown"),
                "message": alert.get("message", alert.get("description", "")),
                "severity": severity,
                "colour": severity_colours.get(severity, "blue"),
                "action_suggestion": alert.get("action_suggestion", ""),
            },
        })
    return widgets


def _build_metric_widget(value: str, title: str, subtitle: str = "") -> dict:
    return {
        "widget_type": "metric_card",
        "title": title,
        "data": {"value": value, "subtitle": subtitle, "trend": ""},
    }


# ---------------------------------------------------------------------------
# SupervisorGraph
# ---------------------------------------------------------------------------

class SupervisorGraph:
    """Optimised supervisor: deterministic tool routing + single LLM format call."""

    def __init__(self, context_builder: ContextBuilder) -> None:
        self._context_builder = context_builder
        self._graph = self._build_graph()
        logger.info("SupervisorGraph compiled (deterministic routing mode)")

    def _build_graph(self):
        graph = StateGraph(AgentState)
        graph.add_node("input_guard", self._input_guard)
        graph.add_node("build_context", self._build_context)
        graph.add_node("classify_intent", self._classify_intent)
        graph.add_node("fetch_data", self._fetch_data)
        graph.add_node("format_response", self._format_response)
        graph.add_node("output_guard", self._output_guard)
        graph.add_node("blocked", self._blocked_response)

        graph.set_entry_point("input_guard")
        graph.add_conditional_edges(
            "input_guard",
            lambda s: "blocked" if s.get("guardrail_blocked") else "build_context",
        )
        graph.add_edge("build_context", "classify_intent")
        graph.add_conditional_edges(
            "classify_intent",
            lambda s: "format_response" if s.get("intent") in ("greeting", "meta") else "fetch_data",
        )
        graph.add_edge("fetch_data", "format_response")
        graph.add_edge("format_response", "output_guard")
        graph.add_edge("output_guard", END)
        graph.add_edge("blocked", END)

        return graph.compile()

    # ------------------------------------------------------------------
    # Node 1: Input guard
    # ------------------------------------------------------------------
    async def _input_guard(self, state: AgentState) -> dict:
        logger.info("[1/6 input_guard] rm_id=%s message=%.80s", state["rm_id"], state["message"])
        result = check_input(state["message"], state["rm_id"])
        if result.is_blocked:
            logger.warning("[1/6 input_guard] BLOCKED reason=%s", result.reason)
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

    # ------------------------------------------------------------------
    # Node 2: Build context
    # ------------------------------------------------------------------
    async def _build_context(self, state: AgentState) -> dict:
        logger.info("[2/6 build_context] Loading memory & context for rm_id=%s", state["rm_id"])
        rm_identity = state.get("rm_context") or {"rm_id": state["rm_id"], "role": "RM"}
        set_rm_context(rm_identity)

        loaded = await self._context_builder.build(
            session_id=state["session_id"],
            rm_id=state["rm_id"],
            query=state["message"],
        )
        ctx_keys = [k for k, v in (loaded or {}).items() if v]
        logger.info("[2/6 build_context] Loaded context keys: %s", ctx_keys)
        return {"loaded_context": loaded}

    # ------------------------------------------------------------------
    # Node 3: Classify intent (pure keyword — NO LLM call)
    # ------------------------------------------------------------------
    async def _classify_intent(self, state: AgentState) -> dict:
        message = state["message"]
        message_lower = message.strip().lower()
        cleaned = message_lower.rstrip("!?.,'\"")
        logger.info("[3/6 classify_intent] message=%.80s", message)

        # Greeting
        if cleaned in GREETING_WORDS or (len(cleaned) <= 3 and cleaned.isalpha()):
            logger.info("[3/6 classify_intent] → GREETING")
            return {"intent": "greeting", "intent_confidence": 0.95, "active_specialists": []}

        # Meta / conversational
        if any(pat in message_lower for pat in META_PATTERNS):
            logger.info("[3/6 classify_intent] → META")
            return {"intent": "meta", "intent_confidence": 0.95, "active_specialists": []}

        # Determine data routes
        routes = _detect_routes(message)
        if not routes:
            routes = ["client_search"]  # default: try to find what user is asking about

        logger.info("[3/6 classify_intent] → qa routes=%s", routes)
        return {"intent": "qa", "intent_confidence": 0.85, "active_specialists": routes}

    # ------------------------------------------------------------------
    # Node 4: Fetch data (deterministic — NO ReAct, direct tool calls)
    # ------------------------------------------------------------------
    async def _fetch_data(self, state: AgentState) -> dict:
        routes = state.get("active_specialists", [])
        message = state["message"]
        logger.info("[4/6 fetch_data] Routes=%s", routes)

        # Ensure RM context is set
        rm_identity = state.get("rm_context") or {"rm_id": state["rm_id"], "role": "RM"}
        set_rm_context(rm_identity)

        raw_data: dict[str, Any] = {}
        widgets: list[dict] = []

        # Extract query parameters
        city = _extract_city(message)
        tier = _extract_tier(message)
        client_name = _extract_client_name(message)

        # --- Client search by name ---
        if "client_search" in routes or (client_name and "client_portfolio" in routes):
            if client_name:
                search_result = await search_clients_by_name.ainvoke({"query": client_name})
                raw_data["client_search"] = search_result
                # If we found a client, also fetch their profile
                results = search_result.get("results", [])
                if results:
                    cid = results[0].get("client_id", "")
                    if cid:
                        profile_result = await get_client_profile.ainvoke({"client_id": cid})
                        raw_data["client_profile"] = profile_result
                        # If portfolio was asked, fetch that too
                        if "client_portfolio" in routes or "portfolio" in state["message"].lower():
                            portfolio_result = await get_client_portfolio.ainvoke({"client_id": cid})
                            raw_data["client_portfolio"] = portfolio_result

        # --- Client list by city/tier ---
        if "client_list_city" in routes or "client_list_tier" in routes or "client_count" in routes:
            kwargs: dict[str, Any] = {}
            if city:
                kwargs["city"] = city
            if tier:
                kwargs["tier"] = tier
            list_result = await get_client_list.ainvoke(kwargs if kwargs else {"limit": 100})
            raw_data["client_list"] = list_result
            clients = list_result.get("clients", [])
            if clients:
                label = f"{city} Clients" if city else f"{tier} Clients" if tier else "Clients"
                widgets.append(_build_client_table_widget(clients, label))
                widgets.append(_build_metric_widget(str(len(clients)), "Total Clients", "matching your query"))

        # --- Dashboard / AUM / revenue ---
        if "dashboard" in routes:
            summary_result = await get_dashboard_summary.ainvoke({})
            raw_data["dashboard"] = summary_result

        # --- Alerts ---
        if "alerts" in routes:
            alerts_result = await get_alerts.ainvoke({})
            raw_data["alerts"] = alerts_result
            alert_list = alerts_result.get("alerts", [])
            if alert_list:
                widgets.extend(_build_alert_widgets(alert_list))

        # --- Meetings ---
        if "meetings" in routes:
            meetings_result = await get_meetings.ainvoke({})
            raw_data["meetings"] = meetings_result

        # --- Leads ---
        if "leads" in routes:
            leads_result = await get_leads.ainvoke({})
            raw_data["leads"] = leads_result

        # --- Dormant clients ---
        if "dormant" in routes:
            list_result = await get_client_list.ainvoke({"limit": 100})
            raw_data["dormant_clients"] = list_result

        # --- Fallback: if no routes matched or no data fetched, try client list ---
        if not raw_data:
            # Check if there's a name mentioned
            if client_name:
                search_result = await search_clients_by_name.ainvoke({"query": client_name})
                raw_data["client_search"] = search_result
                results = search_result.get("results", [])
                if results:
                    cid = results[0].get("client_id", "")
                    if cid:
                        raw_data["client_profile"] = await get_client_profile.ainvoke({"client_id": cid})
            else:
                raw_data["client_list"] = await get_client_list.ainvoke({"limit": 100})

        logger.info("[4/6 fetch_data] Fetched keys=%s widgets=%d", list(raw_data.keys()), len(widgets))
        return {"specialist_results": raw_data, "widgets": widgets}

    # ------------------------------------------------------------------
    # Node 5: Format response (single LLM call with raw data)
    # ------------------------------------------------------------------
    async def _format_response(self, state: AgentState) -> dict:
        intent = state.get("intent")
        logger.info("[5/6 format_response] intent=%s", intent)

        rm_role = state.get("rm_role", "RM")
        persona = VIKRAM_SYSTEM_PROMPT if rm_role == "BM" else ARIA_SYSTEM_PROMPT

        # Build conversation history
        conversation_history = []
        for msg in state.get("messages", [])[:-1]:
            if hasattr(msg, "content") and hasattr(msg, "type"):
                role = "user" if msg.type == "human" else "assistant"
                conversation_history.append({"role": role, "content": msg.content})

        # --- Greeting ---
        if intent == "greeting":
            try:
                llm = ChatOpenAI(
                    base_url=f"{settings.litellm_url}/v1",
                    api_key=settings.litellm_master_key,
                    model=settings.llm_fast_model,
                    temperature=0.7,
                    max_tokens=100,
                )
                response = await llm.ainvoke([
                    {"role": "system", "content": persona},
                    {"role": "user", "content": state["message"]},
                ])
                return {"response": response.content if hasattr(response, "content") else str(response)}
            except Exception:
                return {"response": "Hi! I'm Aria, your wealth management assistant. How can I help you today?"}

        # --- Meta ---
        if intent == "meta":
            try:
                llm = ChatOpenAI(
                    base_url=f"{settings.litellm_url}/v1",
                    api_key=settings.litellm_master_key,
                    model=settings.llm_fast_model,
                    temperature=0.3,
                    max_tokens=200,
                )
                llm_messages = [{"role": "system", "content": persona + "\n\nAnswer the user's question based on the conversation history. Be direct and concise."}]
                llm_messages.extend(conversation_history[-10:])
                llm_messages.append({"role": "user", "content": state["message"]})
                response = await llm.ainvoke(llm_messages)
                return {"response": response.content if hasattr(response, "content") else str(response)}
            except Exception:
                return {"response": "I don't have enough conversation history to answer that."}

        # --- QA: format raw data with single LLM call ---
        raw_data = state.get("specialist_results", {})
        if not raw_data:
            return {"response": "I couldn't find relevant data for your query. Could you rephrase?"}

        # Serialise raw data for LLM (compact JSON)
        data_summary = json.dumps(raw_data, indent=1, default=str, ensure_ascii=False)
        # Truncate if too long (keep under 6000 chars for fast model)
        if len(data_summary) > 6000:
            data_summary = data_summary[:6000] + "\n... (truncated)"

        format_prompt = f"""{persona}

You have retrieved the following data from the CRM system. Use ONLY this data to answer the user's question.

## CRM Data:
{data_summary}

## RULES:
1. ONLY use data above. NEVER invent names, numbers, or facts.
2. Use Indian financial formatting (₹, Cr, L, K).
3. Be concise — under 150 words unless detail is needed.
4. Use bullet points for lists.
5. ONLY answer what was asked. No suggestions, no "Would you like..." prompts.
6. If the data contains an 'error' key, tell the user the data is unavailable."""

        try:
            llm = ChatOpenAI(
                base_url=f"{settings.litellm_url}/v1",
                api_key=settings.litellm_master_key,
                model=settings.llm_fast_model,
                temperature=0.3,
                max_tokens=500,
            )
            llm_messages = [{"role": "system", "content": format_prompt}]
            llm_messages.extend(conversation_history[-4:])
            llm_messages.append({"role": "user", "content": state["message"]})
            response = await llm.ainvoke(llm_messages)
            text = response.content if hasattr(response, "content") else str(response)
        except Exception as exc:
            logger.error("Format response LLM failed: %s", exc)
            # Fallback: return raw data summary
            text = f"Here's what I found:\n{data_summary[:1000]}"

        return {"response": text}

    # ------------------------------------------------------------------
    # Node 6: Output guard
    # ------------------------------------------------------------------
    async def _output_guard(self, state: AgentState) -> dict:
        logger.info("[6/6 output_guard] Response length=%d chars", len(state.get("response") or ""))
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
