"""
SignalStack — Billing API
Stripe Checkout + Customer Portal + Webhook for subscription management.

Endpoints:
  POST /billing/checkout     — Create a Stripe Checkout Session (free → pro)
  POST /billing/portal       — Create a Stripe Customer Portal session (manage/cancel)
  POST /billing/webhook      — Stripe webhook handler (subscription lifecycle)
  GET  /billing/status       — Current subscription status
"""

import logging
import stripe
from fastapi import APIRouter, Depends, Request, HTTPException, status

from backend.config import get_settings
from backend.models.schemas import APIResponse
from backend.services.auth import get_current_user, CurrentUser
from backend.services.supabase import get_service_client

logger = logging.getLogger("api.billing")
router = APIRouter(prefix="/billing", tags=["billing"])


def _init_stripe() -> None:
    """Set the Stripe API key from settings."""
    settings = get_settings()
    stripe.api_key = settings.stripe_secret_key


# ============================================================================
# CHECKOUT — Create a Checkout Session for free → pro upgrade
# ============================================================================

@router.post("/checkout")
async def create_checkout_session(
    user: CurrentUser = Depends(get_current_user),
) -> APIResponse:
    """Create a Stripe Checkout Session for upgrading to Pro.

    Returns a checkout URL that the frontend redirects to.
    If the user already has a Stripe customer ID, reuses it.
    """
    _init_stripe()
    settings = get_settings()

    if not settings.stripe_secret_key or not settings.stripe_pro_price_id:
        return APIResponse.fail("Billing not configured", code="billing_not_configured")

    if user.tier == "pro":
        return APIResponse.fail("Already on Pro tier", code="already_pro")

    db = get_service_client()

    # Check if user already has a Stripe customer ID
    profile_result = await db.select(
        table="profiles",
        columns="stripe_customer_id,email,display_name",
        filters={"id": f"eq.{user.id}"},
        single=True,
    )

    if profile_result["status_code"] != 200 or not isinstance(profile_result["data"], dict):
        return APIResponse.fail("Profile not found", code="profile_not_found")

    profile = profile_result["data"]
    customer_id = profile.get("stripe_customer_id")

    # Create Stripe customer if needed
    if not customer_id:
        customer = stripe.Customer.create(
            email=profile.get("email") or user.email,
            name=profile.get("display_name") or "",
            metadata={"signalstack_user_id": user.id},
        )
        customer_id = customer.id

        # Save customer ID to profile
        await db.update(
            table="profiles",
            data={"stripe_customer_id": customer_id},
            filters={"id": f"eq.{user.id}"},
        )

    # Create Checkout Session
    session = stripe.checkout.Session.create(
        customer=customer_id,
        mode="subscription",
        line_items=[{
            "price": settings.stripe_pro_price_id,
            "quantity": 1,
        }],
        success_url=settings.stripe_success_url or f"{_get_app_url(settings)}/app/settings?billing=success",
        cancel_url=settings.stripe_cancel_url or f"{_get_app_url(settings)}/app/settings?billing=cancelled",
        metadata={"signalstack_user_id": user.id},
        subscription_data={
            "metadata": {"signalstack_user_id": user.id},
        },
    )

    return APIResponse.success({"checkout_url": session.url})


# ============================================================================
# PORTAL — Customer portal for managing/cancelling subscription
# ============================================================================

@router.post("/portal")
async def create_portal_session(
    user: CurrentUser = Depends(get_current_user),
) -> APIResponse:
    """Create a Stripe Customer Portal session for subscription management.

    Users can update payment method, cancel, or view invoices.
    """
    _init_stripe()
    settings = get_settings()

    if not settings.stripe_secret_key:
        return APIResponse.fail("Billing not configured", code="billing_not_configured")

    db = get_service_client()

    profile_result = await db.select(
        table="profiles",
        columns="stripe_customer_id",
        filters={"id": f"eq.{user.id}"},
        single=True,
    )

    if profile_result["status_code"] != 200 or not isinstance(profile_result["data"], dict):
        return APIResponse.fail("Profile not found", code="profile_not_found")

    customer_id = profile_result["data"].get("stripe_customer_id")
    if not customer_id:
        return APIResponse.fail("No billing account found", code="no_billing_account")

    session = stripe.billing_portal.Session.create(
        customer=customer_id,
        return_url=settings.stripe_portal_return_url or f"{_get_app_url(settings)}/app/settings",
    )

    return APIResponse.success({"portal_url": session.url})


# ============================================================================
# STATUS — Current billing/subscription status
# ============================================================================

@router.get("/status")
async def get_billing_status(
    user: CurrentUser = Depends(get_current_user),
) -> APIResponse:
    """Get the user's current subscription status."""
    db = get_service_client()

    result = await db.select(
        table="profiles",
        columns="tier,stripe_customer_id,stripe_subscription_id,subscription_status,subscription_current_period_end",
        filters={"id": f"eq.{user.id}"},
        single=True,
    )

    if result["status_code"] != 200 or not isinstance(result["data"], dict):
        return APIResponse.fail("Profile not found", code="profile_not_found")

    profile = result["data"]
    return APIResponse.success({
        "tier": profile.get("tier", "free"),
        "has_billing": bool(profile.get("stripe_customer_id")),
        "subscription_status": profile.get("subscription_status"),
        "current_period_end": profile.get("subscription_current_period_end"),
        "can_manage": bool(profile.get("stripe_subscription_id")),
    })


# ============================================================================
# WEBHOOK — Stripe sends subscription lifecycle events here
# ============================================================================

