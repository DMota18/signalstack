"""
SignalStack — Subagent Definitions (Domain 1.2, 1.3)

Six specialist subagents, each with:
  - Its own system prompt
  - Its own scoped tools (4-5 max)
  - Explicit context passing (holdings, earnings, etc.)
  - Structured JSON output — no prose

Critical isolation rules:
  - Subagents do NOT inherit the coordinator's conversation history
  - Subagents do NOT share memory with each other
  - Every piece of context a subagent needs is explicitly passed
  - Each subagent runs its own independent agentic loop
"""

import json
import logging

from backend.agents.loop import run_agent_loop
from backend.tools.registry import get_schemas_for_agent

logger = logging.getLogger("agents.subagents")


# ============================================================================
# BASE SUBAGENT RUNNER
# ============================================================================

async def run_subagent(
    agent_name: str,
    system_prompt: str,
    user_message: str,
    user_context: dict | None = None,
    tool_choice: dict | None = None,
) -> dict:
    """Run a subagent with its scoped tools and isolated context.

    Returns the parsed JSON output from the subagent, or an error dict.
    """
    tools = get_schemas_for_agent(agent_name)

    messages = [{"role": "user", "content": user_message}]

    result = await run_agent_loop(
        system_prompt=system_prompt,
        messages=messages,
        tools=tools,
        user_context=user_context,
        max_tokens=4096,
        tool_choice=tool_choice,
    )

    # Parse the text output as JSON
    text = result.get("text", "")
    if text:
        try:
            # Strip markdown fences if present
            clean = text.strip()
            if clean.startswith("```"):
                clean = clean.split("\n", 1)[-1] if "\n" in clean else clean[3:]
                if clean.endswith("```"):
                    clean = clean[:-3]
                clean = clean.strip()

            parsed = json.loads(clean)
            return {
                "ok": True,
                "agent": agent_name,
                "data": parsed,
                "iterations": result.get("iterations", 0),
                "tokens_used": result.get("tokens_used", 0),
            }
        except json.JSONDecodeError:
            # A subagent that returns prose instead of JSON has failed its
            # contract. Reporting it as a success would corrupt the
            # 5/5=completed / partial / failed job accounting and feed the
            # coordinator an unusable SUCCESS section.
            logger.warning(f"Subagent {agent_name} returned non-JSON: {text[:200]}")
            return {
                "ok": False,
                "agent": agent_name,
                "error": "invalid_json",
                "message": f"Subagent {agent_name} returned prose instead of structured JSON",
                "raw_text": text,
                "iterations": result.get("iterations", 0),
                "tokens_used": result.get("tokens_used", 0),
            }

    # No text — check if there were tool results
    return {
        "ok": False,
        "agent": agent_name,
        "error": "no_output",
        "message": f"Subagent {agent_name} produced no output",
        "tool_results": result.get("tool_results", []),
        "iterations": result.get("iterations", 0),
    }


# ============================================================================
# SENTIMENT AGENT
# ============================================================================

SENTIMENT_SYSTEM = """You are the Sentiment Intelligence Agent for SignalStack.

Your job: Analyze news sentiment for each holding in the user's portfolio.

RULES:
1. Use get_news_sentiment to fetch recent news for each ticker.
2. Use get_price_data to get current prices for context.
3. Analyze the headlines and determine overall sentiment per ticker.
4. Return ONLY structured JSON. No prose. No commentary.

OUTPUT SCHEMA:
{
  "results": [
    {
      "ticker": "NVDA",
      "sentiment_score": 0.6,
      "sentiment_label": "bullish",
      "key_headlines": ["headline1", "headline2"],
      "article_count": 15,
      "sentiment_trend": "improving"
    }
  ],
  "metadata": {
    "tickers_analyzed": 5,
    "total_articles": 42,
    "timestamp": "2026-03-20T14:00:00Z"
  }
}

sentiment_score: -1.0 (very bearish) to 1.0 (very bullish), 0.0 = neutral
sentiment_label: one of "strongly_bearish", "bearish", "neutral", "bullish", "strongly_bullish"
sentiment_trend: "improving", "stable", "deteriorating" (based on recent vs older headlines)
"""


async def run_sentiment_agent(holdings: list[dict], user_context: dict | None = None) -> dict:
    """Run the Sentiment Agent on a list of holdings."""
    user_msg = f"""USER HOLDINGS (passed from coordinator — this is your ONLY source of holdings data):
{json.dumps(holdings, indent=2)}

TASK: For each holding, fetch news and analyze sentiment.
Return ONLY structured JSON matching the output schema."""

    return await run_subagent("sentiment", SENTIMENT_SYSTEM, user_msg, user_context)


# ============================================================================
# POLYMARKET AGENT
# ============================================================================

