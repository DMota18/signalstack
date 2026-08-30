"""
SignalStack — Polymarket MCP Tools

Provider: Polymarket (Gamma API)
Rate limit: 1000 calls/hr (free, no authentication required)
Auth: None — completely free and open

Tools:
  search_polymarket_markets  — Search for prediction markets by topic/ticker
  get_market_prices          — Get current yes/no prices (= implied probabilities)
  get_market_volume          — Get trading volume and liquidity data
  match_holdings_to_markets  — Map a user's holdings to relevant markets

These tools serve the Polymarket Agent subagent.
Outcome prices directly equal implied probabilities:
  yes_price = 0.73 means 73% implied probability.
"""

import httpx
import logging
from datetime import datetime, timezone
from typing import Optional

from backend.config import get_settings
from backend.services.supabase import get_service_client
from backend.tools.base import (
    ToolResult, transient_error, validation_error,
    business_error, classify_http_error, retry_with_backoff,
)

logger = logging.getLogger("tools.polymarket")

GAMMA_BASE = "https://gamma-api.polymarket.com"


async def _gamma_request(endpoint: str, params: dict, tool_name: str) -> dict:
    """Make a request to the Polymarket Gamma API. No auth required."""

    async def _call():
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{GAMMA_BASE}{endpoint}", params=params)
            return {"status_code": resp.status_code, "data": resp.json()}

    try:
        result = await retry_with_backoff(_call, max_retries=2, base_delay=5.0, tool_name=tool_name)
        return result
    except httpx.TimeoutException:
        return transient_error(tool_name, "Polymarket Gamma API timeout").to_dict()
    except Exception as e:
        return transient_error(tool_name, f"Polymarket request failed: {e}").to_dict()


async def _check_cache(cache_key: str, tool_name: str) -> Optional[dict]:
    """Check the polymarket_cache table for a valid cached result."""
    db = get_service_client()
    try:
        result = await db.select(
            table="polymarket_cache",
            columns="market_data,expires_at",
            filters={"cache_key": f"eq.{cache_key}"},
            single=True,
        )
        if result["status_code"] == 200 and isinstance(result["data"], dict):
            expires = result["data"].get("expires_at", "")
            if expires and expires > datetime.now(timezone.utc).isoformat():
                return result["data"]["market_data"]
    except Exception as e:
        logger.debug(f"Cache lookup failed for {cache_key}: {e}")
    return None


async def _write_cache(cache_key: str, data: dict, cache_type: str = "search", ttl_seconds: int = 900):
    """Write a result to the polymarket_cache table."""
    db = get_service_client()
    now = datetime.now(timezone.utc)
    try:
        await db.insert(
            table="polymarket_cache",
            data={
                "cache_key": cache_key,
                "market_data": data,
                "cache_type": cache_type,
                "ttl_seconds": ttl_seconds,
                "fetched_at": now.isoformat(),
                "expires_at": datetime.fromtimestamp(now.timestamp() + ttl_seconds, tz=timezone.utc).isoformat(),
            },
            upsert=True,
            on_conflict="cache_key",
        )
    except Exception as e:
        logger.debug(f"Cache write failed for {cache_key}: {e}")


# ============================================================================
# RELEVANCE FILTERING — WHITELIST APPROACH
# Only finance, economy, and crypto markets pass through.
# ============================================================================

# Finance whitelist: if an event title or market question contains ANY of these,
# it's potentially relevant. We check the event title first (more reliable).
_FINANCE_KEYWORDS = {
    # Stock tickers and company names
    "stock", "share", "market cap", "largest company", "s&p", "spx", "spy",
    "nasdaq", "dow", "russell", "ipo", "valuation",
    "nvda", "nvidia", "aapl", "apple", "tsla", "tesla", "googl", "google",
    "alphabet", "msft", "microsoft", "amzn", "amazon", "meta", "facebook",
    "nflx", "netflix", "hood", "robinhood", "pltr", "palantir", "amd",
    "intc", "intel", "coin", "coinbase", "mstr", "microstrategy",
    "opendoor", "open", "arm ", "broadcom", "salesforce",
    # Price action
    "close above", "hit in", "will reach", "price will", "what will",
    "what price", "opens up", "opens down", "above $", "below $",
    "dip to", "settle at",
    # Crypto
    "bitcoin", "btc", "ethereum", "eth", "solana", "sol", "xrp", "ripple",
    "dogecoin", "doge", "crypto", "token", "defi", "nft",
    # Economics
    "fed ", "federal reserve", "interest rate", "rate cut", "rate hike",
    "cpi", "inflation", "gdp", "recession", "unemployment", "tariff",
    "trade war", "treasury", "yield", "bond",
    # Commodities
    "gold", "silver", "crude oil", "wti", "brent", "natural gas",
    "commodity", "hang seng", "nikkei", "ftse",
    # Earnings
    "earnings", "revenue", "quarterly", "eps", "guidance",
    "deliveries", "delivery", "q1 ", "q2 ", "q3 ", "q4 ",
    # AI models (relevant to tech stocks)
    "best ai model", "#1 ai model", "ai model",
    # IPO
    "spacex", "ipo", "public ticker", "list on",
    # Specific events
    "microstrategy", "satoshi",
}

