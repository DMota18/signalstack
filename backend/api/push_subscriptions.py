"""
SignalStack — Push Subscription Routes

Manages Web Push notification subscriptions.
Phase 1: stores/deletes subscriptions. Phase 2: sends via VAPID/FCM.
"""

import logging

from fastapi import APIRouter, Depends, Request

from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.supabase import get_anon_client

logger = logging.getLogger("push_subscriptions")

router = APIRouter(prefix="/push-subscriptions", tags=["push-subscriptions"])


@router.post("", response_model=APIResponse)
async def save_push_subscription(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
):
    """Save a Web Push subscription for the current user.

    Accepts the JSON output of PushSubscription.toJSON() from the browser:
    {endpoint, keys: {p256dh, auth}, expirationTime}
    """
    body = await request.json()
    endpoint = body.get("endpoint")
    keys = body.get("keys", {})

    if not endpoint:
        return APIResponse.fail(message="Push subscription endpoint is required", code="validation_error")

    db = get_anon_client()

    # Upsert — one subscription per user per endpoint
    result = await db.insert(
        table="push_subscriptions",
        data={
            "user_id": user.id,
            "endpoint": endpoint,
            "p256dh": keys.get("p256dh", ""),
            "auth_key": keys.get("auth", ""),
            "expiration_time": body.get("expirationTime"),
        },
        upsert=True,
        on_conflict="user_id,endpoint",
        user_jwt=user.jwt_token,
    )

    if result["status_code"] in (200, 201):
        logger.info(f"Push subscription saved: user={user.id} endpoint={endpoint[:60]}...")
        return APIResponse.success({"subscribed": True})

    return APIResponse.fail(message="Failed to save push subscription", code="insert_error")


@router.delete("", response_model=APIResponse)
async def delete_push_subscription(
    user: CurrentUser = Depends(get_current_user),
):
    """Delete all push subscriptions for the current user."""
    db = get_anon_client()

    result = await db.delete(
        table="push_subscriptions",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    if result["status_code"] in (200, 204):
        logger.info(f"Push subscriptions deleted: user={user.id}")
        return APIResponse.success({"unsubscribed": True})

    return APIResponse.fail(message="Failed to delete push subscription", code="delete_error")
