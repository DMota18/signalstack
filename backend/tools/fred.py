"""
SignalStack — FRED MCP Tools

Provider: Federal Reserve Economic Data (FRED)
Rate limit: 120 calls/min (free tier)
API key: required (api_key query parameter)

Tools:
  get_fred_data        — Fetch economic indicator time series
  get_economic_calendar — Upcoming economic data releases

These tools serve the Macro Agent subagent.
"""

import httpx
import logging
from datetime import datetime, timezone, timedelta
from typing import Optional

from backend.config import get_settings
from backend.tools.base import (
    ToolResult, transient_error, validation_error,
    business_error, permission_error, classify_http_error, retry_with_backoff,
)

logger = logging.getLogger("tools.fred")

FRED_BASE = "https://api.stlouisfed.org/fred"


async def _fred_request(endpoint: str, params: dict, tool_name: str) -> dict:
    """Make an authenticated FRED API request with retry."""
    settings = get_settings()
    if not settings.fred_api_key:
        return permission_error(tool_name, "FRED API key not configured").to_dict()

    params["api_key"] = settings.fred_api_key
    params["file_type"] = "json"

    async def _call():
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(f"{FRED_BASE}{endpoint}", params=params)
            return {"status_code": resp.status_code, "data": resp.json()}

    try:
        result = await retry_with_backoff(_call, max_retries=2, tool_name=tool_name)
        return result
    except httpx.TimeoutException:
        return transient_error(tool_name, "FRED request timeout").to_dict()
    except Exception as e:
        return transient_error(tool_name, f"FRED request failed: {e}").to_dict()


# ============================================================================
# TOOL: get_fred_data
# ============================================================================

FRED_DATA_SCHEMA = {
    "name": "get_fred_data",
    "description": (
        "Fetch economic indicator time series data from FRED (Federal Reserve "
        "Economic Data). Returns the most recent observations for a given series.\n\n"
        "INPUT: series_id (string — must be a valid FRED series ID), "
        "observation_count (integer, default 12, max 100).\n\n"
        "COMMON SERIES IDs:\n"
        "  FEDFUNDS — Federal Funds Effective Rate\n"
        "  CPIAUCSL — Consumer Price Index (All Urban)\n"
        "  UNRATE — Unemployment Rate\n"
        "  GDP — Gross Domestic Product\n"
        "  DGS10 — 10-Year Treasury Yield\n"
        "  DGS2 — 2-Year Treasury Yield\n"
        "  T10Y2Y — 10Y-2Y Treasury Spread (yield curve)\n"
        "  MORTGAGE30US — 30-Year Mortgage Rate\n"
        "  UMCSENT — U. of Michigan Consumer Sentiment\n"
        "  PAYEMS — Total Nonfarm Payrolls\n\n"
        "EXAMPLE QUERIES: 'What is the current Fed funds rate?', "
        "'Show me CPI trend over the last 12 months', "
        "'Is the yield curve inverted?'\n\n"
        "EDGE CASES: Some series update monthly, others weekly or daily. "
        "Missing values are filtered out. Returns business error for "
        "invalid series IDs.\n\n"
        "DO NOT USE FOR: Stock prices (use get_price_data). Company news. "
        "Insider trades. Prediction market data."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "series_id": {
                "type": "string",
                "description": "FRED series ID (e.g. FEDFUNDS, CPIAUCSL, UNRATE)",
            },
            "observation_count": {
                "type": "integer",
                "description": "Number of most recent observations to return. Default 12.",
                "default": 12,
            },
        },
        "required": ["series_id"],
    },
}