# Hard reject: if ANY of these appear, it's definitely not finance
_REJECT_KEYWORDS = {
    # Sports
    "vs.", "vs ", "playoffs", "championship", "super bowl", "world cup",
    "nba", "nfl", "nhl", "mlb", "ufc", "mma", "boxing", "tennis",
    "golf", "nascar", "f1 ", "grand prix", "premier league", "la liga",
    "serie a", "bundesliga", "ligue 1", "pga tour", "open:",
    "copa ", "miami open", "charleston open", "bucharest open",
    "lakers", "celtics", "warriors", "knicks", "cowboys", "eagles",
    "chiefs", "49ers", "patriots", "yankees", "dodgers",
    "ncaa", "tournament winner", "semifinals",
    "stanley cup", "champion",
    # Esports/Gaming
    "counter-strike", "esports", "map 1:", "map 2:", "map 3:",
    "odd/even", "total kills", "total rounds", "o/u ", "spread:",
    "dota", "bo3)", "bo5)", "blast ", "esl ",
    # Politics
    "presidential", "president", "election", "nominee",
    "democratic party", "republican party", "white house",
    "senate", "governor", "cabinet", "congress passes",
    "who visited", "epstein",
    "will trump say", "will be said", "starmer say",
    "venezuela leader", "macron out", "netanyahu",
    "quebec", "peru ", "california governor",
    # Entertainment
    "movie", "box office", "album", "grammy", "oscar",
    "netflix show", "gta vi",
    # Military/Geopolitics (not finance)
    "warships", "military action", "military clash",
    "iran strike", "war powers",
    # Crypto launches (not price action)
    "fdv above", "one day after launch", "public sale",
    "will .* launch a token",
    # Other noise
    "which states will", "which countries will",
    "la liga", "goalscorer",
    "draft: first overall",
    "warner bros",
}


def _parse_prices(market: dict) -> tuple:
    """Parse yes/no prices from a market object. Returns (yes_price, no_price)."""
    import json as _json
    yes_price = None
    no_price = None

    # Try outcomePrices (most common format: '["0.73", "0.27"]')
    outcome_prices = market.get("outcomePrices", "")
    if isinstance(outcome_prices, str) and outcome_prices:
        try:
            prices = _json.loads(outcome_prices)
            if isinstance(prices, list) and len(prices) >= 2:
                yes_price = float(prices[0])
                no_price = float(prices[1])
        except (ValueError, IndexError):
            pass

    # Fallback: outcomes array
    if yes_price is None:
        outcomes = market.get("outcomes", [])
        if isinstance(outcomes, list) and len(outcomes) >= 2:
            for outcome in outcomes:
                if isinstance(outcome, dict):
                    if outcome.get("value", "").lower() == "yes":
                        yes_price = float(outcome.get("price", 0))
                    elif outcome.get("value", "").lower() == "no":
                        no_price = float(outcome.get("price", 0))

    # Fallback: bestBid
    if yes_price is None:
        yes_price = float(market.get("bestBid", 0) or 0)
        no_price = 1.0 - yes_price if yes_price else None

    return yes_price, no_price


def _is_finance_event(event_title: str, market_questions: list[str]) -> bool:
    """Check if an event is finance/economy/crypto related using whitelist."""
    title_lower = event_title.lower()
    all_text = title_lower + " " + " ".join(q.lower() for q in market_questions)

    # Hard reject first
    if any(kw in all_text for kw in _REJECT_KEYWORDS):
        return False

    # Must match at least one finance keyword
    return any(kw in all_text for kw in _FINANCE_KEYWORDS)


