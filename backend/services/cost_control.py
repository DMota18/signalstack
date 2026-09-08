"""
SignalStack — Cost Control Service

Tracks per-user daily Claude API spending and enforces cost caps.
When a user exceeds their daily cap, the system:
  1. Serves cached last-known-good intelligence (if available)
  2. Falls back to a cheaper model (Haiku) for new requests
  3. Blocks new intelligence generation entirely if both fail

Tables:
  - user_daily_costs: Per-user per-day spend tracking
  - job_runs: Per-job cost data (tokens_used, estimated_cost_usd)
"""

import logging
from datetime import UTC, datetime

from backend.config import get_settings
from backend.services.supabase import get_service_client

logger = logging.getLogger("services.cost_control")

# Approximate cost per token (Anthropic pricing as of May 2025)
# These are conservative estimates — actual pricing may vary
COST_PER_INPUT_TOKEN = {
    "claude-sonnet-4-20250514": 3.0 / 1_000_000,
    "claude-haiku-4-5-20251001": 0.80 / 1_000_000,
}
COST_PER_OUTPUT_TOKEN = {
    "claude-sonnet-4-20250514": 15.0 / 1_000_000,
    "claude-haiku-4-5-20251001": 4.0 / 1_000_000,
}


def estimate_cost(
    model: str,
    input_tokens: int,
    output_tokens: int,
) -> float:
    """Estimate the USD cost for a Claude API call."""
    input_rate = COST_PER_INPUT_TOKEN.get(model, 3.0 / 1_000_000)
    output_rate = COST_PER_OUTPUT_TOKEN.get(model, 15.0 / 1_000_000)
    return (input_tokens * input_rate) + (output_tokens * output_rate)


async def get_daily_spend(user_id: str) -> dict:
    """Get the current day's spend for a user.

    Returns:
        {
            "total_cost_usd": float,
            "total_tokens": int,
            "job_count": int,
            "cap_hit": bool,
            "cap_usd": float,
            "remaining_usd": float,
        }
    """
    settings = get_settings()
    cap = settings.claude_daily_cost_cap_usd
    db = get_service_client()

    today = datetime.now(UTC).strftime("%Y-%m-%d")

    result = await db.select(
        table="user_daily_costs",
        columns="total_cost_usd,total_tokens,job_count,cap_hit_at",
        filters={
            "user_id": f"eq.{user_id}",
            "cost_date": f"eq.{today}",
        },
        single=True,
    )

    if result["status_code"] == 200 and isinstance(result["data"], dict):
        data = result["data"]
        total = float(data.get("total_cost_usd", 0))
        return {
            "total_cost_usd": total,
            "total_tokens": data.get("total_tokens", 0),
            "job_count": data.get("job_count", 0),
            "cap_hit": total >= cap,
            "cap_usd": cap,
            "remaining_usd": max(0, cap - total),
        }

    return {
        "total_cost_usd": 0.0,
        "total_tokens": 0,
        "job_count": 0,
        "cap_hit": False,
        "cap_usd": cap,
        "remaining_usd": cap,
    }


async def record_job_cost(
    user_id: str,
    tokens_used: int,
    cost_usd: float,
) -> None:
    """Record a job's cost against the user's daily budget.

    Uses upsert to create or increment the daily row.
    """
    db = get_service_client()
    settings = get_settings()
    cap = settings.claude_daily_cost_cap_usd

    today = datetime.now(UTC).strftime("%Y-%m-%d")

    # Try to fetch existing row
    existing = await db.select(
        table="user_daily_costs",
        columns="id,total_cost_usd,total_tokens,job_count",
        filters={
            "user_id": f"eq.{user_id}",
            "cost_date": f"eq.{today}",
        },
        single=True,
    )

    if existing["status_code"] == 200 and isinstance(existing["data"], dict):
        row = existing["data"]
        new_cost = float(row.get("total_cost_usd", 0)) + cost_usd
        new_tokens = row.get("total_tokens", 0) + tokens_used
        new_count = row.get("job_count", 0) + 1

        update_data: dict = {
            "total_cost_usd": round(new_cost, 4),
            "total_tokens": new_tokens,
            "job_count": new_count,
        }

        # Mark cap hit if exceeded
        if new_cost >= cap and not row.get("cap_hit_at"):
            update_data["cap_hit_at"] = datetime.now(UTC).isoformat()
            logger.warning(f"User {user_id} hit daily cost cap: ${new_cost:.4f} >= ${cap}")

        await db.update(
            table="user_daily_costs",
            data=update_data,
            filters={"id": f"eq.{row['id']}"},
        )
    else:
        # Create new daily row
        await db.insert(
            table="user_daily_costs",
            data={
                "user_id": user_id,
                "cost_date": today,
                "total_tokens": tokens_used,
                "total_cost_usd": round(cost_usd, 4),
                "job_count": 1,
                "cap_hit_at": datetime.now(UTC).isoformat() if cost_usd >= cap else None,
            },
        )

    logger.debug(f"Recorded cost for {user_id}: +${cost_usd:.4f}, +{tokens_used} tokens")


async def select_model_for_user(user_id: str) -> dict:
    """Determine which model to use based on cost budget.

    Returns:
        {
            "model": str,           # Model ID to use
            "reason": str,          # Why this model was selected
            "budget_ok": bool,      # Whether the user still has budget
            "use_cache": bool,      # Whether to serve cached response instead
        }
    """
    settings = get_settings()
    spend = await get_daily_spend(user_id)

    # Under 70% of cap: use primary model
    if spend["total_cost_usd"] < spend["cap_usd"] * 0.7:
        return {
            "model": settings.claude_model,
            "reason": "within_budget",
            "budget_ok": True,
            "use_cache": False,
        }

    # Between 70-100% of cap: fall back to cheaper model
    if spend["total_cost_usd"] < spend["cap_usd"]:
        logger.info(
            f"User {user_id} at {spend['total_cost_usd']:.4f}/{spend['cap_usd']} — "
            f"falling back to {settings.claude_fallback_model}"
        )
        return {
            "model": settings.claude_fallback_model,
            "reason": "budget_warning",
            "budget_ok": True,
            "use_cache": False,
        }

    # Over cap: serve cached response
    logger.info(f"User {user_id} over daily cap — serving cached intelligence")
    return {
        "model": settings.claude_fallback_model,
        "reason": "cap_exceeded",
        "budget_ok": False,
        "use_cache": True,
    }


async def get_cached_intelligence(user_id: str) -> dict | None:
    """Get the most recent intelligence alert for the user as a fallback.

    Returns the most recent alert body_json, or None if no cached intelligence.
    """
    db = get_service_client()

    result = await db.select(
        table="alert_history",
        columns="id,title,body_json,created_at",
        filters={
            "user_id": f"eq.{user_id}",
            "alert_type": "in.(daily_digest,on_demand)",
        },
        order="created_at.desc",
        limit=1,
    )

    if result["status_code"] == 200 and isinstance(result["data"], list) and result["data"]:
        alert = result["data"][0]
        return {
            "alert_id": alert.get("id"),
            "title": alert.get("title"),
            "synthesis": alert.get("body_json", {}),
            "cached": True,
            "cached_at": alert.get("created_at"),
            "message": "Daily intelligence budget reached. Showing your most recent analysis. Refreshes at midnight UTC.",
        }

    return None
