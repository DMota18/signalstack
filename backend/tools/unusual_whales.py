"""
SignalStack — Unusual Whales Tool

Provider: Unusual Whales (unusualwhales.com)
Rate limit: Per plan
Auth: Bearer token in header

Tools:
  get_congressional_trades — Recent trades by US Congress members
  get_options_flow — Unusual options activity for a ticker
"""

import logging

import httpx

from backend.config import get_settings
from backend.tools.base import (
    ToolResult,
    business_error,
    permission_error,
    retry_with_backoff,
    transient_error,
    validation_error,
)

logger = logging.getLogger("tools.unusual_whales")

UW_BASE = "https://api.unusualwhales.com/api"


async def _uw_request(endpoint: str, params: dict, tool_name: str) -> dict:
    """Make an Unusual Whales API request."""
    settings = get_settings()
    if not settings.unusual_whales_api_key:
        return permission_error(tool_name, "Unusual Whales API key not configured").to_dict()

    async def _call():
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(
                f"{UW_BASE}{endpoint}",
                params=params,
                headers={"Authorization": f"Bearer {settings.unusual_whales_api_key}"},
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    try:
        return await retry_with_backoff(_call, max_retries=1, base_delay=5.0, tool_name=tool_name)
    except httpx.TimeoutException:
        return transient_error(tool_name, "Unusual Whales request timeout").to_dict()
    except Exception as e:
        return transient_error(tool_name, f"Unusual Whales request failed: {e}").to_dict()


async def get_congressional_trades(limit: int = 20) -> dict:
    """Fetch recent congressional stock trades."""
    tool_name = "get_congressional_trades"

    result = await _uw_request("/congress/trades", {"limit": limit}, tool_name)

    if isinstance(result, dict) and result.get("ok") is False:
        return result

    if result.get("status_code") != 200:
        return transient_error(tool_name, f"API error ({result.get('status_code')})").to_dict()

    trades_raw = result["data"]
    if isinstance(trades_raw, dict):
        trades_raw = trades_raw.get("data", trades_raw.get("trades", []))
    if not isinstance(trades_raw, list):
        trades_raw = []

    trades = []
    for t in trades_raw[:limit]:
        trades.append({
            "politician": t.get("politician", t.get("representative", "")),
            "party": t.get("party", ""),
            "state": t.get("state", ""),
            "ticker": t.get("ticker", t.get("asset_ticker", "")),
            "asset_name": t.get("asset_description", t.get("asset_name", "")),
            "transaction_type": t.get("type", t.get("transaction_type", "")),
            "amount_range": t.get("amount", t.get("range", "")),
            "transaction_date": t.get("transaction_date", t.get("traded_at", "")),
            "filing_date": t.get("filing_date", t.get("filed_at", "")),
        })

    return ToolResult(
        ok=True, tool_name=tool_name,
        data={"trades": trades, "count": len(trades)},
    ).to_dict()


async def get_options_flow(ticker: str, limit: int = 15) -> dict:
    """Fetch unusual options activity for a ticker."""
    tool_name = "get_options_flow"
    ticker = ticker.upper().strip()

    if not ticker:
        return validation_error(tool_name, "Ticker is required").to_dict()

    result = await _uw_request(
        f"/stock/{ticker}/options-flow",
        {"limit": limit},
        tool_name,
    )

    if isinstance(result, dict) and result.get("ok") is False:
        return result

    if result.get("status_code") != 200:
        if result.get("status_code") == 404:
            return business_error(tool_name, f"No options flow data for {ticker}").to_dict()
        return transient_error(tool_name, f"API error ({result.get('status_code')})").to_dict()

    flows_raw = result["data"]
    if isinstance(flows_raw, dict):
        flows_raw = flows_raw.get("data", flows_raw.get("flows", []))
    if not isinstance(flows_raw, list):
        flows_raw = []

    flows = []
    for f in flows_raw[:limit]:
        flows.append({
            "ticker": ticker,
            "contract_type": f.get("put_call", f.get("option_type", "")),
            "strike": f.get("strike_price", f.get("strike", 0)),
            "expiration": f.get("expiration_date", f.get("expires_at", "")),
            "volume": f.get("volume", 0),
            "open_interest": f.get("open_interest", 0),
            "premium": f.get("premium", f.get("total_premium", 0)),
            "sentiment": f.get("sentiment", ""),
            "unusual_score": f.get("unusual_score", f.get("score", 0)),
        })

    return ToolResult(
        ok=True, tool_name=tool_name,
        data={"ticker": ticker, "flows": flows, "count": len(flows)},
    ).to_dict()
