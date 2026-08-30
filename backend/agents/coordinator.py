"""
SignalStack — Coordinator Agent (Domain 1.2, 4.1, 4.2)

The coordinator is the hub in the hub-and-spoke architecture.
It receives user context, dispatches 6 specialist subagents,
aggregates their structured JSON outputs, and produces the
final synthesized intelligence via the produce_synthesis tool.

Flow:
  1. Build context from UserContext
  2. Run 5 signal agents in parallel (Profile runs after)
  3. Collect results, noting any failures
  4. Pass all results to Claude coordinator for synthesis
  5. Validate synthesis output against schema
  6. Run output interceptor (advice language filter, disclaimer)
  7. Return final output

Key rules:
  - All 5 signal agents MUST be invoked before synthesis
  - Failed agents are noted explicitly in the output
  - Conflicting signals are called out, not hidden
  - NEVER say "buy", "sell", "you should", "I recommend"
  - Disclaimer is injected programmatically by the output interceptor
"""

import asyncio
import json
import logging
import time

from backend.agents.loop import run_agent_loop
from backend.agents.subagents import (
    run_insider_agent,
    run_institutional_agent,
    run_macro_agent,
    run_polymarket_agent,
    run_profile_agent,
    run_sentiment_agent,
)
from backend.services.context import build_user_context
from backend.services.hooks import (
    DISCLAIMER,
    check_concentration_warnings,
)

logger = logging.getLogger("agents.coordinator")


# ============================================================================
# SYNTHESIS TOOL SCHEMA (Domain 4.2 — enforced, not suggested)
# ============================================================================

SYNTHESIS_TOOL = {
    "name": "produce_synthesis",
    "description": (
        "Produces the final synthesized intelligence output for a user's portfolio. "
        "Use this tool to deliver the final result after analyzing all subagent outputs. "
        "The output must follow the exact schema specified."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "portfolio_summary": {
                "type": "object",
                "properties": {
                    "total_holdings": {"type": "integer"},
                    "analysis_timestamp": {"type": "string"},
                    "signals_available": {
                        "type": "array",
                        "items": {"type": "string"},
                    },
                    "signals_unavailable": {
                        "type": "array",
                        "items": {
                            "type": "object",
                            "properties": {
                                "dimension": {"type": "string"},
                                "reason": {"type": "string"},
                            },
                        },
                    },
                },
            },
            "per_holding_intelligence": {
                "type": "array",
                "items": {
                    "type": "object",
                    "properties": {
                        "ticker": {"type": "string"},
                        "position_pct": {"type": "number"},
                        "net_signal": {
                            "type": "string",
                            "enum": [
                                "strongly_bullish", "bullish", "neutral",
                                "bearish", "strongly_bearish", "conflicting",
                                "insufficient_data",
                            ],
                        },
                        "signal_breakdown": {
                            "type": "object",
                            "properties": {
                                "sentiment": {"type": ["string", "null"]},
                                "polymarket": {"type": ["string", "null"]},
                                "insider": {"type": ["string", "null"]},
                                "institutional": {"type": ["string", "null"]},
                                "macro": {"type": ["string", "null"]},
                            },
                        },
                        "narrative": {"type": "string"},
                        "conflicts": {
                            "type": ["array", "null"],
                            "items": {"type": "string"},
                        },
                        "upcoming_catalysts": {
                            "type": "array",
                            "items": {"type": "string"},
                        },
                    },
                    "required": ["ticker", "net_signal", "narrative"],
                },
            },
            "portfolio_level_insights": {
                "type": "array",
                "items": {"type": "string"},
            },
            "disclaimer": {"type": "string"},
        },
        "required": [
            "portfolio_summary",
            "per_holding_intelligence",
            "disclaimer",
        ],
    },
}


# ============================================================================
# COORDINATOR SYSTEM PROMPT (Domain 4.1)
# ============================================================================

