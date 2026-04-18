"""
SignalStack — Chart Data Routes

Provides real historical price data for the portfolio performance chart.
Uses Yahoo Finance (yfinance) for free, unlimited candle data covering
stocks, ETFs, crypto, and international securities.

Caching: Results are cached in memory for 15 minutes.
"""

import time
import logging
import pandas as pd
from datetime import datetime, timezone, timedelta
from fastapi import APIRouter, Depends, Query
from backend.models.schemas import APIResponse
from backend.services.auth import get_current_user, CurrentUser
from backend.services.supabase import get_anon_client

logger = logging.getLogger("api.chart")
router = APIRouter(prefix="/chart", tags=["chart"])

_chart_cache: dict[str, tuple[float, list]] = {}
CACHE_TTL = 900


def _get_yf_params(timeframe: str) -> tuple[str, str]:
    """Map timeframe to yfinance period and interval."""
    mapping = {
        "1D": ("1d", "5m"),
        "1W": ("5d", "30m"),
        "1M": ("1mo", "1d"),
        "3M": ("3mo", "1d"),
        "YTD": ("ytd", "1d"),
        "1Y": ("1y", "1d"),
        "ALL": ("5y", "1wk"),
    }
    return mapping.get(timeframe, ("1mo", "1d"))


def _yf_ticker(ticker: str) -> str:
    """Map SignalStack ticker to Yahoo Finance symbol."""
    crypto_map = {
        "BTC": "BTC-USD",
        "ETH": "ETH-USD",
        "SOL": "SOL-USD",
        "XRP": "XRP-USD",
        "DOGE": "DOGE-USD",
    }
    return crypto_map.get(ticker, ticker)


def _format_label(dt: datetime, timeframe: str) -> str:
    """Format a datetime into a human-readable chart label."""
    if timeframe == "1D":
        return dt.strftime("%-I:%M %p") if hasattr(dt, 'strftime') else str(dt)
    elif timeframe == "1W":
        return dt.strftime("%a %-I%p") if hasattr(dt, 'strftime') else str(dt)
    elif timeframe in ("1M", "3M"):
        return dt.strftime("%b %-d") if hasattr(dt, 'strftime') else str(dt)
    elif timeframe in ("YTD", "1Y"):
        return dt.strftime("%b %-d") if hasattr(dt, 'strftime') else str(dt)
    else:
        return dt.strftime("%b %Y") if hasattr(dt, 'strftime') else str(dt)


def _format_label_win(dt, timeframe: str) -> str:
    """Windows-compatible date formatting (no %-d)."""
    try:
        if timeframe == "1D":
            return dt.strftime("%I:%M %p").lstrip("0")
        elif timeframe == "1W":
            return dt.strftime("%a %I%p").replace(" 0", " ")
        elif timeframe in ("1M", "3M", "YTD", "1Y"):
            return dt.strftime("%b %d").replace(" 0", " ")
        else:
            return dt.strftime("%b %Y")
    except Exception:
        return str(dt)


