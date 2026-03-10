"""
output_guard.py — Validate and post-process agent responses before delivery.

Applied as the penultimate node in the orchestrator graph (before
compose_response).  All transformations are non-destructive: the original
intent of the response is preserved; only compliance markers and formatting
are added.

Processing pipeline inside check_output():
  1. Financial advice detection → append regulatory disclaimer.
  2. PII masking for voice responses (message_type == 'voice_transcript').
  3. Indian number formatting → consistent ₹ notation.
  4. Data leakage check → stub for future cross-RM data detection.
"""

from __future__ import annotations

import logging
import re

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Pattern tables
# ---------------------------------------------------------------------------

# Regex patterns that indicate the response contains financial advice.
# Any match triggers the regulatory disclaimer append.
ADVICE_PATTERNS: list[str] = [
    r"\b(buy|sell|purchase|invest\s+in)\s+\w+\s+(stock|share|fund)",
    r"\byou\s+should\s+(buy|sell|invest)",
    r"\brecommend\s+(buying|selling|investing)",
    r"\bguaranteed?\s+return",
    r"\b(\d+)%\s+guaranteed",
    r"\bbest\s+(time|opportunity)\s+to\s+(buy|sell)",
]

# PII type → regex.  Used by mask_pii() to redact sensitive identifiers.
PII_PATTERNS: dict[str, str] = {
    "pan": r"[A-Z]{5}[0-9]{4}[A-Z]",
    "phone": r"\b[6-9]\d{9}\b",
    "email": r"\b[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}\b",
    "aadhaar": r"\b\d{4}\s\d{4}\s\d{4}\b",
}

# Regulatory disclaimer appended when financial advice patterns are detected.
FINANCIAL_DISCLAIMER: str = (
    "\n\n*Note: This is informational only and not personalized investment "
    "advice. Please consult with the client based on their risk profile and "
    "financial goals.*"
)


# ---------------------------------------------------------------------------
# Main entry point (called by orchestrator graph node)
# ---------------------------------------------------------------------------


async def check_output(state: dict) -> dict:
    """
    Main output guard entry point.  Called by the orchestrator's output_guard_node.

    Applies the processing pipeline (advice → PII → numbers) in sequence and
    returns a partial state dict that LangGraph merges.

    Args:
        state: Current AgentState dict.  Must contain 'response'.
               Optionally 'message_type' ('text' | 'voice_transcript') and
               'guardrail_flags'.

    Returns:
        Partial state dict with updated 'response' and 'guardrail_flags'.
        Never sets 'error' — output guard is advisory only.
    """
    response: str = state.get("response") or ""
    if not response:
        logger.info("Output guard — empty response, skipping checks")
        return state

    flags: list[str] = list(state.get("guardrail_flags") or [])
    message_type: str = state.get("message_type", "text")
    rm_id: str = state.get("rm_id", "unknown")

    # --- 1. Financial advice detection --------------------------------------
    if contains_financial_advice(response):
        logger.warning(
            "Output guard — financial advice pattern detected [rm_id=%s]",
            rm_id,
        )
        response = add_disclaimer(response)
        flags.append("output:financial_advice_disclaimer_added")

    # --- 2. PII masking (voice responses only) ------------------------------
    if message_type == "voice_transcript":
        masked = mask_pii(response)
        if masked != response:
            logger.info(
                "Output guard — PII masked for voice response [rm_id=%s]",
                rm_id,
            )
            response = masked
            flags.append("output:pii_masked")

    # --- 3. Indian number formatting ----------------------------------------
    formatted = format_indian_numbers(response)
    if formatted != response:
        logger.info(
            "Output guard — Indian number formatting applied [rm_id=%s]",
            rm_id,
        )
        response = formatted

    logger.info(
        "Output guard — response processed [rm_id=%s, flags=%s]",
        rm_id,
        flags,
    )
    return {
        "response": response,
        "guardrail_flags": flags,
    }


# ---------------------------------------------------------------------------
# Individual check / transform functions (importable for unit testing)
# ---------------------------------------------------------------------------


def contains_financial_advice(response: str) -> bool:
    """
    Return True if the response text matches any financial advice pattern.

    Args:
        response: Agent response string.

    Returns:
        True if one or more ADVICE_PATTERNS match.
    """
    for pattern in ADVICE_PATTERNS:
        if re.search(pattern, response, re.IGNORECASE):
            return True
    return False


def add_disclaimer(response: str) -> str:
    """
    Append the financial disclaimer to the response (idempotent).

    Args:
        response: Agent response string.

    Returns:
        Response with FINANCIAL_DISCLAIMER appended (no duplicate).
    """
    if FINANCIAL_DISCLAIMER in response:
        return response
    return response + FINANCIAL_DISCLAIMER


def mask_pii(response: str) -> str:
    """
    Redact PII tokens found in the response string.

    Applies each pattern in PII_PATTERNS sequentially.  Replacements use
    the form '[PAN REDACTED]', '[PHONE REDACTED]', etc.

    Args:
        response: Agent response string.

    Returns:
        String with PII tokens replaced by redaction placeholders.
    """
    masked = response
    for pii_type, pattern in PII_PATTERNS.items():
        masked = re.sub(pattern, f"[{pii_type.upper()} REDACTED]", masked)
    return masked


def format_indian_numbers(text: str) -> str:
    """
    Convert large standalone rupee amounts to compact Indian notation.

    Rules:
      >= 10,000,000 (1 Cr)  → ₹X.X Cr
      >= 100,000    (1 L)   → ₹X.X L
      >= 1,000              → ₹X,XXX (comma formatted)
      < 1,000               → unchanged

    Only converts numbers that are preceded by an optional currency marker
    (₹ or Rs / Rs.).  Bare numbers in non-monetary context are left alone.

    Args:
        text: Agent response string.

    Returns:
        String with large rupee amounts converted to compact Indian format.
    """

    def _replace(match: re.Match) -> str:  # type: ignore[type-arg]
        # Group 1 is always present (the digits); group 0 includes the ₹/Rs prefix.
        prefix = match.group(0)[: match.start(1) - match.start(0)]
        num_str = match.group(1).replace(",", "")
        try:
            num = float(num_str)
        except ValueError:
            return match.group(0)

        if num >= 10_000_000:
            return f"₹{num / 10_000_000:.1f} Cr"
        if num >= 100_000:
            return f"₹{num / 100_000:.1f} L"
        if num >= 1_000:
            return f"₹{num:,.0f}"
        # Below 1,000: keep prefix but leave number as-is.
        return match.group(0)

    # Match optional ₹ / Rs / Rs. prefix followed by digits (with optional commas
    # and a single decimal part).
    return re.sub(
        r"(?:₹|Rs\.?\s*)([\d,]+(?:\.\d+)?)",
        _replace,
        text,
    )
