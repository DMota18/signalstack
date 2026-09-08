"""
SignalStack — Price Alert Routes

CRUD for user-defined price movement alerts.
Phase 1: stores configuration. Phase 2: Celery price monitor evaluates them.
"""

import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field

from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.supabase import get_anon_client

logger = logging.getLogger("price_alerts")

router = APIRouter(prefix="/price-alerts", tags=["price-alerts"])


class PriceAlertCreate(BaseModel):
    """Request to create a price movement alert."""
    ticker: str = Field(..., min_length=1, max_length=10)
    threshold_pct: float = Field(..., gt=0, le=50, description="Movement threshold percentage")
    direction: str = Field(..., pattern="^(above|below)$")


@router.get("", response_model=APIResponse)
async def list_price_alerts(user: CurrentUser = Depends(get_current_user)):
    """List all price alerts for the current user."""
    db = get_anon_client()
    result = await db.select(
        table="price_alerts",
        columns="id,ticker,threshold_pct,direction,enabled,triggered_at,created_at",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        order="created_at.desc",
    )

    if result["status_code"] != 200:
        return APIResponse.fail(message="Failed to fetch price alerts", code="fetch_error")

    return APIResponse.success(result["data"] if isinstance(result["data"], list) else [])


@router.post("", response_model=APIResponse)
async def create_price_alert(
    body: PriceAlertCreate,
    user: CurrentUser = Depends(get_current_user),
):
    """Create a price movement alert.

    When the Celery price monitor detects a movement exceeding the threshold,
    it will trigger an intelligence report for the affected ticker.
    """
    db = get_anon_client()

    # Check for duplicate alert on same ticker + direction
    existing = await db.select(
        table="price_alerts",
        columns="id",
        filters={
            "user_id": f"eq.{user.id}",
            "ticker": f"eq.{body.ticker.upper()}",
            "direction": f"eq.{body.direction}",
        },
        user_jwt=user.jwt_token,
    )

    if existing["status_code"] == 200 and existing.get("data"):
        return APIResponse.fail(
            message=f"You already have a {body.direction} alert for {body.ticker.upper()}",
            code="duplicate",
        )

    result = await db.insert(
        table="price_alerts",
        data={
            "user_id": user.id,
            "ticker": body.ticker.upper().strip(),
            "threshold_pct": body.threshold_pct,
            "direction": body.direction,
            "enabled": True,
        },
        user_jwt=user.jwt_token,
    )

    if result["status_code"] in (200, 201):
        logger.info(f"Price alert created: {body.ticker} {body.direction} {body.threshold_pct}% user={user.id}")
        data = result["data"]
        if isinstance(data, list) and len(data) > 0:
            data = data[0]
        return APIResponse.success(data)

    return APIResponse.fail(message="Failed to create price alert", code="insert_error")


@router.delete("/{alert_id}", response_model=APIResponse)
async def delete_price_alert(
    alert_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Delete a price alert."""
    db = get_anon_client()
    result = await db.delete(
        table="price_alerts",
        filters={"id": f"eq.{alert_id}", "user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    if result["status_code"] in (200, 204):
        return APIResponse.success({"deleted": True})

    return APIResponse.fail(message="Failed to delete price alert", code="delete_error")
