"""
SignalStack — SnapTrade Integration Service

Handles the full SnapTrade lifecycle:
  1. Register a SnapTrade user (one per SignalStack user)
  2. Generate Connection Portal URL (user links their brokerage)
  3. List connected accounts
  4. Fetch holdings/positions per account
  5. Sync holdings into SignalStack's Supabase tables

SnapTrade auth flow:
  - We use our clientId + consumerKey to sign requests (HMAC-SHA256)
  - Each SignalStack user gets a SnapTrade userId + userSecret
  - The userSecret is encrypted with Fernet before storage in Supabase
  - At runtime we decrypt the userSecret to make per-user API calls

We use httpx directly (matching our Supabase client pattern) rather
than the snaptrade-python-sdk, for consistency and control over
error handling.
"""

import hashlib
import hmac
import json
import logging
import time
from datetime import UTC, datetime
from urllib.parse import urlencode

import httpx
from cryptography.fernet import Fernet

from backend.config import get_settings
from backend.services.supabase import get_service_client

logger = logging.getLogger("snaptrade")

SNAPTRADE_BASE_URL = "https://api.snaptrade.com/api/v1"


class SnapTradeService:
    """SnapTrade API client with HMAC signature auth and Fernet token encryption."""

    def __init__(self):
        settings = get_settings()
        self.client_id = settings.snaptrade_client_id
        self.consumer_key = settings.snaptrade_consumer_key
        self.fernet = Fernet(settings.encryption_key.encode())
        self.timeout = 30.0

    # ================================================================
    # AUTH SIGNATURE
    # ================================================================

    def _sign_request(
        self,
        path: str,
        method: str = "GET",
        query_params: dict | None = None,
        body: dict | None = None,
    ) -> tuple[dict, dict]:
        """Generate HMAC-SHA256 signature for a SnapTrade API request.

        Returns headers dict with Signature and timestamp.
        """
        timestamp = str(int(time.time()))

        # Build query string (must include clientId and timestamp)
        params = query_params or {}
        params["clientId"] = self.client_id
        params["timestamp"] = timestamp
        # Sort params alphabetically for consistent signature
        sorted_params = sorted(params.items())
        query_string = urlencode(sorted_params)

        # Build signature content
        sig_object = {
            "content": body if body else None,
            "path": path,
            "query": query_string,
        }
        sig_content = json.dumps(sig_object, separators=(",", ":"), sort_keys=False)

        # HMAC-SHA256
        signature = hmac.new(
            self.consumer_key.encode("utf-8"),
            sig_content.encode("utf-8"),
            hashlib.sha256,
        ).digest()

        import base64
        sig_b64 = base64.b64encode(signature).decode("utf-8")

        return {
            "Signature": sig_b64,
            "Content-Type": "application/json",
        }, params

    async def _request(
        self,
        method: str,
        path: str,
        query_params: dict | None = None,
        body: dict | None = None,
    ) -> dict:
        """Make a signed request to the SnapTrade API.

        Returns: {"status_code": int, "data": dict|list}
        """
        headers, full_params = self._sign_request(path, method, query_params, body)
        url = f"{SNAPTRADE_BASE_URL}{path}"

        try:
            async with httpx.AsyncClient(timeout=self.timeout) as client:
                if method == "GET":
                    resp = await client.get(url, headers=headers, params=full_params)
                elif method == "POST":
                    resp = await client.post(
                        url, headers=headers, params=full_params, json=body,
                    )
                elif method == "DELETE":
                    resp = await client.delete(url, headers=headers, params=full_params)
                else:
                    return {"status_code": 400, "data": {"error": f"Unsupported method: {method}"}}

                try:
                    data = resp.json()
                except Exception:
                    data = {"raw": resp.text}

                return {"status_code": resp.status_code, "data": data}

        except httpx.TimeoutException:
            logger.error(f"SnapTrade request timeout: {method} {path}")
            return {"status_code": 408, "data": {"error": "Request timeout"}}
        except Exception as e:
            logger.error(f"SnapTrade request error: {method} {path} — {e}")
            return {"status_code": 500, "data": {"error": str(e)}}

    # ================================================================
    # ENCRYPTION (Fernet — application-level)
    # ================================================================

    def encrypt_secret(self, plaintext: str) -> str:
        """Encrypt a SnapTrade userSecret before storing in Supabase."""
        return self.fernet.encrypt(plaintext.encode("utf-8")).decode("utf-8")

    def decrypt_secret(self, ciphertext: str) -> str:
        """Decrypt a SnapTrade userSecret retrieved from Supabase."""
        return self.fernet.decrypt(ciphertext.encode("utf-8")).decode("utf-8")

    # ================================================================
    # API STATUS
    # ================================================================

    async def check_api_status(self) -> dict:
        """Check if the SnapTrade API is online."""
        return await self._request("GET", "/snapTrade/apiStatus")

    # ================================================================
    # USER REGISTRATION
    # ================================================================

    async def register_user(self, user_id: str) -> dict:
        """Register a new SnapTrade user.

        Args:
            user_id: Our SignalStack user ID (UUID). Used as the SnapTrade userId.

        Returns:
            {"status_code": 200, "data": {"userId": "...", "userSecret": "..."}}
            The userSecret is generated once and must be stored encrypted.
        """
        result = await self._request(
            "POST",
            "/snapTrade/registerUser",
            body={"userId": user_id},
        )
        return result

    async def delete_user(self, user_id: str) -> dict:
        """Delete a SnapTrade user and all their connections."""
        return await self._request(
            "DELETE",
            "/snapTrade/deleteUser",
            query_params={"userId": user_id},
        )

    # ================================================================
    # CONNECTION PORTAL
    # ================================================================

    async def get_connection_portal_url(
        self,
        user_id: str,
        user_secret: str,
        broker: str | None = None,
        custom_redirect: str | None = None,
    ) -> dict:
        """Generate a redirect URL for the SnapTrade Connection Portal.

        The user visits this URL to link their brokerage account via OAuth.
        After connecting, they're redirected back to our app.

        Args:
            user_id: SnapTrade userId
            user_secret: Decrypted SnapTrade userSecret
            broker: Optional broker slug to skip selection (e.g. "robinhood")
            custom_redirect: URL to redirect to after connection
        """
        body = {
            "userId": user_id,
            "userSecret": user_secret,
        }
        if broker:
            body["broker"] = broker
        if custom_redirect:
            body["customRedirect"] = custom_redirect
        else:
            body["customRedirect"] = "https://signalstack.app/connections/callback"

        result = await self._request(
            "POST",
            "/snapTrade/login",
            body=body,
        )
        return result

    # ================================================================
    # ACCOUNTS
    # ================================================================

    async def list_accounts(self, user_id: str, user_secret: str) -> dict:
        """List all brokerage accounts for a SnapTrade user."""
        return await self._request(
            "GET",
            "/accounts",
            query_params={"userId": user_id, "userSecret": user_secret},
        )

    async def get_account_detail(
        self, user_id: str, user_secret: str, account_id: str,
    ) -> dict:
        """Get detailed info for a specific account."""
        return await self._request(
            "GET",
            f"/accounts/{account_id}",
            query_params={"userId": user_id, "userSecret": user_secret},
        )

    # ================================================================
    # HOLDINGS
    # ================================================================

    async def get_account_holdings(
        self, user_id: str, user_secret: str, account_id: str,
    ) -> dict:
        """Get positions for a specific account.

        Returns positions with symbol, quantity, price, market value, etc.
        This is the per-account endpoint (preferred over the deprecated
        get_all_user_holdings).
        """
        return await self._request(
            "GET",
            f"/accounts/{account_id}/holdings",
            query_params={"userId": user_id, "userSecret": user_secret},
        )

    async def get_account_balances(
        self, user_id: str, user_secret: str, account_id: str,
    ) -> dict:
        """Get cash balances for a specific account."""
        return await self._request(
            "GET",
            f"/accounts/{account_id}/balances",
            query_params={"userId": user_id, "userSecret": user_secret},
        )

    # ================================================================
    # CONNECTIONS
    # ================================================================

    async def list_connections(self, user_id: str, user_secret: str) -> dict:
        """List all brokerage connections (authorizations) for a user."""
        return await self._request(
            "GET",
            "/authorizations",
            query_params={"userId": user_id, "userSecret": user_secret},
        )

    async def remove_connection(
        self, user_id: str, user_secret: str, authorization_id: str,
    ) -> dict:
        """Remove a brokerage connection."""
        return await self._request(
            "DELETE",
            f"/authorizations/{authorization_id}",
            query_params={"userId": user_id, "userSecret": user_secret},
        )


