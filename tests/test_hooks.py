"""
SignalStack — Hooks & Compliance Tests

Tests for:
  - Pre-execution hooks (trade blocking, tier gating, profile requirement)
  - Post-execution hooks (timestamp normalization, PII redaction)
  - Output interceptor (advice language filter, disclaimer injection)
  - Concentration warnings
"""

import pytest

from backend.services.hooks import (
    DISCLAIMER,
    build_reformulation_prompt,
    check_concentration_warnings,
    intercept_output,
    post_execution_hook,
    pre_execution_hook,
    strip_advice_language,
)
from tests.conftest import make_user_context

# ============================================================================
# PRE-EXECUTION HOOKS
# ============================================================================

class TestPreExecutionHookBlocksTrades:
    """Trade execution tools are ALWAYS blocked — SignalStack never trades."""

    @pytest.mark.asyncio
    async def test_pre_hook_blocks_execute_trade(self):
        result = await pre_execution_hook("execute_trade", {}, make_user_context())
        assert result.allowed is False
        assert "blocked" in result.block_reason.lower()

    @pytest.mark.asyncio
    async def test_pre_hook_blocks_submit_order(self):
        result = await pre_execution_hook("submit_order", {}, make_user_context())
        assert result.allowed is False

    @pytest.mark.asyncio
    async def test_pre_hook_blocks_place_order(self):
        result = await pre_execution_hook("place_order", {}, make_user_context())
        assert result.allowed is False

    @pytest.mark.asyncio
    async def test_pre_hook_blocks_cancel_order(self):
        result = await pre_execution_hook("cancel_order", {}, make_user_context())
        assert result.allowed is False

    @pytest.mark.asyncio
    async def test_pre_hook_blocks_trade_even_for_premium(self):
        ctx = make_user_context(tier="premium", has_profile=True)
        result = await pre_execution_hook("execute_trade", {}, ctx)
        assert result.allowed is False


class TestPreExecutionHookProfileGating:
    """Idea generation tools require an investor profile."""

    @pytest.mark.asyncio
    async def test_pre_hook_blocks_generate_idea_without_profile(self):
        ctx = make_user_context(has_profile=False)
        result = await pre_execution_hook("generate_idea", {}, ctx)
        assert result.allowed is False
        assert "profile" in result.block_reason.lower()

    @pytest.mark.asyncio
    async def test_pre_hook_allows_generate_idea_with_profile(self):
        ctx = make_user_context(has_profile=True)
        result = await pre_execution_hook("generate_idea", {}, ctx)
        assert result.allowed is True


class TestPreExecutionHookTierGating:
    """Premium and pro tools are gated by subscription tier."""

    @pytest.mark.asyncio
    async def test_pre_hook_blocks_premium_tool_for_free_user(self):
        ctx = make_user_context(tier="free")
        result = await pre_execution_hook("get_13f_filings", {}, ctx)
        assert result.allowed is False
        assert "premium" in result.block_reason.lower()

    @pytest.mark.asyncio
    async def test_pre_hook_blocks_premium_tool_for_pro_user(self):
        ctx = make_user_context(tier="pro")
        result = await pre_execution_hook("get_13f_filings", {}, ctx)
        assert result.allowed is False

    @pytest.mark.asyncio
    async def test_pre_hook_allows_premium_tool_for_premium_user(self):
        ctx = make_user_context(tier="premium")
        result = await pre_execution_hook("get_13f_filings", {}, ctx)
        assert result.allowed is True

    @pytest.mark.asyncio
    async def test_pre_hook_blocks_pro_tool_for_free_user(self):
        ctx = make_user_context(tier="free")
        result = await pre_execution_hook("search_polymarket_markets", {}, ctx)
        assert result.allowed is False

    @pytest.mark.asyncio
    async def test_pre_hook_allows_pro_tool_for_pro_user(self):
        ctx = make_user_context(tier="pro")
        result = await pre_execution_hook("search_polymarket_markets", {}, ctx)
        assert result.allowed is True


