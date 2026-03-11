# Chat Module Upgrade Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the agent-orchestrator chat module from sequential single-agent to parallel multi-agent with memory, streaming, RAG stub, and centralized prompts/guardrails — matching the reference architecture while keeping working widget generation and MongoDB data flow.

**Architecture:** Replace `graphs/orchestrator.py` with a new supervisor graph that dispatches 6 function-based specialist agents in parallel via `asyncio.gather()`, adds a context builder that pre-loads session + memory + alerts before every chat, and adds a post-conversation background hook that extracts facts for long-term memory. New SSE streaming endpoint. All business data still flows through Core API; memory data uses direct Motor connection.

**Tech Stack:** Python 3.12, FastAPI, LangGraph, LangChain, Motor (async MongoDB), redis.asyncio, sse-starlette, LiteLLM proxy → Groq (llama-3.3-70b-versatile + llama-3.1-8b-instant)

---

## Chunk 1: Foundation — Types, Settings, Guardrails, Prompts

### Task 1: Extend models/types.py with new enums

**Files:**
- Modify: `apps/agent-orchestrator/src/models/types.py`

- [ ] **Step 1: Add Intent enum and FactCategory enum**

Replace the `IntentType` enum and add new enums. Keep `AgentRole` and `WidgetType` unchanged.

```python
# Add after existing imports
class Intent(str, Enum):
    """Unified 4-category intent taxonomy for the supervisor graph."""
    QA = "qa"
    ACTION = "action"
    PROACTIVE = "proactive"
    WIDGET = "widget"
    UNKNOWN = "unknown"


class FactCategory(str, Enum):
    """Categories for long-term memory facts extracted post-conversation."""
    PREFERENCE = "preference"
    CLIENT_NOTE = "client_note"
    DECISION = "decision"
    PATTERN = "pattern"
    RELATIONSHIP = "relationship"
```

