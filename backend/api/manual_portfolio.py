"""
SignalStack — Manual Portfolio Routes

Allows users to manually add, edit, and remove holdings without
connecting a brokerage via SnapTrade. This serves as:
  1. A backup for users who don't want to connect their brokerage
  2. A quick onboarding path for beta testers
  3. A way to add holdings from brokerages SnapTrade doesn't support

Manual holdings are stored in the same tables as SnapTrade-synced
holdings. A "manual" brokerage connection record is created to
maintain the same data model.
"""

import asyncio
import logging
from concurrent.futures import ThreadPoolExecutor

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from typing import Optional
from datetime import datetime, timezone

from backend.models.schemas import APIResponse
from backend.services.auth import get_current_user, CurrentUser
from backend.services.supabase import get_service_client, get_anon_client

logger = logging.getLogger("api.manual_portfolio")

_price_executor = ThreadPoolExecutor(max_workers=4)


def _fetch_price_sync(ticker: str) -> Optional[float]:
    """Synchronous price fetch via yfinance. Runs in thread pool."""
    try:
        import yfinance as yf
        crypto_map = {"BTC": "BTC-USD", "ETH": "ETH-USD", "SOL": "SOL-USD",
                      "XRP": "XRP-USD", "DOGE": "DOGE-USD", "ADA": "ADA-USD",
                      "DOT": "DOT-USD", "AVAX": "AVAX-USD", "MATIC": "MATIC-USD",
                      "LINK": "LINK-USD"}
        yf_sym = crypto_map.get(ticker, ticker)
        t = yf.Ticker(yf_sym)
        info = t.fast_info
        price = getattr(info, 'last_price', None) or getattr(info, 'previous_close', None)
        if price and price > 0:
            return round(float(price), 4)
    except Exception as e:
        logger.debug(f"Price fetch failed for {ticker}: {e}")
    return None


async def _fetch_current_price(ticker: str) -> Optional[float]:
    """Fetch the current price for a ticker. Runs yfinance in a thread pool to avoid blocking."""
    loop = asyncio.get_event_loop()
    return await loop.run_in_executor(_price_executor, _fetch_price_sync, ticker)

router = APIRouter(prefix="/manual-portfolio", tags=["manual-portfolio"])


class ManualHolding(BaseModel):
    """A manually entered holding."""
    ticker: str = Field(min_length=1, max_length=10, pattern=r"^[A-Z0-9.\-]+$")
    security_name: Optional[str] = None
    security_type: str = Field(default="equity", pattern=r"^(equity|etf|crypto|option|mutual_fund|bond|other)$")
    quantity: float = Field(gt=0)
    avg_cost_basis: Optional[float] = None
    current_price: Optional[float] = None


class ManualHoldingUpdate(BaseModel):
    """Update fields for an existing manual holding."""
    quantity: Optional[float] = Field(None, gt=0)
    avg_cost_basis: Optional[float] = None
    current_price: Optional[float] = None
    security_name: Optional[str] = None


# ============================================================================
# ENSURE MANUAL CONNECTION EXISTS
# ============================================================================

async def _ensure_manual_connection(user_id: str) -> str:
    """Ensure a 'manual' brokerage connection record exists for this user.
    Returns the connection_id and portfolio_id."""
    db = get_service_client()

    # Check if manual connection already exists
    result = await db.select(
        table="brokerage_connections",
        columns="id",
        filters={"user_id": f"eq.{user_id}", "brokerage_slug": "eq.manual"},
    )

    if result["status_code"] == 200 and isinstance(result["data"], list) and result["data"]:
        connection_id = result["data"][0]["id"]
    else:
        # Create manual connection
        conn_result = await db.insert(
            table="brokerage_connections",
            data={
                "user_id": user_id,
                "snaptrade_user_id": "manual",
                "snaptrade_user_secret": "manual",
                "brokerage_name": "Manual entry",
                "brokerage_slug": "manual",
                "account_id": f"manual-{user_id[:8]}",
                "account_name": "My Portfolio",
                "account_type": "brokerage",
                "status": "active",
            },
        )
        if conn_result["status_code"] in (200, 201):
            data = conn_result["data"]
            connection_id = data[0]["id"] if isinstance(data, list) else data["id"]
        else:
            return None, None

    # Ensure portfolio exists
    port_result = await db.select(
        table="portfolios",
        columns="id",
        filters={"connection_id": f"eq.{connection_id}"},
    )

    if port_result["status_code"] == 200 and isinstance(port_result["data"], list) and port_result["data"]:
        portfolio_id = port_result["data"][0]["id"]
    else:
        port_insert = await db.insert(
            table="portfolios",
            data={
                "user_id": user_id,
                "connection_id": connection_id,
                "total_value": 0,
                "cash_balance": 0,
                "synced_at": datetime.now(timezone.utc).isoformat(),
            },
        )
        if port_insert["status_code"] in (200, 201):
            data = port_insert["data"]
            portfolio_id = data[0]["id"] if isinstance(data, list) else data["id"]
        else:
            return connection_id, None

    return connection_id, portfolio_id


