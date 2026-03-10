# LiteLLM Proxy — RM Buddy

Central LLM proxy for all agent-orchestrator model calls. Handles model routing, fallbacks, cost tracking, Redis caching, and rate limiting via an OpenAI-compatible API surface.

## Prerequisites

- Python 3.11+
- A running Redis instance (for response caching)
- A running PostgreSQL instance (for usage/cost tracking)
- API keys for Anthropic, OpenAI, and Google Gemini

## Setup

### 1. Install

```bash
pip install "litellm[proxy]"
```

### 2. Configure environment

Copy the env template and fill in real values:

```bash
cp ../../deployment/env-templates/.env.litellm .env.litellm
# Edit .env.litellm — set API keys, master key, DB URL, Redis host
```

### 3. Start (direct)

```bash
litellm --config config.yaml --port 4000
```

### 4. Start (PM2 managed)

```bash
# From apps/litellm-proxy/
pm2 start ecosystem.config.js
pm2 logs rm-litellm-proxy
```

Logs are written to `logs/out.log` and `logs/error.log` (directory created by PM2 on first run).

## Verify

### Health check

```bash
curl http://localhost:4000/health
```

Expected response:

```json
{"status": "healthy", "litellm_version": "x.y.z"}
```

### List available models

```bash
curl http://localhost:4000/models \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY"
```

### Test a completion (claude-default)

```bash
curl http://localhost:4000/v1/chat/completions \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "claude-default",
    "messages": [{"role": "user", "content": "Hello"}],
    "max_tokens": 64
  }'
```

### Test an embedding

```bash
curl http://localhost:4000/v1/embeddings \
  -H "Authorization: Bearer $LITELLM_MASTER_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "model": "embedding-model",
    "input": "Nuvama portfolio summary"
  }'
```

## Model Routing

| Alias | Underlying model | Use case |
|---|---|---|
| `claude-default` | claude-sonnet-4-6 | Agent reasoning, intent classification |
| `gpt-fallback` | gpt-4o | Fallback when Claude is unavailable |
| `gemini-cost` | gemini-1.5-flash | Summaries, low-priority tasks |
| `embedding-model` | text-embedding-3-small | Vector search embeddings |

Fallback chain: `claude-default` -> `gpt-fallback` -> `gemini-cost`

## Programmatic Usage (agent-orchestrator)

```python
from litellm_config import get_client_config, check_health

# Get config for a task type
config = get_client_config("agent_reasoning")
# {"base_url": "http://localhost:4000/v1", "api_key": "...", "model": "claude-default"}

# Use with openai client
from openai import AsyncOpenAI
client = AsyncOpenAI(**{k: v for k, v in config.items() if k != "model"})
response = await client.chat.completions.create(
    model=config["model"],
    messages=[{"role": "user", "content": "..."}],
)
```

## Admin UI

LiteLLM ships a built-in dashboard at `http://localhost:4000/ui`.

Login: `admin` / value of `LITELLM_UI_PASSWORD` from your `.env.litellm`.
