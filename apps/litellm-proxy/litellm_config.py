"""
LiteLLM proxy configuration and client helper.
Used by agent-orchestrator to make LLM calls through the proxy.
"""
import os
import httpx
from typing import Optional

LITELLM_URL = os.getenv("LITELLM_URL", "http://localhost:4000")
LITELLM_MASTER_KEY = os.getenv("LITELLM_MASTER_KEY", "sk-litellm-dev-key")

# Model routing rules:
# - Agent reasoning, intent classification: claude-default
# - Cost-sensitive summaries, embeddings: gemini-cost / embedding-model
# - Fallback when claude unavailable: gpt-fallback
MODEL_ROUTING = {
    "agent_reasoning": "claude-default",
    "intent_classification": "claude-default",
    "summarization": "gemini-cost",
    "embedding": "embedding-model",
    "fallback": "gpt-fallback",
}


async def check_health() -> dict:
    """Check LiteLLM proxy health status."""
    async with httpx.AsyncClient() as client:
        try:
            resp = await client.get(f"{LITELLM_URL}/health", timeout=5.0)
            return resp.json()
        except Exception as e:
            return {"status": "unhealthy", "error": str(e)}


async def list_models() -> list[str]:
    """List available models from proxy."""
    async with httpx.AsyncClient() as client:
        headers = {"Authorization": f"Bearer {LITELLM_MASTER_KEY}"}
        resp = await client.get(f"{LITELLM_URL}/models", headers=headers, timeout=5.0)
        data = resp.json()
        return [m["id"] for m in data.get("data", [])]


def get_client_config(task_type: str = "agent_reasoning") -> dict:
    """Get OpenAI-compatible client config for given task type."""
    return {
        "base_url": f"{LITELLM_URL}/v1",
        "api_key": LITELLM_MASTER_KEY,
        "model": MODEL_ROUTING.get(task_type, "claude-default"),
    }
