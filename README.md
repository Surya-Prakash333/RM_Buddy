# RM Buddy — AI Relationship Manager Assistant

A dual-AI system for Nuvama Wealth Management:
- **Aria** — voice + chat assistant for Relationship Managers (RMs)
- **Vikram** — coaching assistant for Branch Managers (BMs)

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Browser / App                         │
│                   React + ElevenLabs Voice                   │
└─────────────────────────────┬───────────────────────────────┘
                              │ HTTP / WebSocket
┌─────────────────────────────▼───────────────────────────────┐
│                    API Gateway  :3000                         │
│              Auth forwarding · Rate limiting                  │
└──────┬──────────────┬───────────────────┬───────────────────┘
       │              │                   │
┌──────▼──────┐ ┌─────▼──────┐  ┌────────▼────────┐
│ Auth Service│ │  Core API  │  │ Agent Orchestr. │
│    :3002    │ │   :3001    │  │  Python :5000   │
│  SSO + JWT  │ │ NestJS +   │  │ LangGraph +     │
│  Sessions   │ │ Mongoose   │  │ LiteLLM :4000   │
└─────────────┘ └─────┬──────┘  └────────┬────────┘
                      │                  │
              ┌───────▼──────────────────▼──────┐
              │         MongoDB Atlas            │
              │         Redis Cache              │
              │         Apache Kafka             │
              └─────────────────────────────────┘
                              │
              ┌───────────────▼─────────────────┐
              │     Communication Service :3003  │
              │  Kafka consumer · WebSocket ·    │
              │  ElevenLabs proactive voice      │
              └─────────────────────────────────┘
```

---

## Prerequisites

| Tool | Version | Install |
|------|---------|---------|
| Node.js | 20+ | https://nodejs.org |
| Python | 3.11+ | https://python.org |
| MongoDB | 7+ | Local or [MongoDB Atlas](https://cloud.mongodb.com) (free tier) |
| Redis | 7+ | `brew install redis` or Docker |
| Apache Kafka | 3.6 | Docker (see below) or https://kafka.apache.org |
| PM2 | latest | `npm install -g pm2` |
| LiteLLM | latest | `pip install litellm` |

---

## 1. Clone and install root dependencies

```bash
git clone <repo-url>
cd rm-buddy
npm install          # installs workspace root + all Node.js apps
```

---

## 2. Start infrastructure

### MongoDB (local)
```bash
brew install mongodb-community && brew services start mongodb-community
# Or use MongoDB Atlas free cluster and set MONGODB_URI in each .env file
```

### Redis (local)
```bash
brew install redis && brew services start redis
# Default: localhost:6379, no password
```

### Kafka (Docker — easiest)
```bash
docker run -d --name kafka \
  -p 9092:9092 \
  -e KAFKA_ENABLE_KRAFT=yes \
  -e KAFKA_CFG_NODE_ID=1 \
  -e KAFKA_CFG_PROCESS_ROLES=broker,controller \
  -e KAFKA_CFG_LISTENERS=PLAINTEXT://:9092,CONTROLLER://:9093 \
  -e KAFKA_CFG_ADVERTISED_LISTENERS=PLAINTEXT://localhost:9092 \
  -e KAFKA_CFG_CONTROLLER_QUORUM_VOTERS=1@localhost:9093 \
  -e KAFKA_CFG_CONTROLLER_LISTENER_NAMES=CONTROLLER \
  bitnami/kafka:3.6

