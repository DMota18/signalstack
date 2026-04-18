"""
SignalStack — Polymarket API Routes

Exposes Polymarket prediction market data to the frontend.

The /holdings-match endpoint does NOT use the heavy match_holdings_to_markets
tool (which was designed for agent use and runs sequentially). Instead it
runs a lighter parallel batch directly against the Gamma API, which is
~10x faster for the dashboard use case.

Endpoints:
  GET  /polymarket/holdings-match  — Match user's holdings to relevant markets
  GET  /polymarket/search          — Search Polymarket by query string
  GET  /polymarket/prices/:id      — Get current prices for a specific market
"""

import asyncio
import logging
from fastapi import APIRouter, Depends, Query
from backend.models.schemas import APIResponse
from backend.services.auth import get_current_user, CurrentUser
from backend.services.supabase import get_anon_client
from backend.tools.polymarket import (
    search_polymarket_markets,
    get_market_prices,
    TICKER_SEARCH_TERMS,
    MACRO_SEARCH_TERMS,
)

logger = logging.getLogger("api.polymarket")

router = APIRouter(prefix="/polymarket", tags=["polymarket"])


# ────────────────────────────────────────────────────────────────────────────
# Lightweight parallel search for the dashboard / alerts UI
# ────────────────────────────────────────────────────────────────────────────

async def _search_for_ticker(ticker: str, security_name: str = "") -> tuple[str, list[dict]]:
    """Search Polymarket for a single ticker using its primary search term.
    Returns (ticker, markets_list). Each ticker runs in parallel via gather.

    If ticker is not in TICKER_SEARCH_TERMS, uses security_name as fallback
    search query. Short/ambiguous tickers (< 4 chars) without a mapping are
    skipped to avoid irrelevant noise.
    """
    upper = ticker.upper()
    search_terms = TICKER_SEARCH_TERMS.get(upper)

    # If no predefined mapping, build search terms from security name
    if not search_terms:
        if security_name and len(security_name) > 2:
            # Use the company name — strip common suffixes
            clean_name = security_name.split(',')[0].split(' Inc')[0].split(' Corp')[0].split(' Ltd')[0].strip()
            if len(clean_name) > 2:
                search_terms = [clean_name]
            else:
                return (upper, [])
        elif len(ticker) >= 4:
            # Long tickers might be unique enough
            search_terms = [ticker]
        else:
            # Short unmapped tickers (NTR, BA, GE etc.) are too ambiguous
            return (upper, [])

    all_markets: list[dict] = []
    seen_questions: set[str] = set()

    all_events: list[dict] = []
    seen_event_titles: set[str] = set()

    for term in search_terms[:2]:
        result = await search_polymarket_markets(
            query=term,
            min_volume=0,
            category="all",
        )
        if isinstance(result, dict) and result.get("ok"):
            data = result.get("data", {})
            for m in data.get("markets", []):
                q = m.get("question", "")
                if q and q not in seen_questions:
                    seen_questions.add(q)
                    all_markets.append(m)
            for e in data.get("events", []):
                t = e.get("event_title", "")
                if t and t not in seen_event_titles:
                    seen_event_titles.add(t)
                    all_events.append(e)

    return (upper, all_markets[:8], all_events[:5])


async def _search_macro() -> list[dict]:
    """Search for macro markets in parallel."""
    macro_markets: list[dict] = []
    seen: set[str] = set()

    # Search all macro terms in parallel for better coverage
    priority_terms = MACRO_SEARCH_TERMS[:5]

    async def _single_macro(term: str) -> list[dict]:
        result = await search_polymarket_markets(query=term, min_volume=1000)
        if isinstance(result, dict) and result.get("ok"):
            markets = result.get("data", {}).get("markets", [])
            # Filter out extreme probabilities — not informative
            return [m for m in markets if 5 <= (m.get("implied_probability_pct") or 0) <= 95]
        return []

    results = await asyncio.gather(
        *[_single_macro(t) for t in priority_terms],
        return_exceptions=True,
    )

    for batch in results:
        if isinstance(batch, list):
            for m in batch:
                q = m.get("question", "")
                if q and q not in seen:
                    seen.add(q)
                    macro_markets.append(m)

    return macro_markets[:8]


