"""
SignalStack — Web Push Notification Service

Sends push notifications to users via the Web Push protocol (VAPID).
Subscriptions are stored in the push_subscriptions table by the
push_subscriptions API route. This service handles delivery.

Flow:
  1. Fetch all active push subscriptions for a user
  2. Build the notification payload (title, body, data)
  3. Send via pywebpush using VAPID credentials
  4. Remove expired/invalid subscriptions on 410 Gone

Used by:
  - Daily digest task (after intelligence generation)
  - Price alert monitor (Phase 2)
  - Pre-earnings briefings (Phase 2)
"""

import json
import logging
from typing import Optional

from pywebpush import webpush, WebPushException

from backend.config import get_settings
from backend.services.supabase import get_service_client

logger = logging.getLogger("services.push")


async def send_push_to_user(
    user_id: str,
    title: str,
    body: str,
    data: Optional[dict] = None,
    url: Optional[str] = None,
) -> dict:
    """Send a push notification to all of a user's subscribed devices.

    Args:
        user_id: The user to notify
        title: Notification title (short, ~60 chars max)
        body: Notification body (max ~200 chars for best display)
        data: Optional JSON data payload for the service worker
        url: Optional URL to open when the notification is clicked

    Returns:
        {
            "sent": int,       # Successfully delivered
            "failed": int,     # Failed to deliver
            "expired": int,    # Removed (410 Gone)
        }
    """
    settings = get_settings()

    if not settings.vapid_private_key or not settings.vapid_email:
        logger.warning("Push notification skipped: VAPID keys not configured")
        return {"sent": 0, "failed": 0, "expired": 0}

    db = get_service_client()

    # Fetch all subscriptions for this user
    result = await db.select(
        table="push_subscriptions",
        columns="id,endpoint,p256dh,auth_key",
        filters={"user_id": f"eq.{user_id}"},
    )

    if result["status_code"] != 200 or not isinstance(result["data"], list):
        logger.warning(f"Failed to fetch push subscriptions for {user_id}")
        return {"sent": 0, "failed": 0, "expired": 0}

    subscriptions = result["data"]
    if not subscriptions:
        logger.debug(f"No push subscriptions for user {user_id}")
        return {"sent": 0, "failed": 0, "expired": 0}

    # Build the notification payload
    payload = json.dumps({
        "title": title,
        "body": body,
        "data": data or {},
        "url": url or "/dashboard",
    })

    vapid_claims = {
        "sub": f"mailto:{settings.vapid_email}",
    }

    sent = 0
    failed = 0
    expired = 0

    for sub in subscriptions:
        subscription_info = {
            "endpoint": sub["endpoint"],
            "keys": {
                "p256dh": sub["p256dh"],
                "auth": sub["auth_key"],
            },
        }

        try:
            webpush(
                subscription_info=subscription_info,
                data=payload,
                vapid_private_key=settings.vapid_private_key,
                vapid_claims=vapid_claims,
            )
            sent += 1

        except WebPushException as e:
            response = getattr(e, "response", None)
            status_code = getattr(response, "status_code", None) if response else None

            if status_code == 410:
                # Subscription expired — remove it
                logger.info(f"Push subscription expired (410), removing: {sub['endpoint'][:60]}...")
                await db.delete(
                    table="push_subscriptions",
                    filters={"id": f"eq.{sub['id']}"},
                )
                expired += 1
            elif status_code == 404:
                # Subscription no longer valid — remove it
                logger.info(f"Push subscription not found (404), removing: {sub['endpoint'][:60]}...")
                await db.delete(
                    table="push_subscriptions",
                    filters={"id": f"eq.{sub['id']}"},
                )
                expired += 1
            else:
                logger.error(f"Push failed for {sub['endpoint'][:60]}...: {e}")
                failed += 1

        except Exception as e:
            logger.error(f"Unexpected push error: {e}")
            failed += 1

    logger.info(f"Push to {user_id}: sent={sent}, failed={failed}, expired={expired}")
    return {"sent": sent, "failed": failed, "expired": expired}
