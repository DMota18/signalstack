"""
SignalStack — Brokerage Connection Routes

Manages the SnapTrade connection lifecycle:
  POST /connections/register   — Register user with SnapTrade + get portal URL
  GET  /connections             — List all connected brokerages
  POST /connections/sync        — Trigger a manual portfolio sync
  DELETE /connections/{id}      — Disconnect a brokerage
"""

from fastapi import APIRouter, Depends

from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.snaptrade import SnapTradeService, sync_user_holdings
from backend.services.supabase import get_anon_client, get_service_client

router = APIRouter(prefix="/connections", tags=["connections"])


@router.post("/register", response_model=APIResponse)
async def register_and_connect(
    user: CurrentUser = Depends(get_current_user),
    broker: str = None,
):
    """Register the user with SnapTrade (if not already) and return
    a Connection Portal URL where they can link their brokerage.

    The user visits the returned URL in their browser, completes the
    OAuth flow with their brokerage, and is redirected back to the app.

    Args:
        broker: Optional broker slug to skip selection (e.g. "robinhood", "fidelity")
    """
    svc = SnapTradeService()
    db = get_service_client()

    # Check if user is already registered with SnapTrade
    existing = await db.select(
        table="brokerage_connections",
        columns="snaptrade_user_id,snaptrade_user_secret",
        filters={"user_id": f"eq.{user.id}"},
        limit=1,
    )

    st_user_id = user.id  # We use SignalStack's user ID as SnapTrade's userId
    st_user_secret = None

    if existing["status_code"] == 200 and isinstance(existing["data"], list) and existing["data"]:
        # Already registered — decrypt the stored secret
        st_user_secret = svc.decrypt_secret(existing["data"][0]["snaptrade_user_secret"])
    else:
        # Register new SnapTrade user
        reg_result = await svc.register_user(st_user_id)

        if reg_result["status_code"] not in (200, 201):
            # Check if user already exists (SnapTrade returns 200 for re-registration)
            error_msg = reg_result["data"].get("message", str(reg_result["data"]))
            return APIResponse.fail(
                message=f"SnapTrade registration failed: {error_msg}",
                code="snaptrade_error",
            )

        st_user_secret = reg_result["data"].get("userSecret")
        if not st_user_secret:
            return APIResponse.fail(
                message="SnapTrade did not return a userSecret",
                code="snaptrade_error",
            )

    # Generate Connection Portal URL
    # Use the app's origin as the redirect so the user lands back on Settings
    from backend.config import get_settings as _get_settings
    _settings = _get_settings()
    redirect_base = "http://localhost:3000" if _settings.debug else "https://signalstack.app"
    redirect_url = f"{redirect_base}/app/settings?status=success"

    portal_result = await svc.get_connection_portal_url(
        user_id=st_user_id,
        user_secret=st_user_secret,
        broker=broker,
        custom_redirect=redirect_url,
    )

    if portal_result["status_code"] != 200:
        return APIResponse.fail(
            message="Failed to generate connection portal URL",
            code="snaptrade_error",
            details=portal_result["data"],
        )

    redirect_uri = portal_result["data"].get("redirectURI", portal_result["data"].get("loginLink"))

    if not redirect_uri:
        return APIResponse.fail(
            message="SnapTrade did not return a redirect URL",
            code="snaptrade_error",
        )

    # Store the encrypted user secret for later use (if new registration)
    # This is a temporary hold — the full brokerage_connections record is
    # created after the user completes the OAuth flow and we detect the
    # new connection via list_accounts.
    if not (existing["status_code"] == 200 and existing["data"]):
        # We'll store a placeholder connection record so we have the encrypted secret
        # The real connection details get filled in after the OAuth callback
        encrypted_secret = svc.encrypt_secret(st_user_secret)
        await db.insert(
            table="brokerage_connections",
            data={
                "user_id": user.id,
                "snaptrade_user_id": st_user_id,
                "snaptrade_user_secret": encrypted_secret,
                "brokerage_name": broker or "pending",
                "brokerage_slug": broker or "pending",
                "account_id": "pending",
                "status": "disconnected",
            },
        )

    return APIResponse.success({
        "redirect_url": redirect_uri,
        "message": "Open this URL to connect your brokerage account.",
    })