# Create the 7 required topics
bash deployment/kafka/init-topics.sh
```

### Seed MongoDB
```bash
mongosh rmbuddy deployment/mongo/init-indexes.js
mongosh rmbuddy deployment/mongo/seed-data.js
```

---

## 3. Configure environment variables

Copy each template and fill in your values:

```bash
cp deployment/env-templates/.env.core-api      apps/core-api/.env.core-api
cp deployment/env-templates/.env.auth          apps/auth-service/.env.auth
cp deployment/env-templates/.env.gateway       apps/gateway/.env.gateway
cp deployment/env-templates/.env.comm          apps/communication-service/.env.comm
cp deployment/env-templates/.env.orchestrator  apps/agent-orchestrator/.env.orchestrator
cp deployment/env-templates/.env.litellm       apps/litellm-proxy/.env.litellm
cp deployment/env-templates/.env.frontend      apps/frontend-web/.env.local
```

**Minimum required values to fill in:**

| File | Key | Value |
|------|-----|-------|
| `.env.core-api` | `MONGODB_URI` | Your MongoDB connection string |
| `.env.litellm` | `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `.env.litellm` | `LITELLM_MASTER_KEY` | Any secret string (e.g. `sk-local-dev`) |
| `.env.orchestrator` | `LITELLM_API_KEY` | Same value as `LITELLM_MASTER_KEY` above |

