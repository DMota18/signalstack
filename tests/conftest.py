"""
SignalStack — Shared Test Fixtures

Provides mock users, holdings, Supabase clients, and httpx responses
for all test files. All external APIs are mocked — no real calls.
"""

import os

# Fake configuration so the suite runs from a fresh clone with no .env,
# and so tests can never pick up real credentials. Real environment
# variables take precedence over .env in pydantic-settings, so these
# also shadow a developer's local .env under pytest.
os.environ.setdefault("SUPABASE_URL", "https://test-project.supabase.co")
os.environ.setdefault("SUPABASE_ANON_KEY", "test-anon-key")
os.environ.setdefault("SUPABASE_SERVICE_ROLE_KEY", "test-service-role-key")
os.environ.setdefault("ENCRYPTION_KEY", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=")
os.environ.setdefault("ANTHROPIC_API_KEY", "test-anthropic-key")
os.environ.setdefault("SUPABASE_JWT_SECRET", "test-jwt-secret")

from datetime import UTC, datetime
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

# ============================================================================
# SAMPLE DATA FACTORIES
# ============================================================================

def make_holdings(tickers=None):
    """Factory for sample holdings data."""
    tickers = tickers or ["NVDA", "AAPL", "GLD", "BTC-USD", "MTPLF"]
    prices = {"NVDA": 950.0, "AAPL": 220.0, "GLD": 195.0, "BTC-USD": 95000.0, "MTPLF": 3.50}
    quantities = {"NVDA": 20, "AAPL": 50, "GLD": 100, "BTC-USD": 0.5, "MTPLF": 1000}

    total = sum(prices.get(t, 100) * quantities.get(t, 10) for t in tickers)
    holdings = []
    for t in tickers:
        price = prices.get(t, 100.0)
        qty = quantities.get(t, 10)
        mv = price * qty
        holdings.append({
            "ticker": t,
            "security_name": f"{t} Inc.",
            "security_type": "crypto" if "BTC" in t or "ETH" in t else "equity",
            "quantity": qty,
            "current_price": price,
            "market_value": mv,
            "pct_of_portfolio": round((mv / total) * 100, 2) if total else 0,
        })
    return holdings


def make_user_context(tier="free", has_profile=False):
    """Factory for user hook context."""
    return {
        "user_id": "test-user-001",
        "tier": tier,
        "has_investor_profile": has_profile,
    }


# ============================================================================
# MOCK CLAUDE API RESPONSES
# ============================================================================

def make_claude_end_turn(text="Analysis complete.", usage=None):
    """Mock a Claude API response with stop_reason=end_turn."""
    return {
        "id": "msg_test_001",
        "type": "message",
        "role": "assistant",
        "content": [{"type": "text", "text": text}],
        "stop_reason": "end_turn",
        "usage": usage or {"input_tokens": 500, "output_tokens": 200},
    }


def make_claude_tool_use(tool_name, tool_input, tool_id="toolu_test_001", usage=None):
    """Mock a Claude API response with stop_reason=tool_use."""
    return {
        "id": "msg_test_002",
        "type": "message",
        "role": "assistant",
        "content": [
            {"type": "text", "text": f"Calling {tool_name}..."},
            {
                "type": "tool_use",
                "id": tool_id,
                "name": tool_name,
                "input": tool_input,
            },
        ],
        "stop_reason": "tool_use",
        "usage": usage or {"input_tokens": 400, "output_tokens": 150},
    }


def make_synthesis_tool_use():
    """Mock a Claude response that calls produce_synthesis."""
    synthesis = {
        "portfolio_summary": {
            "total_holdings": 5,
            "analysis_timestamp": datetime.now(UTC).isoformat(),
            "signals_available": ["sentiment", "polymarket", "macro"],
            "signals_unavailable": [],
        },
        "per_holding_intelligence": [
            {
                "ticker": "NVDA",
                "position_pct": 30.0,
                "net_signal": "bullish",
                "signal_breakdown": {
                    "sentiment": "bullish",
                    "polymarket": "bullish",
                    "insider": None,
                    "institutional": None,
                    "macro": "neutral",
                },
                "narrative": "The data suggests strong momentum for NVDA based on positive sentiment and prediction market signals.",
                "conflicts": None,
                "upcoming_catalysts": ["Earnings in 12 days"],
            },
        ],
        "portfolio_level_insights": [
            "Portfolio is heavily concentrated in technology sector."
        ],
        "disclaimer": "This is market intelligence for educational purposes, not investment advice.",
    }
    return make_claude_tool_use("produce_synthesis", synthesis)


# ============================================================================
# MOCK SUPABASE
# ============================================================================

def make_supabase_response(data, status_code=200):
    """Mock a Supabase REST API response."""
    return {"status_code": status_code, "data": data}


@pytest.fixture
def mock_supabase():
    """Fixture that patches get_service_client and get_anon_client."""
    mock_client = AsyncMock()
    mock_client.select = AsyncMock(return_value=make_supabase_response([]))
    mock_client.insert = AsyncMock(return_value=make_supabase_response([], 201))
    mock_client.update = AsyncMock(return_value=make_supabase_response([]))
    mock_client.delete = AsyncMock(return_value=make_supabase_response([]))

    with patch("backend.services.supabase.get_service_client", return_value=mock_client), \
         patch("backend.services.supabase.get_anon_client", return_value=mock_client):
        yield mock_client


# ============================================================================
# MOCK SETTINGS
# ============================================================================

@pytest.fixture
def mock_settings():
    """Fixture that patches get_settings with test values."""
    settings = MagicMock()
    settings.anthropic_api_key = "sk-ant-test-key"
    settings.claude_model = "claude-sonnet-4-20250514"
    settings.supabase_url = "https://test.supabase.co"
    settings.supabase_anon_key = "test-anon-key"
    settings.supabase_service_role_key = "test-service-key"
    settings.supabase_jwt_secret = "test-jwt-secret"
    settings.encryption_key = "dGVzdC1lbmNyeXB0aW9uLWtleS0zMi1ieXRlcw=="
    settings.finnhub_api_key = "test-finnhub-key"
    settings.fred_api_key = "test-fred-key"
    settings.vapid_private_key = ""
    settings.vapid_public_key = ""
    settings.vapid_email = ""
    settings.debug = True
    settings.app_env = "development"
    settings.rate_limit_free = 20
    settings.rate_limit_pro = 60
    settings.rate_limit_premium = 120
    settings.redis_url = "redis://localhost:6379/0"

    with patch("backend.config.get_settings", return_value=settings):
        yield settings


# ============================================================================
# MOCK FINNHUB RESPONSES
# ============================================================================

@pytest.fixture
def finnhub_quote_response():
    """Realistic Finnhub quote response."""
    return {
        "c": 950.25,    # Current price
        "d": 12.50,     # Change
        "dp": 1.33,     # Percent change
        "h": 955.00,    # High
        "l": 935.00,    # Low
        "o": 940.00,    # Open
        "pc": 937.75,   # Previous close
        "t": 1711036800,
    }


@pytest.fixture
def finnhub_news_response():
    """Realistic Finnhub news response."""
    return [
        {
            "category": "company",
            "datetime": 1711036800,
            "headline": "NVIDIA Reports Record Q4 Revenue of $22.1 Billion",
            "id": 123456,
            "image": "https://example.com/image.jpg",
            "related": "NVDA",
            "source": "Reuters",
            "summary": "NVIDIA reported record revenue driven by AI chip demand.",
            "url": "https://example.com/article",
        },
        {
            "category": "company",
            "datetime": 1710950400,
            "headline": "NVIDIA Expands AI Data Center Operations",
            "id": 123457,
            "image": "",
            "related": "NVDA",
            "source": "Bloomberg",
            "summary": "NVIDIA announces expansion of AI infrastructure.",
            "url": "https://example.com/article2",
        },
    ]


@pytest.fixture
def finnhub_insider_response():
    """Realistic Finnhub insider trades response."""
    return {
        "data": [
            {
                "name": "Jensen Huang",
                "share": 50000,
                "change": 50000,
                "filingDate": "2026-03-15",
                "transactionDate": "2026-03-14",
                "transactionCode": "P",
                "transactionPrice": 950.0,
            },
        ],
        "symbol": "NVDA",
    }


@pytest.fixture
def finnhub_429_response():
    """Finnhub rate limit response."""
    return {"status_code": 429, "data": {"error": "API limit reached"}}


@pytest.fixture
def finnhub_earnings_response():
    """Realistic Finnhub earnings calendar response."""
    return {
        "earningsCalendar": [
            {
                "date": "2026-04-15",
                "epsActual": None,
                "epsEstimate": 5.50,
                "hour": "amc",
                "quarter": 1,
                "revenueActual": None,
                "revenueEstimate": 24000000000,
                "symbol": "NVDA",
                "year": 2026,
            },
            {
                "date": "2026-04-25",
                "epsActual": None,
                "epsEstimate": 2.10,
                "hour": "bmo",
                "quarter": 2,
                "revenueActual": None,
                "revenueEstimate": 95000000000,
                "symbol": "AAPL",
                "year": 2026,
            },
        ],
    }
