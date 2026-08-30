"""
SignalStack — Stock Research API Routes

Comprehensive single-ticker research endpoint that aggregates data
from multiple providers into one unified response. This powers the
Research page — the "come here before you buy" experience.

Data sources (all free):
  - yfinance: fundamentals, financials, analyst data, price history
  - Finnhub: news with sentiment, insider trades, company profile
  - Polymarket: prediction market odds

All providers are called in parallel with graceful degradation.
If any provider fails, the response includes what succeeded.

Endpoints:
  GET /research/{ticker}           — Full research data for a ticker
  GET /research/{ticker}/chart     — Price chart data (separate for caching)
"""

import asyncio
import logging
import time
from datetime import UTC, datetime

from fastapi import APIRouter, Depends, Query
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.supabase import get_service_client
from backend.tools.finnhub import (
    _finnhub_request,
    get_insider_trades,
    get_news_sentiment,
)
from backend.tools.polymarket import TICKER_SEARCH_TERMS, search_polymarket_markets

logger = logging.getLogger("api.research")

router = APIRouter(prefix="/research", tags=["research"])

# ────────────────────────────────────────────────────────────────────────────
# In-memory cache with TTL tiers
# ────────────────────────────────────────────────────────────────────────────

_research_cache: dict[str, tuple[float, dict]] = {}
QUOTE_CACHE_TTL = 120       # 2 min for price data
FUNDAMENTALS_CACHE_TTL = 3600  # 1 hour for fundamentals
NEWS_CACHE_TTL = 600        # 10 min for news


def _get_cached(key: str, ttl: int):
    cached = _research_cache.get(key)
    if cached and (time.time() - cached[0]) < ttl:
        return cached[1]
    return None


def _set_cached(key: str, data: dict):
    _research_cache[key] = (time.time(), data)


# ────────────────────────────────────────────────────────────────────────────
# yfinance data fetchers (run in thread pool since yfinance is sync)
# ────────────────────────────────────────────────────────────────────────────

def _yf_ticker_symbol(ticker: str) -> str:
    """Map SignalStack ticker to Yahoo Finance symbol."""
    crypto_map = {
        "BTC": "BTC-USD", "ETH": "ETH-USD", "SOL": "SOL-USD",
        "XRP": "XRP-USD", "DOGE": "DOGE-USD", "ADA": "ADA-USD",
    }
    return crypto_map.get(ticker.upper(), ticker.upper())


def _fetch_yf_fundamentals(ticker: str) -> dict:
    """Fetch fundamentals from yfinance (synchronous — runs in executor)."""
    try:
        import yfinance as yf
        t = yf.Ticker(_yf_ticker_symbol(ticker))
        info = t.info or {}

        if not info.get("shortName") and not info.get("longName"):
            return {"ok": False, "error": "Ticker not found"}

        return {
            "ok": True,
            "quote": {
                "price": info.get("currentPrice") or info.get("regularMarketPrice", 0),
                "previous_close": info.get("previousClose", 0),
                "open": info.get("open") or info.get("regularMarketOpen", 0),
                "day_high": info.get("dayHigh") or info.get("regularMarketDayHigh", 0),
                "day_low": info.get("dayLow") or info.get("regularMarketDayLow", 0),
                "day_change_pct": info.get("regularMarketChangePercent", 0),
                "volume": info.get("volume") or info.get("regularMarketVolume", 0),
                "avg_volume": info.get("averageVolume", 0),
            },
            "profile": {
                "name": info.get("shortName") or info.get("longName", ""),
                "long_name": info.get("longName", ""),
                "description": info.get("longBusinessSummary", ""),
                "sector": info.get("sector", ""),
                "industry": info.get("industry", ""),
                "country": info.get("country", ""),
                "website": info.get("website", ""),
                "employees": info.get("fullTimeEmployees"),
                "exchange": info.get("exchange", ""),
                "currency": info.get("currency", "USD"),
                "logo_url": info.get("logo_url", ""),
            },
            "fundamentals": {
                "market_cap": info.get("marketCap"),
                "trailing_pe": info.get("trailingPE"),
                "forward_pe": info.get("forwardPE"),
                "trailing_eps": info.get("trailingEps"),
                "forward_eps": info.get("forwardEps"),
                "revenue_ttm": info.get("totalRevenue"),
                "revenue_growth": info.get("revenueGrowth"),
                "ebitda": info.get("ebitda"),
                "profit_margin": info.get("profitMargins"),
                "operating_margin": info.get("operatingMargins"),
                "return_on_equity": info.get("returnOnEquity"),
                "debt_to_equity": info.get("debtToEquity"),
                "current_ratio": info.get("currentRatio"),
                "book_value": info.get("bookValue"),
                "price_to_book": info.get("priceToBook"),
                "beta": info.get("beta"),
                "fifty_two_week_high": info.get("fiftyTwoWeekHigh"),
                "fifty_two_week_low": info.get("fiftyTwoWeekLow"),
                "fifty_day_avg": info.get("fiftyDayAverage"),
                "two_hundred_day_avg": info.get("twoHundredDayAverage"),
                "dividend_yield": info.get("dividendYield"),
                "dividend_rate": info.get("dividendRate"),
                "ex_dividend_date": info.get("exDividendDate"),
                "payout_ratio": info.get("payoutRatio"),
                "next_earnings_date": None,  # Filled from earnings_dates below
            },
            "analyst": {
                "recommendation": info.get("recommendationKey", ""),
                "recommendation_mean": info.get("recommendationMean"),
                "target_mean_price": info.get("targetMeanPrice"),
                "target_high_price": info.get("targetHighPrice"),
                "target_low_price": info.get("targetLowPrice"),
                "num_analyst_opinions": info.get("numberOfAnalystOpinions"),
            },
        }
    except Exception as e:
        logger.error(f"yfinance fundamentals error for {ticker}: {e}")
        return {"ok": False, "error": str(e)}


