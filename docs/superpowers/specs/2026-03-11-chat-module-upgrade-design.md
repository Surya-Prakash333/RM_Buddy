# Chat Module Upgrade — Design Spec

## Goal

Upgrade the `apps/agent-orchestrator` chat module to match the production-grade architecture of the reference codebase (`/Users/surya/RM_Assist/aira_intelligence/rm-buddy-ai`), while preserving what already works: widget generation, real MongoDB data flow, LiteLLM/Groq integration.

## Scope

**In scope:**
- Parallel specialist agents (6 agents running concurrently)
- Long-term memory system (session management, fact extraction, semantic search)
- Context builder pipeline (pre-loads RM data, alerts, preferences, memory before every chat)
- SSE streaming endpoint (`/agent/chat/stream`)
- RAG architecture (tool interface + vector search stub, no document ingestion yet)
- Centralized prompts and guardrails (split from inline code)
- Supervisor graph replacing sequential orchestrator

**Out of scope:**
- CRM write actions (schedule meetings, create leads, etc.) — future phase
- WebSocket endpoint — future phase if needed
- Document ingestion scheduler for RAG — future phase
- Voice/Whisper STT — future phase
- Frontend changes — none required; API contract preserved

## Constraints

- Python FastAPI service (no language change)
- LiteLLM proxy on port 4000 → Groq API (llama-3.3-70b-versatile as smart, llama-3.1-8b-instant as fast) stays
- MongoDB at `m1b.dev.pr.com:27017/RM_Buddy` (production, for business data via Core API)
- MongoDB at `m1b.dev.pr.com:27017/RM_Buddy` (direct Motor connection for memory collections)
- Redis on localhost (already running for core-api cache)
- PM2 process management stays
- Must not break existing `POST /agent/chat` contract (same request/response shape)

---

## Architecture

### Service Boundary

Only `apps/agent-orchestrator` changes. All other services (frontend, gateway, core-api, auth-service, litellm-proxy) remain untouched.

### New Directory Structure

```
apps/agent-orchestrator/src/
├── main.py                          # FastAPI app — thin bootstrapper, mounts routers, lifespan hooks
│                                    #   lifespan: init Motor client, Redis pool, compile supervisor graph
│                                    #   Chat endpoint logic moves to api/v1/chat.py
├── config/
│   ├── settings.py                  # Extended: add REDIS_URL, MEMORY_MONGO_URI, EMBEDDING_MODEL
│   └── llm_config.py               # Keep as-is
├── api/
│   └── v1/
│       ├── chat.py                  # Sync chat endpoint (extracted from main.py lines 142-225)
│       └── stream.py               # NEW: SSE streaming endpoint
├── graphs/
│   ├── state.py                     # Expanded AgentState (add loaded_context, specialist_results, etc.)
│   ├── supervisor.py                # NEW: replaces orchestrator.py — parallel dispatch + compose
│   ├── intent_classifier.py         # Enhanced: keep LLM classification, add keyword routing for specialist selection
│   └── specialists/                 # NEW subfolder (function-based, not class-based — see Agent Pattern below)
│       ├── __init__.py
│       ├── alert_agent.py           # Rewritten: function-based react agent
│       ├── portfolio_agent.py       # NEW: absorbs qa_agent's portfolio analysis + client query logic
│       ├── revenue_agent.py         # NEW: AUM/commission analysis
│       ├── engagement_agent.py      # Rewritten: interaction gaps, contact frequency
│       ├── scoring_agent.py         # NEW: client risk profiles
│       └── document_agent.py        # NEW: RAG stub
├── tools/
│   ├── crm_tool.py                  # MODIFIED: fix thread safety (contextvars), keep data retrieval
│   ├── search_tool.py               # Keep
│   ├── widget_tool.py               # Keep
│   ├── rag_tool.py                  # NEW: vector search stub
│   └── memory_tool.py               # NEW: session/fact retrieval tools for agents
├── memory/
│   ├── context_builder.py           # NEW: pre-chat context assembly (wraps all data loading)
│   ├── session_manager.py           # NEW: Redis+MongoDB write-through sessions
│   └── post_conversation.py         # NEW: LLM fact extraction after response sent
├── guardrails/
│   ├── input_guardrails.py          # NEW: extracted from orchestrator's _INPUT_BLOCKLIST + reference patterns
│   └── output_guardrails.py         # NEW: extracted from orchestrator's output_guard_node + reference patterns
├── prompts/
│   ├── supervisor_prompt.py         # NEW: contains ARIA_SYSTEM_PROMPT, VIKRAM_SYSTEM_PROMPT, COMPOSE_PROMPT
│   │                                #   Migrated from config/prompts.py with reference's personality additions
│   └── specialist_prompts.py        # NEW: per-agent system prompts (from reference's specialist_prompts.py)
├── models/
│   ├── schemas.py                   # Extended: add ContextPayload, FactRecord, ConversationSummary
│   └── types.py                     # Extended: add Intent enum (QA/ACTION/PROACTIVE/WIDGET), FactCategory enum
└── agents/
    └── base_agent.py                # DEPRECATED: kept for backward compat but new specialists don't use it
```