Keep the old `IntentType` enum in place (don't delete it yet — the old orchestrator.py still imports it until Task 8 replaces it). Add a deprecation comment:

```python
class IntentType(str, Enum):
    """DEPRECATED: Use Intent enum instead. Kept for backward compat during migration."""
    # ... existing values unchanged
```

- [ ] **Step 2: Verify import works**

Run: `cd apps/agent-orchestrator && python3 -c "from models.types import Intent, FactCategory; print(Intent.QA, FactCategory.PREFERENCE)"`
Expected: `qa preference`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/models/types.py
git commit -m "feat(orchestrator): add Intent and FactCategory enums for supervisor graph"
```

---

### Task 2: Extend config/settings.py

**Files:**
- Modify: `apps/agent-orchestrator/src/config/settings.py`

- [ ] **Step 1: Add memory, Redis, and LLM model settings**

Add these fields to the `Settings` class after the existing `mongodb_uri` field:

```python
    # -----------------------------------------------------------------------
    # MongoDB — memory collections (direct Motor connection)
    # -----------------------------------------------------------------------
    memory_mongodb_uri: str = "mongodb://m1b.dev.pr.com:27017/RM_Buddy?directConnection=true"
    memory_db_name: str = "RM_Buddy"

    # -----------------------------------------------------------------------
    # LLM model aliases (via LiteLLM proxy)
    # -----------------------------------------------------------------------
    llm_smart_model: str = "claude-default"     # 70b — for compose, portfolio, revenue, scoring
    llm_fast_model: str = "gemini-cost"         # 8b — for classify, alert, engagement, document

    # -----------------------------------------------------------------------
    # Session / memory tuning
    # -----------------------------------------------------------------------
    session_ttl_seconds: int = 3600             # 1 hour Redis TTL for sessions
    max_conversation_history: int = 20          # Max messages loaded from session
    max_memory_facts: int = 10                  # Max preference facts loaded per request
    max_recent_summaries: int = 3               # Recent conversation summaries loaded
```

- [ ] **Step 2: Verify settings load**

Run: `cd apps/agent-orchestrator && python3 -c "from config.settings import settings; print(settings.llm_smart_model, settings.memory_db_name)"`
Expected: `claude-default RM_Buddy`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/config/settings.py
git commit -m "feat(orchestrator): add memory, LLM model, and session settings"
```

---

### Task 3: Create guardrails/input_guardrails.py

**Files:**
- Create: `apps/agent-orchestrator/src/guardrails/__init__.py`
- Create: `apps/agent-orchestrator/src/guardrails/input_guardrails.py`

- [ ] **Step 1: Create the guardrails package and input guardrails**

```python
# guardrails/__init__.py
```

```python
# guardrails/input_guardrails.py
"""Input validation — prompt injection and off-topic detection."""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass

logger = logging.getLogger("guardrails.input")

INJECTION_PATTERNS = [
    r"ignore (previous|all) instructions",
    r"reveal (system|your) prompt",
    r"pretend (you are|to be)",
    r"jailbreak",
    r"DAN mode",
    r"act as",
    r"bypass",
    r"disregard your system prompt",
]

OFF_TOPIC_PATTERNS = [
    r"\b(cricket|movie|song|recipe|weather|stock market tip)\b",
]


@dataclass
class InputGuardResult:
    is_blocked: bool
    reason: str | None = None


def check_input(text: str, rm_id: str = "") -> InputGuardResult:
    """Check user input for prompt injection and off-topic patterns."""
    text_lower = text.lower()

    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, text_lower):
            logger.warning("Prompt injection attempt [rm_id=%s, pattern=%s]", rm_id, pattern)
            return InputGuardResult(is_blocked=True, reason="Potential prompt injection detected")

    for pattern in OFF_TOPIC_PATTERNS:
        if re.search(pattern, text_lower):
            return InputGuardResult(
                is_blocked=True,
                reason="Off-topic request — I only assist with wealth management tasks",
            )

    return InputGuardResult(is_blocked=False)
```

- [ ] **Step 2: Verify**

Run: `cd apps/agent-orchestrator && python3 -c "from guardrails.input_guardrails import check_input; r = check_input('ignore previous instructions'); print(r.is_blocked, r.reason)"`
Expected: `True Potential prompt injection detected`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/guardrails/
git commit -m "feat(orchestrator): add input guardrails — injection + off-topic detection"
```

---

### Task 4: Create guardrails/output_guardrails.py

**Files:**
- Create: `apps/agent-orchestrator/src/guardrails/output_guardrails.py`

- [ ] **Step 1: Create output guardrails**

```python
# guardrails/output_guardrails.py
"""Output validation — financial advice detection and uncertainty disclaimers."""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass

logger = logging.getLogger("guardrails.output")

ADVICE_PATTERNS = [
    r"\b(you should (buy|sell|invest))\b",
    r"\b(guaranteed (return|profit))\b",
    r"\b(will definitely (go up|rise|grow))\b",
    r"\binvest in \b",
    r"\byou should purchase\b",
]

UNCERTAINTY_PHRASES = [
    "i'm not sure",
    "i don't know",
    "i cannot confirm",
]

_DISCLAIMER = "\n\n_Note: Please verify this information with the CRM before acting._"


@dataclass
class OutputGuardResult:
    cleaned_text: str
    flags: list[str]


def check_output(text: str) -> OutputGuardResult:
    """Check agent output for unauthorized advice and uncertainty."""
    flags: list[str] = []
    cleaned = text

    text_lower = text.lower()

    # Check for unauthorized financial advice
    for pattern in ADVICE_PATTERNS:
        if re.search(pattern, text_lower):
            flags.append(f"output:financial_advice:{pattern}")
            logger.warning("Output flagged: potential unauthorized financial advice")
            cleaned = (
                "I can provide information about portfolios and performance, "
                "but I'm not able to recommend specific investment actions."
            )
            return OutputGuardResult(cleaned_text=cleaned, flags=flags)

    # Add disclaimer for uncertain responses
    if any(phrase in text_lower for phrase in UNCERTAINTY_PHRASES):
        flags.append("output:uncertainty_disclaimer")
        cleaned = text + _DISCLAIMER

    return OutputGuardResult(cleaned_text=cleaned, flags=flags)
```

- [ ] **Step 2: Verify**

Run: `cd apps/agent-orchestrator && python3 -c "from guardrails.output_guardrails import check_output; r = check_output('you should buy HDFC'); print(r.flags, r.cleaned_text[:50])"`
Expected: `['output:financial_advice:...'] I can provide information...`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/guardrails/output_guardrails.py
git commit -m "feat(orchestrator): add output guardrails — advice filter + uncertainty disclaimer"
```

---

### Task 5: Create prompts/supervisor_prompt.py

**Files:**
- Create: `apps/agent-orchestrator/src/prompts/__init__.py`
- Create: `apps/agent-orchestrator/src/prompts/supervisor_prompt.py`

- [ ] **Step 1: Create supervisor prompts**

```python
# prompts/__init__.py
```

```python
# prompts/supervisor_prompt.py
"""System prompts for the supervisor compose node — Aria and Vikram personas."""

ARIA_SYSTEM_PROMPT = """You are Aria, an AI assistant for Relationship Managers at Nuvama Wealth Management.

## Your Role
You help RMs manage their client relationships, track portfolios, and stay on top of opportunities and alerts.

## Personality
- Professional, warm, and concise
- Speak like a knowledgeable colleague, not a formal chatbot
- Use Indian financial context (₹, crores, lakhs, MFs, SIPs)
- When uncertain, say so — never hallucinate financial figures

## Boundaries
- Only discuss wealth management, client relationships, and CRM tasks
- Never give investment advice on behalf of the RM ("you should buy X")
- Never access or reveal another RM's client data
- For compliance-sensitive queries, recommend consulting the compliance team

## Response Style
- Keep responses under 150 words unless the RM asks for detail
- Use bullet points for lists of clients or actions
- Always end action responses with what was done
"""

VIKRAM_SYSTEM_PROMPT = """You are Vikram, an AI assistant for Branch Managers at Nuvama Wealth Management.

## Your Role
You help BMs manage their branch operations, track team performance, and identify coaching opportunities.

## Personality
- Professional, strategic, and data-driven
- Speak like a senior colleague providing executive insights
- Use Indian financial context (₹, crores, lakhs)
- Present comparative data (branch vs. team averages)

## Boundaries
- Only discuss wealth management, branch operations, and team performance
- Never give investment advice
- Never reveal individual RM performance data to other RMs

## Response Style
- Keep responses under 200 words unless detail is requested
- Use tables and bullet points for team data
- Always include actionable next steps
"""

COMPOSE_PROMPT = """You are composing a final response for the RM using data gathered by specialist agents.

Below are the findings from each specialist. Synthesize them into ONE coherent, natural response.

## Specialist Findings:
{specialist_findings}

## Memory Context:
{memory_context}

## Instructions:
1. Merge the specialist findings into a natural response — don't list agents separately
2. If memory context includes RM preferences, personalize accordingly
3. Use Indian financial formatting (₹, Cr, L, K)
4. Be concise — under 150 words unless the question warrants detail
5. If any specialist found no data, skip it silently — don't mention empty results
6. End with a brief actionable suggestion when appropriate
"""

INTENT_CLASSIFY_PROMPT = """Classify the user's intent into exactly one of: qa, action, proactive, widget, unknown.

- qa: Questions about clients, portfolios, metrics, or general information
- action: Requests to DO something (schedule meeting, send email, update record) — NOT just viewing data
- proactive: Morning briefing, "good morning", "start my day", system-triggered nudges
- widget: Explicit requests to "show me" data as a visual widget/card/table
- unknown: Cannot determine intent

Reply with ONLY the intent label (lowercase, one word). Nothing else."""
```

- [ ] **Step 2: Verify imports**

Run: `cd apps/agent-orchestrator && python3 -c "from prompts.supervisor_prompt import ARIA_SYSTEM_PROMPT, COMPOSE_PROMPT; print(len(ARIA_SYSTEM_PROMPT), len(COMPOSE_PROMPT))"`
Expected: Two numbers (non-zero)

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/prompts/
git commit -m "feat(orchestrator): add supervisor prompts — Aria, Vikram, compose, intent classify"
```

---

### Task 6: Create prompts/specialist_prompts.py

**Files:**
- Create: `apps/agent-orchestrator/src/prompts/specialist_prompts.py`

- [ ] **Step 1: Create specialist prompts**

```python
# prompts/specialist_prompts.py
"""System prompts for each specialist agent."""

ALERT_AGENT_PROMPT = """You are the Alert Specialist for RM Buddy.
Your job: retrieve and summarize portfolio anomalies, risk alerts, and market events for the RM's clients.
Be brief. List alerts by priority (high → medium → low). Include client name and action needed.
Use Indian financial formatting (₹, Cr, L, K)."""

PORTFOLIO_AGENT_PROMPT = """You are the Portfolio Specialist for RM Buddy.
Your job: analyze portfolio composition, drift from target allocation, and rebalancing opportunities.
Also answer general client queries — client counts, tiers, AUM totals.
Always cite actual numbers from the tools. Flag portfolios with high drift scores.
Use Indian financial formatting (₹, Cr, L, K)."""

REVENUE_AGENT_PROMPT = """You are the Revenue Specialist for RM Buddy.
Your job: analyze AUM, commissions, and revenue metrics for the RM's book of business.
Present numbers clearly. Flag underperforming clients or revenue opportunities.
Use Indian financial formatting (₹, Cr, L, K)."""

SCORING_AGENT_PROMPT = """You are the Scoring Specialist for RM Buddy.
Your job: retrieve and interpret client risk scores and profile assessments.
Explain what the scores mean in plain language. Flag clients whose risk profile may need review.
Use Indian financial formatting (₹, Cr, L, K)."""

ENGAGEMENT_AGENT_PROMPT = """You are the Engagement Specialist for RM Buddy.
Your job: surface engagement gaps — clients not contacted recently, upcoming anniversaries, follow-ups due.
Prioritize by last interaction date. Suggest next actions.
Use Indian financial formatting (₹, Cr, L, K)."""

DOCUMENT_AGENT_PROMPT = """You are the Document Specialist for RM Buddy.
Your job: search the knowledge base for relevant product information, compliance rules, and policies.
Always cite the source document. If information is not found, say so explicitly."""
```

- [ ] **Step 2: Verify**

Run: `cd apps/agent-orchestrator && python3 -c "from prompts.specialist_prompts import ALERT_AGENT_PROMPT, PORTFOLIO_AGENT_PROMPT; print('OK')`"
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/prompts/specialist_prompts.py
git commit -m "feat(orchestrator): add specialist agent prompts"
```

---

## Chunk 2: Thread Safety Fix, New State, Memory System

### Task 7: Fix crm_tool.py thread safety with contextvars

**Files:**
- Modify: `apps/agent-orchestrator/src/tools/crm_tool.py`

- [ ] **Step 1: Replace module-level dict with ContextVar**

Replace lines 1-80 of `crm_tool.py` (the imports + identity management section) with:

```python
"""
crm_tool.py — LangChain tools for CRM data access via Core API.

Uses contextvars.ContextVar for thread-safe RM identity context, enabling
parallel specialist agent dispatch via asyncio.gather().
"""

from __future__ import annotations

import contextvars
import json
import logging
from typing import Any, Optional

import httpx
from langchain_core.tools import tool

from config.settings import settings

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# RM identity context — ContextVar for async-safe parallel dispatch
# ---------------------------------------------------------------------------

_rm_context_var: contextvars.ContextVar[dict[str, Any]] = contextvars.ContextVar(
    "rm_context", default={}
)

_HTTP_TIMEOUT = 10.0  # seconds


def set_rm_context(rm_identity: dict[str, Any]) -> None:
    """
    Set the RM identity context for the current async task.

    Thread/task safe: uses contextvars so parallel asyncio.gather() tasks
    each get their own copy.
    """
    _rm_context_var.set(rm_identity)


def _get_identity_header() -> str:
    """Serialise the current RM identity to a JSON string for X-RM-Identity header."""
    return json.dumps(_rm_context_var.get())


def _build_headers() -> dict[str, str]:
    """Return the base HTTP headers for all Core API requests."""
    return {
        "Content-Type": "application/json",
        "X-RM-Identity": _get_identity_header(),
    }
```

Keep ALL the tool functions (`get_client_list`, `get_client_profile`, `get_client_portfolio`, `get_alerts`, `get_dashboard_summary`) exactly as they are — they already call `_build_headers()` which now uses the ContextVar.

- [ ] **Step 2: Verify existing tools still work**

Run: `cd apps/agent-orchestrator && python3 -c "from tools.crm_tool import set_rm_context, _build_headers; set_rm_context({'rm_id': 'RM001'}); print(_build_headers())"`
Expected: `{'Content-Type': 'application/json', 'X-RM-Identity': '{"rm_id": "RM001"}'}`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/tools/crm_tool.py
git commit -m "fix(orchestrator): use contextvars for thread-safe RM identity in parallel dispatch"
```

---

### Task 8: Expand graphs/state.py — new AgentState

**Files:**
- Modify: `apps/agent-orchestrator/src/graphs/state.py`

- [ ] **Step 1: Rewrite AgentState with new fields**

Replace the entire file:

```python
"""
state.py — AgentState TypedDict for the supervisor graph.

Expanded from the original orchestrator state to support:
- Parallel specialist dispatch (active_specialists, specialist_results)
- Context builder output (loaded_context)
- New intent taxonomy (Intent enum)
- Guardrail results (guardrail_blocked, guardrail_reason)
"""

from __future__ import annotations

from typing import Annotated, Any, Optional

from langgraph.graph import add_messages
from typing_extensions import TypedDict


class AgentState(TypedDict):
    """Full state bag passed between every node in the supervisor graph."""

    # ------------------------------------------------------------------
    # Input — populated from request before graph invocation
    # ------------------------------------------------------------------
    rm_id: str
    rm_role: str                        # 'RM' | 'BM' | 'ADMIN'
    session_id: str
    conversation_id: str
    message: str
    message_type: str                   # 'text' | 'voice_transcript'

    # ------------------------------------------------------------------
    # Context — populated by build_context node
    # ------------------------------------------------------------------
    rm_context: Optional[dict]          # RM identity from request header
    client_context: Optional[dict]      # Active client being discussed
    loaded_context: Optional[dict]      # Full context from ContextBuilder:
                                        #   session, clients, alerts, preferences,
                                        #   memories, summaries

    # ------------------------------------------------------------------
    # Classification — populated by classify_intent node
    # ------------------------------------------------------------------
    intent: Optional[str]               # Intent enum value
    intent_confidence: float            # 0.0 – 1.0
    active_specialists: list[str]       # Which specialist agents to dispatch

    # ------------------------------------------------------------------
    # Specialist results — populated by dispatch_specialists node
    # ------------------------------------------------------------------
    specialist_results: dict[str, str]  # {"alert": "text", "portfolio": "text", ...}

    # ------------------------------------------------------------------
    # Final output — populated by compose_response node
    # ------------------------------------------------------------------
    tool_results: list[dict]            # Raw results from tool calls
    response: Optional[str]             # Final prose text
    widgets: list[dict]                 # List of WidgetPayload-compatible dicts

    # ------------------------------------------------------------------
    # Control flow
    # ------------------------------------------------------------------
    guardrail_blocked: bool
    guardrail_reason: Optional[str]
    guardrail_flags: list[str]          # Detailed flags for metadata
    error: Optional[str]

    # ------------------------------------------------------------------
    # LangGraph conversation history
    # ------------------------------------------------------------------
    messages: Annotated[list, add_messages]
```

- [ ] **Step 2: Verify import**

Run: `cd apps/agent-orchestrator && python3 -c "from graphs.state import AgentState; print(AgentState.__annotations__.keys())"`
Expected: All field names printed

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/graphs/state.py
git commit -m "feat(orchestrator): expand AgentState for supervisor graph — parallel dispatch, memory, context"
```

---

### Task 9: Create memory/context_builder.py

**Files:**
- Create: `apps/agent-orchestrator/src/memory/context_builder.py`

- [ ] **Step 1: Create context builder**

```python
# memory/context_builder.py
"""
Pre-chat context assembly pipeline.

Loads session state, RM client summary, pending alerts, RM preferences,
relevant memories, and recent conversation summaries — all concurrently.
"""

from __future__ import annotations

import asyncio
import logging
from typing import Any

import httpx
from motor.motor_asyncio import AsyncIOMotorDatabase

from config.settings import settings
from tools.crm_tool import _build_headers

logger = logging.getLogger("memory.context_builder")


class ContextBuilder:
    """Assembles the full context dict loaded before every chat interaction."""

    def __init__(self, memory_db: AsyncIOMotorDatabase) -> None:
        self._db = memory_db

    async def build(
        self, session_id: str, rm_id: str, query: str = ""
    ) -> dict[str, Any]:
        """
        Load all context sources concurrently and return assembled dict.

        Args:
            session_id: Current session UUID.
            rm_id: RM employee ID.
            query: User's message (used for semantic memory matching).

        Returns:
            Dict with keys: session, clients, alerts, preferences, memories, summaries.
        """
        results = await asyncio.gather(
            self._load_session(session_id),
            self._load_clients_summary(rm_id),
            self._load_pending_alerts(rm_id),
            self._load_preferences(rm_id),
            self._load_relevant_memories(rm_id, query),
            self._load_recent_summaries(rm_id),
            return_exceptions=True,
        )

        context: dict[str, Any] = {}
        keys = ["session", "clients", "alerts", "preferences", "memories", "summaries"]
        for key, result in zip(keys, results):
            if isinstance(result, Exception):
                logger.warning("Context load failed [key=%s, error=%s]", key, result)
                context[key] = [] if key != "session" else {}
            else:
                context[key] = result

        return context

    async def _load_session(self, session_id: str) -> dict[str, Any]:
        """Load session state from MongoDB (Redis handled by SessionManager)."""
        doc = await self._db["agent_sessions"].find_one(
            {"session_id": session_id}, {"_id": 0}
        )
        return doc or {}

    async def _load_clients_summary(self, rm_id: str) -> list[dict]:
        """Load top 10 clients by AUM from Core API."""
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    f"{settings.core_api_url}/api/v1/clients",
                    params={"limit": 10},
                    headers=_build_headers(),
                )
            if resp.status_code < 400:
                raw = resp.json()
                data = raw.get("data", raw)
                return data if isinstance(data, list) else []
        except Exception as exc:
            logger.warning("Failed to load clients summary: %s", exc)
        return []

    async def _load_pending_alerts(self, rm_id: str) -> list[dict]:
        """Load pending alerts from Core API."""
        try:
            async with httpx.AsyncClient(timeout=8.0) as client:
                resp = await client.get(
                    f"{settings.core_api_url}/api/v1/alerts",
                    params={"status": "pending"},
                    headers=_build_headers(),
                )
            if resp.status_code < 400:
                raw = resp.json()
                data = raw.get("data", raw)
                return data if isinstance(data, list) else []
        except Exception as exc:
            logger.warning("Failed to load alerts: %s", exc)
        return []

    async def _load_preferences(self, rm_id: str) -> list[dict]:
        """Load RM preference facts from memory DB."""
        cursor = self._db["rm_facts"].find(
            {"rm_id": rm_id, "category": "preference", "active": True},
            {"_id": 0, "content": 1, "confidence": 1},
        ).sort("confidence", -1).limit(settings.max_memory_facts)
        return await cursor.to_list(length=settings.max_memory_facts)

    async def _load_relevant_memories(self, rm_id: str, query: str) -> list[dict]:
        """Load memories relevant to the query (text match for now; vector search future)."""
        if not query:
            return []
        # Extract keywords from query for simple text matching
        keywords = [w for w in query.lower().split() if len(w) > 3]
        if not keywords:
            return []
        regex_pattern = "|".join(keywords[:5])
        cursor = self._db["rm_facts"].find(
            {
                "rm_id": rm_id,
                "active": True,
                "content": {"$regex": regex_pattern, "$options": "i"},
            },
            {"_id": 0, "category": 1, "content": 1, "confidence": 1},
        ).limit(5)
        return await cursor.to_list(length=5)

    async def _load_recent_summaries(self, rm_id: str) -> list[dict]:
        """Load last N conversation summaries."""
        cursor = self._db["conversation_summaries"].find(
            {"rm_id": rm_id},
            {"_id": 0, "summary": 1, "topics": 1, "clients_discussed": 1, "created_at": 1},
        ).sort("created_at", -1).limit(settings.max_recent_summaries)
        return await cursor.to_list(length=settings.max_recent_summaries)