class TestPreExecutionHookPushDisclaimer:
    """Push notifications require the disclaimer in the body."""

    @pytest.mark.asyncio
    async def test_pre_hook_blocks_push_without_disclaimer(self):
        tool_input = {"body": "NVDA is looking great today!"}
        result = await pre_execution_hook("send_push_notification", tool_input, make_user_context())
        assert result.allowed is False
        assert "disclaimer" in result.block_reason.lower()

    @pytest.mark.asyncio
    async def test_pre_hook_allows_push_with_disclaimer(self):
        tool_input = {"body": f"NVDA signal update. {DISCLAIMER}"}
        result = await pre_execution_hook("send_push_notification", tool_input, make_user_context())
        assert result.allowed is True


class TestPreExecutionHookAllowsNormalTools:
    """Normal tools should always be allowed."""

    @pytest.mark.asyncio
    async def test_pre_hook_allows_get_price_data(self):
        result = await pre_execution_hook("get_price_data", {"ticker": "NVDA"}, make_user_context())
        assert result.allowed is True

    @pytest.mark.asyncio
    async def test_pre_hook_allows_get_news_sentiment(self):
        result = await pre_execution_hook("get_news_sentiment", {"ticker": "AAPL"}, make_user_context())
        assert result.allowed is True

    @pytest.mark.asyncio
    async def test_pre_hook_allows_get_fred_data(self):
        result = await pre_execution_hook("get_fred_data", {"series_id": "FEDFUNDS"}, make_user_context())
        assert result.allowed is True


# ============================================================================
# POST-EXECUTION HOOKS
# ============================================================================

class TestPostExecutionHookTimestamps:
    """Timestamps should be normalized to ISO 8601."""

    @pytest.mark.asyncio
    async def test_post_hook_normalizes_unix_timestamp(self):
        result = await post_execution_hook("get_price_data", {"timestamp": 1711036800})
        assert "T" in result["timestamp"]  # ISO 8601

    @pytest.mark.asyncio
    async def test_post_hook_normalizes_date_string(self):
        result = await post_execution_hook("get_insider_trades", {"date": "2026-03-15"})
        assert "T" in result["date"]

    @pytest.mark.asyncio
    async def test_post_hook_injects_compliance_metadata(self):
        result = await post_execution_hook("get_price_data", {"price": 950.0})
        assert "_compliance" in result
        assert result["_compliance"]["disclaimer_required"] is True


class TestPostExecutionHookPiiRedaction:
    """PII fields should be redacted from brokerage data."""

    @pytest.mark.asyncio
    async def test_post_hook_redacts_ssn(self):
        result = await post_execution_hook("get_account_holdings", {
            "ssn": "123-45-6789",
            "ticker": "NVDA",
        })
        assert result["ssn"] == "[REDACTED]"

    @pytest.mark.asyncio
    async def test_post_hook_redacts_account_number(self):
        result = await post_execution_hook("get_account_holdings", {
            "account_number": "12345678",
        })
        assert result["account_number"] == "[REDACTED]"

    @pytest.mark.asyncio
    async def test_post_hook_redacts_tax_id(self):
        result = await post_execution_hook("get_account_holdings", {
            "tax_id": "987-65-4321",
        })
        assert result["tax_id"] == "[REDACTED]"


class TestPostExecutionHookFinancialSanitization:
    """Financial data should be sanitized (strip $, convert to float)."""

    @pytest.mark.asyncio
    async def test_post_hook_strips_dollar_sign(self):
        result = await post_execution_hook("get_price_data", {"price": "$950.25"})
        assert result["price"] == 950.25

    @pytest.mark.asyncio
    async def test_post_hook_strips_comma_formatting(self):
        result = await post_execution_hook("get_price_data", {"volume": "1,234,567"})
        assert result["volume"] == 1234567.0


# ============================================================================
# OUTPUT INTERCEPTOR
# ============================================================================