def _is_relevant(market: dict, relevance_keywords: set[str]) -> bool:
    """Check if a market matches the search query keywords."""
    question = (market.get("question", "") or "").lower()
    description = (market.get("description", "") or "").lower()
    title = (market.get("title", "") or "").lower()
    searchable = f"{question} {description} {title}"

    for keyword in relevance_keywords:
        if keyword in searchable:
            return True
    return False


def _build_relevance_keywords(query: str) -> set[str]:
    """Build keyword set from query for matching."""
    stopwords = {"the", "a", "an", "of", "in", "for", "and", "or", "to", "by", "at", "on", "is", "will", "be"}
    raw = query.lower().strip()
    words = [w for w in raw.split() if len(w) > 1 and w not in stopwords]
    keywords = set(words)
    keywords.add(raw)
    for i in range(len(words) - 1):
        keywords.add(f"{words[i]} {words[i+1]}")
    for w in words:
        if len(w) >= 5:
            keywords.add(w[:4])
    return keywords


# ============================================================================
# TOOL: search_polymarket_markets
# ============================================================================

SEARCH_MARKETS_SCHEMA = {
    "name": "search_polymarket_markets",
    "description": (
        "Search Polymarket's Gamma API for active prediction markets related "
        "to a given topic, ticker, or event. Returns market title, current "
        "yes/no prices (which represent implied probabilities), 24h volume, "
        "liquidity, end date, and category.\n\n"
        "INPUT: query (string — ticker symbol, company name, event description, "
        "or topic), min_volume (integer, default 1000), category (string, optional).\n\n"
        "EXAMPLE QUERIES: 'NVDA earnings', 'Fed rate cut June', 'China tariffs', "
        "'Bitcoin 150k', 'recession 2026'\n\n"
        "KEY INSIGHT: Outcome prices directly equal implied probabilities. "
        "A yes_price of 0.73 means the crowd assigns 73% probability to that "
        "outcome. No transformation needed.\n\n"
        "EDGE CASES: Returns business error (not failure) when no markets match "
        "the query. Some tickers may not have direct Polymarket coverage — try "
        "searching by event or industry instead.\n\n"
        "DO NOT USE FOR: Historical price data (use get_price_data). "
        "Company news (use get_news_sentiment). SEC filings. "
        "Actual stock/crypto prices."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "query": {
                "type": "string",
                "description": (
                    "Search term: ticker symbol, company name, event description, "
                    "or topic. Examples: 'NVDA earnings', 'Fed rate cut June', "
                    "'China tariffs'"
                ),
            },
            "min_volume": {
                "type": "integer",
                "description": "Minimum 24h trading volume filter. Default 1000. Use higher (10000+) for liquid markets only.",
                "default": 1000,
            },
            "category": {
                "type": "string",
                "description": "Optional category filter",
                "enum": ["all", "crypto", "politics", "economics", "sports", "science", "pop-culture"],
                "default": "all",
            },
        },
        "required": ["query"],
    },
}


