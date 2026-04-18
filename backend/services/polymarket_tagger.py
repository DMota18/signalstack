"""
SignalStack — Polymarket Auto-Tagger

Fetches all active finance/economy/crypto events from Polymarket,
matches them to stock tickers via keyword rules, and stores the
mapping in polymarket_ticker_tags for fast lookup.

Run by a Celery job every 30 minutes.

Tagging strategy:
  1. Direct company mentions: "Nvidia" → NVDA
  2. Sector/industry keywords: "semiconductor" → NVDA, AMD, INTC, TSM
  3. Macro keywords: "Fed rate", "recession" → tagged as "macro"
  4. Crypto keywords: "Bitcoin" → BTC-USD, MSTR, COIN
"""

import re
import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

from backend.services.supabase import get_service_client

logger = logging.getLogger("services.polymarket_tagger")

GAMMA_BASE = "https://gamma-api.polymarket.com"


# ============================================================================
# TICKER MAPPING RULES
# ============================================================================

# Direct company/product → ticker mapping
COMPANY_TO_TICKERS: dict[str, list[str]] = {
    # Mega-cap tech
    "nvidia": ["NVDA"], "nvda": ["NVDA"],
    "apple": ["AAPL"], "iphone": ["AAPL"],
    "tesla": ["TSLA"], "tsla": ["TSLA"],
    "google": ["GOOGL"], "alphabet": ["GOOGL"],
    "microsoft": ["MSFT"], "azure": ["MSFT"],
    "amazon": ["AMZN"], "aws": ["AMZN"],
    "meta": ["META"], "facebook": ["META"], "instagram": ["META"],
    "netflix": ["NFLX"],
    "palantir": ["PLTR"],
    "salesforce": ["CRM"],
    "oracle": ["ORCL"],
    "adobe": ["ADBE"],
    "snowflake": ["SNOW"],
    "crowdstrike": ["CRWD"],
    "datadog": ["DDOG"],
    # Semiconductors
    "amd": ["AMD"], "advanced micro": ["AMD"],
    "intel": ["INTC"],
    "tsmc": ["TSM"], "taiwan semi": ["TSM"],
    "broadcom": ["AVGO"],
    "micron": ["MU"],
    "qualcomm": ["QCOM"],
    "arm holdings": ["ARM"],
    # Finance
    "jpmorgan": ["JPM"], "jp morgan": ["JPM"],
    "goldman sachs": ["GS"], "goldman": ["GS"],
    "morgan stanley": ["MS"],
    "bank of america": ["BAC"],
    "visa": ["V"],
    "mastercard": ["MA"],
    "paypal": ["PYPL"],
    "stripe ipo": ["macro"],
    # Crypto companies
    "coinbase": ["COIN"],
    "microstrategy": ["MSTR"],
    "marathon digital": ["MARA"],
    "riot platforms": ["RIOT"],
    # Pharma/biotech
    "pfizer": ["PFE"],
    "moderna": ["MRNA"],
    "eli lilly": ["LLY"], "lilly": ["LLY"],
    "novo nordisk": ["NVO"],
    "abbvie": ["ABBV"],
    # Other
    "boeing": ["BA"],
    "disney": ["DIS"],
    "walmart": ["WMT"],
    "costco": ["COST"],
    "uber": ["UBER"],
    "airbnb": ["ABNB"],
    "spacex": ["macro"],
}

# Crypto asset → ticker mapping
CRYPTO_TO_TICKERS: dict[str, list[str]] = {
    "bitcoin": ["BTC-USD", "MSTR", "COIN", "MARA"],
    "btc": ["BTC-USD", "MSTR", "COIN"],
    "ethereum": ["ETH-USD", "COIN"],
    "eth": ["ETH-USD"],
    "solana": ["SOL-USD"],
    "sol": ["SOL-USD"],
    "crypto": ["BTC-USD", "ETH-USD", "COIN", "MSTR"],
    "defi": ["ETH-USD", "COIN"],
    "stablecoin": ["COIN", "BTC-USD"],
}

# Macro/sector keywords → tickers + always tagged as "macro"
MACRO_TO_TICKERS: dict[str, list[str]] = {
    "fed rate": ["TLT", "XLF", "JPM", "BAC"],
    "federal reserve": ["TLT", "XLF", "JPM", "BAC"],
    "interest rate": ["TLT", "XLF", "JPM", "BAC"],
    "rate cut": ["TLT", "XLF", "JPM", "BAC"],
    "rate hike": ["TLT", "XLF", "JPM", "BAC"],
    "inflation": ["TLT", "GLD", "TIP"],
    "cpi": ["TLT", "GLD"],
    "recession": [],  # macro only, affects everything
    "gdp": [],
    "unemployment": [],
    "tariff": [],
    "trade war": [],
    "s&p 500": ["SPY", "VOO"],
    "s&p": ["SPY", "VOO"],
    "nasdaq": ["QQQ"],
    "dow jones": ["DIA"],
    "stock market": ["SPY", "QQQ"],
    "market crash": ["SPY", "QQQ", "VIX"],
    "ipo": [],
    "semiconductor": ["NVDA", "AMD", "INTC", "TSM", "AVGO", "MU"],
    "ai chip": ["NVDA", "AMD", "TSM"],
    "artificial intelligence": ["NVDA", "MSFT", "GOOGL", "META"],
    "electric vehicle": ["TSLA", "RIVN", "LCID"],
    "ev": ["TSLA", "RIVN"],
    "oil": ["XOM", "CVX", "COP", "USO"],
    "crude oil": ["XOM", "CVX", "USO"],
    "gold": ["GLD", "NEM", "GOLD"],
    "energy": ["XOM", "CVX", "XLE"],
}


