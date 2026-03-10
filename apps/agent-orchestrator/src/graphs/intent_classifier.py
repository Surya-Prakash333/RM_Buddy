"""
intent_classifier.py — Two-stage intent classifier for RM Buddy messages.

Stage 1 — Keyword matching (fast, zero LLM cost):
    A dictionary of intent → keyword list is checked against the lowercased
    message.  On a match, confidence is 0.8 (high but not certain, leaves
    room for override).  Order of dict iteration is insertion order (Python
    3.7+), so more specific intents should appear first if keywords overlap.

Stage 2 — LLM fallback (slow, used only when keywords are ambiguous):
    The INTENT_CLASSIFIER_PROMPT is sent to the cost-optimised model with
    temperature=0 and max_tokens=20.  Confidence is 0.95.  If the LLM
    returns an unrecognised string, we fall back to UNKNOWN with 0.5.

Design rationale:
    - The vast majority of RM messages are simple and match keywords.
    - LLM fallback keeps accuracy high for edge cases without paying per-call.
    - Keeping classification outside the main graph nodes makes it unit-testable
      in isolation without needing a full graph execution.
"""

from __future__ import annotations

import logging

from openai import AsyncOpenAI

from config.prompts import INTENT_CLASSIFIER_PROMPT
from models.types import IntentType

logger = logging.getLogger(__name__)


class IntentClassifier:
    """
    Two-stage intent classifier: keyword rules followed by LLM fallback.

    Instantiate once and reuse across requests — the instance holds no
    mutable per-request state.
    """

    # Keyword rules ordered from most-specific to least-specific.
    # A message is matched to the FIRST intent whose keywords appear in it.
    KEYWORD_RULES: dict[IntentType, list[str]] = {
        IntentType.VIEW_ALERTS: [
            "alert", "notification", "urgent", "pending", "warning",
            "due", "overdue", "action required",
        ],
        IntentType.MORNING_BRIEFING: [
            "briefing", "morning briefing", "daily briefing",
            "start of day", "what's on today", "morning overview",
        ],
        IntentType.CLIENT_QUERY: [
            "my clients", "client list", "how many clients", "which client",
            "list clients", "client count", "my portfolio clients",
        ],
        IntentType.PORTFOLIO_ANALYSIS: [
            "portfolio", "aum", "holding", "performance", "return",
            "fund", "stock", "investment", "asset", "allocation",
        ],
        IntentType.SCHEDULE_ACTION: [
            "schedule", "meeting", "call", "appointment", "book",
            "arrange", "remind", "follow up", "follow-up",
        ],
        IntentType.GENERAL_QA: [
            "explain to me", "tell me about", "how does", "what is a",
            "what are the", "help me understand", "describe the",
            "what does", "how to",
        ],
    }

    async def classify(
        self,
        message: str,
        llm_client: AsyncOpenAI,
    ) -> tuple[IntentType, float]:
        """
        Classify the user message into an IntentType.

        Args:
            message:    Raw user message text.
            llm_client: Async OpenAI-compatible client (used only when no
                        keyword match is found).

        Returns:
            Tuple of (IntentType, confidence) where confidence is 0.0–1.0.
        """
        # ------------------------------------------------------------------
        # Stage 1: keyword matching
        # ------------------------------------------------------------------
        message_lower = message.lower()
        for intent, keywords in self.KEYWORD_RULES.items():
            if any(kw in message_lower for kw in keywords):
                logger.debug(
                    "Intent classified by keyword [intent=%s, message_preview=%.50s]",
                    intent,
                    message,
                )
                return intent, 0.8

        # ------------------------------------------------------------------
        # Stage 2: LLM fallback for ambiguous messages
        # ------------------------------------------------------------------
        logger.debug(
            "No keyword match — falling back to LLM classification [message_preview=%.50s]",
            message,
        )
        try:
            response = await llm_client.chat.completions.create(
                model="claude-default",
                messages=[
                    {"role": "system", "content": INTENT_CLASSIFIER_PROMPT},
                    {"role": "user", "content": message},
                ],
                max_tokens=20,
                temperature=0.0,
            )
            intent_str = response.choices[0].message.content.strip().lower()
            intent = IntentType(intent_str)
            logger.debug("LLM classified intent [intent=%s]", intent)
            return intent, 0.95
        except ValueError:
            logger.warning(
                "LLM returned unrecognised intent string [raw=%s]", intent_str
            )
            return IntentType.UNKNOWN, 0.5
        except Exception as exc:
            logger.error("LLM intent classification failed [error=%s]", exc)
            return IntentType.UNKNOWN, 0.0