async def search_polymarket_markets(
    query: str,
    min_volume: int = 1000,
    category: str = "all",
) -> dict:
    """Search for active prediction markets on Polymarket."""
    tool_name = "search_polymarket_markets"
    query = query.strip()

    if not query:
        return validation_error(tool_name, "Search query is required").to_dict()

    # Check cache
    cache_key = f"search:v3:{query.lower()}:{min_volume}:{category}"
    cached = await _check_cache(cache_key, tool_name)
    if cached:
        logger.debug(f"Cache hit for Polymarket search: {query}")
        return ToolResult(ok=True, tool_name=tool_name, data=cached).to_dict()

    # Batch-fetch top events by volume and filter locally for finance/crypto.
    # The Gamma API _q search is unreliable, so we fetch broadly and filter.
    # We preserve event grouping for multi-outcome markets.

    all_events: list = []
    seen_event_slugs: set = set()

    # Strategy 1: Batch-fetch top events
    event_params = {
        "active": "true",
        "closed": "false",
        "limit": 200,
        "order": "volume24hr",
        "ascending": "false",
    }
    result_events = await _gamma_request("/events", event_params, tool_name)

    if isinstance(result_events, dict) and result_events.get("ok") is False:
        return result_events

    if result_events.get("status_code") == 200:
        events_data = result_events.get("data", [])
        if isinstance(events_data, list):
            for event in events_data:
                slug = event.get("slug", "")
                if slug not in seen_event_slugs:
                    seen_event_slugs.add(slug)
                    all_events.append(event)

    # Strategy 2: Also try _q on events for niche queries
    q_params = {
        "active": "true",
        "closed": "false",
        "limit": 50,
        "order": "volume24hr",
        "ascending": "false",
        "_q": query,
    }
    result_q = await _gamma_request("/events", q_params, tool_name)
    if result_q.get("status_code") == 200:
        q_events = result_q.get("data", [])
        if isinstance(q_events, list):
            for event in q_events:
                slug = event.get("slug", "")
                if slug not in seen_event_slugs:
                    seen_event_slugs.add(slug)
                    all_events.append(event)

    # Filter events to ONLY finance/economy/crypto
    finance_events = []
    for event in all_events:
        event_title = event.get("title", "") or ""
        event_markets = event.get("markets", []) or []
        market_questions = [m.get("question", "") for m in event_markets if isinstance(m, dict)]
        if _is_finance_event(event_title, market_questions):
            finance_events.append(event)

    # Flatten markets from finance events for keyword matching
    raw_markets: list = []
    for event in finance_events:
        event_title = event.get("title", "") or ""
        event_slug = event.get("slug", "") or ""
        for m in (event.get("markets", []) or []):
            if isinstance(m, dict):
                # Tag each market with its parent event info
                m["_event_title"] = event_title
                m["_event_slug"] = event_slug
                raw_markets.append(m)

    # Build relevance keywords from the query for filtering
    relevance_keywords = _build_relevance_keywords(query)

    # Filter by volume threshold, category, and RELEVANCE
    markets = []
    for m in raw_markets:
        vol = float(m.get("volume24hr", 0) or 0)
        if vol < min_volume and min_volume > 0:
            continue

        # Filter by category if specified
        market_category = (m.get("category", "") or "").lower()
        if category != "all" and market_category != category.lower():
            continue

        # Relevance check: market must match query keywords
        if not _is_relevant(m, relevance_keywords):
            continue

        # Parse yes/no prices
        yes_price, no_price = _parse_prices(m)

        # Skip fully resolved markets (exactly 0 or 1)
        if yes_price is not None and (yes_price >= 0.999 or yes_price <= 0.001):
            continue

        markets.append({
            "question": m.get("question", m.get("title", "")),
            "yes_price": yes_price,
            "no_price": no_price,
            "implied_probability_pct": round(yes_price * 100, 1) if yes_price else None,
            "volume_24h": vol,
            "liquidity": float(m.get("liquidity", 0) or 0),
            "end_date": m.get("endDate", m.get("end_date_iso", "")),
            "category": m.get("category", ""),
            "market_slug": m.get("slug", m.get("market_slug", "")),
            "condition_id": m.get("conditionId", m.get("condition_id", "")),
            "polymarket_url": f"https://polymarket.com/event/{m.get('_event_slug', m.get('slug', ''))}",
            "event_title": m.get("_event_title", ""),
        })

    # Group markets by event for multi-outcome display
    event_groups: dict = {}
    ungrouped: list = []
    for mkt in markets:
        event_title = mkt.get("event_title", "")
        if event_title:
            if event_title not in event_groups:
                event_groups[event_title] = {
                    "event_title": event_title,
                    "outcomes": [],
                    "total_volume": 0,
                    "end_date": mkt.get("end_date", ""),
                    "polymarket_url": mkt.get("polymarket_url", ""),
                }
            event_groups[event_title]["outcomes"].append({
                "question": mkt["question"],
                "yes_price": mkt["yes_price"],
                "no_price": mkt["no_price"],
                "implied_probability_pct": mkt["implied_probability_pct"],
                "volume_24h": mkt["volume_24h"],
            })
            event_groups[event_title]["total_volume"] += mkt["volume_24h"]
        else:
            ungrouped.append(mkt)

    # Sort outcomes within each event by probability descending
    for eg in event_groups.values():
        eg["outcomes"].sort(key=lambda o: o.get("implied_probability_pct") or 0, reverse=True)
        # Keep top 6 outcomes per event
        eg["outcomes"] = eg["outcomes"][:6]

    # Build final response: grouped events + ungrouped individual markets
    grouped_markets = sorted(event_groups.values(), key=lambda e: e["total_volume"], reverse=True)

    # Also keep flat markets list for backward compatibility
    flat_markets = markets[:20]

    if not markets:
        return business_error(
            tool_name,
            f"No active Polymarket markets found for '{query}' with minimum volume {min_volume}.",
            {"query": query, "min_volume": min_volume, "category": category},
        ).to_dict()

    response_data = {
        "query": query,
        "markets_found": len(markets),
        "markets": flat_markets,
        "events": grouped_markets[:15],
    }

    await _write_cache(cache_key, response_data, "search", 900)

    return ToolResult(ok=True, tool_name=tool_name, data=response_data).to_dict()