> **Note:** For S0–S3, `NUVAMA_SSO_URL` can be left blank. The auth service uses mock tokens (see [Mock Tokens](#mock-tokens) below).

---

## 4. Start LiteLLM proxy

```bash
cd apps/litellm-proxy
# Load env vars
export $(cat .env.litellm | xargs)
litellm --config config.yaml --port 4000

# Verify:
curl http://localhost:4000/health
# Expected: {"status":"healthy",...}
```

---

## 5. Set up Python environment

```bash
cd apps/agent-orchestrator
python3.11 -m venv venv
source venv/bin/activate          # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

---

## 6. Start all services (PM2)

```bash
# From repo root
bash deployment/scripts/start-all.sh
```

This builds all Node.js services and starts them under PM2:

| Service | Port | PM2 name |
|---------|------|----------|
| API Gateway | 3000 | `rm-gateway` |
| Core API | 3001 | `rm-core-api` |
| Auth Service | 3002 | `rm-auth` |
| Communication Service | 3003 | `rm-comm` |
| Agent Orchestrator | 5000 | `rm-orchestrator` |

Check status:
```bash
pm2 status
pm2 logs          # tail all logs
pm2 logs rm-core-api --lines 50   # logs for a specific service
```

---

## 7. Start the frontend

```bash
cd apps/frontend-web
npm install
npm run dev
# Open http://localhost:5173
```

---

## 8. Verify everything is running

```bash
bash deployment/scripts/health-check-all.sh
```

Expected output:
```
RM Buddy Health Check
━━━━━━━━━━━━━━━━━━━━━
✅ Gateway       → ok
✅ Core-API      → ok
✅ Auth          → ok
✅ Comm          → ok
✅ Orchestrator  → ok

✅ All services healthy
```

---

## Mock Tokens

During development (S0–S3), real Nuvama SSO is not required. Use these tokens in the `Authorization: Bearer <token>` header or in the login screen:

| Token | RM ID | Role | Branch |
|-------|-------|------|--------|
| `MOCK_TOKEN_RM001` | RM001 | RM | Mumbai-BKC |
| `MOCK_TOKEN_RM002` | RM002 | RM | Delhi-CP |
| `MOCK_TOKEN_BM003` | RM003 | BM | Mumbai-BKC |

Quick test:
```bash
curl -X POST http://localhost:3002/auth/validate \
  -H "Content-Type: application/json" \
  -d '{"token":"MOCK_TOKEN_RM001"}'
# Expected: {"rm_id":"RM001","name":"Rajesh Kumar","role":"RM",...}
```

---

## Running Tests

### NestJS unit tests (531 tests)
```bash
cd apps/core-api
npm test
```

### Python tests (214 tests)
```bash
cd apps/agent-orchestrator
source venv/bin/activate
pytest tests/ -v
```

### NestJS E2E tests
```bash
cd apps/core-api
npm run test:e2e
# Uses MongoMemoryServer — no running MongoDB required
```

### TypeScript type checks
```bash
cd apps/core-api && npx tsc --noEmit
cd apps/frontend-web && npx tsc --noEmit
```

---

## API Quick Reference

All endpoints require `Authorization: Bearer <token>` header (or `x-rm-identity` if calling Core API directly via the gateway's forwarded header).

### Core API endpoints (via Gateway at :3000)

```
GET  /api/v1/dashboard/summary     → KPIs for the RM's dashboard
GET  /api/v1/clients               → RM's client list
GET  /api/v1/clients/:id           → Single client detail
GET  /api/v1/clients/:id/portfolio → Portfolio holdings
GET  /api/v1/alerts                → Active alerts for RM
POST /api/v1/alerts/:id/acknowledge → Acknowledge an alert
GET  /api/v1/briefing/today        → AI-generated morning briefing
GET  /api/v1/daily-actions         → Priority action list
GET  /api/v1/meetings              → Today's meetings
GET  /api/v1/leads                 → Lead pipeline
GET  /api/v1/search?q=...          → Full-text search across clients/alerts
```

### Agent chat
```
POST /api/v1/agent/chat
Body: { "message": "Show my idle cash alerts", "session_id": "..." }
Response: { "response": "...", "widgets": [...] }
```

### Example: Ask the agent a question
```bash
curl -X POST http://localhost:3000/api/v1/agent/chat \
  -H "Authorization: Bearer MOCK_TOKEN_RM001" \
  -H "Content-Type: application/json" \
  -d '{"message": "What are my top priority alerts today?", "session_id": "test-001"}'
```

---

## Project Structure

```
rm-buddy/
├── apps/
│   ├── gateway/                  # Express reverse proxy + auth middleware, :3000
│   ├── auth-service/             # NestJS SSO + session management, :3002
│   ├── core-api/                 # NestJS business API + alert engine, :3001
│   ├── communication-service/    # Kafka consumer + WebSocket + ElevenLabs, :3003
│   ├── agent-orchestrator/       # Python LangGraph agents + FastAPI, :5000
│   │   └── src/
│   │       ├── agents/specialists/  # QA, Briefing, Alert, Actions agents
│   │       ├── graphs/              # LangGraph orchestrator + intent classifier
│   │       ├── guardrails/          # Input/output/action guards
│   │       ├── memory/              # Redis + MongoDB session memory
│   │       ├── schedulers/          # Nightly batch (2AM pre-compute)
│   │       └── tools/               # LangChain tools (CRM, cache, search, widget)
│   ├── frontend-web/             # React 18 + Vite + Tailwind + Zustand
│   └── litellm-proxy/            # LiteLLM proxy (Claude → GPT fallback), :4000
├── deployment/
│   ├── kafka/init-topics.sh      # Creates 7 Kafka topics
│   ├── mongo/
│   │   ├── init-indexes.js       # MongoDB index setup
│   │   └── seed-data.js          # 5 RMs + sample clients/portfolios/alerts
│   ├── env-templates/            # .env template files for each service
│   └── scripts/
│       ├── start-all.sh          # Build + PM2 start all 5 services
│       └── health-check-all.sh   # Verify all health endpoints
└── shared/
    ├── types/                    # Shared TypeScript interfaces
    └── constants/enums.ts        # Shared enums
```

---

## Alert Types (16)

The alert engine evaluates these rules automatically. Each fires when the condition is met and respects a cooldown to avoid duplicate alerts.

| Alert | Trigger |
|-------|---------|
| `IDLE_CASH` | Cash idle > 30 days and > ₹1L |
| `MATURITY_PROCEEDS` | FD/Bond/MF matures within 7 days |
| `CROSS_SELL` | Client has < 3 products and AUM > ₹50L |
| `HIGH_CASH_ALLOCATION` | Cash > 30% of portfolio |
| `HIGH_TRADING_FREQ` | > 5 trades/week |
| `CONCENTRATION_RISK` | Single stock > 25% of portfolio |
| `DORMANT_CLIENT` | No interaction for > 90 days |
| `ENGAGEMENT_DROP` | Engagement score down > 30% in 14 days |
| `REBALANCING_DUE` | Portfolio drift > 10% from target allocation |
| `GOALS_NOT_MET` | Investment goal progress < 70% at midpoint |
| `BIRTHDAY` | Client birthday in next 3 days |
| `CASHFLOW_REINVEST` | Dividend/maturity proceeds sitting idle |
| `PORTFOLIO_DRIFT` | Asset allocation drift > 8% |
| `TAX_LOSS_HARVESTING` | Unrealized loss > ₹50K with tax benefit possible |
| `DIVIDEND_COLLECTION` | Dividend record date within 3 days |
| `BENEFICIARY_UPDATES` | Nomination > 3 years old and AUM > ₹25L |

---

## Stopping Services

```bash
pm2 stop all       # Stop all services (keep in PM2 registry)
pm2 delete all     # Remove from PM2 registry
pm2 kill           # Kill PM2 daemon entirely
```

---

## Troubleshooting

**Port already in use**
```bash
lsof -i :3001 | grep LISTEN    # find the PID
kill -9 <PID>
```

**MongoDB connection refused**
```bash
brew services start mongodb-community
# or check: mongosh --eval "db.adminCommand('ping')"
```

**Redis connection refused**
```bash
brew services start redis
# or: redis-cli ping  → should return PONG
```

**Agent orchestrator not starting**
```bash
pm2 logs rm-orchestrator --lines 50
# Common fix: activate venv before starting
cd apps/agent-orchestrator && source venv/bin/activate
pm2 restart rm-orchestrator
```

**LiteLLM errors**
```bash
# Check your ANTHROPIC_API_KEY is set
curl http://localhost:4000/health
# Test a completion
curl -X POST http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{"model":"claude-default","messages":[{"role":"user","content":"hi"}],"max_tokens":10}'
```

**Intent classifier returns wrong intent**
```bash
curl -X POST http://localhost:5000/agent/chat \
  -H "Content-Type: application/json" \
  -d '{"rm_id":"RM001","message":"What alerts do I have?","session_id":"debug"}'
# Check "intent" field in response
```

---

## ElevenLabs Voice Setup (requires Naman)

Voice features are live once these steps are done:

1. Log in to [ElevenLabs console](https://elevenlabs.io)
2. Create two agents: **Aria** (RM assistant) and **Vikram** (BM assistant)
3. Register 4 Server Tools pointing to your gateway URL
4. Copy Agent IDs into `apps/communication-service/.env.comm`:
   ```
   ELEVENLABS_ARIA_AGENT_ID=<from console>
   ELEVENLABS_VIKRAM_AGENT_ID=<from console>
   ```
5. Copy same IDs into `apps/frontend-web/.env.local`:
   ```
   VITE_ELEVENLABS_ARIA_AGENT_ID=<from console>
   VITE_ELEVENLABS_VIKRAM_AGENT_ID=<from console>
   ```
6. Restart communication service: `pm2 restart rm-comm`

See `claude-code-prep/stories/S0-INFRA/INFRA-11LABS-01.md` for full console setup guide.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 18, Vite, Tailwind CSS, Zustand |
| Gateway | Express 4, TypeScript |
| Backend APIs | NestJS 10, TypeScript 5.3, Mongoose 8 |
| AI Agents | Python 3.11, LangGraph 0.1, LangChain, FastAPI |
| LLM Proxy | LiteLLM (Claude Sonnet primary → GPT-4o fallback) |
| Database | MongoDB Atlas (Mongoose ODM) |
| Cache | Redis 7 (ioredis) |
| Messaging | Apache Kafka 3.6 (KafkaJS) |
| Voice | ElevenLabs Conversational AI (Aria + Vikram agents) |
| Process Manager | PM2 |
