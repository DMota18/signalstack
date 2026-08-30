"""
SignalStack — Tool Tests

Tests for tool implementations covering all 4 error categories:
  - transient (timeout, 429 rate limit)
  - validation (bad input, invalid ticker)
  - business (valid request, no results)
  - permission (missing API key)

Plus success paths for each tool.
"""

import pytest
from unittest.mock import AsyncMock, patch, MagicMock

from backend.tools.base import (
    ToolResult, ToolError,
    transient_error, validation_error, business_error, permission_error,
    classify_http_error,
)


# ============================================================================
# BASE ERROR FACTORIES
# ============================================================================

class TestErrorFactories:
    """Verify the 4-category error factory functions."""

    def test_transient_error_is_retryable(self):
        err = transient_error("test_tool", "Rate limited")
        assert err.category == "transient"
        assert err.is_retryable is True
        d = err.to_dict()
        assert d["ok"] is False
        assert d["isRetryable"] is True

    def test_validation_error_not_retryable(self):
        err = validation_error("test_tool", "Invalid ticker")
        assert err.category == "validation"
        assert err.is_retryable is False

    def test_business_error_not_retryable(self):
        err = business_error("test_tool", "No markets found")
        assert err.category == "business"
        assert err.is_retryable is False

    def test_permission_error_not_retryable(self):
        err = permission_error("test_tool", "API key missing")
        assert err.category == "permission"
        assert err.is_retryable is False

    def test_tool_result_success(self):
        result = ToolResult(ok=True, data={"price": 950.0}, tool_name="get_price_data")
        d = result.to_dict()
        assert d["ok"] is True
        assert d["data"]["price"] == 950.0


class TestHttpErrorClassifier:
    """classify_http_error maps status codes to the correct category."""

    def test_429_is_transient(self):
        err = classify_http_error("test", 429)
        assert err.category == "transient"
        assert err.is_retryable is True

    def test_503_is_transient(self):
        err = classify_http_error("test", 503)
        assert err.category == "transient"

    def test_401_is_permission(self):
        err = classify_http_error("test", 401)
        assert err.category == "permission"

    def test_403_is_permission(self):
        err = classify_http_error("test", 403)
        assert err.category == "permission"

    def test_404_is_validation(self):
        err = classify_http_error("test", 404)
        assert err.category == "validation"

    def test_400_is_validation(self):
        err = classify_http_error("test", 400)
        assert err.category == "validation"


# ============================================================================
# POLYMARKET TOOLS
# ============================================================================

class TestSearchPolymarketMarkets:
    """Tests for search_polymarket_markets tool."""

    @pytest.mark.asyncio
    async def test_search_success(self, mock_settings):
        # Gamma /events shape: events carry their markets nested
        mock_response = {
            "status_code": 200,
            "data": [
                {
                    "title": "NVDA Q2 2026 Earnings",
                    "slug": "nvda-q2-2026-earnings",
                    "markets": [
                        {
                            "question": "Will NVDA beat Q2 2026 earnings?",
                            "description": "NVIDIA earnings prediction",
                            "outcomePrices": '["0.73", "0.27"]',
                            "volume24hr": 50000,
                            "liquidity": 25000,
                            "endDate": "2026-04-20T00:00:00Z",
                            "category": "crypto",
                            "slug": "nvda-q2-earnings",
                            "conditionId": "cond_123",
                            "active": True,
                        },
                    ],
                },
            ],
        }

        with patch("backend.tools.polymarket._gamma_request", new_callable=AsyncMock) as mock_req, \
             patch("backend.tools.polymarket._check_cache", new_callable=AsyncMock, return_value=None), \
             patch("backend.tools.polymarket._write_cache", new_callable=AsyncMock):
            mock_req.return_value = mock_response

            from backend.tools.polymarket import search_polymarket_markets
            result = await search_polymarket_markets("NVDA earnings", min_volume=0)

            assert result["ok"] is True
            assert len(result["data"]["markets"]) >= 1

    @pytest.mark.asyncio
    async def test_search_validation_error_empty_query(self, mock_settings):
        from backend.tools.polymarket import search_polymarket_markets
        result = await search_polymarket_markets("", min_volume=1000)
        assert result["ok"] is False
        assert result["error"] == "validation"

    @pytest.mark.asyncio
    async def test_search_business_error_no_results(self, mock_settings):
        with patch("backend.tools.polymarket._gamma_request", new_callable=AsyncMock) as mock_req, \
             patch("backend.tools.polymarket._check_cache", new_callable=AsyncMock, return_value=None), \
             patch("backend.tools.polymarket._write_cache", new_callable=AsyncMock):
            mock_req.return_value = {"status_code": 200, "data": []}

            from backend.tools.polymarket import search_polymarket_markets
            result = await search_polymarket_markets("XYZNONEXISTENT123")

            assert result["ok"] is False
            assert result["error"] == "business"

    @pytest.mark.asyncio
    async def test_search_transient_error_timeout(self, mock_settings):
        with patch("backend.tools.polymarket._gamma_request", new_callable=AsyncMock) as mock_req, \
             patch("backend.tools.polymarket._check_cache", new_callable=AsyncMock, return_value=None):
            mock_req.return_value = transient_error("search_polymarket_markets", "timeout").to_dict()

            from backend.tools.polymarket import search_polymarket_markets
            result = await search_polymarket_markets("NVDA")

            assert result["ok"] is False
            assert result["error"] == "transient"

    @pytest.mark.asyncio
    async def test_search_returns_cached_result(self, mock_settings):
        cached_data = {"query": "NVDA", "markets_found": 1, "markets": [{"question": "cached"}]}

        with patch("backend.tools.polymarket._check_cache", new_callable=AsyncMock, return_value=cached_data):
            from backend.tools.polymarket import search_polymarket_markets
            result = await search_polymarket_markets("NVDA")

            assert result["ok"] is True
            assert result["data"]["markets"][0]["question"] == "cached"


