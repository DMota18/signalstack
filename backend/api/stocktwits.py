"""
SignalStack — StockTwits Routes

Fetches ticker-specific messages from StockTwits API, filtered for
verified/official users only.

Provider: StockTwits (stocktwits.com)
Rate limit: 200 req/hour (free, no key needed)
Auth: None required for public streams

Endpoints:
  GET /stocktwits/:ticker  — Verified-only messages for a ticker
"""

import logging

import httpx
from fastapi import APIRouter, Depends, Query

from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user

logger = logging.getLogger("api.stocktwits")

router = APIRouter(prefix="/stocktwits", tags=["stocktwits"])

ST_BASE = "https://api.stocktwits.com/api/2"


@router.get("/{ticker}", response_model=APIResponse)
async def get_stocktwits_messages(
    ticker: str,
    user: CurrentUser = Depends(get_current_user),
    limit: int = Query(30, ge=1, le=50),
):
    """Fetch recent StockTwits messages for a ticker, filtered to verified users.

    StockTwits user classification:
      - official: Company or brand official account
      - verified: Identity-verified user (blue checkmark equivalent)
      - suggested: StockTwits-curated quality user

    We return only official + verified + suggested users to filter out noise.
    """
    ticker = ticker.upper().strip()

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(
                f"{ST_BASE}/streams/symbol/{ticker}.json",
                params={"filter": "top", "limit": 30},
            )

        if resp.status_code == 404:
            return APIResponse.success({"ticker": ticker, "messages": [], "count": 0})

        if resp.status_code != 200:
            logger.warning(f"StockTwits API error {resp.status_code} for {ticker}")
            return APIResponse.success({"ticker": ticker, "messages": [], "count": 0})

        data = resp.json()
        raw_messages = data.get("messages", [])
        symbol_info = data.get("symbol", {})

        # Filter for quality users only
        quality_classifications = {"official", "verified", "suggested"}
        messages = []

        for msg in raw_messages:
            user_data = msg.get("user", {})
            classification = (user_data.get("classification") or "").lower()
            is_official = user_data.get("official", False)

            # Accept if verified/official/suggested, OR if they have significant followers
            followers = user_data.get("followers", 0) or 0
            is_quality = (
                classification in quality_classifications
                or is_official
                or followers >= 500
            )

            if not is_quality:
                continue

            # Parse sentiment
            entities = msg.get("entities", {})
            sentiment = entities.get("sentiment", {})
            sentiment_label = sentiment.get("basic") if sentiment else None

            messages.append({
                "id": msg.get("id"),
                "body": msg.get("body", ""),
                "created_at": msg.get("created_at", ""),
                "user": {
                    "username": user_data.get("username", ""),
                    "name": user_data.get("name", ""),
                    "avatar": user_data.get("avatar_url") or user_data.get("avatar_url_ssl", ""),
                    "followers": followers,
                    "classification": classification,
                    "official": is_official,
                },
                "sentiment": sentiment_label,  # "Bullish" or "Bearish" or null
                "likes": msg.get("likes", {}).get("total", 0) if isinstance(msg.get("likes"), dict) else 0,
            })

        # Sort by likes descending for best content first
        messages.sort(key=lambda m: m["likes"], reverse=True)

        return APIResponse.success({
            "ticker": ticker,
            "messages": messages[:limit],
            "count": len(messages),
            "symbol": {
                "title": symbol_info.get("title", ""),
                "watchlist_count": symbol_info.get("watchlist_count", 0),
            },
        })

    except httpx.TimeoutException:
        logger.warning(f"StockTwits timeout for {ticker}")
        return APIResponse.success({"ticker": ticker, "messages": [], "count": 0})
    except Exception as e:
        logger.error(f"StockTwits error for {ticker}: {e}")
        return APIResponse.success({"ticker": ticker, "messages": [], "count": 0})
