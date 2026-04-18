"""
SignalStack — Supabase Client
Provides two client instances:
  - user_client: uses anon key, respects RLS (for user-facing operations)
  - service_client: uses service_role key, bypasses RLS (for backend operations)

The user_client is used with the user's JWT token set via .auth.set_session()
to enforce row-level security. The service_client is used for system writes
(alerts, job logs, portfolio sync, cache management).

We use httpx directly against Supabase REST API rather than the Python client
library — this matches the existing pattern from the Orchestrator bot (direct
httpx REST calls, not the supabase-py client).
"""

import httpx
from typing import Optional, Any
from backend.config import get_settings


class SupabaseClient:
    """Lightweight Supabase REST client using httpx.
    
    Matches the existing Orchestrator pattern: direct REST calls
    with httpx rather than the supabase-py client library.
    """

    def __init__(self, url: str, key: str, timeout: float = 30.0):
        self.url = url.rstrip("/")
        self.rest_url = f"{self.url}/rest/v1"
        self.auth_url = f"{self.url}/auth/v1"
        self.key = key
        self.timeout = timeout
        self._default_headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }

    def _headers(self, user_jwt: Optional[str] = None) -> dict:
        """Build request headers. If user_jwt is provided, use it for auth
        (respects RLS). Otherwise use the key from __init__."""
        headers = self._default_headers.copy()
        if user_jwt:
            headers["Authorization"] = f"Bearer {user_jwt}"
        return headers

    # --- Auth endpoints ---

    async def sign_up(self, email: str, password: str) -> dict:
        """Create a new user via Supabase Auth."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.auth_url}/signup",
                headers={"apikey": self.key, "Content-Type": "application/json"},
                json={"email": email, "password": password},
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    async def sign_in(self, email: str, password: str) -> dict:
        """Sign in and get JWT tokens via Supabase Auth."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.auth_url}/token?grant_type=password",
                headers={"apikey": self.key, "Content-Type": "application/json"},
                json={"email": email, "password": password},
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    async def refresh_token(self, refresh_token: str) -> dict:
        """Refresh an expired access token."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.auth_url}/token?grant_type=refresh_token",
                headers={"apikey": self.key, "Content-Type": "application/json"},
                json={"refresh_token": refresh_token},
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    async def get_user(self, jwt: str) -> dict:
        """Get the authenticated user's profile from Supabase Auth."""
        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.auth_url}/user",
                headers={"apikey": self.key, "Authorization": f"Bearer {jwt}"},
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    # --- REST API (PostgREST) ---

    async def select(
        self,
        table: str,
        columns: str = "*",
        filters: Optional[dict] = None,
        user_jwt: Optional[str] = None,
        single: bool = False,
        order: Optional[str] = None,
        limit: Optional[int] = None,
    ) -> dict:
        """SELECT from a table. Filters use PostgREST syntax.
        
        Args:
            table: Table name
            columns: Comma-separated column list or "*"
            filters: Dict of PostgREST filters, e.g. {"user_id": f"eq.{uid}"}
            user_jwt: If provided, request runs as that user (respects RLS)
            single: If True, expect exactly one row (adds Accept header)
            order: Order clause, e.g. "created_at.desc"
            limit: Max rows to return
        """
        headers = self._headers(user_jwt)
        if single:
            headers["Accept"] = "application/vnd.pgrst.object+json"

        params = {"select": columns}
        if filters:
            params.update(filters)
        if order:
            params["order"] = order
        if limit:
            params["limit"] = str(limit)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.get(
                f"{self.rest_url}/{table}",
                headers=headers,
                params=params,
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    async def insert(
        self,
        table: str,
        data: dict | list,
        user_jwt: Optional[str] = None,
        upsert: bool = False,
        on_conflict: Optional[str] = None,
    ) -> dict:
        """INSERT into a table. Supports upsert via on_conflict.
        
        Args:
            table: Table name
            data: Row dict or list of row dicts
            user_jwt: If provided, request runs as that user (respects RLS)
            upsert: If True, do upsert (requires on_conflict)
            on_conflict: Conflict columns for upsert, e.g. "portfolio_id,ticker"
        """
        headers = self._headers(user_jwt)
        if upsert:
            resolution = "merge-duplicates"
            headers["Prefer"] = f"resolution={resolution},return=representation"
            if on_conflict:
                headers["Prefer"] += f""  # on_conflict goes in params

        params = {}
        if upsert and on_conflict:
            params["on_conflict"] = on_conflict

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.rest_url}/{table}",
                headers=headers,
                json=data,
                params=params,
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    async def update(
        self,
        table: str,
        data: dict,
        filters: dict,
        user_jwt: Optional[str] = None,
    ) -> dict:
        """UPDATE rows matching filters."""
        headers = self._headers(user_jwt)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.patch(
                f"{self.rest_url}/{table}",
                headers=headers,
                json=data,
                params=filters,
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    async def delete(
        self,
        table: str,
        filters: dict,
        user_jwt: Optional[str] = None,
    ) -> dict:
        """DELETE rows matching filters."""
        headers = self._headers(user_jwt)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.delete(
                f"{self.rest_url}/{table}",
                headers=headers,
                params=filters,
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    async def rpc(
        self,
        function_name: str,
        params: Optional[dict] = None,
        user_jwt: Optional[str] = None,
    ) -> dict:
        """Call a Supabase RPC (database function)."""
        headers = self._headers(user_jwt)

        async with httpx.AsyncClient(timeout=self.timeout) as client:
            resp = await client.post(
                f"{self.rest_url}/rpc/{function_name}",
                headers=headers,
                json=params or {},
            )
            return {"status_code": resp.status_code, "data": resp.json()}


# --- Singleton instances ---

_service_client: Optional[SupabaseClient] = None
_anon_client: Optional[SupabaseClient] = None


def get_service_client() -> SupabaseClient:
    """Get the service-role client (bypasses RLS). Used by the backend for
    system operations: writing alerts, job logs, syncing portfolios, cache."""
    global _service_client
    if _service_client is None:
        settings = get_settings()
        _service_client = SupabaseClient(
            url=settings.supabase_url,
            key=settings.supabase_service_role_key,
        )
    return _service_client


def get_anon_client() -> SupabaseClient:
    """Get the anon-key client. Used with user JWTs for RLS-protected operations."""
    global _anon_client
    if _anon_client is None:
        settings = get_settings()
        _anon_client = SupabaseClient(
            url=settings.supabase_url,
            key=settings.supabase_anon_key,
        )
    return _anon_client
