"""
input_guard.py — Validate and sanitise agent inputs before LLM processing.

Applied as the first node in the orchestrator graph.  All checks are
synchronous regex scans so they add negligible latency.

Guard order applied inside check_input():
  1. Prompt injection detection  → hard block, sets error on state.
  2. Scope enforcement           → hard block if RM tries cross-RM data access.
  3. Off-topic detection         → soft block, sets error on state.
  4. Input sanitisation          → always runs; cleans HTML / SQL / control chars.
"""

from __future__ import annotations

import logging
import re
from typing import Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pattern tables
# ---------------------------------------------------------------------------

# Off-topic patterns (not wealth management related).
# These are matched case-insensitively against the full message.
OFF_TOPIC_PATTERNS: list[str] = [
    r"\bcricket\b",
    r"\bfootball\b",
    r"\bweather\b",
    r"\bnews\b",
    r"\bpolitics?\b",
    r"\brecipe\b",
    r"\bcook\b",
    r"\bmovie\b",
    r"\bsports?\b",
    r"\bmovies?\b",
    r"\bhoroscope\b",
    r"\bgossip\b",
]

# Prompt injection / jailbreak patterns.
# Any match triggers a hard block regardless of surrounding context.
INJECTION_PATTERNS: list[str] = [
    r"ignore\s+(previous|prior|above|all)\s+instructions?",
    r"forget\s+(everything|all|your)",
    r"you\s+are\s+now\s+",
    r"act\s+as\s+(if|though)",
    r"jailbreak",
    r"DAN\s+mode",
    r"pretend\s+(you|to\s+be)",
    r"system\s*:\s*",
    r"<\s*/?system\s*>",
]

# Wealth management domain keywords used for off-topic soft-boundary check.
# If ANY of these appear in the message, the message is considered on-topic
# regardless of whether an off-topic pattern also matches.
WEALTH_KEYWORDS: list[str] = [
    "client",
    "portfolio",
    "aum",
    "investment",
    "fund",
    "equity",
    "debt",
    "alert",
    "meeting",
    "revenue",
    "return",
    "risk",
    "goal",
    "sip",
    "maturity",
    "dividend",
    "mutual fund",
    "stock",
    "bond",
    "fixed deposit",
    "insurance",
    "lead",
    "pipeline",
    "performance",
    "briefing",
    "portfolio action",
    "daily summary",
    "market schedule",
]


# ---------------------------------------------------------------------------
# Main entry point (called by orchestrator graph node)
# ---------------------------------------------------------------------------


async def check_input(state: dict) -> dict:
    """
    Main input guard entry point.  Called by the orchestrator's input_guard_node.

    Modifies state by returning a partial dict that LangGraph merges.
    Returns state with 'error' set if validation fails, otherwise returns
    the sanitised message and an empty guardrail_flags list.

    Args:
        state: Current AgentState dict — must contain 'message' and
               'rm_id', optionally 'rm_role'.

    Returns:
        Partial state dict with at minimum {'guardrail_flags', 'message'}.
        Sets 'error' on guard failures.
    """
    message: str = state.get("message", "")
    rm_identity: dict = {
        "rm_id": state.get("rm_id", ""),
        "role": state.get("rm_role", "RM"),
    }

    # --- 1. Prompt injection check ------------------------------------------
    injection_error = check_prompt_injection(message)
    if injection_error:
        logger.warning(
            "Input guard — prompt injection blocked [rm_id=%s]",
            rm_identity["rm_id"],
        )
        return {
            "guardrail_flags": ["input:prompt_injection"],
            "error": injection_error,
            "message": message,
        }

    # --- 2. Scope check -------------------------------------------------------
    scope_error = check_scope(rm_identity, message)
    if scope_error:
        logger.warning(
            "Input guard — scope violation blocked [rm_id=%s, role=%s]",
            rm_identity["rm_id"],
            rm_identity["role"],
        )
        return {
            "guardrail_flags": ["input:scope_violation"],
            "error": scope_error,
            "message": message,
        }

    # --- 3. Off-topic check ---------------------------------------------------
    if is_off_topic(message):
        logger.warning(
            "Input guard — off-topic message blocked [rm_id=%s]",
            rm_identity["rm_id"],
        )
        return {
            "guardrail_flags": ["input:off_topic"],
            "error": "I can only help with wealth management queries.",
            "message": message,
        }

    # --- 4. Sanitise input (always runs) -------------------------------------
    clean_message = sanitize_input(message)
    if clean_message != message:
        logger.info(
            "Input guard — message sanitised [rm_id=%s]",
            rm_identity["rm_id"],
        )

    logger.info(
        "Input guard — message passed all checks [rm_id=%s]",
        rm_identity["rm_id"],
    )
    return {
        "guardrail_flags": [],
        "error": None,
        "message": clean_message,
    }