# ================================================================
# PORTFOLIO SYNC — transforms SnapTrade data into SignalStack tables
# ================================================================

async def sync_user_holdings(user_id: str) -> dict:
    """Full sync: fetch all accounts and holdings from SnapTrade,
    upsert into SignalStack's portfolios and holdings tables.

    Args:
        user_id: SignalStack user ID (UUID)

    Returns:
        {"accounts_synced": int, "holdings_synced": int,
         "synced_portfolio_ids": [...], "errors": [...]}
    """
    svc = SnapTradeService()
    db = get_service_client()
    result = {"accounts_synced": 0, "holdings_synced": 0, "synced_portfolio_ids": [], "errors": []}

    # 1. Get the user's SnapTrade credentials from brokerage_connections
    conn_result = await db.select(
        table="brokerage_connections",
        columns="id,snaptrade_user_id,snaptrade_user_secret,account_id",
        filters={"user_id": f"eq.{user_id}", "status": "in.(active,stale)"},
    )

    if conn_result["status_code"] != 200 or not isinstance(conn_result["data"], list):
        result["errors"].append("Failed to fetch brokerage connections")
        return result

    connections = conn_result["data"]
    if not connections:
        result["errors"].append("No active brokerage connections found")
        return result

    for conn in connections:
        try:
            st_user_id = conn["snaptrade_user_id"]
            st_user_secret = svc.decrypt_secret(conn["snaptrade_user_secret"])
            st_account_id = conn["account_id"]
            connection_id = conn["id"]

            # 2. Fetch holdings
            holdings_result = await svc.get_account_holdings(st_user_id, st_user_secret, st_account_id)

            # 3. Fetch balances
            balance_result = await svc.get_account_balances(st_user_id, st_user_secret, st_account_id)

            if holdings_result["status_code"] != 200:
                result["errors"].append(f"Failed to fetch holdings for account {st_account_id}")
                # Mark connection as stale
                await db.update(
                    table="brokerage_connections",
                    data={"status": "stale", "last_sync_error": str(holdings_result["data"])},
                    filters={"id": f"eq.{connection_id}"},
                )
                continue

            # 5. Parse and compute portfolio totals
            raw_positions = holdings_result["data"]
            if isinstance(raw_positions, dict):
                # Some endpoints return {"positions": [...], "balances": [...]}
                positions = raw_positions.get("positions", raw_positions.get("holdings", []))
            elif isinstance(raw_positions, list):
                positions = raw_positions
            else:
                positions = []

            # Compute total market value for percentage calculation
            total_value = 0.0
            parsed_holdings = []

            for pos in positions:
                if not pos:
                    continue

                # Extract symbol — SnapTrade normalizes to a unified format
                symbol_info = pos.get("symbol", {})
                if isinstance(symbol_info, dict):
                    ticker = symbol_info.get("symbol", symbol_info.get("ticker", ""))
                    security_name = symbol_info.get("description", symbol_info.get("name", ""))
                    security_type = _map_security_type(symbol_info.get("type", {}).get("code", ""))
                    exchange = symbol_info.get("stock_exchange", {}).get("mic_code", "") if isinstance(symbol_info.get("stock_exchange"), dict) else ""
                else:
                    ticker = str(symbol_info)
                    security_name = ""
                    security_type = "equity"
                    exchange = ""

                if not ticker:
                    continue

                units = float(pos.get("units", pos.get("quantity", 0)))
                price = float(pos.get("price", pos.get("current_price", 0)))
                avg_cost = pos.get("average_purchase_price")
                market_val = units * price if price else 0

                total_value += market_val

                parsed_holdings.append({
                    "ticker": ticker.upper(),
                    "security_name": security_name,
                    "security_type": security_type,
                    "exchange": exchange,
                    "quantity": units,
                    "current_price": price,
                    "avg_cost_basis": float(avg_cost) if avg_cost else None,
                    "market_value": round(market_val, 2),
                })

            # Compute percentages
            for h in parsed_holdings:
                if total_value > 0:
                    h["pct_of_portfolio"] = round((h["market_value"] / total_value) * 100, 3)
                else:
                    h["pct_of_portfolio"] = 0

            # 6. Parse balances
            cash_balance = 0.0
            if balance_result["status_code"] == 200:
                balances = balance_result["data"]
                if isinstance(balances, list):
                    for b in balances:
                        # Sum cash in USD (or primary currency)
                        cash_val = b.get("cash") or b.get("amount") or 0
                        cash_balance += float(cash_val)
                elif isinstance(balances, dict):
                    cash_balance = float(balances.get("cash", balances.get("buying_power", 0)))

            # 7. Upsert portfolio record
            portfolio_data = {
                "user_id": user_id,
                "connection_id": connection_id,
                "total_value": round(total_value + cash_balance, 2),
                "cash_balance": round(cash_balance, 2),
                "synced_at": datetime.now(UTC).isoformat(),
            }

            portfolio_result = await db.insert(
                table="portfolios",
                data=portfolio_data,
                upsert=True,
                on_conflict="connection_id",
            )

            portfolio_id = None
            if portfolio_result["status_code"] in (200, 201):
                pdata = portfolio_result["data"]
                if isinstance(pdata, list) and pdata:
                    portfolio_id = pdata[0]["id"]
                elif isinstance(pdata, dict):
                    portfolio_id = pdata["id"]

            if not portfolio_id:
                result["errors"].append(f"Failed to upsert portfolio for connection {connection_id}")
                continue

            result["accounts_synced"] += 1
            result["synced_portfolio_ids"].append(portfolio_id)

            # 8. Upsert holdings
            for h in parsed_holdings:
                holding_data = {
                    "portfolio_id": portfolio_id,
                    "user_id": user_id,
                    "ticker": h["ticker"],
                    "security_name": h["security_name"],
                    "security_type": h["security_type"],
                    "exchange": h["exchange"],
                    "quantity": h["quantity"],
                    "current_price": h["current_price"],
                    "avg_cost_basis": h["avg_cost_basis"],
                    "market_value": h["market_value"],
                    "pct_of_portfolio": h["pct_of_portfolio"],
                    "synced_at": datetime.now(UTC).isoformat(),
                }

                await db.insert(
                    table="holdings",
                    data=holding_data,
                    upsert=True,
                    on_conflict="portfolio_id,ticker",
                )
                result["holdings_synced"] += 1

            # 9. Update connection health
            await db.update(
                table="brokerage_connections",
                data={
                    "status": "active",
                    "last_sync_at": datetime.now(UTC).isoformat(),
                    "last_sync_error": None,
                },
                filters={"id": f"eq.{connection_id}"},
            )

        except Exception as e:
            logger.error(f"Sync error for connection {conn.get('id')}: {e}")
            result["errors"].append(f"Connection {conn.get('id')}: {str(e)}")

    return result


def _map_security_type(code: str) -> str:
    """Map SnapTrade security type codes to our enum."""
    code = (code or "").lower()
    mapping = {
        "equity": "equity",
        "stock": "equity",
        "etf": "etf",
        "exchange traded fund": "etf",
        "mutual fund": "mutual_fund",
        "mutualfund": "mutual_fund",
        "cryptocurrency": "crypto",
        "crypto": "crypto",
        "option": "option",
        "bond": "bond",
        "fixed income": "bond",
    }
    return mapping.get(code, "other")