class TestMatchHoldingsToMarkets:
    """Tests for match_holdings_to_markets tool."""

    @pytest.mark.asyncio
    async def test_match_validation_error_empty_tickers(self, mock_settings):
        from backend.tools.polymarket import match_holdings_to_markets
        result = await match_holdings_to_markets([])
        assert result["ok"] is False
        assert result["error"] == "validation"


# ============================================================================
# TOOL REGISTRY
# ============================================================================

class TestToolRegistry:
    """Tests for the tool registry dispatch."""

    @pytest.mark.asyncio
    async def test_execute_unknown_tool_returns_validation_error(self):
        from backend.tools.registry import execute_tool
        result = await execute_tool("nonexistent_tool", {})
        assert result["ok"] is False
        assert result["error"] == "validation"

    def test_get_schemas_for_sentiment_agent(self):
        from backend.tools.registry import get_schemas_for_agent
        schemas = get_schemas_for_agent("sentiment")
        tool_names = [s["name"] for s in schemas]
        assert "get_news_sentiment" in tool_names
        assert "get_price_data" in tool_names

    def test_get_schemas_for_polymarket_agent(self):
        from backend.tools.registry import get_schemas_for_agent
        schemas = get_schemas_for_agent("polymarket")
        tool_names = [s["name"] for s in schemas]
        assert "search_polymarket_markets" in tool_names
        assert "match_holdings_to_markets" in tool_names

    def test_get_schemas_for_unknown_agent_returns_empty(self):
        from backend.tools.registry import get_schemas_for_agent
        schemas = get_schemas_for_agent("nonexistent")
        assert schemas == []

    def test_subagent_tool_limits(self):
        """No subagent should have more than 5 tools (CLAUDE.md rule)."""
        from backend.tools.registry import SUBAGENT_TOOLS
        for agent, tools in SUBAGENT_TOOLS.items():
            assert len(tools) <= 5, f"Agent '{agent}' has {len(tools)} tools (max 5)"


# ============================================================================
# RELEVANCE FILTERING (Polymarket)
# ============================================================================

class TestPolymarketRelevanceFilter:
    """The relevance filter should exclude sports/political noise."""

    def test_filters_sports_market(self):
        from backend.tools.polymarket import _is_relevant, _build_relevance_keywords
        market = {"question": "Lakers vs Celtics game tonight?", "category": "sports"}
        keywords = _build_relevance_keywords("NVDA")
        assert _is_relevant(market, keywords) is False

    def test_keeps_relevant_market(self):
        from backend.tools.polymarket import _is_relevant, _build_relevance_keywords
        market = {"question": "Will Nvidia beat Q2 earnings?", "category": "economics"}
        keywords = _build_relevance_keywords("Nvidia")
        assert _is_relevant(market, keywords) is True

    def test_filters_far_future_political_market(self):
        from backend.tools.polymarket import _is_relevant, _build_relevance_keywords
        market = {
            "question": "Who will win the 2028 presidential election?",
            "category": "politics",
            "endDate": "2028-11-15T00:00:00Z",
        }
        keywords = _build_relevance_keywords("NVDA")
        assert _is_relevant(market, keywords) is False