def _fetch_yf_earnings_history(ticker: str) -> dict:
    """Fetch earnings history from yfinance."""
    try:
        import yfinance as yf
        t = yf.Ticker(_yf_ticker_symbol(ticker))

        # Earnings dates with EPS data
        try:
            ed = t.earnings_dates
            if ed is not None and not ed.empty:
                rows = []
                for idx, row in ed.head(8).iterrows():
                    dt = idx.to_pydatetime() if hasattr(idx, 'to_pydatetime') else idx
                    rows.append({
                        "date": dt.strftime("%Y-%m-%d") if hasattr(dt, 'strftime') else str(dt),
                        "eps_estimate": row.get("EPS Estimate") if not _is_nan(row.get("EPS Estimate")) else None,
                        "reported_eps": row.get("Reported EPS") if not _is_nan(row.get("Reported EPS")) else None,
                        "surprise_pct": row.get("Surprise(%)") if not _is_nan(row.get("Surprise(%)")) else None,
                    })
                return {"ok": True, "earnings": rows}
        except Exception:
            pass

        return {"ok": True, "earnings": []}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _fetch_yf_analyst_recommendations(ticker: str) -> dict:
    """Fetch analyst recommendation trends."""
    try:
        import yfinance as yf
        t = yf.Ticker(_yf_ticker_symbol(ticker))
        recs = t.recommendations
        if recs is not None and not recs.empty:
            recent = recs.tail(4)
            rows = []
            for idx, row in recent.iterrows():
                rows.append({
                    "period": str(idx),
                    "strong_buy": int(row.get("strongBuy", 0)),
                    "buy": int(row.get("buy", 0)),
                    "hold": int(row.get("hold", 0)),
                    "sell": int(row.get("sell", 0)),
                    "strong_sell": int(row.get("strongSell", 0)),
                })
            return {"ok": True, "recommendations": rows}
        return {"ok": True, "recommendations": []}
    except Exception as e:
        return {"ok": False, "error": str(e)}


def _is_nan(val) -> bool:
    """Check if a value is NaN."""
    try:
        import math
        return val is None or (isinstance(val, float) and math.isnan(val))
    except Exception:
        return val is None


