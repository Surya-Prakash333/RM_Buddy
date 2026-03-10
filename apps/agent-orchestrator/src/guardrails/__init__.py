"""
guardrails/__init__.py — Public API for the guardrails package.

Three guard layers are applied in the orchestrator graph:

  input_guard   (first node)  — sanitise and validate inbound messages.
  output_guard  (pre-final)   — policy-check and post-process agent responses.
  action_guard  (on demand)   — validate CRM write actions before execution.
"""

from __future__ import annotations

from .action_guard import (
    ALLOWED_ACTIONS,
    DAILY_ACTION_LIMIT,
    HIGH_RISK_ACTIONS,
    check_action,
    get_daily_action_count,
    increment_daily_action_count,
)
from .input_guard import (
    OFF_TOPIC_PATTERNS,
    INJECTION_PATTERNS,
    WEALTH_KEYWORDS,
    check_input,
    check_prompt_injection,
    check_scope,
    is_off_topic,
    sanitize_input,
)
from .output_guard import (
    ADVICE_PATTERNS,
    FINANCIAL_DISCLAIMER,
    PII_PATTERNS,
    add_disclaimer,
    check_output,
    contains_financial_advice,
    format_indian_numbers,
    mask_pii,
)

__all__ = [
    # input_guard
    "OFF_TOPIC_PATTERNS",
    "INJECTION_PATTERNS",
    "WEALTH_KEYWORDS",
    "check_input",
    "check_prompt_injection",
    "check_scope",
    "is_off_topic",
    "sanitize_input",
    # output_guard
    "ADVICE_PATTERNS",
    "FINANCIAL_DISCLAIMER",
    "PII_PATTERNS",
    "add_disclaimer",
    "check_output",
    "contains_financial_advice",
    "format_indian_numbers",
    "mask_pii",
    # action_guard
    "ALLOWED_ACTIONS",
    "DAILY_ACTION_LIMIT",
    "HIGH_RISK_ACTIONS",
    "check_action",
    "get_daily_action_count",
    "increment_daily_action_count",
]