# ============================================================================
# TOOL: get_market_prices
# ============================================================================

MARKET_PRICES_SCHEMA = {
    "name": "get_market_prices",
    "description": (
        "Get current yes/no prices for a specific Polymarket market by "
        "condition ID or slug. Prices directly equal implied probabilities.\n\n"
        "INPUT: market_id (string — condition_id or slug from search results).\n\n"
        "EXAMPLE: After searching for 'NVDA earnings', use the condition_id "
        "from the result to get the latest prices.\n\n"
        "DO NOT USE FOR: Searching for markets (use search_polymarket_markets first). "
        "Stock prices. Historical data."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "market_id": {
                "type": "string",
                "description": "Polymarket condition_id or market slug",
            },
        },
        "required": ["market_id"],
    },
}


async def get_market_prices(market_id: str) -> dict:
    """Get current prices for a specific Polymarket market."""
    tool_name = "get_market_prices"
    market_id = market_id.strip()

    if not market_id:
        return validation_error(tool_name, "market_id is required").to_dict()

    # Check cache (5 min TTL for prices)
    cache_key = f"price:{market_id}"
    cached = await _check_cache(cache_key, tool_name)
    if cached:
        return ToolResult(ok=True, tool_name=tool_name, data=cached).to_dict()

    # Try slug-based lookup first
    result = await _gamma_request(
        "/markets",
        {"slug": market_id, "limit": 1},
        tool_name,
    )

    # If slug didn't work, try condition_id
    if result.get("status_code") == 200:
        data = result["data"]
        if isinstance(data, list) and not data:
            result = await _gamma_request(
                "/markets",
                {"conditionId": market_id, "limit": 1},
                tool_name,
            )

    if isinstance(result, dict) and result.get("ok") is False:
        return result

    if result.get("status_code") != 200:
        return classify_http_error(tool_name, result["status_code"]).to_dict()

    data = result["data"]
    market = data[0] if isinstance(data, list) and data else data if isinstance(data, dict) else None

    if not market:
        return business_error(
            tool_name,
            f"Market '{market_id}' not found.",
            {"market_id": market_id},
        ).to_dict()

    # Parse prices
    outcome_prices = market.get("outcomePrices", "")
    yes_price = None
    no_price = None
    try:
        import json as _json
        if isinstance(outcome_prices, str) and outcome_prices:
            prices = _json.loads(outcome_prices)
            if isinstance(prices, list) and len(prices) >= 2:
                yes_price = float(prices[0])
                no_price = float(prices[1])
    except (ValueError, IndexError):
        pass

    if yes_price is None:
        yes_price = float(market.get("bestBid", 0) or 0)
        no_price = 1.0 - yes_price if yes_price else None

    response_data = {
        "question": market.get("question", market.get("title", "")),
        "yes_price": yes_price,
        "no_price": no_price,
        "implied_probability_pct": round(yes_price * 100, 1) if yes_price else None,
        "volume_24h": float(market.get("volume24hr", 0) or 0),
        "liquidity": float(market.get("liquidity", 0) or 0),
        "end_date": market.get("endDate", ""),
        "last_updated": datetime.now(timezone.utc).isoformat(),
    }

    # Cache (5 min for prices)
    await _write_cache(cache_key, response_data, "price", 300)

    return ToolResult(ok=True, tool_name=tool_name, data=response_data).to_dict()


# ============================================================================
# TOOL: get_market_volume
# ============================================================================