# ---------------------------------------------------------------------------
# Individual check functions (importable for unit testing)
# ---------------------------------------------------------------------------


def check_prompt_injection(message: str) -> Optional[str]:
    """
    Scan message for prompt injection / jailbreak patterns.

    Args:
        message: Raw user message string.

    Returns:
        Human-readable error string if injection detected, else None.
    """
    for pattern in INJECTION_PATTERNS:
        if re.search(pattern, message, re.IGNORECASE):
            logger.warning(
                "Prompt injection pattern matched [pattern=%r]", pattern
            )
            return "I can only help with wealth management queries."
    return None


def is_off_topic(message: str) -> bool:
    """
    Return True if the message is clearly off-topic for wealth management.

    Logic:
      - If any WEALTH_KEYWORDS are present → on-topic (return False).
      - Else if any OFF_TOPIC_PATTERNS match → off-topic (return True).
      - Otherwise → on-topic (return False).

    Args:
        message: User message string.

    Returns:
        True if the message should be rejected as out-of-scope.
    """
    message_lower = message.lower()

    # Wealth domain keywords take priority — if present, never off-topic.
    if any(kw in message_lower for kw in WEALTH_KEYWORDS):
        return False

    # Check against explicit off-topic signal patterns.
    for pattern in OFF_TOPIC_PATTERNS:
        if re.search(pattern, message_lower, re.IGNORECASE):
            return True

    return False


def sanitize_input(message: str) -> str:
    """
    Strip potentially dangerous content from the input message.

    Steps applied in order:
      1. Remove HTML/XML tags.
      2. Neutralise SQL injection attempts (statement terminators before DML).
      3. Strip ASCII control characters (preserves newlines).

    Args:
        message: Raw input string.

    Returns:
        Cleaned string, stripped of leading/trailing whitespace.
    """
    # 1. Remove HTML tags
    message = re.sub(r"<[^>]+>", "", message)

    # 2. Neutralise SQL DML after a semicolon (DROP, DELETE, INSERT, UPDATE, SELECT)
    message = re.sub(
        r";\s*(DROP|DELETE|INSERT|UPDATE|SELECT)\s+",
        "; ",
        message,
        flags=re.IGNORECASE,
    )

    # 3. Strip ASCII control characters except tab (0x09), LF (0x0A), CR (0x0D)
    message = re.sub(r"[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]", "", message)

    return message.strip()


def check_scope(rm_identity: dict, message: str) -> Optional[str]:
    """
    Enforce data scope boundaries for the requesting RM.

    Current rule:
      - An RM (not BM/ADMIN) may not query across all RMs or the whole branch.

    Future extension: extract client_id references from the message and verify
    each against the RM's own client roster via the Core API.

    Args:
        rm_identity: Dict containing at least 'rm_id' and 'role' keys.
        message:     User message string.

    Returns:
        Error string if scope violation detected, else None.
    """
    role: str = rm_identity.get("role", "RM")

    # Only RMs have restricted scope; BMs and ADMINs have broader access.
    if role == "RM" and re.search(
        r"\ball\s+(rms?|relationship\s+managers?)\b", message, re.IGNORECASE
    ):
        return "You can only access your own client data."

    return None