### Migration Map — Current Files

| Current File | Fate | Notes |
|---|---|---|
| `main.py` | **MODIFY** | Extract chat endpoint to `api/v1/chat.py`; add lifespan hooks; mount routers |
| `config/settings.py` | **MODIFY** | Add Redis, memory, embedding settings |
| `config/llm_config.py` | **KEEP** | No changes |
| `config/prompts.py` | **REPLACE** | Content migrated to `prompts/supervisor_prompt.py` and `prompts/specialist_prompts.py` |
| `config/kafka_config.py` | **KEEP** | Untouched, not relevant to chat upgrade |
| `graphs/orchestrator.py` | **REPLACE** | Replaced by `graphs/supervisor.py` |
| `graphs/state.py` | **MODIFY** | Expand AgentState TypedDict |
| `graphs/intent_classifier.py` | **MODIFY** | Add keyword routing for specialist selection |
| `agents/base_agent.py` | **DEPRECATE** | New specialists use function pattern, not class. Kept for any non-upgraded code. |
| `agents/specialists/qa_agent.py` | **DELETE** | Functionality absorbed by `portfolio_agent.py` (client queries + portfolio analysis) |
| `agents/specialists/alert_agent.py` | **REPLACE** | Rewritten as function-based react agent in `graphs/specialists/alert_agent.py` |
| `agents/specialists/briefing_agent.py` | **DELETE** | Briefing becomes a supervisor-level compose task: when intent=PROACTIVE and message matches morning briefing, the supervisor dispatches alert + portfolio + engagement specialists in parallel and composes a briefing narrative. No dedicated agent needed. |
| `agents/specialists/actions_agent.py` | **DELETE** | Daily actions are derived from alert + engagement specialist results during compose. No dedicated agent needed. |
| `agents/specialists/daily_review_agent.py` | **DELETE** | BM team review becomes a compose-time behavior: when rm_role=BM, supervisor composes from all specialist results with Vikram persona. No dedicated agent needed. |
| `agents/specialists/engagement_agent.py` | **REPLACE** | Rewritten as function-based react agent in `graphs/specialists/engagement_agent.py` |
| `agents/specialists/strength_agent.py` | **DELETE** | BM coaching absorbed by compose step with Vikram persona when rm_role=BM |
| `tools/crm_tool.py` | **MODIFY** | Fix `_current_rm_identity` thread safety using `contextvars.ContextVar` |
| `tools/search_tool.py` | **KEEP** | No changes |
| `tools/widget_tool.py` | **KEEP** | No changes |
| `models/schemas.py` | **MODIFY** | Add new schema types |
| `models/types.py` | **MODIFY** | Add new enums |
| `schedulers/nightly_batch.py` | **KEEP** | Untouched, not relevant to chat upgrade |

### Agent Pattern — Function-Based (Not Class-Based)

The current codebase uses class-based agents inheriting from `BaseAgent`. The new specialists use a **function-based pattern** matching the reference architecture:

```python
# graphs/specialists/alert_agent.py
from langgraph.prebuilt import create_react_agent

async def run_alert_agent(state: AgentState, llm, tools) -> dict:
    """Stateless function. Receives state, returns specialist result."""
    agent = create_react_agent(llm, tools, prompt=ALERT_SYSTEM_PROMPT)
    result = await agent.ainvoke({"messages": [("user", state["message"])]})
    return {"specialist_results": {"alert": result["messages"][-1].content}}
```

Benefits: no class hierarchy, no shared mutable state, trivially parallelizable.

### Intent Classification — Unified Taxonomy

**New intent categories** (replacing current 7-category system):

| New Intent | Old Intents Merged | Behavior |
|---|---|---|
| `QA` | `client_query`, `portfolio_analysis`, `general_qa` | Read-only data retrieval + compose |
| `ACTION` | `schedule_action` | Reserved for future CRM write actions |
| `PROACTIVE` | `morning_briefing` | System-initiated or "good morning" triggers; dispatches all specialists |
| `WIDGET` | `view_alerts` | Explicit widget requests; dispatches relevant specialist + widget tools |
| `UNKNOWN` | `unknown` | Fallback to QA behavior |

