"""
nightly_batch.py — Nightly pre-computation batch for RM Buddy.

Runs at 2AM daily:
  - Pre-fetches morning briefings for all active RMs (warms Core API cache)
  - Processes RMs in batches of BATCH_SIZE with BATCH_DELAY_S between batches
    to avoid overloading VM-3

Usage:
    # Wire into FastAPI startup (main.py):
    scheduler = setup_scheduler(settings.CORE_API_URL)
    if scheduler:
        scheduler.start()
"""

from __future__ import annotations

import asyncio
import logging
import os
from typing import Any

import httpx

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BATCH_SIZE = 10       # RMs processed concurrently per batch
BATCH_DELAY_S = 0.5   # seconds between batches


# ---------------------------------------------------------------------------
# Helper functions
# ---------------------------------------------------------------------------


def _get_internal_secret() -> str:
    return os.environ.get("INTERNAL_SECRET", "dev-secret")


async def get_active_rms(core_api_url: str) -> list[dict[str, Any]]:
    """Fetch all active RM profiles from Core API internal endpoint."""
    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{core_api_url}/api/v1/internal/rms",
                headers={"X-Internal-Secret": _get_internal_secret()},
            )
            if resp.status_code == 200:
                data = resp.json()
                return data.get("data", [])
            logger.warning("get_active_rms: HTTP %s", resp.status_code)
            return []
    except Exception as exc:
        logger.error("get_active_rms failed: %s", exc)
        return []


async def prefetch_briefing(rm_id: str, core_api_url: str) -> bool:
    """
    Trigger briefing pre-computation for one RM.

    Calls GET /api/v1/briefing/today which internally generates + caches
    the briefing. Returns True on success, False on failure.
    """
    import base64
    import json

    identity_header = base64.b64encode(
        json.dumps({"rm_id": rm_id, "role": "RM"}).encode()
    ).decode()

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{core_api_url}/api/v1/briefing/today",
                headers={
                    "X-RM-Identity": identity_header,
                    "X-Internal-Secret": _get_internal_secret(),
                },
            )
            return resp.status_code == 200
    except Exception as exc:
        logger.error("prefetch_briefing failed for %s: %s", rm_id, exc)
        return False


# ---------------------------------------------------------------------------
# Main batch job
# ---------------------------------------------------------------------------


async def run_nightly_batch(core_api_url: str) -> dict[str, Any]:
    """
    Main nightly batch job.

    Processes all active RMs in batches of BATCH_SIZE.
    Returns summary dict: { rms_processed, briefings_cached, errors }.
    """
    logger.info("Nightly batch started — fetching active RMs")

    rms = await get_active_rms(core_api_url)
    if not rms:
        logger.warning("Nightly batch: no active RMs found — nothing to do")
        return {"rms_processed": 0, "briefings_cached": 0, "errors": 0}

    total = len(rms)
    briefings_cached = 0
    errors = 0

    for i in range(0, total, BATCH_SIZE):
        batch = rms[i : i + BATCH_SIZE]
        batch_num = i // BATCH_SIZE + 1
        logger.info(
            "Nightly batch: batch %d — %d RMs (total processed so far: %d/%d)",
            batch_num,
            len(batch),
            i,
            total,
        )

        tasks = [prefetch_briefing(rm["rm_id"], core_api_url) for rm in batch]
        results = await asyncio.gather(*tasks, return_exceptions=True)

        for rm, result in zip(batch, results):
            if isinstance(result, Exception):
                logger.error("Batch error for %s: %s", rm["rm_id"], result)
                errors += 1
            elif result:
                briefings_cached += 1
            else:
                errors += 1

        # Throttle between batches — skip delay after the last batch
        if i + BATCH_SIZE < total:
            await asyncio.sleep(BATCH_DELAY_S)

    summary: dict[str, Any] = {
        "rms_processed": total,
        "briefings_cached": briefings_cached,
        "errors": errors,
    }
    logger.info("Nightly batch complete: %s", summary)
    return summary


# ---------------------------------------------------------------------------
# Scheduler setup
# ---------------------------------------------------------------------------


def setup_scheduler(core_api_url: str) -> Any:
    """
    Configure APScheduler for 2AM nightly batch.

    Returns the scheduler instance (caller must call .start()).
    Returns None if APScheduler is not installed (soft dependency).
    """
    try:
        from apscheduler.schedulers.asyncio import AsyncIOScheduler
        from apscheduler.triggers.cron import CronTrigger

        scheduler = AsyncIOScheduler()
        scheduler.add_job(
            run_nightly_batch,
            trigger=CronTrigger(hour=2, minute=0),
            args=[core_api_url],
            id="nightly_batch",
            name="Nightly RM Batch Pre-computation",
            replace_existing=True,
            max_instances=1,
        )
        logger.info("Nightly batch scheduler configured (2AM daily)")
        return scheduler
    except ImportError:
        logger.warning("APScheduler not installed — nightly batch scheduler disabled")
        return None