COORDINATOR_SYSTEM = """You are the SignalStack Intelligence Coordinator. Your job is to synthesize
investment intelligence from multiple specialist agents and deliver a single,
coherent narrative to the user about their portfolio.

RULES:
1. You MUST analyze ALL subagent results before producing a synthesis.
2. If a signal agent returned an error, note the gap explicitly: "Insider data unavailable for NVDA due to [reason]."
3. Your synthesis must reference the user's ACTUAL holdings and position sizes.
4. NEVER say "buy", "sell", "you should", or "I recommend." Use: "the data suggests", "the signal is", "historically this pattern has..."
5. Every output must include the disclaimer: "This is market intelligence for educational purposes, not investment advice."
6. When signals conflict (e.g., bearish sentiment but bullish insider buying), explicitly call out the conflict and present both sides.
7. Use the produce_synthesis tool to deliver your final output in the required structured format.

CONFLICTING SIGNALS EXAMPLE:
"NVDA shows conflicting signals. Near-term sentiment is bearish on export restriction news,
but forward-looking indicators are bullish: Polymarket prices 73% odds of an earnings beat,
insiders bought $1.4M this week, and Bridgewater increased their position 15%. Earnings in
8 days. Net signal: short-term noise against bullish fundamentals."

INSUFFICIENT DATA EXAMPLE:
"MTPLF has limited signal coverage due to its Portuguese listing. Sentiment data is sparse
(2 articles in 30 days). No Polymarket, insider, or institutional data available for non-US
listings. Signals available: 1 of 5 dimensions."
"""


# ============================================================================
# MAIN COORDINATOR FUNCTION
# ============================================================================