async def get_fred_data(series_id: str, observation_count: int = 12) -> dict:
    """Fetch FRED economic data series."""
    tool_name = "get_fred_data"
    series_id = series_id.upper().strip()
    observation_count = min(max(observation_count, 1), 100)

    if not series_id:
        return validation_error(tool_name, "series_id is required").to_dict()

    # First get series metadata
    meta_result = await _fred_request(
        "/series",
        {"series_id": series_id},
        tool_name,
    )

    series_title = ""
    frequency = ""
    units = ""
    if meta_result.get("status_code") == 200 and isinstance(meta_result["data"], dict):
        serieses = meta_result["data"].get("seriess", [])
        if serieses:
            s = serieses[0]
            series_title = s.get("title", "")
            frequency = s.get("frequency", "")
            units = s.get("units", "")

    # Fetch observations
    result = await _fred_request(
        "/series/observations",
        {
            "series_id": series_id,
            "sort_order": "desc",
            "limit": observation_count,
        },
        tool_name,
    )

    if isinstance(result, dict) and result.get("ok") is False:
        return result

    if result.get("status_code") != 200:
        err = result.get("data", {})
        if "error_message" in str(err).lower() and "bad request" in str(err).lower():
            return validation_error(
                tool_name,
                f"Invalid FRED series ID: '{series_id}'. Check the series ID and try again.",
                {"series_id": series_id},
            ).to_dict()
        return classify_http_error(tool_name, result["status_code"]).to_dict()

    data = result["data"]
    observations = data.get("observations", [])

    # Filter out missing values (FRED uses "." for missing)
    valid_obs = []
    for obs in observations:
        val = obs.get("value", ".")
        if val != "." and val is not None:
            try:
                valid_obs.append({
                    "date": obs.get("date", ""),
                    "value": float(val),
                })
            except ValueError:
                continue

    if not valid_obs:
        return business_error(
            tool_name,
            f"No valid observations for series '{series_id}'.",
            {"series_id": series_id},
        ).to_dict()

    # Most recent value first (already sorted desc)
    latest = valid_obs[0] if valid_obs else None

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "series_id": series_id,
            "title": series_title,
            "frequency": frequency,
            "units": units,
            "latest_value": latest["value"] if latest else None,
            "latest_date": latest["date"] if latest else None,
            "observations": valid_obs,
            "observation_count": len(valid_obs),
        },
    ).to_dict()


# ============================================================================
# TOOL: get_economic_calendar
# ============================================================================

ECONOMIC_CALENDAR_SCHEMA = {
    "name": "get_economic_calendar",
    "description": (
        "Get upcoming FRED data release dates for key economic indicators. "
        "Useful for identifying macro events that could impact holdings.\n\n"
        "INPUT: days_ahead (integer, default 14, max 60).\n\n"
        "EXAMPLE QUERIES: 'What economic data is coming out this week?', "
        "'When is the next CPI release?'\n\n"
        "DO NOT USE FOR: Earnings calendar (use earnings_calendar table). "
        "Stock-specific events. Polymarket data."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "days_ahead": {
                "type": "integer",
                "description": "Number of days to look ahead. Default 14.",
                "default": 14,
            },
        },
    },
}

# Key series to track for release dates
KEY_MACRO_SERIES = [
    ("CPIAUCSL", "CPI (Consumer Price Index)"),
    ("UNRATE", "Unemployment Rate"),
    ("PAYEMS", "Nonfarm Payrolls"),
    ("GDP", "GDP"),
    ("FEDFUNDS", "Federal Funds Rate"),
    ("UMCSENT", "Consumer Sentiment"),
    ("RSAFS", "Retail Sales"),
    ("HOUST", "Housing Starts"),
    ("PCE", "Personal Consumption Expenditures"),
]


async def get_economic_calendar(days_ahead: int = 14) -> dict:
    """Get upcoming economic data releases from FRED."""
    tool_name = "get_economic_calendar"
    days_ahead = min(max(days_ahead, 1), 60)

    upcoming = []

    for series_id, label in KEY_MACRO_SERIES:
        result = await _fred_request(
            "/series/release",
            {"series_id": series_id},
            tool_name,
        )

        if result.get("status_code") == 200 and isinstance(result["data"], dict):
            releases = result["data"].get("releases", [])
            if releases:
                # Get the release schedule
                release_id = releases[0].get("id")
                if release_id:
                    dates_result = await _fred_request(
                        "/release/dates",
                        {
                            "release_id": release_id,
                            "include_release_dates_with_no_data": "true",
                        },
                        tool_name,
                    )
                    if dates_result.get("status_code") == 200:
                        release_dates = dates_result["data"].get("release_dates", [])
                        now = datetime.now(timezone.utc).date()
                        cutoff = now + timedelta(days=days_ahead)

                        for rd in release_dates:
                            try:
                                d = datetime.strptime(rd.get("date", ""), "%Y-%m-%d").date()
                                if now <= d <= cutoff:
                                    upcoming.append({
                                        "series_id": series_id,
                                        "indicator": label,
                                        "release_date": rd["date"],
                                        "days_until": (d - now).days,
                                    })
                            except (ValueError, TypeError):
                                continue

    # Sort by date
    upcoming.sort(key=lambda x: x.get("release_date", ""))

    if not upcoming:
        return business_error(
            tool_name,
            f"No upcoming releases found in the next {days_ahead} days.",
        ).to_dict()

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "days_ahead": days_ahead,
            "upcoming_releases": upcoming,
            "count": len(upcoming),
        },
    ).to_dict()


# ============================================================================
# SCHEMA REGISTRY
# ============================================================================

FRED_TOOL_SCHEMAS = [
    FRED_DATA_SCHEMA,
    ECONOMIC_CALENDAR_SCHEMA,
]

FRED_TOOL_EXECUTORS = {
    "get_fred_data": get_fred_data,
    "get_economic_calendar": get_economic_calendar,
}