class TestOutputInterceptorAdviceLanguage:
    """Advice language must be caught before delivery to users."""

    def test_intercept_catches_you_should_buy(self):
        passed, _, violations = intercept_output("The data is clear. You should buy NVDA now.")
        assert passed is False
        assert len(violations) > 0

    def test_intercept_catches_i_recommend_selling(self):
        passed, _, violations = intercept_output("I recommend selling your GLD position.")
        assert passed is False

    def test_intercept_catches_buy_now(self):
        passed, _, violations = intercept_output("NVDA is a strong buy now based on momentum.")
        assert passed is False

    def test_intercept_catches_we_recommend(self):
        passed, _, violations = intercept_output("We recommend increasing your AAPL allocation.")
        assert passed is False

    def test_intercept_catches_definitely_buy(self):
        passed, _, violations = intercept_output("You should definitely buy more shares.")
        assert passed is False

    def test_intercept_allows_compliant_language(self):
        text = "The data suggests bullish momentum for NVDA. Historically, this pattern has preceded positive earnings."
        passed, output, violations = intercept_output(text)
        assert passed is True
        assert len(violations) == 0

    def test_intercept_allows_signal_language(self):
        text = "The signal is bullish. Near-term sentiment data shows improving conditions."
        passed, _, violations = intercept_output(text)
        assert passed is True


class TestOutputInterceptorDisclaimer:
    """Disclaimer must be injected on every output path."""

    def test_intercept_injects_disclaimer_when_missing(self):
        passed, output, _ = intercept_output("NVDA shows bullish signals across all dimensions.")
        assert passed is True
        assert DISCLAIMER in output

    def test_intercept_preserves_existing_disclaimer(self):
        text = f"Analysis complete.\n\n{DISCLAIMER}"
        passed, output, _ = intercept_output(text)
        assert passed is True
        assert output.count(DISCLAIMER) == 1


class TestReformulationPrompt:
    """Reformulation prompt should include violation details."""

    def test_reformulation_prompt_includes_violations(self):
        violations = ["Advice language detected: 'you should buy'"]
        prompt = build_reformulation_prompt("original output", violations)
        assert "you should buy" in prompt
        assert "reformulate" in prompt.lower() or "Reformulate" in prompt


# ============================================================================
# CONCENTRATION WARNINGS
# ============================================================================

class TestConcentrationWarnings:
    """Position concentration > 25% must be flagged programmatically."""

    def test_concentration_warning_fires_at_25_pct(self):
        holdings = [{"ticker": "NVDA", "pct_of_portfolio": 30.0}]
        warnings = check_concentration_warnings(holdings)
        assert len(warnings) == 1
        assert "NVDA" in warnings[0]
        assert "30.0%" in warnings[0]

    def test_concentration_warning_does_not_fire_below_25(self):
        holdings = [{"ticker": "NVDA", "pct_of_portfolio": 20.0}]
        warnings = check_concentration_warnings(holdings)
        assert len(warnings) == 0

    def test_concentration_warning_fires_for_multiple_holdings(self):
        holdings = [
            {"ticker": "NVDA", "pct_of_portfolio": 30.0},
            {"ticker": "AAPL", "pct_of_portfolio": 26.0},
            {"ticker": "GLD", "pct_of_portfolio": 10.0},
        ]
        warnings = check_concentration_warnings(holdings)
        assert len(warnings) == 2

    def test_concentration_warning_handles_none_pct(self):
        holdings = [{"ticker": "NVDA", "pct_of_portfolio": None}]
        warnings = check_concentration_warnings(holdings)
        assert len(warnings) == 0

    def test_concentration_warning_handles_empty_holdings(self):
        warnings = check_concentration_warnings([])
        assert len(warnings) == 0


# ============================================================================
# WIDENED ADVICE FILTER
# ============================================================================