@router.get("/holdings-match", response_model=APIResponse)
async def polymarket_holdings_match(
    user: CurrentUser = Depends(get_current_user),
    include_macro: bool = Query(True, description="Include macro markets (Fed, CPI, etc)"),
):
    """Match the user's current holdings to relevant Polymarket prediction markets.

    Uses the pre-synced polymarket_ticker_tags table for fast DB lookups
    instead of live API searches. The catalog is kept fresh by a Celery
    job that runs every 30 minutes.
    """
    db = get_anon_client()

    # Get user's holdings to extract tickers
    result = await db.select(
        table="holdings",
        columns="ticker,security_name",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    if result["status_code"] != 200:
        return APIResponse.fail(message="Failed to fetch holdings", code="fetch_error")

    holdings = result["data"] if isinstance(result["data"], list) else []

    # Deduplicate tickers
    ticker_set: set[str] = set()
    for h in holdings:
        t = h.get("ticker", "")
        if t:
            ticker_set.add(t.upper())
    tickers = list(ticker_set)

    if not tickers:
        return APIResponse.success({
            "tickers_searched": 0,
            "total_markets_found": 0,
            "per_ticker": {},
            "macro_markets": [],
            "macro_markets_count": 0,
        })

    # ── Fast DB lookups from polymarket_ticker_tags ──
    from backend.services.supabase import get_service_client
    svc = get_service_client()

    per_ticker: dict = {}
    total_found = 0

    # Fetch markets for each ticker from the local catalog
    for ticker in tickers[:15]:
        tag_result = await svc.select(
            table="polymarket_ticker_tags",
            columns="event_id,market_id,event_title,question,yes_price,no_price,volume_24h,total_volume,end_date,polymarket_url,image_url",
            filters={"ticker": f"eq.{ticker}", "active": "eq.true"},
            order="volume_24h.desc",
            limit=8,
        )
        markets = []
        if tag_result["status_code"] == 200 and isinstance(tag_result["data"], list):
            for m in tag_result["data"]:
                markets.append({
                    "question": m.get("question") or m.get("event_title", ""),
                    "event_title": m.get("event_title", ""),
                    "yes_price": float(m["yes_price"]) if m.get("yes_price") is not None else None,
                    "no_price": float(m["no_price"]) if m.get("no_price") is not None else None,
                    "volume_24h": float(m.get("volume_24h", 0) or 0),
                    "total_volume": float(m.get("total_volume", 0) or 0),
                    "end_date": m.get("end_date"),
                    "polymarket_url": m.get("polymarket_url", ""),
                    "image_url": m.get("image_url", ""),
                    "implied_probability_pct": round(float(m["yes_price"]) * 100, 1) if m.get("yes_price") is not None else None,
                })
        if markets:
            per_ticker[ticker] = {
                "markets_found": len(markets),
                "markets": markets,
                "events": [],
            }
            total_found += len(markets)

    # Fetch macro markets
    macro_markets = []
    if include_macro:
        macro_result = await svc.select(
            table="polymarket_ticker_tags",
            columns="event_id,market_id,event_title,question,yes_price,no_price,volume_24h,total_volume,end_date,polymarket_url,image_url",
            filters={"ticker": "eq.macro", "active": "eq.true"},
            order="volume_24h.desc",
            limit=10,
        )
        if macro_result["status_code"] == 200 and isinstance(macro_result["data"], list):
            seen: set[str] = set()
            for m in macro_result["data"]:
                q = m.get("question") or m.get("event_title", "")
                if q and q not in seen:
                    seen.add(q)
                    macro_markets.append({
                        "question": q,
                        "event_title": m.get("event_title", ""),
                        "yes_price": float(m["yes_price"]) if m.get("yes_price") is not None else None,
                        "no_price": float(m["no_price"]) if m.get("no_price") is not None else None,
                        "volume_24h": float(m.get("volume_24h", 0) or 0),
                        "total_volume": float(m.get("total_volume", 0) or 0),
                        "end_date": m.get("end_date"),
                        "polymarket_url": m.get("polymarket_url", ""),
                        "image_url": m.get("image_url", ""),
                        "implied_probability_pct": round(float(m["yes_price"]) * 100, 1) if m.get("yes_price") is not None else None,
                    })

    return APIResponse.success({
        "tickers_searched": len(tickers),
        "total_markets_found": total_found + len(macro_markets),
        "per_ticker": per_ticker,
        "macro_markets": macro_markets,
        "macro_markets_count": len(macro_markets),
    })


@router.get("/search", response_model=APIResponse)
async def polymarket_search(
    user: CurrentUser = Depends(get_current_user),
    q: str = Query(..., min_length=1, max_length=200, description="Search query"),
    min_volume: int = Query(1000, ge=0, description="Minimum 24h volume filter"),
    category: str = Query("all", description="Category filter"),
):
    """Search Polymarket for prediction markets by topic, ticker, or event."""
    tool_result = await search_polymarket_markets(
        query=q,
        min_volume=min_volume,
        category=category,
    )

    if isinstance(tool_result, dict) and tool_result.get("ok") is False:
        # Business error = no results, not a failure — return empty gracefully
        if tool_result.get("error") == "business":
            return APIResponse.success({
                "query": q,
                "markets_found": 0,
                "markets": [],
            })
        return APIResponse.fail(
            message=tool_result.get("message", "Polymarket search failed"),
            code="polymarket_error",
        )

    return APIResponse.success(tool_result.get("data", tool_result))


@router.get("/prices/{market_id:path}", response_model=APIResponse)
async def polymarket_prices(
    market_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Get current yes/no prices for a specific Polymarket market."""
    tool_result = await get_market_prices(market_id)

    if isinstance(tool_result, dict) and tool_result.get("ok") is False:
        return APIResponse.fail(
            message=tool_result.get("message", "Failed to fetch market prices"),
            code="polymarket_error",
        )

    return APIResponse.success(tool_result.get("data", tool_result))


# ────────────────────────────────────────────────────────────────────────────
# Manual sync trigger (for testing — run catalog sync without Celery)
# ────────────────────────────────────────────────────────────────────────────

@router.post("/sync-catalog", response_model=APIResponse)
async def sync_catalog(
    user: CurrentUser = Depends(get_current_user),
):
    """Manually trigger a Polymarket catalog sync.

    Fetches all active finance events, auto-tags to tickers,
    and stores in polymarket_ticker_tags. Normally runs via Celery
    every 30 minutes — this endpoint is for manual testing.
    """
    from backend.services.polymarket_tagger import sync_polymarket_catalog
    result = await sync_polymarket_catalog()
    return APIResponse.success(result)