MARKET_VOLUME_SCHEMA = {
    "name": "get_market_volume",
    "description": (
        "Get trading volume and liquidity data for a Polymarket market. "
        "High volume indicates strong market conviction and reliable "
        "probability estimates.\n\n"
        "INPUT: market_id (string — condition_id or slug).\n\n"
        "DO NOT USE FOR: Searching markets. Stock volume data."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "market_id": {
                "type": "string",
                "description": "Polymarket condition_id or market slug",
            },
        },
        "required": ["market_id"],
    },
}


async def get_market_volume(market_id: str) -> dict:
    """Get volume and liquidity for a Polymarket market."""
    tool_name = "get_market_volume"

    # Reuse the prices endpoint — it includes volume
    prices_result = await get_market_prices(market_id)

    if isinstance(prices_result, dict) and not prices_result.get("ok", True):
        return prices_result

    data = prices_result.get("data", {})

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "market_id": market_id,
            "question": data.get("question", ""),
            "volume_24h": data.get("volume_24h", 0),
            "liquidity": data.get("liquidity", 0),
            "implied_probability_pct": data.get("implied_probability_pct"),
            "market_confidence": _assess_confidence(
                data.get("volume_24h", 0),
                data.get("liquidity", 0),
            ),
        },
    ).to_dict()


def _assess_confidence(volume_24h: float, liquidity: float) -> str:
    """Assess how reliable a market's probability estimate is based on volume/liquidity."""
    if volume_24h > 100000 and liquidity > 50000:
        return "high"
    elif volume_24h > 10000 and liquidity > 5000:
        return "medium"
    elif volume_24h > 1000:
        return "low"
    return "very_low"


# ============================================================================
# TOOL: match_holdings_to_markets
# ============================================================================

MATCH_HOLDINGS_SCHEMA = {
    "name": "match_holdings_to_markets",
    "description": (
        "Map a list of portfolio holdings to relevant Polymarket prediction "
        "markets. For each ticker, searches Polymarket for related markets "
        "(earnings, regulatory, sector events). Returns matched markets "
        "per ticker with implied probabilities.\n\n"
        "INPUT: tickers (list of strings), include_macro (boolean, default true).\n\n"
        "EXAMPLE: Given ['NVDA', 'BTC', 'GLD'], finds 'NVDA earnings beat?', "
        "'Bitcoin 150k?', 'Fed rate cut?' etc.\n\n"
        "NOTE: Not every ticker will have direct Polymarket coverage. The tool "
        "also searches by company name and sector to find indirect matches.\n\n"
        "DO NOT USE FOR: Getting stock prices. Company news. Insider trades."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "tickers": {
                "type": "array",
                "items": {"type": "string"},
                "description": "List of ticker symbols to match",
            },
            "include_macro": {
                "type": "boolean",
                "description": "Also search for macro markets (Fed, CPI, etc). Default true.",
                "default": True,
            },
        },
        "required": ["tickers"],
    },
}

