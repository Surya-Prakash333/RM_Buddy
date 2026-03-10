"""Tests for nightly batch scheduler."""
from __future__ import annotations

import pytest
from unittest.mock import AsyncMock, patch
import sys
import os

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))


@pytest.mark.asyncio
async def test_run_nightly_batch_processes_all_rms() -> None:
    """Should process all active RMs and cache all briefings."""
    from schedulers.nightly_batch import run_nightly_batch

    mock_rms = [{"rm_id": f"RM00{i}"} for i in range(1, 6)]

    with patch("schedulers.nightly_batch.get_active_rms", return_value=mock_rms), \
         patch("schedulers.nightly_batch.prefetch_briefing", new_callable=AsyncMock, return_value=True):
        result = await run_nightly_batch("http://localhost:3001")

    assert result["rms_processed"] == 5
    assert result["briefings_cached"] == 5
    assert result["errors"] == 0


@pytest.mark.asyncio
async def test_run_nightly_batch_handles_empty_rm_list() -> None:
    """Should return zero counts when no active RMs."""
    from schedulers.nightly_batch import run_nightly_batch

    with patch("schedulers.nightly_batch.get_active_rms", return_value=[]):
        result = await run_nightly_batch("http://localhost:3001")

    assert result["rms_processed"] == 0
    assert result["briefings_cached"] == 0
    assert result["errors"] == 0


@pytest.mark.asyncio
async def test_run_nightly_batch_handles_partial_failures() -> None:
    """Failed prefetches should count as errors but not stop other RMs."""
    from schedulers.nightly_batch import run_nightly_batch

    mock_rms = [{"rm_id": f"RM00{i}"} for i in range(1, 4)]
    call_count = {"n": 0}

    async def prefetch_side_effect(rm_id: str, url: str) -> bool:
        call_count["n"] += 1
        if rm_id == "RM002":
            raise Exception("API timeout")
        return True

    with patch("schedulers.nightly_batch.get_active_rms", return_value=mock_rms), \
         patch("schedulers.nightly_batch.prefetch_briefing", side_effect=prefetch_side_effect):
        result = await run_nightly_batch("http://localhost:3001")

    assert result["rms_processed"] == 3
    assert result["briefings_cached"] == 2
    assert result["errors"] == 1


@pytest.mark.asyncio
async def test_batch_processes_all_rms() -> None:
    """All RMs should be processed regardless of batch size."""
    from schedulers.nightly_batch import run_nightly_batch

    call_order: list[str] = []
    mock_rms = [{"rm_id": f"RM{i:03d}"} for i in range(25)]

    async def track_prefetch(rm_id: str, url: str) -> bool:
        call_order.append(rm_id)
        return True

    with patch("schedulers.nightly_batch.get_active_rms", return_value=mock_rms), \
         patch("schedulers.nightly_batch.prefetch_briefing", side_effect=track_prefetch), \
         patch("asyncio.sleep", new_callable=AsyncMock):
        result = await run_nightly_batch("http://localhost:3001")

    assert len(call_order) == 25
    assert result["rms_processed"] == 25
    assert result["errors"] == 0


@pytest.mark.asyncio
async def test_prefetch_false_counts_as_error() -> None:
    """prefetch_briefing returning False should increment errors."""
    from schedulers.nightly_batch import run_nightly_batch

    mock_rms = [{"rm_id": "RM001"}, {"rm_id": "RM002"}]

    async def prefetch_side_effect(rm_id: str, url: str) -> bool:
        return rm_id != "RM002"  # RM002 returns False

    with patch("schedulers.nightly_batch.get_active_rms", return_value=mock_rms), \
         patch("schedulers.nightly_batch.prefetch_briefing", side_effect=prefetch_side_effect):
        result = await run_nightly_batch("http://localhost:3001")

    assert result["briefings_cached"] == 1
    assert result["errors"] == 1
