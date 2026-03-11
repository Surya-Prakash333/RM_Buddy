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
from api.v1.sessions import router as sessions_router

app.include_router(chat_router, prefix="/agent", tags=["Chat"])
app.include_router(stream_router, prefix="/agent", tags=["Streaming"])
app.include_router(sessions_router, prefix="/agent", tags=["Sessions"])


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