async def run_coordinator(user_id: str, model_override: str | None = None) -> dict:
    """Run the full intelligence pipeline for a user.

    Args:
        user_id: SignalStack user ID
        model_override: If set, use this model instead of the default (for cost control)

    Returns:
        {
            "synthesis": dict,       # The structured synthesis output
            "agent_results": dict,   # Per-agent status/timing
            "total_tokens": int,
            "duration_ms": int,
        }
    """
    start_time = time.time()

    # 1. Build fresh user context (Domain 1.6 — never resume stale)
    ctx = await build_user_context(user_id)

    if not ctx.holdings:
        return {
            "synthesis": {
                "portfolio_summary": {
                    "total_holdings": 0,
                    "signals_available": [],
                    "signals_unavailable": [{"dimension": "all", "reason": "No holdings synced"}],
                },
                "per_holding_intelligence": [],
                "portfolio_level_insights": ["No holdings found. Connect a brokerage account to get started."],
                "disclaimer": DISCLAIMER,
            },
            "agent_results": {},
            "total_tokens": 0,
            "duration_ms": int((time.time() - start_time) * 1000),
        }

    # 2. Prepare holdings for subagents (explicit context passing)
    holdings_for_agents = ctx.holdings_for_subagent
    user_hook_context = {
        "user_id": user_id,
        "tier": ctx.tier,
        "has_investor_profile": ctx.preferences.risk_appetite != "moderate" or bool(ctx.preferences.sector_interests),
    }

    # 3. Run signal agents SEQUENTIALLY with delays (free tier rate limit safe)
    agent_results = {}
    agent_timings = {}
    INTER_AGENT_DELAY = 5  # seconds between agents to stay under rate limits

    async def _run_agent(name, coro):
        t0 = time.time()
        try:
            result = await coro
            elapsed = int((time.time() - t0) * 1000)
            agent_timings[name] = {"status": "completed" if result.get("ok") else "failed", "duration_ms": elapsed}
            agent_results[name] = result
            logger.info(f"Agent {name}: {'OK' if result.get('ok') else 'FAILED'} in {elapsed}ms")
        except Exception as e:
            elapsed = int((time.time() - t0) * 1000)
            agent_timings[name] = {"status": "failed", "duration_ms": elapsed, "error": str(e)}
            agent_results[name] = {"ok": False, "agent": name, "error": str(e)}
            logger.error(f"Agent {name} failed: {e}")

    # Sequential dispatch with delays between each agent
    agents = [
        ("sentiment", run_sentiment_agent(holdings_for_agents, user_hook_context)),
        ("polymarket", run_polymarket_agent(holdings_for_agents, ctx.upcoming_earnings, user_hook_context)),
        ("insider", run_insider_agent(holdings_for_agents, user_hook_context)),
        ("institutional", run_institutional_agent(holdings_for_agents, user_hook_context)),
        ("macro", run_macro_agent(holdings_for_agents, None, user_hook_context)),
    ]

    for i, (name, coro) in enumerate(agents):
        if i > 0:
            await asyncio.sleep(INTER_AGENT_DELAY)
        await _run_agent(name, coro)

    # Run Profile Agent last
    await asyncio.sleep(INTER_AGENT_DELAY)
    t0 = time.time()
    try:
        profile_result = await run_profile_agent(
            holdings_for_agents,
            {
                "risk_appetite": ctx.preferences.risk_appetite,
                "sector_interests": ctx.preferences.sector_interests,
                "discovery_mode": ctx.preferences.discovery_mode,
            },
            user_hook_context,
        )
        agent_timings["profile"] = {"status": "completed" if profile_result.get("ok") else "failed", "duration_ms": int((time.time() - t0) * 1000)}
        agent_results["profile"] = profile_result
    except Exception as e:
        agent_timings["profile"] = {"status": "failed", "duration_ms": int((time.time() - t0) * 1000), "error": str(e)}
        agent_results["profile"] = {"ok": False, "error": str(e)}

    # 5. Build coordinator prompt with all subagent results
    subagent_summary = _format_subagent_results(agent_results)
    concentration_warnings = check_concentration_warnings(holdings_for_agents)

    coordinator_user_msg = f"""{ctx.case_facts_block}

=== SUBAGENT RESULTS ===
{subagent_summary}

=== CONCENTRATION WARNINGS ===
{json.dumps(concentration_warnings) if concentration_warnings else "None"}

TASK: Synthesize all subagent results into a coherent portfolio intelligence report.
Use the produce_synthesis tool to deliver the structured output.
Reference actual holdings and position sizes. Call out conflicting signals explicitly."""

    # 6. Run coordinator synthesis with produce_synthesis tool
    synthesis_result = await run_agent_loop(
        system_prompt=COORDINATOR_SYSTEM,
        messages=[{"role": "user", "content": coordinator_user_msg}],
        tools=[SYNTHESIS_TOOL],
        user_context=user_hook_context,
        model=model_override,
        max_tokens=8192,
        tool_choice={"type": "tool", "name": "produce_synthesis"},
    )

    # 7. Extract synthesis from tool results
    synthesis = None
    for tr in synthesis_result.get("tool_results", []):
        if tr.get("tool_name") == "produce_synthesis":
            result_data = tr.get("result", {})
            if isinstance(result_data, dict):
                # The tool input IS the synthesis (tool_choice forces produce_synthesis)
                synthesis = tr.get("tool_input", result_data)
                break

    # Fallback: if produce_synthesis wasn't called, try to parse from text
    if not synthesis and synthesis_result.get("text"):
        try:
            synthesis = json.loads(synthesis_result["text"])
        except json.JSONDecodeError:
            synthesis = {
                "portfolio_summary": {"total_holdings": len(ctx.holdings), "signals_available": list(agent_results.keys())},
                "per_holding_intelligence": [],
                "portfolio_level_insights": [synthesis_result.get("text", "Synthesis generation incomplete.")],
                "disclaimer": DISCLAIMER,
            }

    if not synthesis:
        synthesis = {
            "portfolio_summary": {"total_holdings": len(ctx.holdings)},
            "per_holding_intelligence": [],
            "portfolio_level_insights": ["Intelligence synthesis could not be completed."],
            "disclaimer": DISCLAIMER,
        }

    # 8. Ensure disclaimer is present
    if "disclaimer" not in synthesis or synthesis["disclaimer"] != DISCLAIMER:
        synthesis["disclaimer"] = DISCLAIMER

    # 9. Add concentration warnings
    if concentration_warnings:
        existing = synthesis.get("portfolio_level_insights", [])
        synthesis["portfolio_level_insights"] = concentration_warnings + existing

    total_tokens = synthesis_result.get("tokens_used", 0)
    for ar in agent_results.values():
        total_tokens += ar.get("tokens_used", 0)

    return {
        "synthesis": synthesis,
        "agent_results": agent_timings,
        "total_tokens": total_tokens,
        "duration_ms": int((time.time() - start_time) * 1000),
    }


def _format_subagent_results(agent_results: dict) -> str:
    """Format all subagent results for the coordinator's prompt."""
    sections = []

    for agent_name, result in agent_results.items():
        if result.get("ok"):
            data = result.get("data", {})
            sections.append(f"--- {agent_name.upper()} AGENT (SUCCESS) ---\n{json.dumps(data, indent=2)}")
        else:
            error = result.get("error", result.get("message", "Unknown error"))
            sections.append(f"--- {agent_name.upper()} AGENT (FAILED) ---\nError: {error}")

    return "\n\n".join(sections)