# ============================================================================
# MAIN SYNC FUNCTION
# ============================================================================

async def sync_polymarket_catalog() -> dict:
    """Fetch all active finance events from Polymarket and tag to tickers.

    Uses Polymarket's own finance category tag_slugs to get all markets
    listed on polymarket.com/finance, then auto-tags them to tickers.

    Returns:
        {
            "events_fetched": int,
            "finance_events": int,
            "tags_created": int,
            "tags_deactivated": int,
        }
    """
    logger.info("Starting Polymarket catalog sync...")

    # 1. Fetch all active finance events using Polymarket's tag_slug categories
    finance_events = await _fetch_finance_events()
    logger.info(f"Fetched {len(finance_events)} finance events from Polymarket")

    # 3. Auto-tag each event to tickers
    tags = []
    for event in finance_events:
        event_tags = _tag_event(event)
        tags.extend(event_tags)

    logger.info(f"Generated {len(tags)} ticker tags")

    # 4. Write to database
    db = get_service_client()

    # Mark all existing tags as inactive first
    deactivated = await db.update(
        table="polymarket_ticker_tags",
        data={"active": False},
        filters={"tag_source": "eq.auto"},
    )
    deactivated_count = 0
    if deactivated["status_code"] in (200, 204) and isinstance(deactivated.get("data"), list):
        deactivated_count = len(deactivated["data"])

    # Upsert all new tags
    created_count = 0
    for tag in tags:
        result = await db.insert(
            table="polymarket_ticker_tags",
            data=tag,
            upsert=True,
            on_conflict="event_id,market_id,ticker",
        )
        if result["status_code"] in (200, 201):
            created_count += 1

    logger.info(
        f"Polymarket sync complete: {len(finance_events)} finance events fetched, "
        f"{created_count} tags upserted, {deactivated_count} deactivated"
    )

    return {
        "events_fetched": len(finance_events),
        "finance_events": len(finance_events),
        "tags_created": created_count,
        "tags_deactivated": deactivated_count,
    }


# ============================================================================
# API FETCHING
# ============================================================================

async def _fetch_finance_events() -> list:
    """Fetch all active finance events from Polymarket using tag_slug categories.

    Queries each finance sub-category that Polymarket uses on polymarket.com/finance,
    deduplicates by event ID, and returns the combined list.
    """
    FINANCE_TAG_SLUGS = [
        "finance",       # top-level finance category
        "stocks",        # individual stock markets
        "earnings",      # earnings prediction markets
        "crypto",        # crypto price/event markets
        "commodities",   # gold, oil, etc.
        "fed-rates",     # Federal Reserve rate decisions
        "indices",       # S&P 500, Nasdaq, Dow
        "ipos",          # IPO markets
        "forex",         # currency markets
        "acquisitions",  # M&A markets
    ]

    all_events: list = []
    seen_ids: set[str] = set()

    async with httpx.AsyncClient(timeout=30.0) as client:
        for tag_slug in FINANCE_TAG_SLUGS:
            offset = 0
            limit = 100

            while True:
                params = {
                    "tag_slug": tag_slug,
                    "active": "true",
                    "closed": "false",
                    "limit": str(limit),
                    "offset": str(offset),
                    "order": "volume24hr",
                    "ascending": "false",
                }

                try:
                    resp = await client.get(f"{GAMMA_BASE}/events", params=params)
                    if resp.status_code != 200:
                        logger.warning(f"Polymarket API returned {resp.status_code} for tag_slug={tag_slug} at offset {offset}")
                        break

                    events = resp.json()
                    if not isinstance(events, list) or len(events) == 0:
                        break

                    for event in events:
                        eid = str(event.get("id", ""))
                        if eid and eid not in seen_ids:
                            seen_ids.add(eid)
                            all_events.append(event)

                    offset += limit

                    # Safety cap per category
                    if offset >= 500:
                        break

                except Exception as e:
                    logger.error(f"Polymarket fetch error for tag_slug={tag_slug} at offset {offset}: {e}")
                    break

            logger.info(f"tag_slug={tag_slug}: fetched up to offset {offset}")

    return all_events


