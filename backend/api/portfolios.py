"""
SignalStack — Portfolio & Holdings Routes
Read-only for now — data comes from SnapTrade sync (Phase 1).
These endpoints serve the portfolio dashboard in the PWA.
"""

from fastapi import APIRouter, Depends, Query

from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.supabase import get_anon_client

router = APIRouter(prefix="/portfolios", tags=["portfolios"])


@router.get("", response_model=APIResponse)
async def list_portfolios(user: CurrentUser = Depends(get_current_user)):
    """List all portfolios for the current user with brokerage metadata."""
    db = get_anon_client()

    # Get portfolios joined with connection metadata
    result = await db.select(
        table="portfolios",
        columns="id,total_value,cash_balance,day_change_pct,day_change_value,synced_at,connection_id",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        order="created_at.asc",
    )

    if result["status_code"] != 200:
        return APIResponse.fail(message="Failed to fetch portfolios", code="fetch_error")

    portfolios = result["data"] if isinstance(result["data"], list) else []

    # Enrich with connection metadata
    if portfolios:
        conn_ids = [p["connection_id"] for p in portfolios if p.get("connection_id")]
        if conn_ids:
            conns = await db.select(
                table="brokerage_connections",
                columns="id,brokerage_name,account_name,account_type,status",
                filters={"id": f"in.({','.join(conn_ids)})"},
                user_jwt=user.jwt_token,
            )
            conn_map = {}
            if conns["status_code"] == 200 and isinstance(conns["data"], list):
                conn_map = {c["id"]: c for c in conns["data"]}

            for p in portfolios:
                conn = conn_map.get(p.get("connection_id"), {})
                p["brokerage_name"] = conn.get("brokerage_name", "Unknown")
                p["account_name"] = conn.get("account_name")
                p["account_type"] = conn.get("account_type")
                p["connection_status"] = conn.get("status", "unknown")

    return APIResponse.success(portfolios)


@router.get("/{portfolio_id}/holdings", response_model=APIResponse)
async def list_holdings(
    portfolio_id: str,
    user: CurrentUser = Depends(get_current_user),
    sort_by: str = Query("pct_of_portfolio", pattern=r"^(pct_of_portfolio|ticker|market_value|day_gain_pct)$"),
    sort_dir: str = Query("desc", pattern=r"^(asc|desc)$"),
):
    """List all holdings in a portfolio, sorted by weight (default)."""
    db = get_anon_client()
    result = await db.select(
        table="holdings",
        columns=(
            "ticker,security_name,security_type,quantity,avg_cost_basis,"
            "current_price,market_value,pct_of_portfolio,"
            "total_gain_pct,total_gain_value,day_gain_pct,day_gain_value,synced_at"
        ),
        filters={
            "portfolio_id": f"eq.{portfolio_id}",
            "user_id": f"eq.{user.id}",
        },
        user_jwt=user.jwt_token,
        order=f"{sort_by}.{sort_dir}.nullslast",
    )

    if result["status_code"] != 200:
        return APIResponse.fail(message="Failed to fetch holdings", code="fetch_error")

    return APIResponse.success(result["data"] if isinstance(result["data"], list) else [])