def _fetch_yf_financials(ticker: str) -> dict:
    """Fetch financial statements from yfinance — income, balance sheet, cash flow."""
    try:
        import math

        import yfinance as yf
        t = yf.Ticker(_yf_ticker_symbol(ticker))

        def _df_to_list(df, max_periods=5) -> list:
            """Convert a yfinance financial DataFrame to a list of dicts."""
            if df is None or df.empty:
                return []
            rows = []
            for col in list(df.columns)[:max_periods]:
                period_data = {"period": col.strftime("%Y-%m-%d") if hasattr(col, 'strftime') else str(col)}
                for idx, val in df[col].items():
                    key = str(idx).replace(" ", "_").lower()
                    if val is not None and not (isinstance(val, float) and math.isnan(val)):
                        period_data[key] = float(val)
                    else:
                        period_data[key] = None
                rows.append(period_data)
            return rows

        income = _df_to_list(t.financials)
        balance = _df_to_list(t.balance_sheet)
        cashflow = _df_to_list(t.cashflow)

        return {
            "ok": True,
            "income_statement": income,
            "balance_sheet": balance,
            "cash_flow": cashflow,
        }
    except Exception as e:
        logger.error(f"yfinance financials error for {ticker}: {e}")
        return {"ok": False, "income_statement": [], "balance_sheet": [], "cash_flow": []}


def _fetch_yf_institutional(ticker: str) -> dict:
    """Fetch institutional holders and major holders from yfinance."""
    try:
        import math

        import yfinance as yf
        t = yf.Ticker(_yf_ticker_symbol(ticker))

        holders = []
        try:
            ih = t.institutional_holders
            if ih is not None and not ih.empty:
                for _, row in ih.head(10).iterrows():
                    shares = row.get("Shares")
                    value = row.get("Value")
                    pct = row.get("% Out") or row.get("pctHeld")
                    holders.append({
                        "holder": str(row.get("Holder", "")),
                        "shares": int(shares) if shares and not (isinstance(shares, float) and math.isnan(shares)) else None,
                        "value": float(value) if value and not (isinstance(value, float) and math.isnan(value)) else None,
                        "pct_held": float(pct) if pct and not (isinstance(pct, float) and math.isnan(pct)) else None,
                        "date_reported": str(row.get("Date Reported", "")) if row.get("Date Reported") is not None else None,
                    })
        except Exception:
            pass

        major = {}
        try:
            mh = t.major_holders
            if mh is not None and not mh.empty:
                for _, row in mh.iterrows():
                    val = row.iloc[0] if len(row) > 0 else None
                    label = str(row.iloc[1]) if len(row) > 1 else ""
                    if val is not None:
                        major[label] = str(val)
        except Exception:
            pass

        return {"ok": True, "institutional_holders": holders, "major_holders": major}
    except Exception as e:
        logger.error(f"yfinance institutional error for {ticker}: {e}")
        return {"ok": False, "institutional_holders": [], "major_holders": {}}


def _fetch_yf_similar(ticker: str) -> dict:
    """Fetch similar stocks by sector/industry from yfinance info."""
    try:
        import yfinance as yf
        t = yf.Ticker(_yf_ticker_symbol(ticker))
        info = t.info or {}

        sector = info.get("sector", "")
        industry = info.get("industry", "")

        # yfinance doesn't have a built-in "similar stocks" endpoint,
        # but we can use the sector/industry to suggest related tickers
        # from a curated mapping of popular tickers per sector.
        SECTOR_TICKERS = {
            "Technology": ["AAPL", "MSFT", "GOOGL", "META", "NVDA", "AMD", "CRM", "ORCL", "ADBE", "INTC"],
            "Communication Services": ["GOOGL", "META", "NFLX", "DIS", "T", "VZ", "TMUS", "SPOT"],
            "Consumer Cyclical": ["AMZN", "TSLA", "HD", "NKE", "MCD", "SBUX", "TGT", "LOW"],
            "Financial Services": ["JPM", "BAC", "GS", "MS", "V", "MA", "AXP", "BRK-B", "C"],
            "Healthcare": ["JNJ", "UNH", "PFE", "ABBV", "MRK", "LLY", "TMO", "ABT"],
            "Consumer Defensive": ["PG", "KO", "PEP", "WMT", "COST", "CL", "MDLZ"],
            "Energy": ["XOM", "CVX", "COP", "SLB", "EOG", "OXY", "PSX"],
            "Industrials": ["CAT", "DE", "BA", "HON", "UPS", "RTX", "LMT", "GE"],
            "Basic Materials": ["LIN", "APD", "SHW", "FCX", "NEM", "NUE", "DOW"],
            "Real Estate": ["AMT", "PLD", "CCI", "SPG", "O", "EQIX", "DLR"],
            "Utilities": ["NEE", "DUK", "SO", "D", "AEP", "EXC", "SRE"],
        }

        sector_peers = SECTOR_TICKERS.get(sector, [])
        # Remove the current ticker from peers
        similar = [t for t in sector_peers if t.upper() != ticker.upper()][:6]

        return {
            "ok": True,
            "sector": sector,
            "industry": industry,
            "similar_tickers": similar,
        }
    except Exception:
        return {"ok": False, "similar_tickers": []}


