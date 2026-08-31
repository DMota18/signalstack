"""
SignalStack — Cost Control Tests

The three-band model policy that keeps per-user Claude spend under the
daily cap: primary model under 70%, fallback model from 70-100%,
cached intelligence beyond the cap.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from backend.services.cost_control import estimate_cost, select_model_for_user


def spend(total: float, cap: float = 0.50) -> dict:
    return {
        "total_cost_usd": total,
        "total_tokens": 1000,
        "job_count": 1,
        "cap_hit": total >= cap,
        "cap_usd": cap,
        "remaining_usd": max(0, cap - total),
    }


def settings_mock():
    s = MagicMock()
    s.claude_model = "claude-primary-test"
    s.claude_fallback_model = "claude-fallback-test"
    s.claude_daily_cost_cap_usd = 0.50
    return s


class TestModelSelectionBands:
    @pytest.mark.asyncio
    async def test_under_70_pct_uses_primary_model(self):
        with patch("backend.services.cost_control.get_daily_spend", AsyncMock(return_value=spend(0.10))), \
             patch("backend.services.cost_control.get_settings", return_value=settings_mock()):
            decision = await select_model_for_user("user-1")

        assert decision["model"] == "claude-primary-test"
        assert decision["reason"] == "within_budget"
        assert decision["use_cache"] is False

    @pytest.mark.asyncio
    async def test_between_70_and_100_pct_falls_back(self):
        with patch("backend.services.cost_control.get_daily_spend", AsyncMock(return_value=spend(0.40))), \
             patch("backend.services.cost_control.get_settings", return_value=settings_mock()):
            decision = await select_model_for_user("user-1")

        assert decision["model"] == "claude-fallback-test"
        assert decision["reason"] == "budget_warning"
        assert decision["use_cache"] is False

    @pytest.mark.asyncio
    async def test_over_cap_serves_cache(self):
        with patch("backend.services.cost_control.get_daily_spend", AsyncMock(return_value=spend(0.55))), \
             patch("backend.services.cost_control.get_settings", return_value=settings_mock()):
            decision = await select_model_for_user("user-1")

        assert decision["use_cache"] is True
        assert decision["budget_ok"] is False
        assert decision["reason"] == "cap_exceeded"


class TestCostEstimation:
    def test_output_tokens_cost_more_than_input(self):
        input_heavy = estimate_cost("claude-sonnet-4-20250514", 10_000, 0)
        output_heavy = estimate_cost("claude-sonnet-4-20250514", 0, 10_000)
        assert output_heavy > input_heavy

    def test_fallback_model_is_cheaper(self):
        sonnet = estimate_cost("claude-sonnet-4-20250514", 5_000, 5_000)
        haiku = estimate_cost("claude-haiku-4-5-20251001", 5_000, 5_000)
        assert haiku < sonnet

    def test_unknown_model_uses_conservative_default(self):
        # Unknown models are priced at the primary-model rate, never free
        assert estimate_cost("claude-future-model", 5_000, 5_000) == \
            estimate_cost("claude-sonnet-4-20250514", 5_000, 5_000)
