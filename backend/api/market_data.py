"""
SignalStack — Market Data Routes

Aggregates data from Alpha Vantage, NewsAPI, Fear & Greed, and Unusual Whales.

Endpoints:
  GET /market-data/fear-greed         — Current Fear & Greed Index
  GET /market-data/technicals/:ticker — RSI, MACD, Bollinger for a ticker
  GET /market-data/headlines          — Top market headlines from NewsAPI
  GET /market-data/congress           — Recent congressional trades
  GET /market-data/options-flow/:ticker — Unusual options activity
"""

import logging
from fastapi import APIRouter, Depends, Query
from backend.models.schemas import APIResponse
from backend.services.auth import get_current_user, CurrentUser
from backend.tools.fear_greed import get_fear_greed
from backend.tools.alpha_vantage import get_technical_indicators
from backend.tools.newsapi import get_market_headlines
from backend.tools.unusual_whales import get_congressional_trades, get_options_flow

logger = logging.getLogger("api.market_data")

router = APIRouter(prefix="/market-data", tags=["market-data"])


@router.get("/fear-greed", response_model=APIResponse)
async def fear_greed_index(
    user: CurrentUser = Depends(get_current_user),
):
    """Get the current Fear & Greed Index (0-100)."""
    result = await get_fear_greed(limit=7)
    if isinstance(result, dict) and result.get("ok"):
        return APIResponse.success(result.get("data", {}))
    return APIResponse.success({"value": None, "classification": "unavailable", "history": []})


@router.get("/technicals/{ticker}", response_model=APIResponse)
async def technicals(
    ticker: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Get RSI, MACD, and Bollinger Bands for a ticker."""
    result = await get_technical_indicators(ticker)
    if isinstance(result, dict) and result.get("ok"):
        return APIResponse.success(result.get("data", {}))
    return APIResponse.success({"ticker": ticker, "rsi": None, "macd": None, "bollinger_bands": None})


@router.get("/headlines", response_model=APIResponse)
async def headlines(
    user: CurrentUser = Depends(get_current_user),
    limit: int = Query(20, ge=1, le=50),
):
    """Get top business/finance headlines from NewsAPI."""
    result = await get_market_headlines(page_size=limit)
    if isinstance(result, dict) and result.get("ok"):
        return APIResponse.success(result.get("data", {}))
    # Fallback already handled in tool — return empty
    return APIResponse.success({"articles": [], "total_results": 0})


@router.get("/congress", response_model=APIResponse)
async def congress_trades(
    user: CurrentUser = Depends(get_current_user),
    limit: int = Query(20, ge=1, le=50),
):
    """Get recent congressional stock trades."""
    result = await get_congressional_trades(limit=limit)
    if isinstance(result, dict) and result.get("ok"):
        return APIResponse.success(result.get("data", {}))
    return APIResponse.success({"trades": [], "count": 0})


@router.get("/options-flow/{ticker}", response_model=APIResponse)
async def options_flow(
    ticker: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Get unusual options activity for a ticker."""
    result = await get_options_flow(ticker)
    if isinstance(result, dict) and result.get("ok"):
        return APIResponse.success(result.get("data", {}))
    return APIResponse.success({"ticker": ticker, "flows": [], "count": 0})
