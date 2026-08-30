"""
SignalStack — Watchlist Routes
User-curated tickers beyond their actual holdings.
Ticker limits enforced by tier:
  free:    5 total (holdings + watchlist combined)
  pro:     unlimited
"""

from fastapi import APIRouter, Depends

from backend.models.schemas import APIResponse, WatchlistAddRequest
from backend.services.auth import CurrentUser, get_current_user
from backend.services.supabase import get_anon_client

router = APIRouter(prefix="/watchlist", tags=["watchlist"])

# Free tier: 5 tickers total (holdings + watchlist)
FREE_TIER_TICKER_LIMIT = 5


@router.get("", response_model=APIResponse)
async def list_watchlist(user: CurrentUser = Depends(get_current_user)):
    """Get all watchlist items for the current user."""
    db = get_anon_client()
    result = await db.select(
        table="watchlist",
        columns="ticker,added_at",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        order="added_at.desc",
    )

    if result["status_code"] != 200:
        return APIResponse.fail(message="Failed to fetch watchlist", code="fetch_error")

    return APIResponse.success(result["data"] if isinstance(result["data"], list) else [])


@router.post("", response_model=APIResponse)
async def add_to_watchlist(
    req: WatchlistAddRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Add a ticker to the watchlist. Enforces tier-based ticker limits."""
    db = get_anon_client()
    ticker = req.ticker.upper()

    # Enforce free tier limit
    if user.tier == "free":
        # Count holdings
        holdings_result = await db.select(
            table="holdings",
            columns="ticker",
            filters={"user_id": f"eq.{user.id}"},
            user_jwt=user.jwt_token,
        )
        holdings_count = len(holdings_result["data"]) if holdings_result["status_code"] == 200 and isinstance(holdings_result["data"], list) else 0

        # Count existing watchlist
        watchlist_result = await db.select(
            table="watchlist",
            columns="ticker",
            filters={"user_id": f"eq.{user.id}"},
            user_jwt=user.jwt_token,
        )
        watchlist_count = len(watchlist_result["data"]) if watchlist_result["status_code"] == 200 and isinstance(watchlist_result["data"], list) else 0

        total = holdings_count + watchlist_count
        if total >= FREE_TIER_TICKER_LIMIT:
            return APIResponse.fail(
                message=f"Free tier is limited to {FREE_TIER_TICKER_LIMIT} total tickers (holdings + watchlist). Upgrade to Pro for unlimited.",
                code="tier_limit",
                details={"current_count": total, "limit": FREE_TIER_TICKER_LIMIT, "upgrade_url": "/settings/billing"},
            )

    # Insert (unique constraint on user_id + ticker handles duplicates)
    result = await db.insert(
        table="watchlist",
        data={"user_id": user.id, "ticker": ticker},
        user_jwt=user.jwt_token,
    )

    if result["status_code"] in (200, 201):
        row = result["data"]
        return APIResponse.success(row[0] if isinstance(row, list) and row else row)

    # Check if duplicate
    if result["status_code"] == 409:
        return APIResponse.fail(message=f"{ticker} is already in your watchlist", code="duplicate")

    return APIResponse.fail(message="Failed to add ticker", code="insert_error")


@router.delete("/{ticker}", response_model=APIResponse)
async def remove_from_watchlist(
    ticker: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Remove a ticker from the watchlist."""
    db = get_anon_client()
    result = await db.delete(
        table="watchlist",
        filters={"user_id": f"eq.{user.id}", "ticker": f"eq.{ticker.upper()}"},
        user_jwt=user.jwt_token,
    )

    if result["status_code"] == 200:
        return APIResponse.success({"removed": ticker.upper()})

    return APIResponse.fail(message="Failed to remove ticker", code="delete_error")
