"""Synchronous chat endpoint — extracted from main.py."""

from __future__ import annotations

import json
import logging
import time
import uuid
from typing import Any

from fastapi import APIRouter, BackgroundTasks, HTTPException, Request
from langchain_core.messages import AIMessage, HumanMessage

from config.settings import settings
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

    # Load prior conversation messages from session store
    prior_messages: list = []
    try:
        session_data = await session_manager.get_session(request.session_id)
        if session_data and session_data.get("messages"):
            for msg in session_data["messages"][-settings.max_conversation_history:]:
                role = msg.get("role", "")
                content = msg.get("content", "")
                if not content:
                    continue
                if role == "user":
                    prior_messages.append(HumanMessage(content=content))
                elif role == "assistant":
                    prior_messages.append(AIMessage(content=content))
            logger.info(
                "Loaded %d prior messages for session %s",
                len(prior_messages), request.session_id,
            )
    except Exception as exc:
        logger.warning("Failed to load session history: %s", exc)

    # Combine prior messages with current message
    all_messages = prior_messages + [HumanMessage(content=request.message)]

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
        "messages": all_messages,
    }

    try:
        final_state = await supervisor.run(initial_state)
    except Exception as exc:
        logger.error("Supervisor graph failed [rm_id=%s]: %s", request.rm_id, exc)
        raise HTTPException(status_code=500, detail="Internal orchestrator error") from exc

    elapsed_ms = int((time.monotonic() - start_ms) * 1000)

    # Save session in background
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