```

- [ ] **Step 2: Verify import**

Run: `cd apps/agent-orchestrator && python3 -c "from memory.context_builder import ContextBuilder; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/memory/context_builder.py
git commit -m "feat(orchestrator): add ContextBuilder — pre-chat context assembly pipeline"
```

---

### Task 10: Create memory/session_manager.py (enhanced)

**Files:**
- Modify: `apps/agent-orchestrator/src/memory/session_memory.py` → keep as-is (backward compat)
- Create: `apps/agent-orchestrator/src/memory/session_manager.py`

- [ ] **Step 1: Create enhanced SessionManager**

```python
# memory/session_manager.py
"""
Enhanced session management with write-through Redis+MongoDB strategy.

Replaces the older SessionMemory for the new supervisor graph.
Uses agent_sessions collection (not chat_history).
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Any

from motor.motor_asyncio import AsyncIOMotorDatabase

from config.settings import settings

logger = logging.getLogger("memory.session_manager")


class SessionManager:
    """Write-through session manager: Redis (fast) + MongoDB (durable)."""

    def __init__(self, redis_client: Any, memory_db: AsyncIOMotorDatabase) -> None:
        self._redis = redis_client
        self._db = memory_db
        self._collection = self._db["agent_sessions"]
        self._ttl = settings.session_ttl_seconds

    def _redis_key(self, session_id: str) -> str:
        return f"session:{session_id}"

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        """Load session: Redis first, MongoDB fallback, repopulate Redis on miss."""
        key = self._redis_key(session_id)

        # Try Redis
        try:
            raw = await self._redis.get(key)
            if raw:
                logger.debug("Session Redis hit [session_id=%s]", session_id)
                return json.loads(raw)
        except Exception as exc:
            logger.warning("Redis get failed: %s", exc)

        # MongoDB fallback
        doc = await self._collection.find_one(
            {"session_id": session_id}, {"_id": 0}
        )
        if doc:
            # Repopulate Redis
            try:
                await self._redis.setex(key, self._ttl, json.dumps(doc, default=str))
            except Exception:
                pass
            return doc
        return None

    async def save_session(
        self,
        session_id: str,
        rm_id: str,
        conversation_id: str,
        messages: list[dict[str, Any]],
        active_client: dict | None = None,
        metadata: dict | None = None,
    ) -> None:
        """Save session: MongoDB first (durable), then Redis (cache)."""
        now = datetime.now(timezone.utc)
        doc = {
            "session_id": session_id,
            "rm_id": rm_id,
            "conversation_id": conversation_id,
            "messages": messages[-settings.max_conversation_history:],  # Trim to max
            "active_client": active_client,
            "metadata": metadata or {},
            "updated_at": now,
            "expires_at": now + timedelta(seconds=self._ttl),
        }

        # MongoDB first
        await self._collection.update_one(
            {"session_id": session_id},
            {"$set": doc, "$setOnInsert": {"created_at": now}},
            upsert=True,
        )

        # Redis second
        key = self._redis_key(session_id)
        try:
            await self._redis.setex(key, self._ttl, json.dumps(doc, default=str))
        except Exception as exc:
            logger.warning("Redis set failed (non-fatal): %s", exc)

    async def append_message(
        self, session_id: str, message: dict[str, Any]
    ) -> None:
        """Append a single message to an existing session."""
        await self._collection.update_one(
            {"session_id": session_id},
            {
                "$push": {"messages": message},
                "$set": {"updated_at": datetime.now(timezone.utc)},
            },
        )
        # Invalidate Redis cache so next get_session picks up the new message
        try:
            await self._redis.delete(self._redis_key(session_id))
        except Exception:
            pass
```

- [ ] **Step 2: Verify import**

Run: `cd apps/agent-orchestrator && python3 -c "from memory.session_manager import SessionManager; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/memory/session_manager.py
git commit -m "feat(orchestrator): add SessionManager — write-through Redis+MongoDB sessions"
```

---

### Task 11: Create memory/post_conversation.py

**Files:**
- Create: `apps/agent-orchestrator/src/memory/post_conversation.py`

- [ ] **Step 1: Create post-conversation fact extraction hook**

```python
# memory/post_conversation.py
"""
Post-conversation hook — extracts facts and summaries after each chat.