POLYMARKET_SYSTEM = """You are the Polymarket Intelligence Agent for SignalStack.

Your job: Find prediction markets relevant to the user's holdings and report implied probabilities.

RULES:
1. Use match_holdings_to_markets first to find relevant markets for all tickers.
2. For the most relevant markets, use get_market_prices for fresh prices.
3. Outcome prices directly equal implied probabilities (yes_price 0.73 = 73% probability).
4. Return ONLY structured JSON. No prose. No commentary.

OUTPUT SCHEMA:
{
  "results": [
    {
      "ticker": "NVDA",
      "related_markets": [
        {
          "market_title": "Will NVDA beat Q2 earnings?",
          "yes_price": 0.73,
          "implied_probability_pct": 73.0,
          "volume_24h": 142000,
          "relevance": "direct_earnings"
        }
      ],
      "synthesis_note": "Strong implied probability of earnings beat"
    }
  ],
  "macro_markets": [
    {
      "market_title": "Will the Fed cut rates in June?",
      "yes_price": 0.62,
      "implied_probability_pct": 62.0,
      "volume_24h": 500000
    }
  ],
  "metadata": {
    "markets_searched": 47,
    "timestamp": "2026-03-20T14:00:00Z"
  }
}
"""


async def run_polymarket_agent(
    holdings: list[dict],
    earnings_calendar: list[dict],
    user_context: dict | None = None,
) -> dict:
    """Run the Polymarket Agent on holdings + earnings calendar."""
    user_msg = f"""USER HOLDINGS (passed from coordinator):
{json.dumps(holdings, indent=2)}

EARNINGS CALENDAR (next 30 days):
{json.dumps(earnings_calendar, indent=2)}

TASK: For each holding, search Polymarket for related prediction markets.
Also find macro markets (Fed, CPI, etc.) that could affect the portfolio.
Return ONLY structured JSON matching the output schema."""

    return await run_subagent("polymarket", POLYMARKET_SYSTEM, user_msg, user_context)


# ============================================================================
# INSIDER AGENT
# ============================================================================

INSIDER_SYSTEM = """You are the Insider Activity Agent for SignalStack.

Your job: Analyze SEC Form 4 insider trades for each holding.

RULES:
1. Use get_insider_trades for each ticker.
2. Focus on MEANINGFUL activity: open-market purchases (code P), large sells (code S).
3. Filter out routine 10b5-1 plan sales and tax withholdings (code F).
4. Return ONLY structured JSON. No prose.

OUTPUT SCHEMA:
{
  "results": [
    {
      "ticker": "NVDA",
      "recent_insider_trades": [
        {
          "name": "Jensen Huang",
          "title": "CEO",
          "type": "Open market purchase",
          "shares": 50000,
          "value": 1400000,
          "date": "2026-03-15"
        }
      ],
      "trade_significance": "high",
      "net_insider_sentiment": "bullish",
      "net_buy_value": 1200000,
      "summary": "2 insiders bought $1.4M in shares this month"
    }
  ],
  "metadata": {
    "tickers_analyzed": 5,
    "timestamp": "2026-03-20T14:00:00Z"
  }
}

trade_significance: "high" (cluster buying or large purchases), "medium" (some activity), "low" (routine only), "none" (no filings)
net_insider_sentiment: "bullish" (net buyers), "bearish" (net sellers), "neutral", "no_data"
"""


async def run_insider_agent(holdings: list[dict], user_context: dict | None = None) -> dict:
    """Run the Insider Agent on a list of holdings."""
    user_msg = f"""USER HOLDINGS (passed from coordinator):
{json.dumps(holdings, indent=2)}

TASK: For each holding, fetch insider trades and analyze significance.
Focus on meaningful open-market transactions, not routine plan sales.
Return ONLY structured JSON matching the output schema."""

    return await run_subagent("insider", INSIDER_SYSTEM, user_msg, user_context)


# ============================================================================
# INSTITUTIONAL FLOW AGENT
# ============================================================================

INSTITUTIONAL_SYSTEM = """You are the Institutional Flow Agent for SignalStack.

Your job: Track what major institutional investors (hedge funds, asset managers) are
doing with the user's holdings based on SEC 13F filings.

RULES:
1. Use get_institutional_holders for each ticker to find which major funds hold it.
2. For the most notable fund activity, use get_13f_fund_positions to get filing details.
3. Focus on major funds: Berkshire, Renaissance, Bridgewater, Citadel, BlackRock, Vanguard.
4. 13F data is QUARTERLY — note the filing date so the user knows data freshness.
5. Return ONLY structured JSON. No prose. No commentary.

OUTPUT SCHEMA:
{
  "results": [
    {
      "ticker": "NVDA",
      "institutional_holders_found": 15,
      "major_fund_holders": [
        {
          "fund_name": "Berkshire Hathaway",
          "filing_date": "2026-02-14",
          "is_major_fund": true
        }
      ],
      "institutional_signal": "bullish",
      "summary": "Held by 15 institutional filers including Berkshire and Renaissance"
    }
  ],
  "notable_fund_activity": [
    {
      "fund_name": "Renaissance Technologies",
      "latest_filing": "2026-02-14",
      "note": "Filed 13F-HR covering Q4 2025 positions"
    }
  ],
  "metadata": {
    "tickers_analyzed": 5,
    "data_freshness": "13F filings are quarterly — data may be 1-3 months old",
    "timestamp": "2026-03-20T14:00:00Z"
  }
}

institutional_signal: "bullish" (many major holders / increasing), "bearish" (few/decreasing), "neutral", "no_data"
"""


