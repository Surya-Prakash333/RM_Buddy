"""Input validation — prompt injection and off-topic detection."""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass

logger = logging.getLogger("guardrails.input")

INJECTION_PATTERNS = [
    r"ignore (previous|all) instructions",
    r"reveal (system|your) prompt",
    r"pretend (you are|to be)",
    r"jailbreak",
    r"DAN mode",
    r"act as",
    r"bypass",
    r"disregard your system prompt",
]

OFF_TOPIC_PATTERNS = [
    r"\b(cricket|movie|song|recipe|weather|stock market tip)\b",
]


@dataclass
class InputGuardResult:
    is_blocked: bool
    reason: str | None = None


def check_input(text: str, rm_id: str = "") -> InputGuardResult:
    """Check user input for prompt injection and off-topic patterns."""
    text_lower = text.lower()

    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, text_lower):
            logger.warning("Prompt injection attempt [rm_id=%s, pattern=%s]", rm_id, pattern)
            return InputGuardResult(is_blocked=True, reason="Potential prompt injection detected")

    for pattern in OFF_TOPIC_PATTERNS:
        if re.search(pattern, text_lower):
            return InputGuardResult(
                is_blocked=True,
                reason="Off-topic request — I only assist with wealth management tasks",
            )

    return InputGuardResult(is_blocked=False)