@router.post("/webhook")
async def stripe_webhook(request: Request) -> dict:
    """Handle Stripe webhook events for subscription lifecycle.

    Events handled:
      - checkout.session.completed → activate Pro tier
      - customer.subscription.updated → sync tier with subscription status
      - customer.subscription.deleted → downgrade to free
      - invoice.payment_failed → flag for follow-up
    """
    _init_stripe()
    settings = get_settings()

    if not settings.stripe_webhook_secret:
        raise HTTPException(status_code=503, detail="Webhook not configured")

    payload = await request.body()
    sig_header = request.headers.get("stripe-signature")

    if not sig_header:
        raise HTTPException(status_code=400, detail="Missing stripe-signature header")

    try:
        event = stripe.Webhook.construct_event(
            payload, sig_header, settings.stripe_webhook_secret,
        )
    except stripe.SignatureVerificationError:
        raise HTTPException(status_code=400, detail="Invalid webhook signature")
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid payload")

    event_type = event["type"]
    data = event["data"]["object"]

    logger.info(f"Stripe webhook: {event_type}")

    if event_type == "checkout.session.completed":
        await _handle_checkout_completed(data)
    elif event_type == "customer.subscription.updated":
        await _handle_subscription_updated(data)
    elif event_type == "customer.subscription.deleted":
        await _handle_subscription_deleted(data)
    elif event_type == "invoice.payment_failed":
        await _handle_payment_failed(data)

    return {"received": True}


# ============================================================================
# WEBHOOK HANDLERS
# ============================================================================

async def _handle_checkout_completed(session: dict) -> None:
    """Activate Pro tier after successful checkout."""
    user_id = session.get("metadata", {}).get("signalstack_user_id")
    subscription_id = session.get("subscription")
    customer_id = session.get("customer")

    if not user_id:
        logger.error(f"Checkout completed but no user_id in metadata: {session.get('id')}")
        return

    db = get_service_client()

    # Fetch subscription details for period end
    sub = stripe.Subscription.retrieve(subscription_id) if subscription_id else None

    update_data = {
        "tier": "pro",
        "stripe_customer_id": customer_id,
        "stripe_subscription_id": subscription_id,
        "subscription_status": "active",
    }

    if sub:
        update_data["subscription_current_period_end"] = _unix_to_iso(sub.current_period_end)

    result = await db.update(
        table="profiles",
        data=update_data,
        filters={"id": f"eq.{user_id}"},
    )

    if result["status_code"] in (200, 204):
        logger.info(f"User {user_id} upgraded to Pro via checkout {session.get('id')}")

        # Credit the referrer if this user was referred
        try:
            from backend.api.referrals import credit_referrer_on_upgrade
            await credit_referrer_on_upgrade(user_id)
        except Exception as e:
            logger.warning(f"Referral credit failed for {user_id}: {e}")
    else:
        logger.error(f"Failed to upgrade user {user_id}: {result}")


async def _handle_subscription_updated(subscription: dict) -> None:
    """Sync tier when subscription status changes (e.g., past_due, active)."""
    user_id = subscription.get("metadata", {}).get("signalstack_user_id")
    if not user_id:
        # Try to find user by customer ID
        user_id = await _find_user_by_customer(subscription.get("customer"))
    if not user_id:
        logger.warning(f"Subscription updated but no user found: {subscription.get('id')}")
        return

    db = get_service_client()

    sub_status = subscription.get("status")  # active, past_due, canceled, etc.
    tier = "pro" if sub_status in ("active", "trialing", "past_due") else "free"

    await db.update(
        table="profiles",
        data={
            "tier": tier,
            "subscription_status": sub_status,
            "subscription_current_period_end": _unix_to_iso(subscription.get("current_period_end")),
        },
        filters={"id": f"eq.{user_id}"},
    )

    logger.info(f"User {user_id} subscription updated: status={sub_status}, tier={tier}")


async def _handle_subscription_deleted(subscription: dict) -> None:
    """Downgrade to free when subscription is cancelled/expired."""
    user_id = subscription.get("metadata", {}).get("signalstack_user_id")
    if not user_id:
        user_id = await _find_user_by_customer(subscription.get("customer"))
    if not user_id:
        return

    db = get_service_client()

    await db.update(
        table="profiles",
        data={
            "tier": "free",
            "subscription_status": "canceled",
            "stripe_subscription_id": None,
        },
        filters={"id": f"eq.{user_id}"},
    )

    logger.info(f"User {user_id} downgraded to free (subscription deleted)")


async def _handle_payment_failed(invoice: dict) -> None:
    """Log payment failure for follow-up. Don't immediately downgrade —
    Stripe retries and sends subscription.updated if it ultimately fails."""
    customer_id = invoice.get("customer")
    user_id = await _find_user_by_customer(customer_id)

    logger.warning(
        f"Payment failed for customer {customer_id} (user {user_id}). "
        f"Invoice: {invoice.get('id')}. Stripe will retry."
    )


# ============================================================================
# HELPERS
# ============================================================================

async def _find_user_by_customer(customer_id: str) -> str | None:
    """Look up a SignalStack user ID from a Stripe customer ID."""
    if not customer_id:
        return None

    db = get_service_client()
    result = await db.select(
        table="profiles",
        columns="id",
        filters={"stripe_customer_id": f"eq.{customer_id}"},
        single=True,
    )

    if result["status_code"] == 200 and isinstance(result["data"], dict):
        return result["data"].get("id")
    return None


def _unix_to_iso(ts: int | None) -> str | None:
    """Convert a Unix timestamp to ISO 8601 string."""
    if not ts:
        return None
    from datetime import datetime, timezone
    return datetime.fromtimestamp(ts, tz=timezone.utc).isoformat()


def _get_app_url(settings) -> str:
    """Derive the app URL from CORS origins or fallback."""
    if settings.cors_origins:
        origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
        if origins:
            return origins[0]
    if settings.app_env == "production":
        return "https://signalstack.app"
    return "http://localhost:5173"
