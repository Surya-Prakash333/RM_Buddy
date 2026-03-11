"""
Post-conversation hook — extracts facts and summaries after each chat.

Runs as a FastAPI BackgroundTask (non-blocking). Uses LLM to extract:
- Facts: preference, client_note, decision, pattern, relationship
- Conversation summary: 2-3 sentences + topics + clients discussed
"""

from __future__ import annotations

import json
import logging
from datetime import datetime, timezone
from typing import Any

from langchain_openai import ChatOpenAI
from motor.motor_asyncio import AsyncIOMotorDatabase

from config.settings import settings

logger = logging.getLogger("memory.post_conversation")

EXTRACTION_PROMPT = """Analyze this conversation between an RM and AI assistant. Extract:

1. **Summary**: 2-3 sentence summary of what was discussed.
2. **Topics**: List of topics (e.g., ["portfolio", "alerts", "rebalancing"])
3. **Clients discussed**: List of client IDs or names mentioned.
4. **Facts**: Non-trivial facts to remember. Each fact has:
   - category: one of "preference", "client_note", "decision", "pattern", "relationship"
   - content: the fact in one sentence
   - confidence: 0.5 to 1.0 (how certain this fact is)
   - client_id: if the fact is about a specific client (optional, null otherwise)

Only extract facts that are genuinely useful for future conversations.
Do NOT extract trivial observations.

Return JSON:
{{
  "summary": "...",
  "topics": [...],
  "clients_discussed": [...],
  "facts": [
    {{"category": "...", "content": "...", "confidence": 0.8, "client_id": null}}
  ]
}}

Conversation:
{conversation}

Specialist findings:
{specialist_results}
"""


async def run_post_conversation_hook(
    memory_db: AsyncIOMotorDatabase,
    rm_id: str,
    conversation_id: str,
    session_id: str,
    messages: list[Any],
    specialist_results: dict[str, str],
) -> None:
    """Extract facts and summary from conversation, save to memory DB."""
    try:
        conversation_text = _format_conversation(messages)
        specialist_text = "\n".join(
            f"[{name}]: {text}" for name, text in specialist_results.items()
        )

        if not conversation_text.strip():
            return

        llm = ChatOpenAI(
            base_url=f"{settings.litellm_url}/v1",
            api_key=settings.litellm_master_key,
            model=settings.llm_fast_model,
            temperature=0.1,
        )

        prompt = EXTRACTION_PROMPT.format(
            conversation=conversation_text,
            specialist_results=specialist_text or "None",
        )
        response = await llm.ainvoke([{"role": "user", "content": prompt}])

        content = response.content if hasattr(response, "content") else str(response)
        extracted = _parse_json_response(content)
        if not extracted:
            logger.warning("Post-conversation extraction returned no valid JSON")
            return

        now = datetime.now(timezone.utc)

        # Save conversation summary
        summary_doc = {
            "rm_id": rm_id,
            "conversation_id": conversation_id,
            "session_id": session_id,
            "summary": extracted.get("summary", ""),
            "topics": extracted.get("topics", []),
            "clients_discussed": extracted.get("clients_discussed", []),
            "created_at": now,
        }
        await memory_db["conversation_summaries"].insert_one(summary_doc)

        # Save facts (upsert by content match)
        facts = extracted.get("facts", [])
        for fact in facts:
            if not fact.get("content"):
                continue
            await memory_db["rm_facts"].update_one(
                {"rm_id": rm_id, "content": fact["content"]},
                {
                    "$set": {
                        "rm_id": rm_id,
                        "category": fact.get("category", "client_note"),
                        "content": fact["content"],
                        "confidence": fact.get("confidence", 0.7),
                        "client_id": fact.get("client_id"),
                        "active": True,
                        "updated_at": now,
                    },
                    "$setOnInsert": {"created_at": now},
                },
                upsert=True,
            )

        logger.info(
            "Post-conversation extraction complete [rm_id=%s, facts=%d, summary=%s]",
            rm_id, len(facts), bool(extracted.get("summary")),
        )

    except Exception as exc:
        logger.error("Post-conversation hook failed: %s", exc, exc_info=True)


def _format_conversation(messages: list[Any]) -> str:
    """Format LangGraph messages into readable conversation text."""
    lines = []
    for msg in messages:
        if hasattr(msg, "content") and hasattr(msg, "type"):
            role = "RM" if msg.type == "human" else "Aria"
            lines.append(f"{role}: {msg.content}")
        elif isinstance(msg, dict):
            role = "RM" if msg.get("role") == "user" else "Aria"
            lines.append(f"{role}: {msg.get('content', '')}")
    return "\n".join(lines)


def _parse_json_response(text: str) -> dict | None:
    """Extract JSON from LLM response, handling markdown code blocks."""
    try:
        return json.loads(text)
    except json.JSONDecodeError:
        pass
    if "```json" in text:
        start = text.index("```json") + 7
        end = text.index("```", start)
        try:
            return json.loads(text[start:end].strip())
        except (json.JSONDecodeError, ValueError):
            pass
    brace_start = text.find("{")
    brace_end = text.rfind("}")
    if brace_start >= 0 and brace_end > brace_start:
        try:
            return json.loads(text[brace_start:brace_end + 1])
        except json.JSONDecodeError:
            pass
    return None