async def _recalculate_portfolio(user_id: str, portfolio_id: str):
    """Recalculate portfolio totals and holding percentages."""
    db = get_service_client()

    # Get all holdings for this portfolio
    result = await db.select(
        table="holdings",
        columns="id,quantity,current_price,market_value",
        filters={"portfolio_id": f"eq.{portfolio_id}"},
    )

    if result["status_code"] != 200 or not isinstance(result["data"], list):
        return

    holdings = result["data"]
    total_value = sum(h.get("market_value") or 0 for h in holdings)

    # Update each holding's percentage
    for h in holdings:
        mv = h.get("market_value") or 0
        pct = (mv / total_value * 100) if total_value > 0 else 0
        await db.update(
            table="holdings",
            data={"pct_of_portfolio": round(pct, 3)},
            filters={"id": f"eq.{h['id']}"},
        )

    # Update portfolio total
    await db.update(
        table="portfolios",
        data={
            "total_value": round(total_value, 2),
            "synced_at": datetime.now(timezone.utc).isoformat(),
        },
        filters={"id": f"eq.{portfolio_id}"},
    )


# ============================================================================
# ROUTES
# ============================================================================

@router.post("/holdings", response_model=APIResponse)
async def add_holding(
    holding: ManualHolding,
    user: CurrentUser = Depends(get_current_user),
):
    """Manually add a holding to your portfolio."""
    db = get_service_client()

    connection_id, portfolio_id = await _ensure_manual_connection(user.id)
    if not portfolio_id:
        return APIResponse.fail(message="Failed to create portfolio", code="create_error")

    ticker = holding.ticker.upper()

    # Auto-fetch price if not provided
    current_price = holding.current_price
    if not current_price:
        fetched = await _fetch_current_price(ticker)
        if fetched:
            current_price = fetched

    market_value = (holding.quantity * current_price) if current_price else 0

    result = await db.insert(
        table="holdings",
        data={
            "portfolio_id": portfolio_id,
            "user_id": user.id,
            "ticker": ticker,
            "security_name": holding.security_name or "",
            "security_type": holding.security_type,
            "quantity": holding.quantity,
            "avg_cost_basis": holding.avg_cost_basis,
            "current_price": current_price,
            "market_value": round(market_value, 2),
            "pct_of_portfolio": 0,  # Recalculated below
            "synced_at": datetime.now(timezone.utc).isoformat(),
        },
        upsert=True,
        on_conflict="portfolio_id,ticker",
    )

    if result["status_code"] not in (200, 201):
        return APIResponse.fail(message="Failed to add holding", code="insert_error")

    # Recalculate percentages
    await _recalculate_portfolio(user.id, portfolio_id)

    return APIResponse.success({
        "ticker": ticker,
        "quantity": holding.quantity,
        "message": f"Added {holding.quantity} shares of {ticker}",
    })


@router.put("/holdings/{ticker}", response_model=APIResponse)
async def update_holding(
    ticker: str,
    update: ManualHoldingUpdate,
    user: CurrentUser = Depends(get_current_user),
):
    """Update an existing manual holding."""
    db = get_service_client()
    ticker = ticker.upper()

    # Find the holding
    result = await db.select(
        table="holdings",
        columns="id,portfolio_id,quantity,current_price",
        filters={"user_id": f"eq.{user.id}", "ticker": f"eq.{ticker}"},
    )

    if result["status_code"] != 200 or not result["data"]:
        return APIResponse.fail(message=f"Holding {ticker} not found", code="not_found")

    holding = result["data"][0] if isinstance(result["data"], list) else result["data"]

    # Build update data
    data = {}
    qty = update.quantity or holding.get("quantity", 0)
    price = update.current_price if update.current_price is not None else holding.get("current_price", 0)

    if update.quantity is not None:
        data["quantity"] = update.quantity
    if update.avg_cost_basis is not None:
        data["avg_cost_basis"] = update.avg_cost_basis
    if update.current_price is not None:
        data["current_price"] = update.current_price
    if update.security_name is not None:
        data["security_name"] = update.security_name

    data["market_value"] = round(qty * (price or 0), 2)
    data["synced_at"] = datetime.now(timezone.utc).isoformat()

    if not data:
        return APIResponse.fail(message="No fields to update", code="validation_error")

    await db.update(
        table="holdings",
        data=data,
        filters={"id": f"eq.{holding['id']}"},
    )

    # Recalculate percentages
    await _recalculate_portfolio(user.id, holding["portfolio_id"])

    return APIResponse.success({"ticker": ticker, "message": f"Updated {ticker}"})


