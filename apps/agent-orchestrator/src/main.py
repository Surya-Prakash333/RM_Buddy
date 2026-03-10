"""
main.py — FastAPI application entrypoint for the RM Buddy Agent Orchestrator.

Endpoints:
    POST /agent/chat       Main conversational endpoint for RMs and BMs.
    POST /agent/proactive  Triggered by comm-service for proactive alert processing.
    GET  /health           Liveness check for load balancers and PM2.

Startup / shutdown lifespan:
    - Initialises shared HTTP client (httpx), Redis, and Motor connections.
    - Builds the OrchestratorGraph once (expensive compile step happens once).
    - Cleanly closes all connections on shutdown.

All state (LLM client, graph, memory) is injected via FastAPI app.state so
that tests can swap implementations without monkey-patching.
"""

from __future__ import annotations

import logging
import sys
from contextlib import asynccontextmanager
from typing import Any, AsyncGenerator

import httpx
import redis.asyncio as aioredis
from fastapi import Depends, FastAPI, HTTPException, Request
from motor.motor_asyncio import AsyncIOMotorClient

from config.llm_config import get_llm_client
from config.settings import settings
from graphs.orchestrator import OrchestratorGraph
from memory.session_memory import SessionMemory
from models.schemas import AgentRequest, AgentResponse

# ---------------------------------------------------------------------------
# Logging setup — structured JSON in production, plain in debug
# ---------------------------------------------------------------------------
logging.basicConfig(
    stream=sys.stdout,
    level=logging.DEBUG if settings.debug else logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s — %(message)s",
)
logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Application lifespan (startup + shutdown)
# ---------------------------------------------------------------------------

@asynccontextmanager
async def lifespan(app: FastAPI) -> AsyncGenerator[None, None]:
    """Manage shared resources across the application lifetime."""
    logger.info("Starting up %s on port %s", settings.app_name, settings.port)

    # LLM client
    llm_client = get_llm_client()

    # HTTP client for Core API calls
    http_client = httpx.AsyncClient(
        base_url=settings.core_api_url,
        timeout=15.0,
        headers={"Content-Type": "application/json"},
    )

    # Redis — working memory
    redis_kwargs: dict[str, Any] = {
        "host": settings.redis_host,
        "port": settings.redis_port,
        "decode_responses": True,
    }
    if settings.redis_password:
        redis_kwargs["password"] = settings.redis_password
    redis_client = aioredis.Redis(**redis_kwargs)

    # MongoDB — persistent history
    mongo_client = AsyncIOMotorClient(settings.mongodb_uri)

    # Session memory
    session_memory = SessionMemory(
        redis_client=redis_client,
        mongo_client=mongo_client,
        ttl=settings.working_memory_ttl,
    )

    # Build orchestrator graph (compile happens here once)
    orchestrator = OrchestratorGraph(llm_client=llm_client, tools=[])

    # Attach everything to app.state for dependency injection
    app.state.llm_client = llm_client
    app.state.http_client = http_client
    app.state.redis_client = redis_client
    app.state.mongo_client = mongo_client
    app.state.session_memory = session_memory
    app.state.orchestrator = orchestrator

    logger.info("All services initialised — ready to accept requests")

    yield

    # ------------------------------------------------------------------
    # Shutdown
    # ------------------------------------------------------------------
    logger.info("Shutting down %s", settings.app_name)
    await http_client.aclose()
    await redis_client.aclose()
    mongo_client.close()
    logger.info("Shutdown complete")


# ---------------------------------------------------------------------------
# FastAPI application
# ---------------------------------------------------------------------------

app = FastAPI(
    title="RM Buddy Agent Orchestrator",
    version="1.0.0",
    description=(
        "LangGraph-based AI agent orchestrator for Nuvama Wealth Management. "
        "Routes RM/BM messages through intent classification → specialist agents."
    ),
    lifespan=lifespan,
)


# ---------------------------------------------------------------------------
# Dependency helpers
# ---------------------------------------------------------------------------

def get_orchestrator(request: Request) -> OrchestratorGraph:
    return request.app.state.orchestrator


def get_session_memory(request: Request) -> SessionMemory:
    return request.app.state.session_memory


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@app.post(
    "/agent/chat",
    response_model=AgentResponse,
    summary="Process an RM or BM message through the agent orchestrator.",
)
async def chat(
    request: AgentRequest,
    orchestrator: OrchestratorGraph = Depends(get_orchestrator),
    memory: SessionMemory = Depends(get_session_memory),
) -> AgentResponse:
    """
    Main chat endpoint.

    Flow:
      1. Append the user message to persistent history.
      2. Run the LangGraph orchestrator.
      3. Append the assistant response to persistent history.
      4. Return the AgentResponse.
    """
    logger.info(
        "Chat request received [rm_id=%s, session_id=%s, message_preview=%.60s]",
        request.rm_id,
        request.session_id,
        request.message,
    )

    # Persist user turn
    await memory.append_message(
        request.session_id,
        {"role": "user", "content": request.message, "rm_id": request.rm_id},
    )

    try:
        response = await orchestrator.run(request)
    except Exception as exc:
        logger.error(
            "Unhandled orchestrator error [rm_id=%s, error=%s]",
            request.rm_id,
            exc,
        )
        raise HTTPException(status_code=500, detail="Internal orchestrator error") from exc

    # Persist assistant turn
    if response.text:
        await memory.append_message(
            request.session_id,
            {
                "role": "assistant",
                "content": response.text,
                "agent_id": response.agent_id,
                "message_id": response.message_id,
            },
        )

    return response


@app.post(
    "/agent/proactive",
    summary="Handle proactive alert processing triggered by comm-service.",
)
async def proactive(
    payload: dict[str, Any],
    orchestrator: OrchestratorGraph = Depends(get_orchestrator),
) -> dict[str, Any]:
    """
    Proactive alert endpoint.

    Called by the comm-service (or Kafka consumer) when an alert is
    generated and needs to be enriched with AI commentary before delivery.

    Payload keys (all optional in this story — enriched in S1/S2):
        rm_id       str — target RM
        alert_type  str — 'birthday' | 'idle_cash' | 'maturity' | etc.
        data        dict — alert-specific payload

    Returns a dict with an 'enriched_text' key added by the agent.
    """
    logger.info(
        "Proactive alert received [rm_id=%s, alert_type=%s]",
        payload.get("rm_id"),
        payload.get("alert_type"),
    )

    # Stub — enrichment logic added in S1
    return {
        "status": "received",
        "rm_id": payload.get("rm_id"),
        "alert_type": payload.get("alert_type"),
        "enriched_text": None,  # populated by specialist agents in S1
    }


@app.get("/health", summary="Liveness check.")
async def health() -> dict[str, str]:
    """Return service health status."""
    return {
        "status": "ok",
        "service": settings.app_name,
        "version": "1.0.0",
    }