Runs as a FastAPI BackgroundTask (non-blocking). Uses LLM to extract:
- Facts: preference, client_note, decision, pattern, relationship
- Conversation summary: 2-3 sentences + topics + clients discussed
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from langchain_openai import ChatOpenAI
from motor.motor_asyncio import AsyncIOMotorDatabase

from config.settings import settings

logger = logging.getLogger("memory.post_conversation")

EXTRACTION_PROMPT = """Analyze this conversation between an RM and AI assistant. Extract:

1. **Summary**: 2-3 sentence summary of what was discussed.
2. **Topics**: List of topics (e.g., ["portfolio", "alerts", "rebalancing"])
3. **Clients discussed**: List of client IDs or names mentioned.
4. **Facts**: Non-trivial facts to remember. Each fact has:
   - category: one of "preference", "client_note", "decision", "pattern", "relationship"
   - content: the fact in one sentence
   - confidence: 0.5 to 1.0 (how certain this fact is)
   - client_id: if the fact is about a specific client (optional, null otherwise)

Only extract facts that are genuinely useful for future conversations.
Do NOT extract trivial observations.

Return JSON:
{{
  "summary": "...",
  "topics": [...],
  "clients_discussed": [...],
  "facts": [
    {{"category": "...", "content": "...", "confidence": 0.8, "client_id": null}}
  ]
}}

Conversation:
{conversation}

Specialist findings:
{specialist_results}
"""


