"""
SignalStack — Finnhub MCP Tools

Provider: Finnhub (finnhub.io)
Rate limit: 60 calls/min (free tier)
API key: required (X-Finnhub-Token header)

Tools:
  get_price_data       — Equity/ETF current price quote
  get_news_sentiment   — Company news with AI sentiment analysis
  get_insider_trades   — SEC Form 4 insider buying/selling
  get_company_profile  — Company fundamentals and sector info

These tools serve the Sentiment Agent and Insider Agent subagents.
"""

import httpx
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from backend.config import get_settings
from backend.tools.base import (
    ToolResult, ToolError, transient_error, validation_error,
    business_error, classify_http_error, retry_with_backoff,
)

logger = logging.getLogger("tools.finnhub")

FINNHUB_BASE = "https://finnhub.io/api/v1"


async def _finnhub_request(endpoint: str, params: dict, tool_name: str) -> dict:
    """Make an authenticated Finnhub API request with retry."""
    settings = get_settings()
    if not settings.finnhub_api_key:
        return permission_error(tool_name, "Finnhub API key not configured").to_dict()

    params["token"] = settings.finnhub_api_key

    async def _call():
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{FINNHUB_BASE}{endpoint}", params=params)
            return {"status_code": resp.status_code, "data": resp.json()}

    try:
        result = await retry_with_backoff(_call, max_retries=2, tool_name=tool_name)
        return result
    except httpx.TimeoutException:
        return transient_error(tool_name, "Finnhub request timeout").to_dict()
    except Exception as e:
        return transient_error(tool_name, f"Finnhub request failed: {e}").to_dict()


# ============================================================================
# TOOL: get_price_data
# ============================================================================

PRICE_DATA_SCHEMA = {
    "name": "get_price_data",
    "description": (
        "Get the current stock/ETF price quote for a given ticker symbol. "
        "Returns current price, daily change, percentage change, high, low, "
        "open, previous close, and timestamp.\n\n"
        "INPUT: ticker (string, e.g. 'NVDA', 'AAPL', 'GLD', 'SPY').\n\n"
        "EXAMPLE QUERIES: 'What is NVDA trading at?', 'Get me the price of GLD', "
        "'How much did AAPL move today?'\n\n"
        "EDGE CASES: Returns business error for invalid/delisted tickers. "
        "Prices may be delayed 15 min on free tier.\n\n"
        "DO NOT USE FOR: Crypto prices (use get_crypto_data). "
        "Historical price series. News or sentiment. Options data."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "Stock/ETF ticker symbol (e.g. NVDA, AAPL, SPY)",
            },
        },
        "required": ["ticker"],
    },
}


async def get_price_data(ticker: str) -> dict:
    """Fetch current price quote from Finnhub."""
    tool_name = "get_price_data"
    ticker = ticker.upper().strip()

    if not ticker or len(ticker) > 10:
        return validation_error(tool_name, f"Invalid ticker: '{ticker}'").to_dict()

    result = await _finnhub_request("/quote", {"symbol": ticker}, tool_name)

    if isinstance(result, dict) and result.get("ok") is False:
        return result  # Already a ToolError

    if result.get("status_code") != 200:
        return classify_http_error(tool_name, result["status_code"]).to_dict()

    data = result["data"]

    # Finnhub returns c=0 for invalid tickers
    if not data or data.get("c", 0) == 0:
        return business_error(
            tool_name,
            f"No price data for '{ticker}'. The ticker may be invalid, delisted, or not covered.",
            {"ticker": ticker},
        ).to_dict()

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "ticker": ticker,
            "current_price": data.get("c"),
            "change": data.get("d"),
            "change_pct": data.get("dp"),
            "high": data.get("h"),
            "low": data.get("l"),
            "open": data.get("o"),
            "previous_close": data.get("pc"),
            "timestamp": datetime.fromtimestamp(
                data.get("t", 0), tz=timezone.utc
            ).isoformat() if data.get("t") else None,
        },
    ).to_dict()


# ============================================================================
# TOOL: get_news_sentiment
# ============================================================================

