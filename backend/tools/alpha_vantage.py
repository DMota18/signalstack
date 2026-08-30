"""
SignalStack — Alpha Vantage MCP Tool

Provider: Alpha Vantage (alphavantage.co)
Rate limit: 25 calls/day (free), 75/min (premium)
Auth: API key in query parameter

Tools:
  get_technical_indicators — RSI, MACD, Bollinger Bands, SMA/EMA for a ticker
"""

import logging

import httpx

from backend.config import get_settings
from backend.tools.base import (
    ToolResult,
    retry_with_backoff,
    transient_error,
    validation_error,
)

logger = logging.getLogger("tools.alpha_vantage")

AV_BASE = "https://www.alphavantage.co/query"


async def _av_request(params: dict, tool_name: str) -> dict:
    """Make an Alpha Vantage API request."""
    settings = get_settings()
    if not settings.alpha_vantage_api_key:
        return {"ok": False, "error": "permission", "message": "Alpha Vantage API key not configured", "tool": tool_name}

    params["apikey"] = settings.alpha_vantage_api_key

    async def _call():
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.get(AV_BASE, params=params)
            return {"status_code": resp.status_code, "data": resp.json()}

    try:
        return await retry_with_backoff(_call, max_retries=1, base_delay=10.0, tool_name=tool_name)
    except httpx.TimeoutException:
        return transient_error(tool_name, "Alpha Vantage request timeout").to_dict()
    except Exception as e:
        return transient_error(tool_name, f"Alpha Vantage request failed: {e}").to_dict()


async def get_technical_indicators(ticker: str) -> dict:
    """Fetch RSI, MACD, and Bollinger Bands for a ticker."""
    tool_name = "get_technical_indicators"
    ticker = ticker.upper().strip()
    if not ticker:
        return validation_error(tool_name, "Ticker is required").to_dict()

    # Fetch RSI, MACD, BBANDS in parallel
    import asyncio

    async def _fetch_rsi():
        return await _av_request({
            "function": "RSI", "symbol": ticker,
            "interval": "daily", "time_period": "14", "series_type": "close",
        }, tool_name)

    async def _fetch_macd():
        return await _av_request({
            "function": "MACD", "symbol": ticker,
            "interval": "daily", "series_type": "close",
        }, tool_name)

    async def _fetch_bbands():
        return await _av_request({
            "function": "BBANDS", "symbol": ticker,
            "interval": "daily", "time_period": "20", "series_type": "close",
        }, tool_name)

    results = await asyncio.gather(
        _fetch_rsi(), _fetch_macd(), _fetch_bbands(),
        return_exceptions=True,
    )

    rsi_result = results[0] if not isinstance(results[0], Exception) else {}
    macd_result = results[1] if not isinstance(results[1], Exception) else {}
    bbands_result = results[2] if not isinstance(results[2], Exception) else {}

    # Parse RSI
    rsi_value = None
    rsi_data = rsi_result.get("data", {}) if isinstance(rsi_result, dict) else {}
    rsi_series = rsi_data.get("Technical Analysis: RSI", {})
    if rsi_series:
        latest_date = next(iter(rsi_series), None)
        if latest_date:
            rsi_value = float(rsi_series[latest_date].get("RSI", 0))

    # Parse MACD
    macd_value = None
    macd_signal = None
    macd_hist = None
    macd_data = macd_result.get("data", {}) if isinstance(macd_result, dict) else {}
    macd_series = macd_data.get("Technical Analysis: MACD", {})
    if macd_series:
        latest_date = next(iter(macd_series), None)
        if latest_date:
            entry = macd_series[latest_date]
            macd_value = float(entry.get("MACD", 0))
            macd_signal = float(entry.get("MACD_Signal", 0))
            macd_hist = float(entry.get("MACD_Hist", 0))

    # Parse Bollinger Bands
    bb_upper = None
    bb_middle = None
    bb_lower = None
    bb_data = bbands_result.get("data", {}) if isinstance(bbands_result, dict) else {}
    bb_series = bb_data.get("Technical Analysis: BBANDS", {})
    if bb_series:
        latest_date = next(iter(bb_series), None)
        if latest_date:
            entry = bb_series[latest_date]
            bb_upper = float(entry.get("Real Upper Band", 0))
            bb_middle = float(entry.get("Real Middle Band", 0))
            bb_lower = float(entry.get("Real Lower Band", 0))

    # Compute signals
    rsi_signal = None
    if rsi_value is not None:
        if rsi_value > 70:
            rsi_signal = "overbought"
        elif rsi_value < 30:
            rsi_signal = "oversold"
        else:
            rsi_signal = "neutral"

    macd_signal_str = None
    if macd_hist is not None:
        macd_signal_str = "bullish" if macd_hist > 0 else "bearish"

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "ticker": ticker,
            "rsi": {"value": rsi_value, "signal": rsi_signal, "period": 14},
            "macd": {
                "value": macd_value, "signal_line": macd_signal,
                "histogram": macd_hist, "signal": macd_signal_str,
            },
            "bollinger_bands": {
                "upper": bb_upper, "middle": bb_middle, "lower": bb_lower,
            },
        },
    ).to_dict()