**Specialist selection** is separate from intent classification. Keywords in the message determine WHICH specialists run:

```python
KEYWORD_MAP = {
    "portfolio": ["portfolio", "holding", "nav", "rebalance", "drift", "aum", "client"],
    "alert":     ["alert", "anomaly", "risk", "warning", "drawdown", "attention"],
    "revenue":   ["revenue", "commission", "fee", "income", "brokerage"],
    "scoring":   ["score", "rating", "risk profile", "risk score"],
    "engagement": ["engagement", "interaction", "last contact", "meeting", "dormant", "inactive"],
    "document":  ["document", "policy", "compliance", "product", "fund", "scheme"],
}
# Default if no keywords match: ["portfolio"]
# PROACTIVE intent: all specialists activated
```

---

## Supervisor Graph Flow

```
input_guard → build_context → classify_intent → dispatch_specialists → compose_response → output_guard
                                                                                              ↓
                                                                              post_conversation_hook (background)
```

### Node Details

**1. `input_guard`** — Prompt injection detection + off-topic filtering. Uses regex patterns from `guardrails/input_guardrails.py`. If blocked, short-circuits to error response. Extracted from current `orchestrator.py` `_INPUT_BLOCKLIST` + reference's additional patterns.

**2. `build_context`** — Wraps `ContextBuilder.build(session_id, rm_id, query)`. Assembles:
   - Session state including **conversation history** (Redis first → MongoDB `agent_sessions` fallback → repopulate Redis)
   - RM client list summary (top 10 by AUM, via Core API)
   - Pending alerts (via Core API)
   - RM preferences (from `rm_facts` collection via direct Motor query)
   - Semantic memory search — query-based (via Motor, no vector search until embeddings are set up; falls back to text match)
   - Recent conversation summaries (last 3, from `conversation_summaries` via Motor)

   All stored in `state["loaded_context"]`. Conversation history from session is also loaded into `state["messages"]` for the LangGraph message reducer.

**3. `classify_intent`** — Two-stage:
   - Stage 1: Keyword scan → selects active specialist list (stored in `state["active_specialists"]`)
   - Stage 2: LLM classifies as `QA` / `ACTION` / `PROACTIVE` / `WIDGET` / `UNKNOWN`
   - For `PROACTIVE`: all specialists activated regardless of keywords

**4. `dispatch_specialists`** — Runs active specialists in parallel via `asyncio.gather(return_exceptions=True)`. Each specialist is a function that creates a `create_react_agent` with its own tools + prompt + LLM.

   **Partial failure handling:** If a specialist raises an exception, its result is logged as a warning and excluded from `specialist_results`. The compose step works with whatever specialists succeeded. If ALL specialists fail, compose falls back to a direct LLM call (current behavior).

   Results stored in `state["specialist_results"]` as `{"agent_name": "text_output"}`.

**5. `compose_response`** — Smart LLM (70b) synthesizes:
   - Specialist findings from `state["specialist_results"]`
   - Memory context: preferences, relevant memories, conversation history from `state["loaded_context"]`
   - User's original message
   - Persona: Aria (for RM) or Vikram (for BM) from `prompts/supervisor_prompt.py`

   Also invokes widget tools based on specialist data to produce `state["widgets"]`.

**6. `output_guard`** — Checks for unauthorized financial advice, uncertainty disclaimers. From `guardrails/output_guardrails.py`. Returns cleaned text + flags.

**7. `post_conversation_hook`** — Runs as FastAPI `BackgroundTasks` (non-blocking). LLM extracts:
   - Facts: `preference`, `client_note`, `decision`, `pattern`, `relationship` with confidence 0.5-1.0
   - Conversation summary: 2-3 sentences + topics + clients_discussed

   Stored in MongoDB via direct Motor: `rm_facts` (upsert by content match) and `conversation_summaries` (insert).

---

## Specialist Agents

