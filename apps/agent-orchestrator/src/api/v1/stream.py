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
