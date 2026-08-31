"""
SignalStack — Referral System Routes

Manages invite codes and referral tracking.
Each user gets a unique referral code. When a referred user upgrades
to Pro, the referrer earns a credit (free month).

Endpoints:
  GET  /referrals/code     — Get or generate the user's referral code
  GET  /referrals/stats    — Get referral stats (signups, upgrades, credits)
  POST /referrals/apply    — Apply a referral code during signup
"""

import logging
import secrets
import string

from fastapi import APIRouter, Depends

from backend.config import get_settings
from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.supabase import get_service_client

logger = logging.getLogger("api.referrals")

router = APIRouter(prefix="/referrals", tags=["referrals"])


def _generate_code() -> str:
    """Generate a short, readable referral code like 'ZA-K7X2M'."""
    chars = string.ascii_uppercase + string.digits
    random_part = ''.join(secrets.choice(chars) for _ in range(5))
    return f"ZA-{random_part}"


@router.get("/code")
async def get_referral_code(
    user: CurrentUser = Depends(get_current_user),
) -> APIResponse:
    """Get the current user's referral code. Generates one if it doesn't exist."""
    db = get_service_client()

    # Check if user already has a code
    result = await db.select(
        table="profiles",
        columns="referral_code",
        filters={"id": f"eq.{user.id}"},
        single=True,
    )

    if result["status_code"] == 200 and isinstance(result["data"], dict):
        existing_code = result["data"].get("referral_code")
        if existing_code:
            return APIResponse.success({
                "code": existing_code,
                "link": f"{get_settings().app_base_url}/signup?ref={existing_code}",
            })

    # Generate a new code (retry on collision)
    for _ in range(5):
        code = _generate_code()
        update_result = await db.update(
            table="profiles",
            data={"referral_code": code},
            filters={"id": f"eq.{user.id}"},
        )
        if update_result["status_code"] in (200, 204):
            return APIResponse.success({
                "code": code,
                "link": f"{get_settings().app_base_url}/signup?ref={code}",
            })

    return APIResponse.fail("Failed to generate referral code", code="generation_error")


@router.get("/stats")
async def get_referral_stats(
    user: CurrentUser = Depends(get_current_user),
) -> APIResponse:
    """Get referral statistics for the current user."""
    db = get_service_client()

    # Count signups referred by this user
    signups_result = await db.select(
        table="referral_events",
        columns="id",
        filters={
            "referrer_id": f"eq.{user.id}",
            "event_type": "eq.signup",
        },
    )
    signups = len(signups_result["data"]) if signups_result["status_code"] == 200 and isinstance(signups_result["data"], list) else 0

    # Count upgrades (conversions)
    upgrades_result = await db.select(
        table="referral_events",
        columns="id",
        filters={
            "referrer_id": f"eq.{user.id}",
            "event_type": "eq.upgrade",
        },
    )
    upgrades = len(upgrades_result["data"]) if upgrades_result["status_code"] == 200 and isinstance(upgrades_result["data"], list) else 0

    # Get current credit balance
    credits_result = await db.select(
        table="profiles",
        columns="referral_credits",
        filters={"id": f"eq.{user.id}"},
        single=True,
    )
    credits = 0
    if credits_result["status_code"] == 200 and isinstance(credits_result["data"], dict):
        credits = credits_result["data"].get("referral_credits", 0)

    return APIResponse.success({
        "signups": signups,
        "upgrades": upgrades,
        "credits_earned": upgrades,
        "credits_remaining": credits,
    })


@router.post("/apply")
async def apply_referral_code(
    code: str,
    user: CurrentUser = Depends(get_current_user),
) -> APIResponse:
    """Apply a referral code to the current user (called during/after signup).

    Records the referral relationship and logs a signup event.
    """
    db = get_service_client()

    if not code or len(code) > 10:
        return APIResponse.fail("Invalid referral code", code="validation_error")

    # Look up the referrer by code
    referrer_result = await db.select(
        table="profiles",
        columns="id",
        filters={"referral_code": f"eq.{code.upper()}"},
        single=True,
    )

    if referrer_result["status_code"] != 200 or not isinstance(referrer_result["data"], dict):
        return APIResponse.fail("Referral code not found", code="code_not_found")

    referrer_id = referrer_result["data"].get("id")

    # Can't refer yourself
    if referrer_id == user.id:
        return APIResponse.fail("Cannot use your own referral code", code="self_referral")

    # Check if already referred
    existing = await db.select(
        table="profiles",
        columns="referred_by",
        filters={"id": f"eq.{user.id}"},
        single=True,
    )
    if existing["status_code"] == 200 and isinstance(existing["data"], dict):
        if existing["data"].get("referred_by"):
            return APIResponse.fail("Referral already applied", code="already_referred")

    # Set the referral relationship
    await db.update(
        table="profiles",
        data={"referred_by": referrer_id},
        filters={"id": f"eq.{user.id}"},
    )

    # Log the signup event
    await db.insert(
        table="referral_events",
        data={
            "referrer_id": referrer_id,
            "referred_id": user.id,
            "event_type": "signup",
        },
    )

    logger.info(f"Referral applied: {user.id} referred by {referrer_id} (code: {code})")
    return APIResponse.success({"applied": True, "referrer_id": referrer_id})


async def credit_referrer_on_upgrade(user_id: str) -> None:
    """Called when a user upgrades to Pro. If they were referred,
    credit the referrer with a free month.

    This is called from the billing webhook handler.
    """
    db = get_service_client()

    # Check if user was referred
    profile_result = await db.select(
        table="profiles",
        columns="referred_by",
        filters={"id": f"eq.{user_id}"},
        single=True,
    )

    if profile_result["status_code"] != 200 or not isinstance(profile_result["data"], dict):
        return

    referrer_id = profile_result["data"].get("referred_by")
    if not referrer_id:
        return

    # Check if upgrade event already logged (prevent double credit)
    existing = await db.select(
        table="referral_events",
        columns="id",
        filters={
            "referrer_id": f"eq.{referrer_id}",
            "referred_id": f"eq.{user_id}",
            "event_type": "eq.upgrade",
        },
    )
    if existing["status_code"] == 200 and isinstance(existing["data"], list) and existing["data"]:
        return  # Already credited

    # Log the upgrade event
    await db.insert(
        table="referral_events",
        data={
            "referrer_id": referrer_id,
            "referred_id": user_id,
            "event_type": "upgrade",
        },
    )

    # Increment referrer's credit balance
    referrer_profile = await db.select(
        table="profiles",
        columns="referral_credits",
        filters={"id": f"eq.{referrer_id}"},
        single=True,
    )
    current_credits = 0
    if referrer_profile["status_code"] == 200 and isinstance(referrer_profile["data"], dict):
        current_credits = referrer_profile["data"].get("referral_credits", 0)

    await db.update(
        table="profiles",
        data={"referral_credits": current_credits + 1},
        filters={"id": f"eq.{referrer_id}"},
    )

    logger.info(f"Referral credit: {referrer_id} earned 1 month credit (referred user {user_id} upgraded)")