| Agent | Domain | Tools | Model | Source |
|-------|--------|-------|-------|--------|
| Alert | Portfolio anomalies, risk alerts | `get_alerts` | Fast (8b) | Replaces current `alert_agent.py` |
| Portfolio | Holdings, allocation, drift, client queries | `get_client_list`, `get_client_profile`, `get_client_portfolio`, `search_clients_by_name` | Smart (70b) | Absorbs `qa_agent.py` + new drift analysis |
| Revenue | AUM, commission metrics | `get_client_list`, `get_dashboard_summary` | Smart (70b) | New |
| Engagement | Interaction gaps, contact freq | `get_client_list`, `get_client_profile` | Fast (8b) | Replaces current `engagement_agent.py` |
| Scoring | Client risk profiles | `get_client_profile`, `get_client_portfolio` | Smart (70b) | New |
| Document | Product docs, policies (RAG) | `search_knowledge_base` | Fast (8b) | New (stub) |

---

## Thread Safety Fix — `crm_tool.py`

**Problem:** Current `_current_rm_identity` is a module-level dict. Under parallel `asyncio.gather()`, coroutines interleave and one specialist can overwrite another's identity context.

**Fix:** Replace with `contextvars.ContextVar`:

```python
import contextvars

_rm_context_var: contextvars.ContextVar[dict] = contextvars.ContextVar('rm_context', default={})

def set_rm_context(rm_identity: dict) -> None:
    _rm_context_var.set(rm_identity)

def _get_identity_header() -> str:
    return json.dumps(_rm_context_var.get())
```

The supervisor's `dispatch_specialists` node must call `set_rm_context()` before dispatching, and since `contextvars` are inherited by child tasks in `asyncio.gather()`, each specialist gets the correct identity.

---

## Memory System

### Session Memory (Short-Term)

- Per RM + conversation (keyed by `session_id`)
- Write-through: save to MongoDB `agent_sessions` first → then Redis (TTL 1 hour)
- On read: Redis first → on miss, load from MongoDB + repopulate Redis
- Contains: `session_id`, `rm_id`, `conversation_id`, `messages` (conversation history), `active_client`, `metadata`, `created_at`, `updated_at`, `expires_at`

### Long-Term Memory (Persistent)

**`rm_facts` collection:**
- Categories: `preference`, `client_note`, `decision`, `pattern`, `relationship`
- Each fact: `rm_id`, `category`, `content`, `confidence` (0.5-1.0), `client_id` (optional), `active` (bool), `created_at`, `updated_at`
- Upsert logic: if `content` matches existing fact for same `rm_id` + `category`, update `confidence` and `updated_at`; else insert

**`conversation_summaries` collection:**
- Fields: `rm_id`, `conversation_id`, `session_id`, `summary`, `topics`, `clients_discussed`, `created_at`

### MongoDB Indexes Required

```javascript
// rm_facts
db.rm_facts.createIndex({ rm_id: 1, category: 1, active: 1 })
db.rm_facts.createIndex({ rm_id: 1, content: 1 }, { unique: true })

// conversation_summaries
db.conversation_summaries.createIndex({ rm_id: 1, created_at: -1 })

// agent_sessions
db.agent_sessions.createIndex({ session_id: 1 }, { unique: true })
db.agent_sessions.createIndex({ expires_at: 1 }, { expireAfterSeconds: 0 })  // TTL index
```

### Context Builder Pipeline

```
ContextBuilder.build(session_id, rm_id, query) →
  1. SessionManager.get_session(session_id)                              # Redis → MongoDB fallback; includes conversation history
  2. Core API: GET /api/v1/clients?limit=10&sort=aum                     # Top clients summary
  3. Core API: GET /api/v1/alerts?status=pending                         # Pending alerts
  4. Motor: rm_facts.find({rm_id, category: "preference", active: true}) # RM preferences (top 10)
  5. Motor: rm_facts.find({rm_id, active: true, content: {$regex: keywords}}) # Relevant memories (text match; vector search future)
  6. Motor: conversation_summaries.find({rm_id}).sort({created_at: -1}).limit(3) # Recent convos
→ Returns LoadedContext dict with all 6 sections
```

Steps 2-6 run concurrently via `asyncio.gather()` for latency.

---

## SSE Streaming

**Endpoint:** `POST /agent/chat/stream`

**Request:** Same as `/agent/chat` (ChatRequest body)

**Response:** `text/event-stream` with events:

| Event | Payload | When |
|-------|---------|------|
| `step` | `{"step": "building_context"}` | Each graph node entry |
| `token` | `{"text": "Hello"}` | During compose_response LLM streaming |
| `widget` | `{WidgetPayload}` | When a widget is generated |
| `done` | `{"intent": "...", "confidence": 0.8, "latency_ms": 1200}` | Graph complete |
| `error` | `{"message": "...", "code": "AGENT_ERROR"}` | On failure (after any partial data) |

