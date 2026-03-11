"""
settings.py — Application-wide configuration for the RM Buddy Agent Orchestrator.

All values can be overridden via environment variables or via an .env.orchestrator
file placed at the working directory (the default env_file for pydantic-settings).

Usage:
    from config.settings import settings

    print(settings.litellm_url)
"""

from __future__ import annotations

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Flat settings class — no env_prefix so variable names match exactly."""

    # -----------------------------------------------------------------------
    # Service identity
    # -----------------------------------------------------------------------
    app_name: str = "rm-orchestrator"
    port: int = 5000
    debug: bool = False

    # -----------------------------------------------------------------------
    # LiteLLM proxy (OpenAI-compatible)
    # -----------------------------------------------------------------------
    litellm_url: str = "http://localhost:4000"
    litellm_master_key: str = "sk-litellm-dev-key"

    # -----------------------------------------------------------------------
    # Core API (NestJS service)
    # -----------------------------------------------------------------------
    core_api_url: str = "http://localhost:3001"

    # -----------------------------------------------------------------------
    # Redis — working memory / session cache
    # -----------------------------------------------------------------------
    redis_host: str = "localhost"
    redis_port: int = 6379
    redis_password: str = ""

    # -----------------------------------------------------------------------
    # MongoDB — persistent session history
    # -----------------------------------------------------------------------
    mongodb_uri: str = "mongodb://localhost:27017/rmbuddy"

    # -----------------------------------------------------------------------
    # Agent runtime knobs
    # -----------------------------------------------------------------------
    max_agent_tokens: int = 4096
    agent_temperature: float = 0.3
    agent_timeout_seconds: int = 30
    working_memory_ttl: int = 1800  # seconds — 30 min

    class Config:
        env_file = ".env.orchestrator"
        env_prefix = ""
        extra = "ignore"


# Module-level singleton — import as `from config.settings import settings`
settings = Settings()
