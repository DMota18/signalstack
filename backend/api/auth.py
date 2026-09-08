"""
SignalStack — Auth Routes
Wraps Supabase Auth endpoints with our standard response envelope.
No custom JWT logic — Supabase handles signup, signin, and token refresh.
"""

from fastapi import APIRouter, HTTPException, status

from backend.models.schemas import (
    APIResponse,
    RefreshRequest,
    SignInRequest,
    SignUpRequest,
)
from backend.services.supabase import get_anon_client

router = APIRouter(prefix="/auth", tags=["auth"])


@router.post("/signup", response_model=APIResponse)
async def sign_up(req: SignUpRequest):
    """Create a new account. The profiles table row is auto-created
    by the Supabase trigger (handle_new_user)."""
    db = get_anon_client()
    result = await db.sign_up(req.email, req.password)

    if result["status_code"] in (200, 201):
        data = result["data"]
        # Supabase returns user + session on signup (if email confirm disabled)
        # or just user (if email confirm enabled)
        session = data.get("session")
        if session:
            return APIResponse.success({
                "access_token": session["access_token"],
                "refresh_token": session["refresh_token"],
                "expires_in": session["expires_in"],
                "user_id": data["user"]["id"],
            })
        else:
            # Email confirmation required
            return APIResponse.success({
                "message": "Check your email to confirm your account.",
                "user_id": data.get("user", {}).get("id"),
            })

    # Error cases
    error_msg = result["data"].get("msg", result["data"].get("error_description", "Signup failed"))
    return APIResponse.fail(message=error_msg, code="auth_error")


@router.post("/signin", response_model=APIResponse)
async def sign_in(req: SignInRequest):
    """Sign in with email/password. Returns JWT access + refresh tokens."""
    db = get_anon_client()
    result = await db.sign_in(req.email, req.password)

    if result["status_code"] == 200:
        data = result["data"]
        return APIResponse.success({
            "access_token": data["access_token"],
            "refresh_token": data["refresh_token"],
            "expires_in": data["expires_in"],
            "user_id": data["user"]["id"],
        })

    error_msg = result["data"].get("error_description", "Invalid credentials")
    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail=error_msg,
    )


@router.post("/refresh", response_model=APIResponse)
async def refresh_token(req: RefreshRequest):
    """Exchange a refresh token for a new access token."""
    db = get_anon_client()
    result = await db.refresh_token(req.refresh_token)

    if result["status_code"] == 200:
        data = result["data"]
        return APIResponse.success({
            "access_token": data["access_token"],
            "refresh_token": data["refresh_token"],
            "expires_in": data["expires_in"],
            "user_id": data["user"]["id"],
        })

    raise HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Invalid or expired refresh token.",
    )