# ────────────────────────────────────────────────────────────────────────────
# Finnhub and Polymarket fetchers (already async)
# ────────────────────────────────────────────────────────────────────────────

async def _fetch_news(ticker: str) -> dict:
    """Fetch news from Finnhub."""
    result = await get_news_sentiment(ticker, lookback_days=14)
    if isinstance(result, dict) and result.get("ok"):
        return {"ok": True, "articles": result.get("data", {}).get("articles", [])}
    return {"ok": False, "articles": []}


async def _fetch_insider(ticker: str) -> dict:
    """Fetch insider trades from Finnhub."""
    result = await get_insider_trades(ticker)
    if isinstance(result, dict) and result.get("ok"):
        data = result.get("data", {})
        return {
            "ok": True,
            "trades": data.get("transactions", [])[:10],
            "summary": {
                "total_transactions": data.get("total_transactions", 0),
                "open_market_buys": data.get("open_market_buys", 0),
                "open_market_sells": data.get("open_market_sells", 0),
                "net_buy_value": data.get("net_buy_value", 0),
            },
        }
    return {"ok": False, "trades": [], "summary": {}}


async def _fetch_polymarket(ticker: str) -> dict:
    """Fetch Polymarket markets tagged to this ticker from the local catalog.

    Looks up pre-tagged markets from polymarket_ticker_tags (populated by
    the background sync job). Also includes macro-tagged markets that
    affect all stocks.

    Falls back to the old search-based approach if no tags exist yet.
    """
    db = get_service_client()
    ticker_upper = ticker.upper()

    # Fetch ticker-specific markets
    ticker_result = await db.select(
        table="polymarket_ticker_tags",
        columns="event_id,market_id,event_title,question,yes_price,no_price,volume_24h,total_volume,end_date,polymarket_url",
        filters={"ticker": f"eq.{ticker_upper}", "active": "eq.true"},
        order="volume_24h.desc",
        limit=10,
    )

    # Fetch macro markets (affect everything)
    macro_result = await db.select(
        table="polymarket_ticker_tags",
        columns="event_id,market_id,event_title,question,yes_price,no_price,volume_24h,total_volume,end_date,polymarket_url",
        filters={"ticker": "eq.macro", "active": "eq.true"},
        order="volume_24h.desc",
        limit=6,
    )

    ticker_markets = []
    if ticker_result["status_code"] == 200 and isinstance(ticker_result["data"], list):
        ticker_markets = ticker_result["data"]

    macro_markets = []
    if macro_result["status_code"] == 200 and isinstance(macro_result["data"], list):
        macro_markets = macro_result["data"]

    # If no tagged markets at all, fall back to old search approach
    if not ticker_markets and not macro_markets:
        return await _fetch_polymarket_search_fallback(ticker)

    # Deduplicate by question (a market might be tagged to both the ticker and macro)
    seen_questions: set[str] = set()
    all_markets = []

    for m in ticker_markets + macro_markets:
        q = m.get("question", "")
        if q and q not in seen_questions:
            seen_questions.add(q)
            # Normalize to the format the frontend expects
            all_markets.append({
                "question": q,
                "event_title": m.get("event_title", ""),
                "yes_price": float(m["yes_price"]) if m.get("yes_price") is not None else None,
                "no_price": float(m["no_price"]) if m.get("no_price") is not None else None,
                "volume_24h": float(m.get("volume_24h", 0) or 0),
                "total_volume": float(m.get("total_volume", 0) or 0),
                "end_date": m.get("end_date"),
                "polymarket_url": m.get("polymarket_url", ""),
                "is_macro": m in macro_markets and m not in ticker_markets,
            })

    return {"ok": True, "markets": all_markets[:15], "events": []}