# ============================================================================
# TAGGING
# ============================================================================

def _tag_event(event: dict) -> list[dict]:
    """Generate ticker tags for an event. Returns list of tag rows."""
    event_id = str(event.get("id", ""))
    event_title = event.get("title") or ""
    event_slug = event.get("slug") or ""
    end_date_str = event.get("endDate") or event.get("end_date")
    image_url = event.get("image") or event.get("icon") or ""

    end_date = None
    if end_date_str:
        try:
            end_date = datetime.fromisoformat(end_date_str.replace("Z", "+00:00"))
        except Exception:
            pass

    markets = event.get("markets") or []
    combined_text = event_title.lower()
    for m in markets:
        if isinstance(m, dict):
            combined_text += " " + (m.get("question") or "").lower()

    # Collect all matched tickers
    matched_tickers: set[str] = set()
    is_macro = False

    # Check company mentions
    for keyword, tickers in COMPANY_TO_TICKERS.items():
        if keyword in combined_text:
            for t in tickers:
                if t == "macro":
                    is_macro = True
                else:
                    matched_tickers.add(t)

    # Check crypto mentions
    for keyword, tickers in CRYPTO_TO_TICKERS.items():
        # Use word boundary to avoid "eth" matching "whether"
        if re.search(rf'\b{re.escape(keyword)}\b', combined_text):
            matched_tickers.update(tickers)

    # Check macro/sector mentions
    for keyword, tickers in MACRO_TO_TICKERS.items():
        if keyword in combined_text:
            is_macro = True
            matched_tickers.update(tickers)

    # Always add "macro" tag for macro events
    if is_macro:
        matched_tickers.add("macro")

    # If no tickers matched but it passed the finance filter,
    # tag it as macro (general finance market)
    if not matched_tickers:
        matched_tickers.add("macro")

    # Build tag rows — one per market per ticker
    tags = []
    now = datetime.now(timezone.utc).isoformat()

    if markets:
        for m in markets:
            if not isinstance(m, dict):
                continue

            market_id = str(m.get("id", ""))
            question = m.get("question") or event_title

            # Parse prices
            yes_price = _parse_price(m, "yes")
            no_price = _parse_price(m, "no")
            vol_24h = float(m.get("volume24hr", 0) or 0)
            total_vol = float(m.get("volume", 0) or 0)

            # Skip fully resolved markets
            if yes_price is not None and (yes_price >= 0.999 or yes_price <= 0.001):
                continue

            slug = m.get("slug") or event_slug
            polymarket_url = f"https://polymarket.com/event/{event_slug}" if event_slug else ""

            for ticker in matched_tickers:
                tags.append({
                    "event_id": event_id,
                    "market_id": market_id,
                    "ticker": ticker,
                    "tag_source": "auto",
                    "event_title": event_title,
                    "question": question,
                    "yes_price": yes_price,
                    "no_price": no_price,
                    "volume_24h": vol_24h,
                    "total_volume": total_vol,
                    "end_date": end_date.isoformat() if end_date else None,
                    "polymarket_url": polymarket_url,
                    "image_url": image_url,
                    "active": True,
                    "last_synced_at": now,
                })
    else:
        # Event with no sub-markets — tag at event level
        polymarket_url = f"https://polymarket.com/event/{event_slug}" if event_slug else ""
        vol_24h = float(event.get("volume24hr", 0) or 0)
        total_vol = float(event.get("volume", 0) or 0)

        for ticker in matched_tickers:
            tags.append({
                "event_id": event_id,
                "market_id": None,
                "ticker": ticker,
                "tag_source": "auto",
                "event_title": event_title,
                "question": event_title,
                "yes_price": None,
                "no_price": None,
                "volume_24h": vol_24h,
                "total_volume": total_vol,
                "end_date": end_date.isoformat() if end_date else None,
                "polymarket_url": polymarket_url,
                "image_url": image_url,
                "active": True,
                "last_synced_at": now,
            })

    return tags


def _parse_price(market: dict, side: str) -> Optional[float]:
    """Parse a yes/no price from a market dict."""
    # Try outcomePrices first (array format)
    outcome_prices = market.get("outcomePrices")
    if outcome_prices:
        try:
            if isinstance(outcome_prices, str):
                import json
                outcome_prices = json.loads(outcome_prices)
            if isinstance(outcome_prices, list) and len(outcome_prices) >= 2:
                return float(outcome_prices[0]) if side == "yes" else float(outcome_prices[1])
        except Exception:
            pass

    # Try direct fields
    if side == "yes":
        for key in ("yes_price", "bestAsk", "lastTradePrice"):
            val = market.get(key)
            if val is not None:
                try:
                    return float(val)
                except (ValueError, TypeError):
                    pass

    if side == "no":
        for key in ("no_price", "bestBid"):
            val = market.get(key)
            if val is not None:
                try:
                    return float(val)
                except (ValueError, TypeError):
                    pass

    return None