# Ticker → search terms mapping for better Polymarket matching.
# Each ticker maps to terms that are likely to appear in relevant
# Polymarket market questions. The FIRST term is used as the primary
# search query; the rest are used for relevance filtering.
TICKER_SEARCH_TERMS = {
    # Mega-cap tech
    "NVDA": ["Nvidia", "NVDA", "AI chips", "GPU"],
    "AAPL": ["Apple", "iPhone", "AAPL"],
    "TSLA": ["Tesla", "TSLA", "Elon Musk", "electric vehicle"],
    "GOOGL": ["Google", "Alphabet", "GOOGL"],
    "GOOG": ["Google", "Alphabet", "GOOG"],
    "MSFT": ["Microsoft", "MSFT", "Azure"],
    "AMZN": ["Amazon", "AMZN", "AWS"],
    "META": ["Meta", "Facebook", "META", "Instagram"],
    # Crypto
    "BTC": ["Bitcoin", "BTC", "crypto"],
    "ETH": ["Ethereum", "ETH", "crypto"],
    "SOL": ["Solana", "SOL", "crypto"],
    "BTC-USD": ["Bitcoin", "BTC", "crypto"],
    "ETH-USD": ["Ethereum", "ETH", "crypto"],
    # Crypto-adjacent equities
    "MSTR": ["MicroStrategy", "MSTR", "Bitcoin", "crypto"],
    "COIN": ["Coinbase", "COIN", "crypto"],
    "IREN": ["Iris Energy", "IREN", "Bitcoin mining", "crypto mining"],
    "MARA": ["Marathon Digital", "MARA", "Bitcoin mining", "crypto mining"],
    "RIOT": ["Riot Platforms", "RIOT", "Bitcoin mining", "crypto mining"],
    "CLSK": ["CleanSpark", "CLSK", "Bitcoin mining"],
    # Semiconductors
    "MU": ["Micron", "MU", "memory chips", "semiconductor"],
    "AMD": ["AMD", "Advanced Micro Devices", "GPU", "semiconductor"],
    "INTC": ["Intel", "INTC", "semiconductor"],
    "TSM": ["TSMC", "TSM", "semiconductor"],
    "AVGO": ["Broadcom", "AVGO", "semiconductor"],
    # ETFs / Commodities
    "GLD": ["gold", "gold price"],
    "SLV": ["silver", "silver price"],
    "TLT": ["treasury", "bonds", "interest rate"],
    "QQQ": ["Nasdaq", "tech stocks"],
    "SPY": ["S&P 500", "stock market"],
    # Other popular
    "PLTR": ["Palantir", "PLTR", "government AI"],
    "SMCI": ["Super Micro", "SMCI", "AI server"],
    "ARM": ["ARM Holdings", "ARM", "chip design"],
    "CRM": ["Salesforce", "CRM"],
    "NFLX": ["Netflix", "NFLX"],
    "DIS": ["Disney", "DIS"],
    "BA": ["Boeing", "BA", "aviation"],
    "JPM": ["JPMorgan", "JPM", "banking"],
    "GS": ["Goldman Sachs", "GS", "banking"],
}

MACRO_SEARCH_TERMS = [
    "Fed rate", "interest rate", "CPI inflation",
    "recession", "tariffs", "trade war",
]


async def match_holdings_to_markets(
    tickers: list[str],
    include_macro: bool = True,
) -> dict:
    """Match portfolio holdings to relevant Polymarket markets."""
    tool_name = "match_holdings_to_markets"

    if not tickers:
        return validation_error(tool_name, "At least one ticker is required").to_dict()

    matches = {}
    total_markets_found = 0

    for ticker in tickers[:15]:  # Cap at 15 tickers per call
        ticker = ticker.upper().strip()
        search_terms = TICKER_SEARCH_TERMS.get(ticker, [ticker])

        ticker_markets = []
        for term in search_terms:
            result = await search_polymarket_markets(
                query=term,
                min_volume=500,  # Lower threshold for matching
            )

            if isinstance(result, dict) and result.get("ok"):
                found = result.get("data", {}).get("markets", [])
                for m in found:
                    # Deduplicate by question
                    if not any(existing["question"] == m["question"] for existing in ticker_markets):
                        ticker_markets.append(m)

        matches[ticker] = {
            "markets_found": len(ticker_markets),
            "markets": ticker_markets[:5],  # Top 5 per ticker
        }
        total_markets_found += len(ticker_markets)

    # Add macro markets if requested
    macro_markets = []
    if include_macro:
        for term in MACRO_SEARCH_TERMS:
            result = await search_polymarket_markets(query=term, min_volume=5000)
            if isinstance(result, dict) and result.get("ok"):
                found = result.get("data", {}).get("markets", [])
                for m in found:
                    if not any(existing["question"] == m["question"] for existing in macro_markets):
                        macro_markets.append(m)

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "tickers_searched": len(tickers),
            "total_markets_found": total_markets_found,
            "per_ticker": matches,
            "macro_markets": macro_markets[:10] if macro_markets else [],
            "macro_markets_count": len(macro_markets),
        },
    ).to_dict()


# ============================================================================
# SCHEMA REGISTRY
# ============================================================================

POLYMARKET_TOOL_SCHEMAS = [
    SEARCH_MARKETS_SCHEMA,
    MARKET_PRICES_SCHEMA,
    MARKET_VOLUME_SCHEMA,
    MATCH_HOLDINGS_SCHEMA,
]

POLYMARKET_TOOL_EXECUTORS = {
    "search_polymarket_markets": search_polymarket_markets,
    "get_market_prices": get_market_prices,
    "get_market_volume": get_market_volume,
    "match_holdings_to_markets": match_holdings_to_markets,
}