@router.get("/performance", response_model=APIResponse)
async def get_chart_data(
    user: CurrentUser = Depends(get_current_user),
    timeframe: str = Query("1M", regex="^(1D|1W|1M|3M|YTD|1Y|ALL)$"),
    start_date: str = Query(None, description="Custom start date YYYY-MM-DD"),
    end_date: str = Query(None, description="Custom end date YYYY-MM-DD"),
):
    """Get portfolio performance chart data with real price history."""
    cache_key = f"{user.id}:{timeframe}:{start_date}:{end_date}"
    cached = _chart_cache.get(cache_key)
    if cached and (time.time() - cached[0]) < CACHE_TTL:
        return APIResponse.success(cached[1])

    # Get user holdings
    db = get_anon_client()
    holdings_result = await db.select(
        table="holdings",
        columns="ticker,current_price,quantity,market_value,pct_of_portfolio,security_type",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    if holdings_result["status_code"] != 200 or not isinstance(holdings_result["data"], list):
        return APIResponse.fail(message="Failed to fetch holdings", code="fetch_error")

    holdings = holdings_result["data"]
    if not holdings:
        return APIResponse.success([])

    total_value = sum(h.get("market_value") or 0 for h in holdings)
    if total_value <= 0:
        return APIResponse.success([])

    # Import yfinance (lazy import to avoid startup cost)
    try:
        import yfinance as yf
    except ImportError:
        logger.error("yfinance not installed. Run: pip install yfinance")
        return APIResponse.fail(message="Chart data provider not available", code="dependency_error")

    # Get top holdings by weight
    top_holdings = sorted(holdings, key=lambda h: h.get("pct_of_portfolio") or 0, reverse=True)[:10]
    weights = {h["ticker"]: (h.get("pct_of_portfolio") or 0) / 100 for h in top_holdings}

    # Build yfinance tickers
    yf_symbols = [_yf_ticker(h["ticker"]) for h in top_holdings if h["ticker"] not in ("MTPLF",)]
    symbol_to_ticker = {_yf_ticker(h["ticker"]): h["ticker"] for h in top_holdings}

    if not yf_symbols:
        return APIResponse.success([])

    # Fetch data
    period, interval = _get_yf_params(timeframe)

    try:
        if start_date and end_date:
            data = yf.download(
                " ".join(yf_symbols),
                start=start_date,
                end=end_date,
                interval="1d",
                progress=False,
                threads=True,
            )
            effective_timeframe = "1M"
        else:
            data = yf.download(
                " ".join(yf_symbols),
                period=period,
                interval=interval,
                progress=False,
                threads=True,
            )
            effective_timeframe = timeframe

        if data.empty:
            return APIResponse.success([])

    except Exception as e:
        logger.error(f"yfinance download failed: {e}")
        return APIResponse.fail(message="Failed to fetch price data", code="fetch_error")

    # Extract close prices
    try:
        close_raw = data["Close"]
        # Normalize to DataFrame with ticker columns regardless of single/multi
        if isinstance(close_raw, pd.Series):
            close_data = close_raw.to_frame(name=yf_symbols[0])
        elif isinstance(close_raw, pd.DataFrame):
            if len(yf_symbols) == 1 and yf_symbols[0] not in close_raw.columns:
                # Single ticker: yfinance may return flat column names
                close_data = close_raw.rename(columns={close_raw.columns[0]: yf_symbols[0]}) if len(close_raw.columns) == 1 else close_raw
            else:
                close_data = close_raw
        else:
            close_data = pd.DataFrame(close_raw)
    except (KeyError, Exception) as e:
        logger.error(f"Failed to extract Close prices: {e}")
        return APIResponse.success([])

    # Calculate weighted portfolio value at each timestamp.
    #
    # APPROACH: The LAST data point must equal the current total_value
    # from the database (the source of truth). We compute the weighted
    # percentage change at each historical point RELATIVE TO THE LAST
    # DATA POINT, then scale backwards from total_value.
    #
    # This ensures the chart always ends at the real portfolio value
    # regardless of which timeframe is selected.

    chart_data = []
    end_prices = {}  # Latest price per ticker in the series

    for col in close_data.columns:
        last_valid = close_data[col].last_valid_index()
        if last_valid is not None:
            end_prices[col] = float(close_data[col].loc[last_valid])

    for idx, row in close_data.iterrows():
        weighted_return_from_here_to_end = 0.0
        total_weight_covered = 0.0

        for yf_sym in close_data.columns:
            price = row.get(yf_sym) if hasattr(row, 'get') else row[yf_sym] if yf_sym in close_data.columns else None

            try:
                price = float(price)
            except (TypeError, ValueError):
                continue

            if price != price:  # NaN check
                continue

            end_price = end_prices.get(yf_sym)
            if not end_price or end_price <= 0 or price <= 0:
                continue

            # Map back to original ticker for weight lookup
            orig_ticker = symbol_to_ticker.get(yf_sym if isinstance(yf_sym, str) else str(yf_sym))
            weight = weights.get(orig_ticker, 0)

            if weight > 0:
                # How much did this ticker change from THIS point to the END?
                pct_change_to_end = (end_price - price) / price
                weighted_return_from_here_to_end += pct_change_to_end * weight
                total_weight_covered += weight

        if total_weight_covered > 0:
            scaled_return_to_end = weighted_return_from_here_to_end / total_weight_covered
        else:
            scaled_return_to_end = 0

        # Work backwards from total_value: this point's value = total_value / (1 + return_to_end)
        portfolio_value = total_value / (1 + scaled_return_to_end) if (1 + scaled_return_to_end) != 0 else total_value

        # Format the timestamp
        dt = idx.to_pydatetime() if hasattr(idx, 'to_pydatetime') else idx
        label = _format_label_win(dt, effective_timeframe)
        ts = int(dt.timestamp()) if hasattr(dt, 'timestamp') else 0

        chart_data.append({
            "label": label,
            "timestamp": ts,
            "portfolio": round(portfolio_value, 2),
        })

    # Cache
    _chart_cache[cache_key] = (time.time(), chart_data)

    return APIResponse.success(chart_data)


# Market indices cache
_indices_cache: tuple[float, list] = (0, [])
INDICES_CACHE_TTL = 300  # 5 minutes


@router.get("/market-indices", response_model=APIResponse)
async def get_market_indices():
    """Get current market index data for the ticker bar."""
    global _indices_cache

    if _indices_cache[1] and (time.time() - _indices_cache[0]) < INDICES_CACHE_TTL:
        return APIResponse.success(_indices_cache[1])

    try:
        import yfinance as yf

        symbols = {
            "^DJI": "DOW",
            "^IXIC": "NASDAQ",
            "^GSPC": "S&P 500",
            "^VIX": "VIX",
            "BTC-USD": "BTC",
            "GC=F": "Gold",
            "^TNX": "10Y",
        }

        data = yf.download(
            " ".join(symbols.keys()),
            period="2d",
            interval="1d",
            progress=False,
            threads=True,
        )

        if data.empty:
            return APIResponse.success([])

        indices = []
        close = data["Close"]

        for yf_sym, label in symbols.items():
            try:
                if len(close.shape) > 1 and yf_sym in close.columns:
                    col = close[yf_sym].dropna()
                else:
                    col = close.dropna()

                if len(col) >= 2:
                    current = float(col.iloc[-1])
                    prev = float(col.iloc[-2])
                    change = current - prev
                    change_pct = (change / prev * 100) if prev > 0 else 0
                elif len(col) == 1:
                    current = float(col.iloc[-1])
                    change = 0
                    change_pct = 0
                else:
                    continue

                indices.append({
                    "symbol": yf_sym,
                    "label": label,
                    "price": round(current, 2),
                    "change": round(change, 2),
                    "changePct": round(change_pct, 2),
                })
            except Exception as e:
                logger.debug(f"Failed to get index {yf_sym}: {e}")

        _indices_cache = (time.time(), indices)
        return APIResponse.success(indices)

    except Exception as e:
        logger.error(f"Market indices fetch failed: {e}")
        return APIResponse.success([])