async def _fetch_polymarket_search_fallback(ticker: str) -> dict:
    """Legacy fallback: search Polymarket API directly if no tags exist."""
    search_terms = TICKER_SEARCH_TERMS.get(ticker.upper(), [ticker])
    all_markets = []
    seen_questions: set[str] = set()

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

    return {"ok": True, "markets": all_markets[:10], "events": []}


# ────────────────────────────────────────────────────────────────────────────
# Main research endpoint
# ────────────────────────────────────────────────────────────────────────────

_optional_bearer = HTTPBearer(auto_error=False)


async def _optional_user(
    credentials: HTTPAuthorizationCredentials | None = Depends(_optional_bearer),
) -> CurrentUser | None:
    """Optional auth — returns CurrentUser if authenticated, None if not."""
    if credentials is None:
        return None
    try:
        return await get_current_user(credentials)
    except Exception:
        return None


@router.get("/{ticker}", response_model=APIResponse)
async def get_research(
    ticker: str,
    user: CurrentUser | None = Depends(_optional_user),
):
    """Get comprehensive research data for a single ticker.

    PUBLIC ENDPOINT — works without authentication.
    Authenticated users get the same data (future: personalized annotations).

    Aggregates data from yfinance (fundamentals, analyst, earnings),
    Finnhub (news, insider trades), and Polymarket (prediction odds)
    into one response. All providers called in parallel.
    """
    ticker = ticker.upper().strip()
    if not ticker or len(ticker) > 10:
        return APIResponse.fail(message="Invalid ticker", code="validation_error")

    # Check cache
    cache_key = f"research:{ticker}"
    cached = _get_cached(cache_key, QUOTE_CACHE_TTL)
    if cached:
        return APIResponse.success(cached)

    # ── Run ALL data fetches in parallel ──
    loop = asyncio.get_event_loop()

    # yfinance calls are sync — run in executor
    yf_fundamentals_task = loop.run_in_executor(None, _fetch_yf_fundamentals, ticker)
    yf_earnings_task = loop.run_in_executor(None, _fetch_yf_earnings_history, ticker)
    yf_analyst_task = loop.run_in_executor(None, _fetch_yf_analyst_recommendations, ticker)
    yf_financials_task = loop.run_in_executor(None, _fetch_yf_financials, ticker)
    yf_institutional_task = loop.run_in_executor(None, _fetch_yf_institutional, ticker)
    yf_similar_task = loop.run_in_executor(None, _fetch_yf_similar, ticker)

    # Finnhub + Polymarket are async
    news_task = _fetch_news(ticker)
    insider_task = _fetch_insider(ticker)
    polymarket_task = _fetch_polymarket(ticker)

    # Gather everything
    results = await asyncio.gather(
        yf_fundamentals_task,
        yf_earnings_task,
        yf_analyst_task,
        yf_financials_task,
        yf_institutional_task,
        yf_similar_task,
        news_task,
        insider_task,
        polymarket_task,
        return_exceptions=True,
    )

    yf_fund = results[0] if not isinstance(results[0], Exception) else {"ok": False, "error": str(results[0])}
    yf_earn = results[1] if not isinstance(results[1], Exception) else {"ok": False, "error": str(results[1])}
    yf_recs = results[2] if not isinstance(results[2], Exception) else {"ok": False, "error": str(results[2])}
    yf_fin = results[3] if not isinstance(results[3], Exception) else {"ok": False, "income_statement": [], "balance_sheet": [], "cash_flow": []}
    yf_inst = results[4] if not isinstance(results[4], Exception) else {"ok": False, "institutional_holders": [], "major_holders": {}}
    yf_sim = results[5] if not isinstance(results[5], Exception) else {"ok": False, "similar_tickers": []}
    news = results[6] if not isinstance(results[6], Exception) else {"ok": False, "articles": []}
    insider = results[7] if not isinstance(results[7], Exception) else {"ok": False, "trades": [], "summary": {}}
    polymarket = results[8] if not isinstance(results[8], Exception) else {"ok": False, "markets": []}

    # If yfinance fundamentals completely failed, the ticker likely doesn't exist
    if not yf_fund.get("ok"):
        return APIResponse.fail(
            message=f"Could not find data for ticker '{ticker}'",
            code="ticker_not_found",
        )

    # ── Assemble unified response ──
    response = {
        "ticker": ticker,
        "quote": yf_fund.get("quote", {}),
        "profile": yf_fund.get("profile", {}),
        "fundamentals": yf_fund.get("fundamentals", {}),
        "analyst": {
            **(yf_fund.get("analyst", {})),
            "recommendations_trend": yf_recs.get("recommendations", []) if yf_recs.get("ok") else [],
        },
        "earnings_history": yf_earn.get("earnings", []) if yf_earn.get("ok") else [],
        "news": news.get("articles", []),
        "insider": {
            "trades": insider.get("trades", []),
            "summary": insider.get("summary", {}),
        },
        "polymarket": {
            "markets": polymarket.get("markets", []),
            "events": polymarket.get("events", []),
        },
        "financials": {
            "income_statement": yf_fin.get("income_statement", []) if yf_fin.get("ok") else [],
            "balance_sheet": yf_fin.get("balance_sheet", []) if yf_fin.get("ok") else [],
            "cash_flow": yf_fin.get("cash_flow", []) if yf_fin.get("ok") else [],
        },
        "institutional": {
            "holders": yf_inst.get("institutional_holders", []) if yf_inst.get("ok") else [],
            "major_holders": yf_inst.get("major_holders", {}) if yf_inst.get("ok") else {},
        },
        "similar": {
            "sector": yf_sim.get("sector", "") if yf_sim.get("ok") else "",
            "industry": yf_sim.get("industry", "") if yf_sim.get("ok") else "",
            "tickers": yf_sim.get("similar_tickers", []) if yf_sim.get("ok") else [],
        },
        "providers_status": {
            "yfinance": "ok" if yf_fund.get("ok") else "failed",
            "yfinance_earnings": "ok" if yf_earn.get("ok") else "failed",
            "yfinance_analyst": "ok" if yf_recs.get("ok") else "failed",
            "yfinance_financials": "ok" if yf_fin.get("ok") else "failed",
            "yfinance_institutional": "ok" if yf_inst.get("ok") else "failed",
            "finnhub_news": "ok" if news.get("ok") else "failed",
            "finnhub_insider": "ok" if insider.get("ok") else "failed",
            "polymarket": "ok" if polymarket.get("ok") else "failed",
        },
        "fetched_at": datetime.now(UTC).isoformat(),
    }

    # Cache the response
    _set_cached(cache_key, response)

    return APIResponse.success(response)


