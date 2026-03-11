"""
llm_config.py — LiteLLM proxy client configuration.

We point the standard openai.AsyncOpenAI client at the LiteLLM proxy so that
every agent in the graph routes through a single gateway.  LiteLLM handles
model aliasing, rate-limiting, cost tracking, and fallbacks transparently.

Model names are logical aliases configured inside LiteLLM; changing the
underlying provider never requires changes here.

Usage:
    from config.llm_config import get_llm_client, MODELS

    client = get_llm_client()
    response = await client.chat.completions.create(
        model=MODELS["reasoning"],
        messages=[...],
    )
"""

from __future__ import annotations

from openai import AsyncOpenAI

from .settings import settings


def get_llm_client() -> AsyncOpenAI:
    """
    Return an AsyncOpenAI client that targets the LiteLLM proxy.

    A new client instance is created on every call — callers that need
    connection reuse should cache the returned object themselves (e.g. via
    FastAPI dependency injection with `lru_cache`).

    Returns:
        AsyncOpenAI: Configured client ready for async chat completions.
    """
    return AsyncOpenAI(
        base_url=f"{settings.litellm_url}/v1",
        api_key=settings.litellm_master_key,
        # Slightly generous timeout; individual agent calls enforce their own
        # per-request timeout via `timeout=` on .create() calls.
        timeout=float(settings.agent_timeout_seconds),
    )


# ---------------------------------------------------------------------------
# Logical model aliases as routed by LiteLLM
# ---------------------------------------------------------------------------
MODELS: dict[str, str] = {
    # Primary reasoning model
    "reasoning": "claude-default",
    # Cost-optimised model for summarisation / bulk tasks
    "summarization": "gpt-fallback",
    # Embedding model for semantic search / RAG retrieval
    "embedding": "text-embedding-3-small",
}