NEWS_SENTIMENT_SCHEMA = {
    "name": "get_news_sentiment",
    "description": (
        "Get recent news articles for a company with AI-ready metadata. "
        "Returns headline, source, URL, summary, and publication datetime "
        "for each article, sorted newest first.\n\n"
        "INPUT: ticker (string), lookback_days (integer, default 7, max 30).\n\n"
        "EXAMPLE QUERIES: 'What news is there about NVDA?', "
        "'Recent headlines for AAPL in the last 3 days'\n\n"
        "EDGE CASES: Returns empty list (business category, NOT error) for "
        "tickers with no news coverage. Some small-cap tickers may have "
        "zero articles.\n\n"
        "DO NOT USE FOR: Insider trades (use get_insider_trades). "
        "SEC filings. Macro/economic data. Price quotes."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "Company ticker symbol",
            },
            "lookback_days": {
                "type": "integer",
                "description": "Number of days to look back. Default 7, max 30.",
                "default": 7,
            },
        },
        "required": ["ticker"],
    },
}


async def get_news_sentiment(ticker: str, lookback_days: int = 7) -> dict:
    """Fetch company news from Finnhub."""
    tool_name = "get_news_sentiment"
    ticker = ticker.upper().strip()
    lookback_days = min(max(lookback_days, 1), 30)

    if not ticker:
        return validation_error(tool_name, "Ticker is required").to_dict()

    now = datetime.now(timezone.utc)
    from_date = (now - timedelta(days=lookback_days)).strftime("%Y-%m-%d")
    to_date = now.strftime("%Y-%m-%d")

    result = await _finnhub_request(
        "/company-news",
        {"symbol": ticker, "from": from_date, "to": to_date},
        tool_name,
    )

    if isinstance(result, dict) and result.get("ok") is False:
        return result

    if result.get("status_code") != 200:
        return classify_http_error(tool_name, result["status_code"]).to_dict()

    articles = result["data"]
    if not isinstance(articles, list):
        articles = []

    # Empty results are business category, not errors
    if not articles:
        return business_error(
            tool_name,
            f"No news articles found for '{ticker}' in the last {lookback_days} days.",
            {"ticker": ticker, "lookback_days": lookback_days},
        ).to_dict()

    # Normalize and limit to top 20 articles
    normalized = []
    for a in articles[:20]:
        normalized.append({
            "headline": a.get("headline", ""),
            "source": a.get("source", ""),
            "url": a.get("url", ""),
            "summary": a.get("summary", ""),
            "category": a.get("category", ""),
            "published_at": datetime.fromtimestamp(
                a.get("datetime", 0), tz=timezone.utc
            ).isoformat() if a.get("datetime") else None,
        })

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "ticker": ticker,
            "article_count": len(normalized),
            "lookback_days": lookback_days,
            "articles": normalized,
        },
    ).to_dict()


# ============================================================================
# TOOL: get_insider_trades
# ============================================================================

INSIDER_TRADES_SCHEMA = {
    "name": "get_insider_trades",
    "description": (
        "Get recent SEC Form 4 insider trades for a company. Returns "
        "insider name, title, transaction type (buy/sell/exercise), "
        "shares traded, price, value, and filing date.\n\n"
        "INPUT: ticker (string).\n\n"
        "EXAMPLE QUERIES: 'Have insiders been buying NVDA?', "
        "'Recent insider activity in AAPL'\n\n"
        "EDGE CASES: Returns empty list (business category) for tickers "
        "with no recent Form 4 filings. Foreign-listed companies may "
        "not file Form 4. Transaction codes are mapped to readable names.\n\n"
        "DO NOT USE FOR: Institutional/13F holdings (use get_13f_filings). "
        "Congressional trades. Company news. Price data."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "Company ticker symbol",
            },
        },
        "required": ["ticker"],
    },
}

# SEC transaction code mapping (from v1 bot)
TRANSACTION_CODES = {
    "P": "Open market purchase",
    "S": "Open market sale",
    "A": "Grant/award",
    "D": "Disposition to issuer",
    "F": "Tax withholding",
    "I": "Discretionary transaction",
    "M": "Option exercise",
    "C": "Conversion of derivative",
    "G": "Gift",
    "J": "Other",
    "K": "Equity swap",
    "U": "Disposition to trust",
    "W": "Acquisition by will/laws of descent",
    "X": "Option exercise (out of money)",
    "Z": "Deposit/withdrawal from voting trust",
}