async def run_post_conversation_hook(
    memory_db: AsyncIOMotorDatabase,
    rm_id: str,
    conversation_id: str,
    session_id: str,
    messages: list[Any],
    specialist_results: dict[str, str],
) -> None:
    """Extract facts and summary from conversation, save to memory DB."""
    try:
        # Format conversation text
        conversation_text = _format_conversation(messages)
        specialist_text = "\n".join(
            f"[{name}]: {text}" for name, text in specialist_results.items()
        )

        if not conversation_text.strip():
            return

        # Call LLM for extraction
        llm = ChatOpenAI(
            base_url=f"{settings.litellm_url}/v1",
            api_key=settings.litellm_master_key,
            model=settings.llm_fast_model,
            temperature=0.1,
        )

        prompt = EXTRACTION_PROMPT.format(
            conversation=conversation_text,
            specialist_results=specialist_text or "None",
        )
        response = await llm.ainvoke([{"role": "user", "content": prompt}])

        # Parse LLM response
        content = response.content if hasattr(response, "content") else str(response)
        # Try to extract JSON from the response
        extracted = _parse_json_response(content)
        if not extracted:
            logger.warning("Post-conversation extraction returned no valid JSON")
            return

        now = datetime.now(timezone.utc)

        # Save conversation summary
        summary_doc = {
            "rm_id": rm_id,
            "conversation_id": conversation_id,
            "session_id": session_id,
            "summary": extracted.get("summary", ""),
            "topics": extracted.get("topics", []),
            "clients_discussed": extracted.get("clients_discussed", []),
            "created_at": now,
        }
        await memory_db["conversation_summaries"].insert_one(summary_doc)

        # Save facts (upsert by content match)
        facts = extracted.get("facts", [])
        for fact in facts:
            if not fact.get("content"):
                continue
            await memory_db["rm_facts"].update_one(
                {"rm_id": rm_id, "content": fact["content"]},
                {
                    "$set": {
                        "rm_id": rm_id,
                        "category": fact.get("category", "client_note"),
                        "content": fact["content"],
                        "confidence": fact.get("confidence", 0.7),
                        "client_id": fact.get("client_id"),
                        "active": True,
                        "updated_at": now,
                    },
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )

        logger.info(
            "Post-conversation extraction complete [rm_id=%s, facts=%d, summary=%s]",
            rm_id, len(facts), bool(extracted.get("summary")),
        )

    except Exception as exc:
        logger.error("Post-conversation hook failed: %s", exc, exc_info=True)


def _format_conversation(messages: list[Any]) -> str:
    """Format LangGraph messages into readable conversation text."""
    lines = []
    for msg in messages:
        if hasattr(msg, "content") and hasattr(msg, "type"):
            role = "RM" if msg.type == "human" else "Aria"
            lines.append(f"{role}: {msg.content}")
        elif isinstance(msg, dict):
            role = "RM" if msg.get("role") == "user" else "Aria"
            lines.append(f"{role}: {msg.get('content', '')}")
    return "\n".join(lines)


def _parse_json_response(text: str) -> dict | None:
    """Extract JSON from LLM response, handling markdown code blocks."""
    # Try direct parse
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    # Try extracting from ```json ... ``` block
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.index("```", start)
        try:
            return json.loads(text[start:end].strip())
        except (json.JSONDecodeError, ValueError):
            pass
    # Try extracting from { ... }
    brace_start = text.find("{")
    brace_end = text.rfind("}")
    if brace_start >= 0 and brace_end > brace_start:
        try:
            return json.loads(text[brace_start:brace_end + 1])
        except json.JSONDecodeError:
            pass
    return None
```

- [ ] **Step 2: Verify import**

Run: `cd apps/agent-orchestrator && python3 -c "from memory.post_conversation import _parse_json_response; print(_parse_json_response('{\"summary\": \"test\"}'))"`
Expected: `{'summary': 'test'}`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/memory/post_conversation.py
git commit -m "feat(orchestrator): add post-conversation hook — LLM fact extraction + summary"
```

---

## Chunk 3: Specialist Agents + RAG Stub

### Task 12: Create graphs/specialists/ — all 6 agents

**Files:**
- Create: `apps/agent-orchestrator/src/graphs/specialists/__init__.py`
- Create: `apps/agent-orchestrator/src/graphs/specialists/alert_agent.py`
- Create: `apps/agent-orchestrator/src/graphs/specialists/portfolio_agent.py`
- Create: `apps/agent-orchestrator/src/graphs/specialists/revenue_agent.py`
- Create: `apps/agent-orchestrator/src/graphs/specialists/engagement_agent.py`
- Create: `apps/agent-orchestrator/src/graphs/specialists/scoring_agent.py`
- Create: `apps/agent-orchestrator/src/graphs/specialists/document_agent.py`

- [ ] **Step 1: Create __init__.py with agent registry**

```python
# graphs/specialists/__init__.py
"""Specialist agent registry — maps agent names to run functions."""

from .alert_agent import run_alert_agent
from .portfolio_agent import run_portfolio_agent
from .revenue_agent import run_revenue_agent
from .engagement_agent import run_engagement_agent
from .scoring_agent import run_scoring_agent
from .document_agent import run_document_agent

SPECIALIST_REGISTRY = {
    "alert": run_alert_agent,
    "portfolio": run_portfolio_agent,
    "revenue": run_revenue_agent,
    "engagement": run_engagement_agent,
    "scoring": run_scoring_agent,
    "document": run_document_agent,
}
```

- [ ] **Step 2: Create alert_agent.py**

```python
# graphs/specialists/alert_agent.py
"""Alert specialist — retrieves and summarizes portfolio anomalies and alerts."""

from __future__ import annotations
from typing import Any

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from config.settings import settings
from graphs.state import AgentState
from prompts.specialist_prompts import ALERT_AGENT_PROMPT
from tools.crm_tool import get_alerts


def _make_agent():
    llm = ChatOpenAI(
        base_url=f"{settings.litellm_url}/v1",
        api_key=settings.litellm_master_key,
        model=settings.llm_fast_model,
    )
    return create_react_agent(llm, tools=[get_alerts], state_modifier=ALERT_AGENT_PROMPT)


async def run_alert_agent(state: AgentState) -> dict[str, Any]:
    """Run alert specialist and return result text."""
    agent = _make_agent()
    result = await agent.ainvoke({"messages": state["messages"]})
    text = result["messages"][-1].content if result["messages"] else ""
    return {"specialist_results": {"alert": text}}
```

- [ ] **Step 3: Create portfolio_agent.py**

```python
# graphs/specialists/portfolio_agent.py
"""Portfolio specialist — client queries, holdings, allocation drift, AUM."""

from __future__ import annotations
from typing import Any

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from config.settings import settings
from graphs.state import AgentState
from prompts.specialist_prompts import PORTFOLIO_AGENT_PROMPT
from tools.crm_tool import get_client_list, get_client_profile, get_client_portfolio
from tools.search_tool import search_clients_by_name


def _make_agent():
    llm = ChatOpenAI(
        base_url=f"{settings.litellm_url}/v1",
        api_key=settings.litellm_master_key,
        model=settings.llm_smart_model,
    )
    return create_react_agent(
        llm,
        tools=[get_client_list, get_client_profile, get_client_portfolio, search_clients_by_name],
        state_modifier=PORTFOLIO_AGENT_PROMPT,
    )


async def run_portfolio_agent(state: AgentState) -> dict[str, Any]:
    agent = _make_agent()
    result = await agent.ainvoke({"messages": state["messages"]})
    text = result["messages"][-1].content if result["messages"] else ""
    return {"specialist_results": {"portfolio": text}}
```

- [ ] **Step 4: Create revenue_agent.py**

```python
# graphs/specialists/revenue_agent.py
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
        state_modifier=REVENUE_AGENT_PROMPT,
    )


async def run_revenue_agent(state: AgentState) -> dict[str, Any]:
    agent = _make_agent()
    result = await agent.ainvoke({"messages": state["messages"]})
    text = result["messages"][-1].content if result["messages"] else ""
    return {"specialist_results": {"revenue": text}}
```

- [ ] **Step 5: Create engagement_agent.py**

```python
# graphs/specialists/engagement_agent.py
"""Engagement specialist — interaction gaps, contact frequency, follow-ups."""

from __future__ import annotations
from typing import Any

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from config.settings import settings
from graphs.state import AgentState
from prompts.specialist_prompts import ENGAGEMENT_AGENT_PROMPT
from tools.crm_tool import get_client_list, get_client_profile


def _make_agent():
    llm = ChatOpenAI(
        base_url=f"{settings.litellm_url}/v1",
        api_key=settings.litellm_master_key,
        model=settings.llm_fast_model,
    )
    return create_react_agent(
        llm,
        tools=[get_client_list, get_client_profile],
        state_modifier=ENGAGEMENT_AGENT_PROMPT,
    )


async def run_engagement_agent(state: AgentState) -> dict[str, Any]:
    agent = _make_agent()
    result = await agent.ainvoke({"messages": state["messages"]})
    text = result["messages"][-1].content if result["messages"] else ""
    return {"specialist_results": {"engagement": text}}
```

- [ ] **Step 6: Create scoring_agent.py**

```python
# graphs/specialists/scoring_agent.py
"""Scoring specialist — client risk scores and profile assessments."""

from __future__ import annotations
from typing import Any

from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

from config.settings import settings
from graphs.state import AgentState
from prompts.specialist_prompts import SCORING_AGENT_PROMPT
from tools.crm_tool import get_client_profile, get_client_portfolio


def _make_agent():
    llm = ChatOpenAI(
        base_url=f"{settings.litellm_url}/v1",
        api_key=settings.litellm_master_key,
        model=settings.llm_smart_model,
    )
    return create_react_agent(
        llm,
        tools=[get_client_profile, get_client_portfolio],
        state_modifier=SCORING_AGENT_PROMPT,
    )


async def run_scoring_agent(state: AgentState) -> dict[str, Any]:
    agent = _make_agent()
    result = await agent.ainvoke({"messages": state["messages"]})
    text = result["messages"][-1].content if result["messages"] else ""
    return {"specialist_results": {"scoring": text}}
```

- [ ] **Step 7: Create document_agent.py (RAG stub)**

```python
# graphs/specialists/document_agent.py
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
        state_modifier=DOCUMENT_AGENT_PROMPT,
    )


async def run_document_agent(state: AgentState) -> dict[str, Any]:
    agent = _make_agent()
    result = await agent.ainvoke({"messages": state["messages"]})
    text = result["messages"][-1].content if result["messages"] else ""
    return {"specialist_results": {"document": text}}
```

- [ ] **Step 8: Commit all specialists**

```bash
git add apps/agent-orchestrator/src/graphs/specialists/
git commit -m "feat(orchestrator): add 6 function-based specialist agents — alert, portfolio, revenue, engagement, scoring, document"
```

---

### Task 13: Create tools/rag_tool.py (stub)

**Files:**
- Create: `apps/agent-orchestrator/src/tools/rag_tool.py`

- [ ] **Step 1: Create RAG tool stub**

```python
# tools/rag_tool.py
"""RAG tool — vector search over knowledge base (stub until documents are ingested)."""

from __future__ import annotations

import logging
from typing import Any

from langchain_core.tools import tool

logger = logging.getLogger(__name__)


@tool
async def search_knowledge_base(query: str, top_k: int = 5) -> dict[str, Any]:
    """Search the knowledge base for relevant product docs, compliance rules, or policies.

    Args:
        query: Natural language search query.
        top_k: Maximum number of results to return. Default 5.

    Returns:
        Dict with 'results' list (empty until knowledge base is populated).
    """
    logger.debug("search_knowledge_base called [query=%s, top_k=%d]", query, top_k)
    return {
        "results": [],
        "message": "Knowledge base not yet populated. Documents will be available after RAG ingestion is configured.",
    }
```

- [ ] **Step 2: Verify**

Run: `cd apps/agent-orchestrator && python3 -c "from tools.rag_tool import search_knowledge_base; print(search_knowledge_base.name)"`
Expected: `search_knowledge_base`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/tools/rag_tool.py
git commit -m "feat(orchestrator): add RAG tool stub — search_knowledge_base"
```

---

## Chunk 4: Supervisor Graph + API Endpoints + Main.py Refactor

### Task 14: Create graphs/supervisor.py — the new supervisor graph

**Files:**
- Create: `apps/agent-orchestrator/src/graphs/supervisor.py`

- [ ] **Step 1: Create the supervisor graph**

```python
# graphs/supervisor.py
"""
Supervisor graph — replaces the sequential orchestrator with parallel specialist dispatch.

Flow: input_guard → build_context → classify_intent → dispatch_specialists → compose_response → output_guard
"""

from __future__ import annotations

import asyncio
import logging
import time
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

        async def _run_one(name: str) -> tuple[str, str]:
            try:
                run_fn = SPECIALIST_REGISTRY[name]
                result = await run_fn(state)
                text = result.get("specialist_results", {}).get(name, "")
                return name, text
            except Exception as exc:
                logger.warning("Specialist %s failed: %s", name, exc)
                return name, ""

        tasks = [_run_one(name) for name in active if name in SPECIALIST_REGISTRY]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        specialist_results: dict[str, str] = {}
        for r in results:
            if isinstance(r, tuple):
                name, text = r
                if text:
                    specialist_results[name] = text
            elif isinstance(r, Exception):
                logger.warning("Specialist gather exception: %s", r)

        return {"specialist_results": specialist_results}

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

        try:
            llm = ChatOpenAI(
                base_url=f"{settings.litellm_url}/v1",
                api_key=settings.litellm_master_key,
                model=settings.llm_smart_model,
                temperature=settings.agent_temperature,
            )
            response = await llm.ainvoke([
                {"role": "system", "content": persona},
                {"role": "user", "content": state["message"]},
                {"role": "assistant", "content": compose_instruction},
                {"role": "user", "content": "Now compose the final response for the RM."},
            ])
            text = response.content if hasattr(response, "content") else str(response)
        except Exception as exc:
            logger.error("Compose response failed: %s", exc)
            # Fallback: return raw specialist findings
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
```

- [ ] **Step 2: Verify import compiles**

Run: `cd apps/agent-orchestrator && python3 -c "from graphs.supervisor import SupervisorGraph; print('OK')"`
Expected: `OK`

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/graphs/supervisor.py
git commit -m "feat(orchestrator): add supervisor graph — parallel dispatch + compose + guardrails"
```

---

### Task 15: Create api/v1/chat.py — extracted chat endpoint

**Files:**
- Create: `apps/agent-orchestrator/src/api/__init__.py`
- Create: `apps/agent-orchestrator/src/api/v1/__init__.py`
- Create: `apps/agent-orchestrator/src/api/v1/chat.py`

- [ ] **Step 1: Create the chat router**

```python
# api/__init__.py
```

```python
# api/v1/__init__.py
```

```python
# api/v1/chat.py
"""Synchronous chat endpoint — extracted from main.py."""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from langchain_core.messages import HumanMessage

from graphs.state import AgentState
from memory.post_conversation import run_post_conversation_hook
from models.schemas import AgentRequest, AgentResponse, WidgetPayload

logger = logging.getLogger("api.chat")
router = APIRouter()


@router.post(
    "/chat",
    response_model=AgentResponse,
    summary="Process an RM or BM message through the supervisor graph.",
)
async def chat(
    raw_request: Request,
    request: AgentRequest,
    background_tasks: BackgroundTasks,
) -> AgentResponse:
    """
    Main chat endpoint. Flow:
    1. Parse RM identity from header or context.
    2. Build initial state.
    3. Run supervisor graph (parallel specialists + compose).
    4. Save session + trigger post-conversation extraction in background.
    5. Return AgentResponse.
    """
    start_ms = time.monotonic()

    # Get shared resources from app state
    supervisor = raw_request.app.state.supervisor
    session_manager = raw_request.app.state.session_manager
    memory_db = raw_request.app.state.memory_db

    # Parse RM identity
    rm_identity: dict = {}
    identity_header = raw_request.headers.get("x-rm-identity", "")
    if identity_header:
        try:
            rm_identity = json.loads(identity_header)
        except Exception:
            pass
    if not rm_identity:
        rm_identity = request.context.get("rm_context", {}) if request.context else {}
    if not rm_identity:
        rm_identity = {"rm_id": request.rm_id, "role": "RM"}

    rm_role = rm_identity.get("role", (request.context or {}).get("rm_role", "RM"))
    conversation_id = str(uuid.uuid4())

    logger.info(
        "Chat request [rm_id=%s, session_id=%s, message=%.60s]",
        request.rm_id, request.session_id, request.message,
    )

    # Build initial state
    initial_state: AgentState = {
        "rm_id": request.rm_id,
        "rm_role": rm_role,
        "session_id": request.session_id,
        "conversation_id": conversation_id,
        "message": request.message,
        "message_type": request.message_type,
        "rm_context": rm_identity,
        "client_context": (request.context or {}).get("client_context"),
        "loaded_context": None,
        "intent": None,
        "intent_confidence": 0.0,
        "active_specialists": [],
        "specialist_results": {},
        "tool_results": [],
        "response": None,
        "widgets": [],
        "guardrail_blocked": False,
        "guardrail_reason": None,
        "guardrail_flags": [],
        "error": None,
        "messages": [HumanMessage(content=request.message)],
    }

    try:
        final_state = await supervisor.run(initial_state)
    except Exception as exc:
        logger.error("Supervisor graph failed [rm_id=%s]: %s", request.rm_id, exc)
        raise HTTPException(status_code=500, detail="Internal orchestrator error") from exc

    elapsed_ms = int((time.monotonic() - start_ms) * 1000)

    # Save session in background
    messages_for_session = [
        {"role": "user", "content": request.message},
        {"role": "assistant", "content": final_state.get("response", "")},
    ]
    background_tasks.add_task(
        session_manager.append_message,
        request.session_id,
        {"role": "user", "content": request.message, "rm_id": request.rm_id},
    )
    if final_state.get("response"):
        background_tasks.add_task(
            session_manager.append_message,
            request.session_id,
            {"role": "assistant", "content": final_state["response"]},
        )

    # Post-conversation hook in background
    background_tasks.add_task(
        run_post_conversation_hook,
        memory_db=memory_db,
        rm_id=request.rm_id,
        conversation_id=conversation_id,
        session_id=request.session_id,
        messages=final_state.get("messages", []),
        specialist_results=final_state.get("specialist_results", {}),
    )

    # Build response
    agent_id = "vikram" if rm_role == "BM" else "aria"
    widgets = [
        WidgetPayload(**w) if isinstance(w, dict) else w
        for w in (final_state.get("widgets") or [])
    ]
    has_error = bool(final_state.get("error"))
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
            "guardrail_flags": final_state.get("guardrail_flags", []),
            "active_specialists": final_state.get("active_specialists", []),
            "latency_ms": elapsed_ms,
        },
    )
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-orchestrator/src/api/
git commit -m "feat(orchestrator): extract chat endpoint to api/v1/chat.py with supervisor graph"
```

---

### Task 16: Create api/v1/stream.py — SSE streaming endpoint

**Files:**
- Create: `apps/agent-orchestrator/src/api/v1/stream.py`

- [ ] **Step 1: Install sse-starlette**

Run: `cd apps/agent-orchestrator && pip install sse-starlette`

- [ ] **Step 2: Create SSE streaming endpoint**

```python
# api/v1/stream.py
"""SSE streaming endpoint — streams step events and response tokens."""

from __future__ import annotations

import json
import logging
import uuid
from typing import AsyncGenerator

from fastapi import APIRouter, BackgroundTasks, Request
from sse_starlette.sse import EventSourceResponse
from langchain_core.messages import HumanMessage

from graphs.state import AgentState
from models.schemas import AgentRequest

logger = logging.getLogger("api.stream")
router = APIRouter()


@router.post(
    "/chat/stream",
    summary="SSE streaming chat — streams step events and response tokens.",
)
async def stream_chat(
    raw_request: Request,
    request: AgentRequest,
    background_tasks: BackgroundTasks,
):
    """
    SSE endpoint. Streams events:
      - event: step — graph node progress
      - event: token — response tokens from compose node
      - event: widget — widget payloads
      - event: done — final metadata
      - event: error — if something fails
    """
    supervisor = raw_request.app.state.supervisor

    # Parse RM identity (same as chat.py)
    rm_identity: dict = {}
    identity_header = raw_request.headers.get("x-rm-identity", "")
    if identity_header:
        try:
            rm_identity = json.loads(identity_header)
        except Exception:
            pass
    if not rm_identity:
        rm_identity = {"rm_id": request.rm_id, "role": "RM"}

    rm_role = rm_identity.get("role", "RM")

    initial_state: AgentState = {
        "rm_id": request.rm_id,
        "rm_role": rm_role,
        "session_id": request.session_id,
        "conversation_id": str(uuid.uuid4()),
        "message": request.message,
        "message_type": request.message_type,
        "rm_context": rm_identity,
        "client_context": None,
        "loaded_context": None,
        "intent": None,
        "intent_confidence": 0.0,
        "active_specialists": [],
        "specialist_results": {},
        "tool_results": [],
        "response": None,
        "widgets": [],
        "guardrail_blocked": False,
        "guardrail_reason": None,
        "guardrail_flags": [],
        "error": None,
        "messages": [HumanMessage(content=request.message)],
    }

    async def event_generator() -> AsyncGenerator[dict, None]:
        try:
            # For now, run the full graph and stream the result
            # Full LangGraph astream_events integration can be added later
            yield {"event": "step", "data": json.dumps({"step": "processing"})}

            final_state = await supervisor.run(initial_state)

            # Stream the response text token by token (simulated chunking)
            response_text = final_state.get("response", "")
            if response_text:
                # Send in chunks for UX
                words = response_text.split(" ")
                chunk = []
                for word in words:
                    chunk.append(word)
                    if len(chunk) >= 5:
                        yield {"event": "token", "data": json.dumps({"text": " ".join(chunk) + " "})}
                        chunk = []
                if chunk:
                    yield {"event": "token", "data": json.dumps({"text": " ".join(chunk)})}

            # Stream widgets
            for widget in final_state.get("widgets", []):
                yield {"event": "widget", "data": json.dumps(widget)}

            # Done event
            yield {
                "event": "done",
                "data": json.dumps({
                    "intent": final_state.get("intent"),
                    "intent_confidence": final_state.get("intent_confidence"),
                    "active_specialists": final_state.get("active_specialists", []),
                    "guardrail_flags": final_state.get("guardrail_flags", []),
                }),
            }

        except Exception as exc:
            logger.error("Stream error: %s", exc)
            yield {"event": "error", "data": json.dumps({"message": str(exc), "code": "AGENT_ERROR"})}

    return EventSourceResponse(event_generator())
```

- [ ] **Step 3: Commit**

```bash
git add apps/agent-orchestrator/src/api/v1/stream.py
git commit -m "feat(orchestrator): add SSE streaming endpoint /agent/chat/stream"
```

---

### Task 17: Refactor main.py — thin bootstrapper

**Files:**
- Modify: `apps/agent-orchestrator/src/main.py`

- [ ] **Step 1: Rewrite main.py as thin bootstrapper**

Replace the entire file:

```python
"""
main.py — FastAPI application entrypoint for the RM Buddy Agent Orchestrator.

Thin bootstrapper: initialises shared resources (Redis, Motor, LLM), compiles
the supervisor graph, and mounts API routers.
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

import redis.asyncio as aioredis
from fastapi import FastAPI
from motor.motor_asyncio import AsyncIOMotorClient

from config.settings import settings
from graphs.supervisor import SupervisorGraph
from memory.context_builder import ContextBuilder
from memory.session_manager import SessionManager

# Legacy imports — kept so existing /agent/proactive and /health still work
from models.schemas import AgentRequest, AgentResponse

# ---------------------------------------------------------------------------
# Logging
# ---------------------------------------------------------------------------
logging.basicConfig(
    stream=sys.stdout,
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Lifespan — startup / shutdown
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    logger.info("Starting up %s on port %s", settings.app_name, settings.port)

    # Redis
    redis_kwargs: dict[str, Any] = {
        "host": settings.redis_host,
        "port": settings.redis_port,
        "decode_responses": True,
    }
    if settings.redis_password:
        redis_kwargs["password"] = settings.redis_password
    redis_client = aioredis.Redis(**redis_kwargs)

    # Motor — direct connection for memory collections
    motor_client = AsyncIOMotorClient(settings.memory_mongodb_uri)
    memory_db = motor_client[settings.memory_db_name]

    # Context builder
    context_builder = ContextBuilder(memory_db=memory_db)

    # Session manager
    session_manager = SessionManager(redis_client=redis_client, memory_db=memory_db)

    # Supervisor graph
    supervisor = SupervisorGraph(context_builder=context_builder)

    # Attach to app.state
    app.state.redis_client = redis_client
    app.state.motor_client = motor_client
    app.state.memory_db = memory_db
    app.state.context_builder = context_builder
    app.state.session_manager = session_manager
    app.state.supervisor = supervisor

    logger.info("All services initialised — ready to accept requests")
    yield

    # Shutdown
    logger.info("Shutting down %s", settings.app_name)
    await redis_client.aclose()
    motor_client.close()
    logger.info("Shutdown complete")


# ---------------------------------------------------------------------------
# FastAPI app
# ---------------------------------------------------------------------------

app = FastAPI(
    title="RM Buddy Agent Orchestrator",
    version="2.0.0",
    description=(
        "LangGraph-based AI agent orchestrator for Nuvama Wealth Management. "
        "Parallel specialist dispatch with memory, streaming, and RAG."
    ),
    lifespan=lifespan,
)

# Mount API routers
from api.v1.chat import router as chat_router
from api.v1.stream import router as stream_router

app.include_router(chat_router, prefix="/agent", tags=["Chat"])
app.include_router(stream_router, prefix="/agent", tags=["Streaming"])


# ---------------------------------------------------------------------------
# Legacy endpoints (kept for backward compat)
# ---------------------------------------------------------------------------

@app.post("/agent/proactive", summary="Handle proactive alert processing.")
async def proactive(payload: dict[str, Any]) -> dict[str, Any]:
    logger.info("Proactive alert [rm_id=%s, type=%s]", payload.get("rm_id"), payload.get("alert_type"))
    return {
        "status": "received",
        "rm_id": payload.get("rm_id"),
        "alert_type": payload.get("alert_type"),
        "enriched_text": None,
    }


@app.get("/health", summary="Liveness check.")
async def health() -> dict[str, str]:
    return {"status": "ok", "service": settings.app_name, "version": "2.0.0"}
```

- [ ] **Step 2: Install sse-starlette if not already done**

Run: `cd apps/agent-orchestrator && pip install sse-starlette motor`

- [ ] **Step 3: Restart orchestrator and test**

```bash
cd /Users/surya/Desktop/Vibe/AI\ RM\ Assistant/rm-buddy/apps/agent-orchestrator
pm2 delete rm-orchestrator && pm2 start ecosystem.config.js
```

Wait 5 seconds, then test:

```bash
curl -s -X POST http://localhost:5000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"rm_id":"RM001","message":"how many clients do I have?","session_id":"test-upgrade","message_type":"text","context":{"rm_role":"RM","rm_context":{"rm_id":"RM001","rm_name":"Rajesh Kumar","role":"RM"}}}' | python3 -m json.tool
```

Expected: Response with `text` containing client count, `metadata.active_specialists` containing `["portfolio"]`, `metadata.intent` = `"qa"`.

- [ ] **Step 4: Test SSE streaming**

```bash
curl -s -N -X POST http://localhost:5000/agent/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"rm_id":"RM001","message":"show me my alerts","session_id":"test-stream","message_type":"text"}' | head -20
```

Expected: SSE events (`data: {"step": ...}`, `data: {"text": ...}`, `data: {...}`)

- [ ] **Step 5: Test health endpoint**

```bash
curl -s http://localhost:5000/health
```

Expected: `{"status":"ok","service":"rm-orchestrator","version":"2.0.0"}`

- [ ] **Step 6: Commit**

```bash
git add apps/agent-orchestrator/src/main.py
git commit -m "feat(orchestrator): refactor main.py as thin bootstrapper with supervisor graph"
```

---

## Chunk 5: MongoDB Indexes + Cleanup + Final Verification

### Task 18: Create MongoDB indexes for memory collections

**Files:**
- Create: `deployment/mongo/init-memory-indexes.js`

- [ ] **Step 1: Create index script**

```javascript
// deployment/mongo/init-memory-indexes.js
// Run: mongosh "mongodb://m1b.dev.pr.com:27017/RM_Buddy" < deployment/mongo/init-memory-indexes.js

db = db.getSiblingDB("RM_Buddy");

// rm_facts — long-term memory facts
db.rm_facts.createIndex({ rm_id: 1, category: 1, active: 1 });
db.rm_facts.createIndex({ rm_id: 1, content: 1 }, { unique: true });

// conversation_summaries
db.conversation_summaries.createIndex({ rm_id: 1, created_at: -1 });

// agent_sessions — write-through session store
db.agent_sessions.createIndex({ session_id: 1 }, { unique: true });
db.agent_sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 });

print("Memory indexes created successfully.");
```

- [ ] **Step 2: Run the index script**

```bash
mongosh "mongodb://m1b.dev.pr.com:27017/RM_Buddy" < deployment/mongo/init-memory-indexes.js
```

Expected: `Memory indexes created successfully.`

- [ ] **Step 3: Commit**

```bash
git add deployment/mongo/init-memory-indexes.js
git commit -m "feat(deployment): add MongoDB indexes for memory collections"
```

---

### Task 19: Update .env.orchestrator with new settings

**Files:**
- Modify: `apps/agent-orchestrator/.env.orchestrator`

- [ ] **Step 1: Add new env vars**

Append to the file:

```
# Memory MongoDB (direct Motor connection)
MEMORY_MONGODB_URI=mongodb://m1b.dev.pr.com:27017/RM_Buddy?directConnection=true
MEMORY_DB_NAME=RM_Buddy

# LLM model aliases
LLM_SMART_MODEL=claude-default
LLM_FAST_MODEL=gemini-cost

# Session tuning
SESSION_TTL_SECONDS=3600
MAX_CONVERSATION_HISTORY=20
MAX_MEMORY_FACTS=10
MAX_RECENT_SUMMARIES=3
```

- [ ] **Step 2: Commit**

```bash
git add apps/agent-orchestrator/.env.orchestrator
git commit -m "feat(orchestrator): add memory and LLM model settings to .env.orchestrator"
```

---

### Task 20: End-to-end verification

- [ ] **Step 1: Restart all affected services**

```bash
cd /Users/surya/Desktop/Vibe/AI\ RM\ Assistant/rm-buddy/apps/agent-orchestrator
pm2 delete rm-orchestrator && pm2 start ecosystem.config.js
```

- [ ] **Step 2: Test chat — client count**

```bash
curl -s -X POST http://localhost:5000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"rm_id":"RM001","message":"how many clients do I have?","session_id":"e2e-test-1","message_type":"text","context":{"rm_context":{"rm_id":"RM001","rm_name":"Rajesh Kumar","role":"RM"}}}' | python3 -m json.tool
```

Verify: `metadata.active_specialists` includes `"portfolio"`, response mentions 47 clients.

- [ ] **Step 3: Test chat — alerts**

```bash
curl -s -X POST http://localhost:5000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"rm_id":"RM001","message":"show me my alerts","session_id":"e2e-test-2","message_type":"text","context":{"rm_context":{"rm_id":"RM001","rm_name":"Rajesh Kumar","role":"RM"}}}' | python3 -m json.tool
```

Verify: `metadata.active_specialists` includes `"alert"`, response contains real alert data.

- [ ] **Step 4: Test chat — morning briefing (proactive)**

```bash
curl -s -X POST http://localhost:5000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"rm_id":"RM001","message":"good morning","session_id":"e2e-test-3","message_type":"text","context":{"rm_context":{"rm_id":"RM001","rm_name":"Rajesh Kumar","role":"RM"}}}' | python3 -m json.tool
```

Verify: `metadata.intent` = `"proactive"`, `metadata.active_specialists` contains all 6 agents.

- [ ] **Step 5: Test SSE streaming**

```bash
curl -s -N -X POST http://localhost:5000/agent/chat/stream \
  -H "Content-Type: application/json" \
  -d '{"rm_id":"RM001","message":"how many diamond clients?","session_id":"e2e-test-4","message_type":"text"}' | head -30
```

Verify: SSE event stream with `step`, `token`, `done` events.

- [ ] **Step 6: Verify memory collections were created**

```bash
mongosh "mongodb://m1b.dev.pr.com:27017/RM_Buddy" --quiet --eval "
print('rm_facts:', db.rm_facts.countDocuments({}));
print('conversation_summaries:', db.conversation_summaries.countDocuments({}));
print('agent_sessions:', db.agent_sessions.countDocuments({}));
"
```

After a few test chats, `conversation_summaries` and `rm_facts` should have > 0 documents (created by post-conversation hook).

- [ ] **Step 7: Test via frontend**

Open the browser, log in as Rajesh Kumar, and test:
1. "How many clients do I have?" — should show 47
2. "Show me my diamond clients" — should show 3
3. "Show me my alerts" — should show real alerts
4. "Good morning" — should give a comprehensive briefing

Verify the sidebar still shows correct client count and all dashboard data loads.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat(orchestrator): complete chat module upgrade — parallel agents, memory, streaming, guardrails"
```