@router.post("/callback", response_model=APIResponse)
async def connection_callback(
    user: CurrentUser = Depends(get_current_user),
):
    """Called after the user completes the SnapTrade Connection Portal flow.

    Fetches the newly connected accounts from SnapTrade and creates/updates
    the brokerage_connections records with real account data.
    """
    svc = SnapTradeService()
    db = get_service_client()

    # Get stored SnapTrade credentials
    conn_result = await db.select(
        table="brokerage_connections",
        columns="id,snaptrade_user_id,snaptrade_user_secret",
        filters={"user_id": f"eq.{user.id}"},
        limit=1,
    )

    if conn_result["status_code"] != 200 or not conn_result["data"]:
        return APIResponse.fail(message="No SnapTrade registration found", code="not_found")

    conn = conn_result["data"][0] if isinstance(conn_result["data"], list) else conn_result["data"]
    st_user_id = conn["snaptrade_user_id"]
    st_user_secret = svc.decrypt_secret(conn["snaptrade_user_secret"])
    encrypted_secret = conn["snaptrade_user_secret"]

    # Fetch all accounts from SnapTrade
    accounts_result = await svc.list_accounts(st_user_id, st_user_secret)

    if accounts_result["status_code"] != 200:
        return APIResponse.fail(
            message="Failed to fetch accounts from SnapTrade",
            code="snaptrade_error",
            details=accounts_result["data"],
        )

    accounts = accounts_result["data"]
    if not isinstance(accounts, list):
        accounts = [accounts] if accounts else []

    created_connections = []

    for acct in accounts:
        account_id = acct.get("id", acct.get("accountId", ""))
        brokerage = acct.get("brokerage", acct.get("institution", {}))
        if isinstance(brokerage, dict):
            brokerage_name = brokerage.get("name", "Unknown")
            brokerage_slug = brokerage.get("slug", "unknown")
        else:
            brokerage_name = str(brokerage)
            brokerage_slug = str(brokerage).lower().replace(" ", "-")

        account_name = acct.get("name", acct.get("account_name", ""))
        account_type = acct.get("type", acct.get("account_type", "brokerage"))

        # Upsert connection record (update the placeholder or create new)
        conn_data = {
            "user_id": user.id,
            "snaptrade_user_id": st_user_id,
            "snaptrade_user_secret": encrypted_secret,
            "brokerage_name": brokerage_name,
            "brokerage_slug": brokerage_slug,
            "account_id": str(account_id),
            "account_name": account_name,
            "account_type": str(account_type) if account_type else "brokerage",
            "status": "active",
        }

        # Try to update existing placeholder first
        update_result = await db.update(
            table="brokerage_connections",
            data=conn_data,
            filters={
                "user_id": f"eq.{user.id}",
                "account_id": f"in.(pending,{account_id})",
            },
        )

        if update_result["status_code"] == 200 and update_result["data"]:
            row = update_result["data"]
            created_connections.append(row[0] if isinstance(row, list) else row)
        else:
            # Insert new connection
            insert_result = await db.insert(
                table="brokerage_connections",
                data=conn_data,
            )
            if insert_result["status_code"] in (200, 201):
                row = insert_result["data"]
                created_connections.append(row[0] if isinstance(row, list) else row)

    # Trigger initial sync
    sync_result = await sync_user_holdings(user.id)

    return APIResponse.success({
        "connections": len(created_connections),
        "accounts": [
            {
                "brokerage": c.get("brokerage_name"),
                "account_name": c.get("account_name"),
                "status": c.get("status"),
            }
            for c in created_connections
        ],
        "initial_sync": sync_result,
    })


@router.get("", response_model=APIResponse)
async def list_connections(user: CurrentUser = Depends(get_current_user)):
    """List all brokerage connections for the current user."""
    db = get_anon_client()
    result = await db.select(
        table="brokerage_connections",
        columns=(
            "id,brokerage_name,brokerage_slug,account_name,account_type,"
            "status,last_sync_at,created_at"
        ),
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        order="created_at.asc",
    )

    if result["status_code"] != 200:
        return APIResponse.fail(message="Failed to fetch connections", code="fetch_error")

    return APIResponse.success(result["data"] if isinstance(result["data"], list) else [])


@router.post("/sync", response_model=APIResponse)
async def trigger_sync(user: CurrentUser = Depends(get_current_user)):
    """Manually trigger a portfolio sync from SnapTrade.
    Fetches latest holdings and updates the database."""
    sync_result = await sync_user_holdings(user.id)

    if sync_result["errors"]:
        return APIResponse.success({
            "status": "partial",
            "accounts_synced": sync_result["accounts_synced"],
            "holdings_synced": sync_result["holdings_synced"],
            "errors": sync_result["errors"],
        })

    return APIResponse.success({
        "status": "complete",
        "accounts_synced": sync_result["accounts_synced"],
        "holdings_synced": sync_result["holdings_synced"],
    })


@router.delete("/{connection_id}", response_model=APIResponse)
async def disconnect(
    connection_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Disconnect a brokerage. Removes the connection and associated
    portfolio/holdings data from SignalStack. Does NOT delete the
    user's SnapTrade account (they can reconnect later)."""
    db = get_service_client()

    # Verify the connection belongs to this user
    conn_result = await db.select(
        table="brokerage_connections",
        columns="id,snaptrade_user_id,snaptrade_user_secret",
        filters={"id": f"eq.{connection_id}", "user_id": f"eq.{user.id}"},
        single=True,
    )

    if conn_result["status_code"] != 200 or not conn_result["data"]:
        return APIResponse.fail(message="Connection not found", code="not_found")

    # Mark as disconnected (soft delete — we keep the record for history)
    await db.update(
        table="brokerage_connections",
        data={"status": "disconnected"},
        filters={"id": f"eq.{connection_id}"},
    )

    # Delete associated portfolio and its holdings (scoped to this connection only)
    # First get the portfolio IDs for this connection
    portfolio_result = await db.select(
        table="portfolios",
        columns="id",
        filters={"connection_id": f"eq.{connection_id}", "user_id": f"eq.{user.id}"},
    )
    if portfolio_result["status_code"] == 200 and isinstance(portfolio_result["data"], list):
        for portfolio in portfolio_result["data"]:
            await db.delete(
                table="holdings",
                filters={"portfolio_id": f"eq.{portfolio['id']}", "user_id": f"eq.{user.id}"},
            )
    await db.delete(
        table="portfolios",
        filters={"connection_id": f"eq.{connection_id}", "user_id": f"eq.{user.id}"},
    )

    return APIResponse.success({
        "disconnected": connection_id,
        "message": "Brokerage disconnected. Holdings data removed.",
    })
