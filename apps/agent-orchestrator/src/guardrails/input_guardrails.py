"""Input validation — prompt injection, harmful content, and off-topic detection."""

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

# Harmful / dangerous content — block immediately without calling agents
HARMFUL_PATTERNS = [
    r"\b(how to (make|create|build|manufacture|produce|assemble))\b.{0,30}\b(bomb|weapon|explosive|poison|drug|narcotic|meth|cocaine|heroin|fentanyl)\b",
    r"\b(bomb|weapon|explosive|poison)\b.{0,30}\b(make|create|build|recipe|instructions|how)\b",
    r"\bhow to (hack|attack|exploit|ddos|phish)\b",
    r"\b(kill|murder|assassinate|harm|hurt)\b.{0,20}\b(someone|person|people|him|her)\b",
    r"\b(suicide|self.harm)\b.{0,20}\b(how|method|way)\b",
    r"\b(illegal|illicit)\b.{0,20}\b(how|guide|tutorial)\b",
    r"\b(hydrogen bomb|nuclear weapon|chemical weapon|biological weapon)\b",
    r"\b(launder money|money laundering|tax evasion|fraud scheme)\b",
]

OFF_TOPIC_PATTERNS = [
    r"\b(cricket|movie|song|recipe|weather|stock market tip)\b",
]


@dataclass
class InputGuardResult:
    is_blocked: bool
    reason: str | None = None


def check_input(text: str, rm_id: str = "") -> InputGuardResult:
    """Check user input for prompt injection, harmful content, and off-topic patterns."""
    text_lower = text.lower()

    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, text_lower):
            logger.warning("Prompt injection attempt [rm_id=%s, pattern=%s]", rm_id, pattern)
            return InputGuardResult(is_blocked=True, reason="Potential prompt injection detected")

    for pattern in HARMFUL_PATTERNS:
        if re.search(pattern, text_lower):
            logger.warning("Harmful content blocked [rm_id=%s]", rm_id)
            return InputGuardResult(
                is_blocked=True,
                reason="I can't help with that request. I'm here to assist with wealth management tasks only.",
            )

    for pattern in OFF_TOPIC_PATTERNS:
        if re.search(pattern, text_lower):
            return InputGuardResult(
                is_blocked=True,
                reason="Off-topic request — I only assist with wealth management tasks",
            )

    return InputGuardResult(is_blocked=False)