# ────────────────────────────────────────────────────────────────────────────
# Price chart endpoint (separate for independent caching)
# ────────────────────────────────────────────────────────────────────────────

@router.get("/{ticker}/chart", response_model=APIResponse)
async def get_research_chart(
    ticker: str,
    timeframe: str = Query("3M", regex="^(1D|1W|1M|3M|6M|1Y|5Y)$"),
    user: CurrentUser | None = Depends(_optional_user),
):
    """Get price chart data for a single ticker. PUBLIC ENDPOINT."""
    ticker = ticker.upper().strip()
    cache_key = f"research_chart:{ticker}:{timeframe}"
    cached = _get_cached(cache_key, QUOTE_CACHE_TTL)
    if cached:
        return APIResponse.success(cached)

    loop = asyncio.get_event_loop()
    chart_data = await loop.run_in_executor(None, _fetch_chart_data, ticker, timeframe)

    if chart_data.get("ok"):
        _set_cached(cache_key, chart_data["data"])
        return APIResponse.success(chart_data["data"])

    return APIResponse.fail(message="Chart data unavailable", code="chart_error")


def _fetch_chart_data(ticker: str, timeframe: str) -> dict:
    """Fetch OHLCV chart data from yfinance."""
    try:

        import yfinance as yf

        period_map = {
            "1D": ("1d", "5m"),
            "1W": ("5d", "30m"),
            "1M": ("1mo", "1d"),
            "3M": ("3mo", "1d"),
            "6M": ("6mo", "1d"),
            "1Y": ("1y", "1d"),
            "5Y": ("5y", "1wk"),
        }
        period, interval = period_map.get(timeframe, ("3mo", "1d"))
        is_intraday = timeframe in ("1D", "1W")

        sym = _yf_ticker_symbol(ticker)
        t = yf.Ticker(sym)
        hist = t.history(period=period, interval=interval)

        if hist.empty:
            return {"ok": False}

        points = []
        seen_dates: set[str] = set()

        for idx, row in hist.iterrows():
            dt = idx.to_pydatetime() if hasattr(idx, 'to_pydatetime') else idx

            # For daily+ data, deduplicate by date (yfinance can return
            # multiple entries for the same calendar day on some intervals)
            if not is_intraday:
                utc_dt = dt.astimezone(UTC) if hasattr(dt, 'astimezone') else dt
                date_key = utc_dt.strftime("%Y-%m-%d")
                if date_key in seen_dates:
                    continue
                seen_dates.add(date_key)

            ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else 0
            points.append({
                "timestamp": ts,
                "label": _format_chart_label(dt, timeframe),
                "open": round(float(row["Open"]), 2),
                "high": round(float(row["High"]), 2),
                "low": round(float(row["Low"]), 2),
                "close": round(float(row["Close"]), 2),
                "volume": int(row.get("Volume", 0)),
            })

        return {"ok": True, "data": points}
    except Exception as e:
        logger.error(f"Chart data error for {ticker}: {e}")
        return {"ok": False, "error": str(e)}


