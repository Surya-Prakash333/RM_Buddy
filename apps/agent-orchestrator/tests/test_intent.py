"""
test_intent.py — Unit tests for the two-stage IntentClassifier.

All tests run without real LLM connections:
  - Keyword-matching tests mock the LLM client so it is never called.
  - LLM fallback tests use a minimal AsyncMock that returns controlled text.

Coverage targets:
  - All 7 IntentType values have at least one positive test.
  - Out-of-scope messages route to UNKNOWN.
  - Confidence thresholds are enforced (>=0.8 keyword, >=0.9 LLM path).
  - Unrecognised LLM output falls back to UNKNOWN with confidence 0.5.
"""

from __future__ import annotations

import sys
import os
from unittest.mock import AsyncMock, MagicMock

import pytest

# ---------------------------------------------------------------------------
# Path setup — allow imports from src/ without installing the package
# ---------------------------------------------------------------------------
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from graphs.intent_classifier import IntentClassifier
from models.types import IntentType


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_mock_llm(response_text: str) -> AsyncMock:
    """Build an AsyncMock LLM client that returns `response_text` as intent."""
    mock_choice = MagicMock()
    mock_choice.message.content = response_text

    mock_completion = MagicMock()
    mock_completion.choices = [mock_choice]

    mock_llm = AsyncMock()
    mock_llm.chat.completions.create = AsyncMock(return_value=mock_completion)
    return mock_llm


# ---------------------------------------------------------------------------
# Keyword-stage tests (LLM should NOT be called)
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_intent_view_alerts_keyword() -> None:
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("view_alerts")

    intent, confidence = await classifier.classify("Show me my alerts", mock_llm)

    assert intent == IntentType.VIEW_ALERTS
    assert confidence >= 0.8
    mock_llm.chat.completions.create.assert_not_called()


@pytest.mark.asyncio
async def test_intent_morning_briefing_keyword() -> None:
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("morning_briefing")

    intent, confidence = await classifier.classify(
        "Give me my morning briefing", mock_llm
    )

    assert intent == IntentType.MORNING_BRIEFING
    assert confidence >= 0.8
    mock_llm.chat.completions.create.assert_not_called()


@pytest.mark.asyncio
async def test_intent_client_query_keyword() -> None:
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("client_query")

    intent, confidence = await classifier.classify(
        "How many clients do I have?", mock_llm
    )

    assert intent == IntentType.CLIENT_QUERY
    assert confidence >= 0.8
    mock_llm.chat.completions.create.assert_not_called()


@pytest.mark.asyncio
async def test_intent_portfolio_analysis_keyword() -> None:
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("portfolio_analysis")

    intent, confidence = await classifier.classify(
        "What is my total AUM this month?", mock_llm
    )

    assert intent == IntentType.PORTFOLIO_ANALYSIS
    assert confidence >= 0.8
    mock_llm.chat.completions.create.assert_not_called()


@pytest.mark.asyncio
async def test_intent_schedule_action_keyword() -> None:
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("schedule_action")

    intent, confidence = await classifier.classify(
        "Schedule a call with Ravi Kumar for tomorrow", mock_llm
    )

    assert intent == IntentType.SCHEDULE_ACTION
    assert confidence >= 0.8
    mock_llm.chat.completions.create.assert_not_called()


@pytest.mark.asyncio
async def test_intent_general_qa_keyword() -> None:
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("general_qa")

    intent, confidence = await classifier.classify(
        "What are the best practices for client engagement?", mock_llm
    )

    assert intent == IntentType.GENERAL_QA
    assert confidence >= 0.8
    mock_llm.chat.completions.create.assert_not_called()


# ---------------------------------------------------------------------------
# LLM fallback tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_intent_llm_fallback_used_for_ambiguous_message() -> None:
    """Messages with no keywords should trigger the LLM fallback."""
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("portfolio_analysis")

    # Deliberately ambiguous — no clear keywords
    intent, confidence = await classifier.classify(
        "Raghu's numbers don't look right", mock_llm
    )

    assert intent == IntentType.PORTFOLIO_ANALYSIS
    assert confidence >= 0.9
    mock_llm.chat.completions.create.assert_called_once()


@pytest.mark.asyncio
async def test_intent_unknown_for_out_of_scope() -> None:
    """Out-of-scope messages should resolve to UNKNOWN via LLM fallback."""
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("unknown")

    intent, confidence = await classifier.classify(
        "What is the cricket score for today's IPL match?", mock_llm
    )

    assert intent == IntentType.UNKNOWN


@pytest.mark.asyncio
async def test_intent_unrecognised_llm_output_falls_back_to_unknown() -> None:
    """If the LLM returns garbage, confidence must be 0.5 and intent UNKNOWN."""
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("definitely_not_a_valid_category")

    intent, confidence = await classifier.classify(
        "xyzzy frobnicate the quux", mock_llm
    )

    assert intent == IntentType.UNKNOWN
    assert confidence == 0.5


# ---------------------------------------------------------------------------
# Confidence threshold tests
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_keyword_confidence_is_exactly_0_8() -> None:
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("view_alerts")

    _, confidence = await classifier.classify("Check my pending notifications", mock_llm)
    assert confidence == 0.8


@pytest.mark.asyncio
async def test_llm_confidence_is_exactly_0_95() -> None:
    classifier = IntentClassifier()
    mock_llm = make_mock_llm("morning_briefing")

    # No keywords → LLM path
    _, confidence = await classifier.classify(
        "Give me the usual thing for starting the day", mock_llm
    )
    assert confidence == 0.95
