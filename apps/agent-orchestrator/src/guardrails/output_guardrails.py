"""Output validation — financial advice detection and uncertainty disclaimers."""

from __future__ import annotations

import re
import logging
from dataclasses import dataclass

logger = logging.getLogger("guardrails.output")

ADVICE_PATTERNS = [
    r"\b(you should (buy|sell|invest))\b",
    r"\b(guaranteed (return|profit))\b",
    r"\b(will definitely (go up|rise|grow))\b",
    r"\binvest in \b",
    r"\byou should purchase\b",
]

UNCERTAINTY_PHRASES = [
    "i'm not sure",
    "i don't know",
    "i cannot confirm",
]

_DISCLAIMER = "\n\n_Note: Please verify this information with the CRM before acting._"


@dataclass
class OutputGuardResult:
    cleaned_text: str
    flags: list[str]


def check_output(text: str) -> OutputGuardResult:
    """Check agent output for unauthorized advice and uncertainty."""
    flags: list[str] = []
    cleaned = text

    text_lower = text.lower()

    # Check for unauthorized financial advice
    for pattern in ADVICE_PATTERNS:
        if re.search(pattern, text_lower):
            flags.append(f"output:financial_advice:{pattern}")
            logger.warning("Output flagged: potential unauthorized financial advice")
            cleaned = (
                "I can provide information about portfolios and performance, "
                "but I'm not able to recommend specific investment actions."
            )
            return OutputGuardResult(cleaned_text=cleaned, flags=flags)

    # Add disclaimer for uncertain responses
    if any(phrase in text_lower for phrase in UNCERTAINTY_PHRASES):
        flags.append("output:uncertainty_disclaimer")
        cleaned = text + _DISCLAIMER

    return OutputGuardResult(cleaned_text=cleaned, flags=flags)