def _format_chart_label(dt, timeframe: str) -> str:
    """Format chart timestamp label."""
    try:
        if timeframe == "1D":
            return dt.strftime("%I:%M %p").lstrip("0")
        elif timeframe == "1W":
            return dt.strftime("%a %I%p").replace(" 0", " ")
        elif timeframe in ("1M", "3M", "6M"):
            return dt.strftime("%b %d").replace(" 0", " ")
        elif timeframe in ("1Y",):
            return dt.strftime("%b %d").replace(" 0", " ")
        else:
            return dt.strftime("%b %Y")
    except Exception:
        return str(dt)


# ────────────────────────────────────────────────────────────────────────────
# Symbol search (autocomplete)
# ────────────────────────────────────────────────────────────────────────────

_search_cache: dict[str, tuple[float, list]] = {}
SEARCH_CACHE_TTL = 300  # 5 min


@router.get("/search/symbols", response_model=APIResponse)
async def search_symbols(
    q: str = Query(..., min_length=1, max_length=50, description="Search query — ticker or company name"),
    user: CurrentUser | None = Depends(_optional_user),
):
    """Search for stock/ETF/crypto symbols by ticker or company name.
    PUBLIC ENDPOINT — powers the search bar on both public and authenticated pages.
    """
    q = q.strip()
    cache_key = f"sym_search:{q.lower()}"

    cached = _search_cache.get(cache_key)
    if cached and (time.time() - cached[0]) < SEARCH_CACHE_TTL:
        return APIResponse.success(cached[1])

    result = await _finnhub_request(
        "/search",
        {"q": q},
        "symbol_search",
    )

    if isinstance(result, dict) and result.get("ok") is False:
        return APIResponse.fail(message="Search failed", code="search_error")

    if result.get("status_code") != 200:
        return APIResponse.fail(message="Finnhub search unavailable", code="finnhub_error")

    data = result.get("data", {})
    raw_results = data.get("result", []) if isinstance(data, dict) else []

    # Filter and normalize — only show stock/ETF security types
    ALLOWED_TYPES = {"Common Stock", "ETP", "ETF", "REIT", "ADR", "Crypto"}

    matches = []
    seen_symbols = set()

    for r in raw_results:
        symbol = r.get("symbol", "")
        display_symbol = r.get("displaySymbol", symbol)
        name = r.get("description", "")
        sec_type = r.get("type", "")

        # Skip duplicates
        if display_symbol in seen_symbols:
            continue

        # Skip non-equity types and foreign exchanges (reduce noise)
        # Allow through if type matches or if no type info (be permissive)
        if sec_type and sec_type not in ALLOWED_TYPES:
            continue

        # Skip tickers with dots/special chars (usually foreign or preferred shares)
        if "." in display_symbol and not display_symbol.endswith("-USD"):
            continue

        seen_symbols.add(display_symbol)
        matches.append({
            "symbol": display_symbol,
            "name": name,
            "type": sec_type,
        })

        if len(matches) >= 8:
            break

    _search_cache[cache_key] = (time.time(), matches)
    return APIResponse.success(matches)
