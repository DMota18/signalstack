"""
SignalStack — Profile Routes
User profile management and investor profile (risk/sector/discovery preferences).
"""

from fastapi import APIRouter, Depends

from backend.models.schemas import (
    APIResponse,
    InvestorProfileUpdate,
    ProfileUpdate,
)
from backend.services.auth import CurrentUser, get_current_user
from backend.services.supabase import get_anon_client

router = APIRouter(prefix="/profile", tags=["profile"])


# ============================================================================
# USER PROFILE
# ============================================================================

@router.get("", response_model=APIResponse)
async def get_profile(user: CurrentUser = Depends(get_current_user)):
    """Get the current user's profile."""
    db = get_anon_client()
    result = await db.select(
        table="profiles",
        filters={"id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        single=True,
    )

    if result["status_code"] == 200:
        return APIResponse.success(result["data"])

    return APIResponse.fail(message="Profile not found", code="not_found")


@router.patch("", response_model=APIResponse)
async def update_profile(
    updates: ProfileUpdate,
    user: CurrentUser = Depends(get_current_user),
):
    """Update the current user's profile. Only non-null fields are changed."""
    data = updates.model_dump(exclude_none=True)
    if not data:
        return APIResponse.fail(message="No fields to update", code="validation_error")

    db = get_anon_client()
    result = await db.update(
        table="profiles",
        data=data,
        filters={"id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    if result["status_code"] == 200:
        updated = result["data"]
        return APIResponse.success(updated[0] if isinstance(updated, list) and updated else updated)

    return APIResponse.fail(message="Update failed", code="update_error")


# ============================================================================
# INVESTOR PROFILE (risk appetite, sectors, discovery mode)
# ============================================================================

@router.get("/investor", response_model=APIResponse)
async def get_investor_profile(user: CurrentUser = Depends(get_current_user)):
    """Get the current user's investor profile preferences."""
    db = get_anon_client()
    result = await db.select(
        table="investor_profiles",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        single=True,
    )

    if result["status_code"] == 200:
        return APIResponse.success(result["data"])

    # No investor profile yet — return defaults
    if result["status_code"] == 406:  # 406 = no rows for single-object request
        return APIResponse.success({
            "risk_appetite": "moderate",
            "sector_interests": [],
            "discovery_mode": "adjacent",
            "is_default": True,
        })

    return APIResponse.fail(message="Failed to fetch investor profile", code="fetch_error")


@router.put("/investor", response_model=APIResponse)
async def upsert_investor_profile(
    profile: InvestorProfileUpdate,
    user: CurrentUser = Depends(get_current_user),
):
    """Create or update the investor profile. Uses upsert on user_id."""
    data = profile.model_dump(exclude_none=True)
    data["user_id"] = user.id

    db = get_anon_client()

    # Check if profile exists
    existing = await db.select(
        table="investor_profiles",
        columns="id",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    if existing["status_code"] == 200 and existing["data"]:
        # Update existing
        result = await db.update(
            table="investor_profiles",
            data={k: v for k, v in data.items() if k != "user_id"},
            filters={"user_id": f"eq.{user.id}"},
            user_jwt=user.jwt_token,
        )
    else:
        # Insert new
        result = await db.insert(
            table="investor_profiles",
            data=data,
            user_jwt=user.jwt_token,
        )

    if result["status_code"] in (200, 201):
        row = result["data"]
        return APIResponse.success(row[0] if isinstance(row, list) and row else row)

    return APIResponse.fail(message="Failed to save investor profile", code="save_error")
