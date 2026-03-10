"""
action_guard.py — Validate CRM write actions before execution.

Called on demand by agent tools — NOT a graph node.  Any specialist agent
that wants to perform a CRM mutation (meeting, lead, note, etc.) must call
check_action() first and honour the returned verdict.

Design decisions:
  - Whitelist approach: only explicitly approved action types are permitted.
  - High-risk actions require explicit RM confirmation (human-in-the-loop).
  - Daily rate limit is enforced via a Redis counter (key-per-RM-per-day).
  - Never raises exceptions — callers receive a structured result dict.
"""

from __future__ import annotations

import logging
from datetime import date
from typing import Any, Optional

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Action policy tables
# ---------------------------------------------------------------------------

# Exhaustive whitelist of CRM action types the agent is permitted to trigger.
# Any type NOT in this set is rejected immediately.
ALLOWED_ACTIONS: frozenset[str] = frozenset(
    {
        "CREATE_MEETING",
        "UPDATE_MEETING_NOTES",
        "CREATE_LEAD",
        "UPDATE_LEAD_STATUS",
        "CREATE_PIPELINE",
        "UPDATE_PIPELINE_STAGE",
        "ACKNOWLEDGE_ALERT",
        "ADD_CLIENT_NOTE",
    }
)

# Actions that are allowed but require explicit RM confirmation before
# the agent executes them.  The caller must re-invoke with confirmed=True
# after the user approves.
HIGH_RISK_ACTIONS: frozenset[str] = frozenset(
    {
        "CREATE_MEETING",
        "CREATE_LEAD",
    }
)

# Maximum number of CRM write actions an RM may perform per calendar day.
DAILY_ACTION_LIMIT: int = 20


# ---------------------------------------------------------------------------
# Main entry point
# ---------------------------------------------------------------------------


async def check_action(
    action_type: str,
    rm_id: str,
    payload: dict,
    redis_client: Optional[Any] = None,
) -> dict:
    """
    Validate a CRM action before the agent executes it.

    Checks applied in order:
      1. Whitelist — reject unknown action types immediately.
      2. Daily rate limit — reject if RM has exhausted today's quota.
      3. High-risk confirmation — allow but flag for human approval.

    Args:
        action_type:  String identifier for the requested CRM action
                      (must be one of ALLOWED_ACTIONS).
        rm_id:        The requesting RM's identifier.
        payload:      Action-specific parameters (validated by caller).
        redis_client: Optional async Redis client for rate-limit tracking.
                      If None, rate limiting is skipped (e.g. during tests).

    Returns:
        Dict with at minimum {'allowed': bool}.
        On rejection: adds 'reason' (str) and 'requires_confirmation' (False).
        On high-risk approval: adds 'requires_confirmation' (True) and
        'action_type' for the caller to surface to the user.
    """
    # --- 1. Whitelist check -------------------------------------------------
    if action_type not in ALLOWED_ACTIONS:
        logger.warning(
            "Action guard — rejected unknown action [rm_id=%s, action=%s]",
            rm_id,
            action_type,
        )
        return {
            "allowed": False,
            "reason": f"Action '{action_type}' is not permitted.",
            "requires_confirmation": False,
        }

    # --- 2. Daily rate limit ------------------------------------------------
    if redis_client is not None:
        daily_count = await get_daily_action_count(rm_id, redis_client)
        if daily_count >= DAILY_ACTION_LIMIT:
            logger.warning(
                "Action guard — daily limit reached [rm_id=%s, count=%d]",
                rm_id,
                daily_count,
            )
            return {
                "allowed": False,
                "reason": f"Daily action limit ({DAILY_ACTION_LIMIT}) reached.",
                "requires_confirmation": False,
            }

    # --- 3. High-risk confirmation gate ------------------------------------
    if action_type in HIGH_RISK_ACTIONS:
        logger.info(
            "Action guard — high-risk action requires confirmation "
            "[rm_id=%s, action=%s]",
            rm_id,
            action_type,
        )
        return {
            "allowed": True,
            "requires_confirmation": True,
            "action_type": action_type,
        }

    logger.info(
        "Action guard — action approved [rm_id=%s, action=%s]",
        rm_id,
        action_type,
    )
    return {"allowed": True, "requires_confirmation": False}


# ---------------------------------------------------------------------------
# Redis rate-limit helpers
# ---------------------------------------------------------------------------


async def get_daily_action_count(rm_id: str, redis_client: Any) -> int:
    """
    Return the number of CRM actions the RM has performed today.

    Redis key pattern: ``actions:rm:{rm_id}:date:{YYYY-MM-DD}``

    Args:
        rm_id:        RM identifier string.
        redis_client: Async Redis client (must support .get()).

    Returns:
        Integer count; 0 if no entry exists yet.
    """
    key = _daily_key(rm_id)
    raw = await redis_client.get(key)
    return int(raw) if raw else 0


async def increment_daily_action_count(rm_id: str, redis_client: Any) -> None:
    """
    Increment the RM's daily action counter and ensure it expires at EOD.

    TTL is set to 86400 seconds (24 h) so the key is automatically cleaned up.
    This is called AFTER an action has been successfully executed.

    Args:
        rm_id:        RM identifier string.
        redis_client: Async Redis client (must support .incr() and .expire()).
    """
    key = _daily_key(rm_id)
    await redis_client.incr(key)
    await redis_client.expire(key, 86400)
    logger.info(
        "Action guard — daily counter incremented [rm_id=%s, key=%s]",
        rm_id,
        key,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------


def _daily_key(rm_id: str) -> str:
    """Build the Redis key for today's action counter for the given RM."""
    return f"actions:rm:{rm_id}:date:{date.today().isoformat()}"
