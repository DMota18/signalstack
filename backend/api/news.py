"""
SignalStack — News Routes

Aggregates news from Finnhub for user holdings, general markets, and macro/economy.

Endpoints:
  GET /news/holdings    — News for user's holdings (per-ticker)
  GET /news/markets     — General market news
  GET /news/economy     — Macro/economic news + FRED data
"""

import asyncio
import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query

from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.supabase import get_anon_client
from backend.tools.finnhub import get_news_sentiment
from backend.tools.fred import get_economic_calendar, get_fred_data

logger = logging.getLogger("api.news")

router = APIRouter(prefix="/news", tags=["news"])


@router.get("/holdings", response_model=APIResponse)
async def news_for_holdings(
    user: CurrentUser = Depends(get_current_user),
    limit: int = Query(30, ge=1, le=100),
):
    """Fetch recent news for the user's holdings, grouped by ticker."""
    db = get_anon_client()
    result = await db.select(
        table="holdings",
        columns="ticker,security_name",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        order="pct_of_portfolio.desc.nullslast",
    )

    holdings = result["data"] if result["status_code"] == 200 and isinstance(result["data"], list) else []
    tickers = list({h["ticker"]: h.get("security_name", "") for h in holdings if h.get("ticker")}.keys())[:8]

    if not tickers:
        return APIResponse.success({"articles": [], "tickers_searched": 0})

    async def _fetch(ticker: str):
        try:
            res = await get_news_sentiment(ticker, lookback_days=7)
            if isinstance(res, dict) and res.get("ok"):
                articles = res.get("data", {}).get("articles", [])
                for a in articles:
                    a["ticker"] = ticker
                return articles
        except Exception:
            pass
        return []

    batches = await asyncio.gather(*[_fetch(t) for t in tickers], return_exceptions=True)

    all_articles = []
    for batch in batches:
        if isinstance(batch, list):
            all_articles.extend(batch)

    # Sort by published_at descending, deduplicate by headline
    seen = set()
    deduped = []
    for a in sorted(all_articles, key=lambda x: x.get("published_at", ""), reverse=True):
        headline = a.get("headline", "")
        if headline and headline not in seen:
            seen.add(headline)
            deduped.append(a)

    return APIResponse.success({
        "articles": deduped[:limit],
        "tickers_searched": len(tickers),
    })


@router.get("/markets", response_model=APIResponse)
async def market_news(
    limit: int = Query(20, ge=1, le=50),
    user: CurrentUser = Depends(get_current_user),
):
    """Fetch general market news from Finnhub's /news endpoint (no ticker needed)."""

    import httpx

    from backend.config import get_settings

    settings = get_settings()

    if not settings.finnhub_api_key:
        return APIResponse.fail(message="Finnhub API key not configured", code="config_error")

    try:
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                "https://finnhub.io/api/v1/news",
                params={
                    "category": "general",
                    "token": settings.finnhub_api_key,
                },
            )

        if resp.status_code != 200:
            return APIResponse.fail(message="Failed to fetch market news", code="finnhub_error")

        raw = resp.json()
        if not isinstance(raw, list):
            raw = []

        articles = []
        for a in raw[:limit]:
            articles.append({
                "headline": a.get("headline", ""),
                "source": a.get("source", ""),
                "url": a.get("url", ""),
                "summary": a.get("summary", ""),
                "category": a.get("category", ""),
                "published_at": datetime.fromtimestamp(
                    a.get("datetime", 0), tz=UTC
                ).isoformat() if a.get("datetime") else None,
            })

        return APIResponse.success({"articles": articles})

    except Exception as e:
        logger.error(f"Market news fetch error: {e}")
        return APIResponse.fail(message="Failed to fetch market news", code="fetch_error")


@router.get("/economy", response_model=APIResponse)
async def economy_data(
    user: CurrentUser = Depends(get_current_user),
):
    """Fetch key macro indicators from FRED + upcoming economic calendar."""
    key_series = [
        ("FEDFUNDS", "Fed Funds Rate"),
        ("CPIAUCSL", "CPI (All Urban)"),
        ("UNRATE", "Unemployment Rate"),
        ("DGS10", "10Y Treasury Yield"),
        ("DGS2", "2Y Treasury Yield"),
        ("GDP", "Real GDP"),
    ]

    async def _fetch_series(series_id: str, label: str):
        try:
            res = await get_fred_data(series_id, observation_count=24)
            if isinstance(res, dict) and res.get("ok"):
                data = res.get("data", {})
                observations = data.get("observations", [])
                latest = observations[0] if observations else {}
                prev = observations[1] if len(observations) > 1 else {}
                return {
                    "series_id": series_id,
                    "label": label,
                    "title": data.get("title", label),
                    "frequency": data.get("frequency", ""),
                    "units": data.get("units", ""),
                    "latest_value": latest.get("value"),
                    "latest_date": latest.get("date"),
                    "previous_value": prev.get("value"),
                    "previous_date": prev.get("date"),
                    "observations": observations[:12],
                }
        except Exception as e:
            logger.warning(f"FRED fetch failed for {series_id}: {e}")
        return None

    # Fetch all series + calendar in parallel
    tasks = [_fetch_series(sid, label) for sid, label in key_series]

    async def _fetch_calendar():
        try:
            res = await get_economic_calendar(days_ahead=30)
            if isinstance(res, dict) and res.get("ok"):
                return res.get("data", {}).get("releases", [])
        except Exception:
            pass
        return []

    tasks.append(_fetch_calendar())

    results = await asyncio.gather(*tasks, return_exceptions=True)

    indicators = [r for r in results[:-1] if isinstance(r, dict)]
    calendar = results[-1] if isinstance(results[-1], list) else []

    return APIResponse.success({
        "indicators": indicators,
        "calendar": calendar[:10],
        "fetched_at": datetime.now(UTC).isoformat(),
    })
