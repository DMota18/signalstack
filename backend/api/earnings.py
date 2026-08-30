"""
SignalStack — Earnings Calendar Routes

Serves the Earnings page in the PWA. Two endpoints:
  GET  /earnings          — Get upcoming earnings for user's holdings
  POST /earnings/refresh  — Trigger a Finnhub refresh for user's tickers
"""

import logging
from datetime import UTC, datetime, timedelta

from fastapi import APIRouter, Depends

from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.supabase import get_anon_client, get_service_client
from backend.tools.finnhub import _finnhub_request

logger = logging.getLogger("api.earnings")

router = APIRouter(prefix="/earnings", tags=["earnings"])


@router.get("", response_model=APIResponse)
async def get_earnings(
    user: CurrentUser = Depends(get_current_user),
):
    """Get upcoming earnings for the user's holdings and watchlist.

    Reads from the earnings_calendar table, filtered to tickers
    the user holds or watches. Returns events in the next 60 days.
    """
    db = get_anon_client()

    # Get user's tickers (holdings + watchlist)
    holdings_res = await db.select(
        table="holdings",
        columns="ticker,security_name",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )
    watchlist_res = await db.select(
        table="watchlist",
        columns="ticker",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    tickers: set[str] = set()
    ticker_names: dict[str, str] = {}
    if holdings_res["status_code"] == 200 and isinstance(holdings_res["data"], list):
        for h in holdings_res["data"]:
            t = h.get("ticker", "")
            if t:
                tickers.add(t)
                if h.get("security_name"):
                    ticker_names[t] = h["security_name"]
    if watchlist_res["status_code"] == 200 and isinstance(watchlist_res["data"], list):
        for w in watchlist_res["data"]:
            if w.get("ticker"):
                tickers.add(w["ticker"])

    if not tickers:
        return APIResponse.success([])

    # Query earnings_calendar for these tickers
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    ticker_filter = ",".join(sorted(tickers))

    earnings_res = await db.select(
        table="earnings_calendar",
        columns="ticker,report_date,report_time,consensus_eps,consensus_revenue,actual_eps,actual_revenue",
        filters={
            "ticker": f"in.({ticker_filter})",
            "report_date": f"gte.{today}",
        },
        order="report_date.asc",
        limit=50,
    )

    earnings = []
    if earnings_res["status_code"] == 200 and isinstance(earnings_res["data"], list):
        for e in earnings_res["data"]:
            days_until = (datetime.strptime(e["report_date"], "%Y-%m-%d") - datetime.now(UTC).replace(hour=0, minute=0, second=0, microsecond=0)).days
            earnings.append({
                **e,
                "security_name": ticker_names.get(e["ticker"], ""),
                "days_until": max(0, days_until),
                "in_portfolio": e["ticker"] in {h.get("ticker") for h in (holdings_res["data"] or [])},
            })

    return APIResponse.success(earnings)


@router.post("/refresh", response_model=APIResponse)
async def refresh_earnings(
    user: CurrentUser = Depends(get_current_user),
):
    """Trigger an on-demand earnings calendar refresh from Finnhub.

    Fetches earnings dates for the user's tickers and upserts
    into the earnings_calendar table. Rate-limited by Finnhub
    (60 calls/min free tier), so we batch carefully.
    """
    db_anon = get_anon_client()
    db_service = get_service_client()

    # Get user's tickers
    holdings_res = await db_anon.select(
        table="holdings",
        columns="ticker",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    tickers: list[str] = []
    if holdings_res["status_code"] == 200 and isinstance(holdings_res["data"], list):
        tickers = list({h["ticker"] for h in holdings_res["data"] if h.get("ticker")})

    if not tickers:
        return APIResponse.success({"refreshed": 0, "message": "No tickers to refresh"})

    # Finnhub earnings calendar endpoint: /calendar/earnings
    # It takes from/to date range, not per-ticker, so one call covers all
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    future = (datetime.now(UTC) + timedelta(days=60)).strftime("%Y-%m-%d")

    result = await _finnhub_request(
        "/calendar/earnings",
        {"from": today, "to": future},
        "refresh_earnings",
    )

    if isinstance(result, dict) and result.get("ok") is False:
        return APIResponse.fail(message="Finnhub request failed", code="finnhub_error")

    if result.get("status_code") != 200:
        return APIResponse.fail(message=f"Finnhub returned {result.get('status_code')}", code="finnhub_error")

    data = result["data"]
    all_earnings = data.get("earningsCalendar", []) if isinstance(data, dict) else []

    # Filter to only the user's tickers
    user_tickers_set = set(t.upper() for t in tickers)
    matched = [e for e in all_earnings if e.get("symbol", "").upper() in user_tickers_set]

    # Upsert into earnings_calendar
    upserted = 0
    for e in matched:
        row = {
            "ticker": e.get("symbol", "").upper(),
            "report_date": e.get("date", ""),
            "report_time": _map_report_time(e.get("hour", "")),
            "consensus_eps": e.get("epsEstimate"),
            "consensus_revenue": e.get("revenueEstimate"),
            "actual_eps": e.get("epsActual"),
            "actual_revenue": e.get("revenueActual"),
        }

        if not row["ticker"] or not row["report_date"]:
            continue

        insert_res = await db_service.insert(
            table="earnings_calendar",
            data=row,
            upsert=True,
            on_conflict="ticker,report_date",
        )

        if insert_res["status_code"] in (200, 201):
            upserted += 1

    return APIResponse.success({
        "refreshed": upserted,
        "total_finnhub_results": len(all_earnings),
        "matched_to_holdings": len(matched),
    })


def _map_report_time(hour_str: str) -> str:
    """Map Finnhub's hour field to readable format."""
    mapping = {
        "bmo": "Before market",
        "amc": "After market",
        "dmh": "During market",
    }
    return mapping.get(hour_str.lower().strip(), "Time TBD")