@router.delete("/holdings/{ticker}", response_model=APIResponse)
async def remove_holding(
    ticker: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Remove a holding from your manual portfolio."""
    db = get_service_client()
    ticker = ticker.upper()

    # Find the holding to get portfolio_id
    result = await db.select(
        table="holdings",
        columns="id,portfolio_id",
        filters={"user_id": f"eq.{user.id}", "ticker": f"eq.{ticker}"},
    )

    if result["status_code"] != 200 or not result["data"]:
        return APIResponse.fail(message=f"Holding {ticker} not found", code="not_found")

    holding = result["data"][0] if isinstance(result["data"], list) else result["data"]
    portfolio_id = holding["portfolio_id"]

    await db.delete(
        table="holdings",
        filters={"id": f"eq.{holding['id']}"},
    )

    # Recalculate percentages
    await _recalculate_portfolio(user.id, portfolio_id)

    return APIResponse.success({"ticker": ticker, "message": f"Removed {ticker}"})


@router.post("/bulk", response_model=APIResponse)
async def bulk_add_holdings(
    holdings: list[ManualHolding],
    user: CurrentUser = Depends(get_current_user),
):
    """Add multiple holdings at once. Useful for initial portfolio setup.
    
    Example body:
    [
      {"ticker": "NVDA", "quantity": 45, "current_price": 142.50, "security_type": "equity"},
      {"ticker": "AAPL", "quantity": 30, "current_price": 198.30, "security_type": "equity"},
      {"ticker": "BTC", "quantity": 0.5, "current_price": 97420, "security_type": "crypto"}
    ]
    """
    if len(holdings) > 50:
        return APIResponse.fail(message="Maximum 50 holdings per request", code="validation_error")

    db = get_service_client()
    connection_id, portfolio_id = await _ensure_manual_connection(user.id)
    if not portfolio_id:
        return APIResponse.fail(message="Failed to create portfolio", code="create_error")

    added = []
    errors = []

    for h in holdings:
        ticker = h.ticker.upper()
        current_price = h.current_price
        if not current_price:
            fetched = await _fetch_current_price(ticker)
            if fetched:
                current_price = fetched
        market_value = (h.quantity * current_price) if current_price else 0

        result = await db.insert(
            table="holdings",
            data={
                "portfolio_id": portfolio_id,
                "user_id": user.id,
                "ticker": ticker,
                "security_name": h.security_name or "",
                "security_type": h.security_type,
                "quantity": h.quantity,
                "avg_cost_basis": h.avg_cost_basis,
                "current_price": current_price,
                "market_value": round(market_value, 2),
                "pct_of_portfolio": 0,
                "synced_at": datetime.now(timezone.utc).isoformat(),
            },
            upsert=True,
            on_conflict="portfolio_id,ticker",
        )

        if result["status_code"] in (200, 201):
            added.append(ticker)
        else:
            errors.append(f"{ticker}: failed to add")

    # Recalculate all percentages
    await _recalculate_portfolio(user.id, portfolio_id)

    return APIResponse.success({
        "added": added,
        "count": len(added),
        "errors": errors,
    })


@router.post("/refresh-prices", response_model=APIResponse)
async def refresh_prices(
    user: CurrentUser = Depends(get_current_user),
):
    """Refresh current prices for all holdings via yfinance."""
    db = get_service_client()

    result = await db.select(
        table="holdings",
        columns="id,ticker,quantity,portfolio_id",
        filters={"user_id": f"eq.{user.id}"},
    )

    if result["status_code"] != 200 or not isinstance(result["data"], list):
        return APIResponse.fail(message="Failed to fetch holdings", code="fetch_error")

    holdings = result["data"]
    if not holdings:
        return APIResponse.success({"updated": 0})

    updated = 0
    portfolio_ids = set()

    for h in holdings:
        price = await _fetch_current_price(h["ticker"])
        if price:
            mv = round(h["quantity"] * price, 2)
            await db.update(
                table="holdings",
                data={
                    "current_price": price,
                    "market_value": mv,
                    "synced_at": datetime.now(timezone.utc).isoformat(),
                },
                filters={"id": f"eq.{h['id']}"},
            )
            updated += 1
            portfolio_ids.add(h["portfolio_id"])

    # Recalculate percentages for each affected portfolio
    for pid in portfolio_ids:
        await _recalculate_portfolio(user.id, pid)

    return APIResponse.success({"updated": updated, "total": len(holdings)})