class TestAdviceFilterWidenedPatterns:
    """Bare imperatives and unhedged recommendations must be caught,
    while ordinary market commentary passes."""

    @pytest.mark.parametrize("text", [
        "Buy NVDA before earnings.",
        "I recommend NVDA at these levels.",
        "Consider selling your GLD position into strength.",
        "It is time to buy the dip here.",
        "You should take profits on AAPL.",
        "You should not sell yet.",
        "Analyst consensus: strong buy.",
        "Load up on semis before the print.",
        "My recommendation is to rotate into bonds.",
        "Must buy at this valuation.",
    ])
    def test_advice_phrases_blocked(self, text):
        passed, _, violations = intercept_output(text)
        assert passed is False
        assert violations

    @pytest.mark.parametrize("text", [
        "The data suggests bullish momentum for NVDA.",
        "A strong sell-off hit tech names midday.",
        "Insiders bought $1.4M in shares this week.",
        "Buyback activity accelerated in Q2.",
        "Sell pressure increased after the downgrade.",
        "RSI indicates the stock is overbought.",
        "Selling by institutions slowed this quarter.",
        "The signal is strongly bullish across dimensions.",
        "Historically this pattern has preceded gains.",
    ])
    def test_market_commentary_passes(self, text):
        passed, _, violations = intercept_output(text)
        assert passed is True
        assert violations == []


class TestStripAdviceLanguage:
    """The regex fallback must produce output that passes the interceptor."""

    def test_stripped_output_passes_interceptor(self):
        text = "Buy NVDA before earnings. I recommend selling GLD now. You should take profits."
        stripped = strip_advice_language(text)
        passed, _, violations = intercept_output(stripped)
        assert passed is True
        assert violations == []

    def test_strip_leaves_compliant_text_alone(self):
        text = "The data suggests bullish momentum for NVDA."
        assert strip_advice_language(text) == text


# ============================================================================
# PII REDACTION SCOPING
# ============================================================================

class TestPiiRedactionScoping:
    """The bare account-number pattern applies to brokerage tools and
    account-ish keys — market data must survive untouched."""

    @pytest.mark.asyncio
    async def test_market_cap_not_redacted_for_market_tools(self):
        result = await post_execution_hook("get_company_profile", {
            "summary": "Market cap stands at 2210000000000 with rising volume.",
        })
        assert "2210000000000" in result["summary"]
        assert "[ACCT_REDACTED]" not in result["summary"]

    @pytest.mark.asyncio
    async def test_brokerage_tool_strings_are_scrubbed(self):
        result = await post_execution_hook("get_account_holdings", {
            "description": "Transfers from 12345678901 settle in 2 days.",
        })
        assert "12345678901" not in result["description"]
        assert "[ACCT_REDACTED]" in result["description"]

    @pytest.mark.asyncio
    async def test_accountish_key_scrubbed_on_any_tool(self):
        result = await post_execution_hook("get_price_data", {
            "account_summary": "Linked account 987654321012 is active.",
        })
        assert "[ACCT_REDACTED]" in result["account_summary"]

    @pytest.mark.asyncio
    async def test_ssn_pattern_redacted_everywhere(self):
        result = await post_execution_hook("get_news_sentiment", {
            "note": "Leaked filing contained 123-45-6789 in the exhibit.",
        })
        assert "123-45-6789" not in result["note"]


class TestComplianceMetadataAdviceFlag:
    """advice_flag reflects the payload instead of being hardcoded False."""

    @pytest.mark.asyncio
    async def test_advice_flag_true_when_result_contains_advice(self):
        result = await post_execution_hook("get_news_sentiment", {
            "headline": "Analyst note: strong buy on NVDA",
        })
        assert result["_compliance"]["advice_flag"] is True

    @pytest.mark.asyncio
    async def test_advice_flag_false_for_clean_result(self):
        result = await post_execution_hook("get_news_sentiment", {
            "headline": "NVDA rises on data center demand",
        })
        assert result["_compliance"]["advice_flag"] is False