Uses `sse-starlette` library. The supervisor graph is the same; the `compose_response` node yields tokens via an async generator instead of waiting for full completion.

---

## RAG Architecture (Stub)

**Tool:** `search_knowledge_base(query: str, top_k: int = 5) -> list[dict]`

**Current implementation (stub):** Returns `{"results": [], "message": "Knowledge base not yet populated"}`.

**Future activation requires:**
1. A `vector_embeddings` collection with pre-computed embeddings
2. Embedding model configured in LiteLLM (e.g., `text-embedding-3-small`, 1536 dimensions)
3. MongoDB Atlas Vector Search index on the collection
4. Tool updated to: embed query → `$vectorSearch` → return top-K

---

## Guardrails

**Input (`input_guardrails.py`):**
- Prompt injection: "ignore previous instructions", "reveal prompt", "jailbreak", "DAN mode", "act as", "bypass"
- Off-topic: cricket scores, movie reviews, recipes, weather, stock tips
- Returns: `InputGuardResult(is_blocked: bool, reason: str | None)`

**Output (`output_guardrails.py`):**
- Financial advice: "you should buy/sell", "guaranteed return", "will definitely rise", "invest in"
- Uncertainty: "I'm not sure", "I don't know" → appends disclaimer: "_Note: Please verify with CRM before acting._"
- Returns: `OutputGuardResult(cleaned_text: str, flags: list[str])`

---

## API Contract

**`POST /agent/chat`** — Unchanged request/response shape:
```json
// Request
{"rm_id": "RM001", "message": "...", "session_id": "...", "message_type": "text", "context": {...}}

// Response
{"session_id": "...", "agent_id": "aria", "response_type": "text|widget|error", "text": "...", "widgets": [...], "metadata": {...}}
```

**`POST /agent/chat/stream`** — NEW endpoint, same request body, SSE response stream.

---

## MongoDB New Collections

```javascript
// rm_facts — long-term memory facts
{
  rm_id: "RM001",
  category: "preference",     // preference | client_note | decision | pattern | relationship
  content: "Prefers briefings sorted by AUM descending",
  confidence: 0.85,
  client_id: null,            // optional, for client-specific facts
  active: true,
  created_at: ISODate(),
  updated_at: ISODate()
}

// conversation_summaries
{
  rm_id: "RM001",
  conversation_id: "conv-uuid",
  session_id: "sess-uuid",
  summary: "Discussed portfolio rebalancing for client Sharma...",
  topics: ["portfolio", "rebalancing"],
  clients_discussed: ["CLT005"],
  created_at: ISODate()
}

// agent_sessions — session state (source of truth for write-through)
{
  session_id: "sess-uuid",
  rm_id: "RM001",
  conversation_id: "conv-uuid",
  messages: [...],            // conversation history
  active_client: null,        // client being discussed
  metadata: {},
  created_at: ISODate(),
  updated_at: ISODate(),
  expires_at: ISODate()       // TTL index — auto-deleted after 1 hour
}
```

---

## Dependencies (New Python Packages)

| Package | Purpose |
|---------|---------|
| `motor` | Async MongoDB driver for memory collections (rm_facts, conversation_summaries, agent_sessions) |
| `redis` (with async) | Async Redis client — already installed; use `redis.asyncio` |
| `sse-starlette` | SSE response support for FastAPI streaming endpoint |

Note: `aioredis` is deprecated. The modern `redis` package (already in use) includes `redis.asyncio`.

---

## Data Access Strategy

| Data Type | Access Method | Rationale |
|---|---|---|
| Business data (clients, portfolios, alerts, meetings) | HTTP via Core API (`httpx`) | Core API owns this data; consistent auth/validation |
| Memory data (sessions, facts, summaries) | Direct Motor connection | Orchestrator owns this data; avoids circular deps; low latency |

---

## Latency Budget

| Node | Target | Notes |
|------|--------|-------|
| `input_guard` | < 10ms | Pure regex, no I/O |
| `build_context` | < 800ms | 6 concurrent data loads; Redis cache helps for sessions |
| `classify_intent` | < 1s | One LLM call (fast model) + keyword scan |
| `dispatch_specialists` | < 5s | Parallel agents; each agent = 1-2 LLM tool-use calls |
| `compose_response` | < 3s | One LLM call (smart model) |
| `output_guard` | < 10ms | Pure regex, no I/O |
| **Total** | **< 10s** | Acceptable for wealth management UX |
| `post_conversation_hook` | < 5s | Background; non-blocking |