@router.get("/all-holdings", response_model=APIResponse)
async def list_all_holdings(user: CurrentUser = Depends(get_current_user)):
    """List all holdings across all portfolios for the current user.
    Enriches with live day-change data from Finnhub quotes."""
    import asyncio

    from backend.tools.coingecko import get_crypto_data
    from backend.tools.finnhub import _finnhub_request

    db = get_anon_client()
    result = await db.select(
        table="holdings",
        columns=(
            "ticker,security_name,security_type,quantity,"
            "avg_cost_basis,current_price,market_value,pct_of_portfolio,"
            "total_gain_pct,total_gain_value,day_gain_pct,day_gain_value,synced_at"
        ),
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        order="pct_of_portfolio.desc.nullslast",
    )

    if result["status_code"] != 200:
        return APIResponse.fail(message="Failed to fetch holdings", code="fetch_error")

    holdings = result["data"] if isinstance(result["data"], list) else []

    if not holdings:
        return APIResponse.success(holdings)

    # ── Enrich with live Finnhub quotes for day change ──
    # Batch fetch quotes in parallel (max 12 to stay under rate limit)
    # Crypto tickers need special handling — Finnhub uses different symbols
    CRYPTO_TICKERS = {"BTC", "ETH", "SOL", "XRP", "DOGE", "ADA", "DOT", "AVAX", "MATIC", "LINK",
                      "BTC-USD", "ETH-USD", "SOL-USD", "XRP-USD", "DOGE-USD"}
    CRYPTO_FINNHUB_MAP = {
        "BTC": "BINANCE:BTCUSDT", "BTC-USD": "BINANCE:BTCUSDT",
        "ETH": "BINANCE:ETHUSDT", "ETH-USD": "BINANCE:ETHUSDT",
        "SOL": "BINANCE:SOLUSDT", "SOL-USD": "BINANCE:SOLUSDT",
        "XRP": "BINANCE:XRPUSDT", "XRP-USD": "BINANCE:XRPUSDT",
        "DOGE": "BINANCE:DOGEUSDT", "DOGE-USD": "BINANCE:DOGEUSDT",
    }

    equity_tickers = [h["ticker"] for h in holdings
                      if h.get("ticker") and h["ticker"].upper() not in CRYPTO_TICKERS][:12]

    async def _fetch_quote(ticker: str) -> tuple[str, dict]:
        try:
            finnhub_sym = CRYPTO_FINNHUB_MAP.get(ticker.upper(), ticker)
            res = await _finnhub_request("/quote", {"symbol": finnhub_sym}, "day_change_enrichment")
            if res.get("status_code") == 200 and isinstance(res.get("data"), dict):
                return (ticker, res["data"])
        except Exception:
            pass
        return (ticker, {})

    quote_results = await asyncio.gather(
        *[_fetch_quote(t) for t in equity_tickers],
        return_exceptions=True,
    )

    # Build lookup: ticker -> {c: current, pc: prev close, dp: day change %}
    quotes: dict[str, dict] = {}
    for item in quote_results:
        if isinstance(item, tuple) and len(item) == 2:
            ticker, data = item
            if data.get("c") and data.get("c") > 0:
                quotes[ticker] = data

    # Enrich holdings — equities from Finnhub, crypto from CoinGecko
    crypto_tickers = [h["ticker"] for h in holdings
                      if h.get("ticker") and h["ticker"].upper() in CRYPTO_TICKERS]

    # Fetch CoinGecko data for crypto holdings in parallel
    async def _fetch_crypto_quote(ticker: str) -> tuple[str, dict]:
        try:
            # Strip -USD suffix for CoinGecko lookup
            clean = ticker.upper().replace("-USD", "")
            result = await get_crypto_data(clean)
            if isinstance(result, dict) and result.get("ok"):
                return (ticker, result.get("data", {}))
        except Exception:
            pass
        return (ticker, {})

    crypto_results = await asyncio.gather(
        *[_fetch_crypto_quote(t) for t in crypto_tickers],
        return_exceptions=True,
    )

    crypto_quotes: dict[str, dict] = {}
    for item in crypto_results:
        if isinstance(item, tuple) and len(item) == 2:
            ticker, data = item
            if data.get("current_price"):
                crypto_quotes[ticker] = data

    for h in holdings:
        ticker = h.get("ticker", "")
        existing_price = h.get("current_price") or 0

        if ticker.upper() in CRYPTO_TICKERS:
            # Enrich crypto from CoinGecko
            cg = crypto_quotes.get(ticker, {})
            if cg:
                current = cg.get("current_price", 0)
                day_pct = cg.get("price_change_pct_24h", 0)
                day_change = cg.get("price_change_24h", 0)

                h["current_price"] = current
                h["day_gain_pct"] = round(day_pct, 2) if day_pct else 0
                h["day_gain_value"] = round(
                    day_change * (h.get("quantity") or 0), 2
                ) if day_change else 0
                h["market_value"] = round(current * (h.get("quantity") or 0), 2)
        else:
            # Enrich equities from Finnhub
            quote = quotes.get(ticker, {})
            if not quote:
                continue

            current = quote.get("c", 0)
            prev_close = quote.get("pc", 0)
            day_pct = quote.get("dp", 0)

            # Sanity check: only overwrite if the Finnhub price is within 50% of
            # the existing price. Prevents garbage data from overwriting good data.
            if existing_price > 0 and current > 0:
                ratio = current / existing_price
                if ratio < 0.5 or ratio > 2.0:
                    continue

            h["current_price"] = current
            h["day_gain_pct"] = round(day_pct, 2) if day_pct else 0
            h["day_gain_value"] = round(
                (current - prev_close) * (h.get("quantity") or 0), 2
            ) if prev_close and current else 0
            h["market_value"] = round(current * (h.get("quantity") or 0), 2)

    return APIResponse.success(holdings)
