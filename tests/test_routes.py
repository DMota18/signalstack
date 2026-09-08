"""
SignalStack — Route Handler Tests

Verifies the APIResponse envelope contract over real ASGI requests:
every endpoint returns {"status": "ok"|"error", "data": ..., "error": ...},
expected failures come back as envelope errors (not raw exceptions),
and unauthenticated requests are rejected.
"""

from unittest.mock import AsyncMock, patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient

from backend.api.portfolios import router as portfolios_router
from backend.services.auth import CurrentUser, get_current_user

TEST_USER = CurrentUser(id="user-1", email="test@example.com", tier="pro", jwt_token="jwt-token")


def make_app(authenticated: bool = True) -> FastAPI:
    app = FastAPI()
    app.include_router(portfolios_router, prefix="/api/v1")
    if authenticated:
        app.dependency_overrides[get_current_user] = lambda: TEST_USER
    return app


def make_client(app: FastAPI) -> AsyncClient:
    return AsyncClient(transport=ASGITransport(app=app), base_url="http://test")


class TestAPIResponseEnvelope:
    @pytest.mark.asyncio
    async def test_success_returns_ok_envelope(self):
        db = AsyncMock()
        db.select = AsyncMock(side_effect=[
            {"status_code": 200, "data": [
                {"id": "p-1", "total_value": 25000.0, "cash_balance": 100.0,
                 "day_change_pct": 1.2, "day_change_value": 300.0,
                 "synced_at": "2026-08-30T12:00:00Z", "connection_id": "c-1"},
            ]},
            {"status_code": 200, "data": [
                {"id": "c-1", "brokerage_name": "Manual", "account_name": "Main",
                 "account_type": "brokerage", "status": "active"},
            ]},
        ])

        with patch("backend.api.portfolios.get_anon_client", return_value=db):
            async with make_client(make_app()) as client:
                resp = await client.get("/api/v1/portfolios")

        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "ok"
        assert isinstance(body["data"], list)
        assert body["error"] is None
        # List endpoints return arrays directly in data, not {"items": [...]}
        assert body["data"][0]["id"] == "p-1"
        assert body["data"][0]["brokerage_name"] == "Manual"

    @pytest.mark.asyncio
    async def test_upstream_failure_returns_error_envelope(self):
        db = AsyncMock()
        db.select = AsyncMock(return_value={"status_code": 500, "data": None})

        with patch("backend.api.portfolios.get_anon_client", return_value=db):
            async with make_client(make_app()) as client:
                resp = await client.get("/api/v1/portfolios")

        # Expected failures are envelope errors, not raised exceptions
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "error"
        assert body["error"]["code"] == "fetch_error"
        assert "message" in body["error"]

    @pytest.mark.asyncio
    async def test_unauthenticated_request_is_rejected(self):
        async with make_client(make_app(authenticated=False)) as client:
            resp = await client.get("/api/v1/portfolios")

        assert resp.status_code in (401, 403)