async def get_insider_trades(ticker: str) -> dict:
    """Fetch SEC Form 4 insider trades from Finnhub."""
    tool_name = "get_insider_trades"
    ticker = ticker.upper().strip()

    if not ticker:
        return validation_error(tool_name, "Ticker is required").to_dict()

    # Finnhub insider transactions endpoint
    now = datetime.now(timezone.utc)
    from_date = (now - timedelta(days=90)).strftime("%Y-%m-%d")
    to_date = now.strftime("%Y-%m-%d")

    result = await _finnhub_request(
        "/stock/insider-transactions",
        {"symbol": ticker, "from": from_date, "to": to_date},
        tool_name,
    )

    if isinstance(result, dict) and result.get("ok") is False:
        return result

    if result.get("status_code") != 200:
        return classify_http_error(tool_name, result["status_code"]).to_dict()

    data = result["data"]
    trades = data.get("data", []) if isinstance(data, dict) else []

    if not trades:
        return business_error(
            tool_name,
            f"No insider trades found for '{ticker}' in the last 90 days.",
            {"ticker": ticker},
        ).to_dict()

    normalized = []
    for t in trades[:30]:
        code = t.get("transactionCode", "")
        normalized.append({
            "name": t.get("name", ""),
            "title": t.get("title", ""),  # e.g. "CEO", "CFO", "Director"
            "transaction_type": TRANSACTION_CODES.get(code, code),
            "transaction_code": code,
            "shares": t.get("share", 0),
            "price": t.get("transactionPrice", 0),
            "value": (t.get("share", 0) or 0) * (t.get("transactionPrice", 0) or 0),
            "shares_after": t.get("shareAfter", 0),
            "filing_date": t.get("filingDate", ""),
            "transaction_date": t.get("transactionDate", ""),
        })

    # Compute summary metrics
    buys = [t for t in normalized if t["transaction_code"] == "P"]
    sells = [t for t in normalized if t["transaction_code"] == "S"]

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "ticker": ticker,
            "total_transactions": len(normalized),
            "open_market_buys": len(buys),
            "open_market_sells": len(sells),
            "net_buy_value": sum(t["value"] for t in buys) - sum(t["value"] for t in sells),
            "transactions": normalized,
        },
    ).to_dict()


# ============================================================================
# TOOL: get_company_profile
# ============================================================================

COMPANY_PROFILE_SCHEMA = {
    "name": "get_company_profile",
    "description": (
        "Get fundamental company information: name, sector, industry, "
        "market cap, exchange, country, IPO date, and website URL.\n\n"
        "INPUT: ticker (string).\n\n"
        "EXAMPLE QUERIES: 'What sector is NVDA in?', 'Tell me about AAPL'\n\n"
        "DO NOT USE FOR: Price data (use get_price_data). News. "
        "Insider trades. Financial statements."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "Company ticker symbol",
            },
        },
        "required": ["ticker"],
    },
}


async def get_company_profile(ticker: str) -> dict:
    """Fetch company profile from Finnhub."""
    tool_name = "get_company_profile"
    ticker = ticker.upper().strip()

    result = await _finnhub_request("/stock/profile2", {"symbol": ticker}, tool_name)

    if isinstance(result, dict) and result.get("ok") is False:
        return result

    if result.get("status_code") != 200:
        return classify_http_error(tool_name, result["status_code"]).to_dict()

    data = result["data"]
    if not data or not data.get("name"):
        return business_error(
            tool_name,
            f"No profile found for '{ticker}'.",
            {"ticker": ticker},
        ).to_dict()

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "ticker": data.get("ticker", ticker),
            "name": data.get("name", ""),
            "sector": data.get("finnhubIndustry", ""),
            "market_cap": data.get("marketCapitalization", 0),
            "exchange": data.get("exchange", ""),
            "country": data.get("country", ""),
            "ipo_date": data.get("ipo", ""),
            "website": data.get("weburl", ""),
            "logo": data.get("logo", ""),
            "currency": data.get("currency", "USD"),
        },
    ).to_dict()


# ============================================================================
# SCHEMA REGISTRY
# ============================================================================

FINNHUB_TOOL_SCHEMAS = [
    PRICE_DATA_SCHEMA,
    NEWS_SENTIMENT_SCHEMA,
    INSIDER_TRADES_SCHEMA,
    COMPANY_PROFILE_SCHEMA,
]

FINNHUB_TOOL_EXECUTORS = {
    "get_price_data": get_price_data,
    "get_news_sentiment": get_news_sentiment,
    "get_insider_trades": get_insider_trades,
    "get_company_profile": get_company_profile,
}