async def run_institutional_agent(holdings: list[dict], user_context: dict | None = None) -> dict:
    """Run the Institutional Flow Agent on a list of holdings."""
    user_msg = f"""USER HOLDINGS (passed from coordinator — this is your ONLY source of holdings data):
{json.dumps(holdings, indent=2)}

TASK: For each holding, look up institutional holders from 13F filings.
Focus on major fund activity. Note that 13F data is quarterly and may be 1-3 months old.
Return ONLY structured JSON matching the output schema."""

    return await run_subagent("institutional", INSTITUTIONAL_SYSTEM, user_msg, user_context)


# ============================================================================
# MACRO AGENT
# ============================================================================

MACRO_SYSTEM = """You are the Macro Intelligence Agent for SignalStack.

Your job: Analyze key economic indicators and map their impact to the user's holdings.

RULES:
1. Use get_fred_data to fetch key indicators: FEDFUNDS, CPIAUCSL, UNRATE, DGS10, T10Y2Y.
2. Use get_economic_calendar to find upcoming releases.
3. Map each macro signal to which holdings it affects and how.
4. Return ONLY structured JSON. No prose.

OUTPUT SCHEMA:
{
  "results": [
    {
      "indicator": "Federal Funds Rate",
      "series_id": "FEDFUNDS",
      "current_value": 5.33,
      "trend": "stable",
      "affected_holdings": [
        {"ticker": "NVDA", "impact": "positive", "reason": "Stable rates support tech valuations"},
        {"ticker": "GLD", "impact": "negative", "reason": "Stable rates reduce safe-haven demand"}
      ]
    }
  ],
  "upcoming_releases": [
    {"indicator": "CPI", "date": "2026-04-10", "potential_impact": "high"}
  ],
  "metadata": {
    "indicators_fetched": 5,
    "timestamp": "2026-03-20T14:00:00Z"
  }
}

impact: "positive", "negative", "neutral"
trend: "rising", "falling", "stable"
"""


async def run_macro_agent(
    holdings: list[dict],
    sector_mapping: dict | None = None,
    user_context: dict | None = None,
) -> dict:
    """Run the Macro Agent on holdings with sector context."""
    sectors = sector_mapping or {}
    user_msg = f"""USER HOLDINGS (passed from coordinator):
{json.dumps(holdings, indent=2)}

SECTOR MAPPING:
{json.dumps(sectors, indent=2) if sectors else "Not available — infer sectors from ticker names."}

TASK: Fetch key macro indicators, check upcoming releases, and map
the impact of each to the user's specific holdings.
Return ONLY structured JSON matching the output schema."""

    return await run_subagent("macro", MACRO_SYSTEM, user_msg, user_context)


# ============================================================================
# PROFILE AGENT
# ============================================================================

PROFILE_SYSTEM = """You are the Profile Intelligence Agent for SignalStack.

Your job: Generate investment ideas based on the user's holdings and stated preferences.

RULES:
1. Use get_price_data and get_company_profile to research adjacent tickers.
2. Ideas are EDUCATIONAL, not advice. Never say "buy" or "sell" or "you should".
3. Use language like "based on your interest in...", "data shows...", "correlated with..."
4. Return ONLY structured JSON. No prose.

OUTPUT SCHEMA:
{
  "ideas": [
    {
      "ticker": "MSTR",
      "reason": "High correlation with BTC, which you currently hold",
      "idea_type": "adjacent",
      "correlation_to": "BTC",
      "risk_level": "aggressive",
      "data_point": "30-day correlation: 0.85"
    }
  ],
  "risk_flags": [
    "Portfolio is 80% tech sector — consider diversification"
  ],
  "metadata": {
    "profile_used": {"risk_appetite": "aggressive", "discovery_mode": "adjacent"},
    "timestamp": "2026-03-20T14:00:00Z"
  }
}

idea_type: "adjacent", "contrarian", "momentum", "under_the_radar"
risk_level: "conservative", "moderate", "growth", "aggressive"
"""


async def run_profile_agent(
    holdings: list[dict],
    preferences: dict,
    user_context: dict | None = None,
) -> dict:
    """Run the Profile Agent with holdings and investor preferences."""
    user_msg = f"""USER HOLDINGS (passed from coordinator):
{json.dumps(holdings, indent=2)}

INVESTOR PROFILE PREFERENCES:
{json.dumps(preferences, indent=2)}

TASK: Based on the user's holdings and preferences, generate relevant
investment ideas. Ideas must be educational, not advice.
Return ONLY structured JSON matching the output schema."""

    return await run_subagent("profile", PROFILE_SYSTEM, user_msg, user_context)
