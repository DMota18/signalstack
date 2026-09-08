"""
SignalStack — Coordinator Isolation Tests

The hub-and-spoke architecture's headline claim: subagents share no
context. Each specialist sees only what the coordinator explicitly
passes (holdings, preferences); one agent's output must never leak
into another agent's prompt. Aggregation happens exactly once, in the
synthesis call.
"""

import json
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest

from backend.agents.coordinator import run_coordinator

AGENT_ORDER = ["sentiment", "polymarket", "insider", "institutional", "macro", "profile"]


def make_ctx():
    return SimpleNamespace(
        holdings=[{"ticker": "NVDA"}],
        holdings_for_subagent=[{"ticker": "NVDA", "quantity": 20, "pct_of_portfolio": 60.0}],
        tier="pro",
        preferences=SimpleNamespace(
            risk_appetite="aggressive",
            sector_interests=["ai_semiconductors"],
            discovery_mode="adjacent",
        ),
        upcoming_earnings=[],
        case_facts_block="=== CASE FACTS ===\nNVDA 60%",
    )


def subagent_loop_responses():
    """Each subagent call returns JSON carrying a unique leak marker."""
    counter = {"n": 0}

    async def _loop(**kwargs):
        counter["n"] += 1
        marker = f"LEAK_MARKER_{counter['n']}"
        return {
            "text": json.dumps({"results": [], "marker": marker}),
            "tool_results": [],
            "iterations": 1,
            "tokens_used": 10,
            "input_tokens": 6,
            "output_tokens": 4,
        }

    return _loop


SYNTHESIS = {
    "portfolio_summary": {"total_holdings": 1, "signals_available": AGENT_ORDER},
    "per_holding_intelligence": [
        {"ticker": "NVDA", "net_signal": "bullish", "narrative": "The data suggests momentum."},
    ],
    "portfolio_level_insights": [],
    "disclaimer": "This is market intelligence for educational purposes, not investment advice.",
}


class TestSubagentContextIsolation:
    @pytest.mark.asyncio
    async def test_no_subagent_sees_another_subagents_output(self):
        subagent_loop = AsyncMock(side_effect=subagent_loop_responses())
        synthesis_loop = AsyncMock(return_value={
            "text": "",
            "tool_results": [{"tool_name": "produce_synthesis", "tool_input": SYNTHESIS}],
            "iterations": 1,
            "tokens_used": 100,
            "input_tokens": 60,
            "output_tokens": 40,
        })

        with patch("backend.agents.subagents.run_agent_loop", subagent_loop), \
             patch("backend.agents.coordinator.run_agent_loop", synthesis_loop), \
             patch("backend.agents.coordinator.build_user_context", AsyncMock(return_value=make_ctx())), \
             patch("backend.agents.subagents.get_schemas_for_agent", return_value=[]), \
             patch("asyncio.sleep", AsyncMock()):
            result = await run_coordinator("user-1")

        # All six subagents ran, in the documented order, each isolated
        assert subagent_loop.call_count == len(AGENT_ORDER)

        for i, call in enumerate(subagent_loop.call_args_list, start=1):
            prompt = json.dumps(call.kwargs.get("messages") or call.args[1])
            # Every subagent gets the explicitly-passed holdings...
            assert "NVDA" in prompt
            # ...and NONE of the outputs produced by agents that ran before it
            for earlier in range(1, i):
                assert f"LEAK_MARKER_{earlier}" not in prompt, (
                    f"subagent call {i} saw output from subagent {earlier}"
                )

        # Aggregation happens exactly once: the synthesis prompt carries
        # every subagent's structured output plus the case facts block
        synthesis_prompt = json.dumps(synthesis_loop.call_args.kwargs["messages"])
        for n in range(1, len(AGENT_ORDER) + 1):
            assert f"LEAK_MARKER_{n}" in synthesis_prompt
        assert "CASE FACTS" in synthesis_prompt

        # And the coordinator returns the structured synthesis with the
        # per-agent status accounting intact
        assert result["synthesis"]["per_holding_intelligence"][0]["ticker"] == "NVDA"
        assert set(result["agent_results"].keys()) == set(AGENT_ORDER)
        assert all(v["status"] == "completed" for v in result["agent_results"].values())

    @pytest.mark.asyncio
    async def test_failed_subagent_is_reported_not_hidden(self):
        async def failing_then_ok(**kwargs):
            if subagent_loop.call_count == 1:
                raise RuntimeError("Gamma API exploded")
            return {
                "text": json.dumps({"results": []}),
                "tool_results": [], "iterations": 1,
                "tokens_used": 10, "input_tokens": 5, "output_tokens": 5,
            }

        subagent_loop = AsyncMock(side_effect=failing_then_ok)
        synthesis_loop = AsyncMock(return_value={
            "text": "",
            "tool_results": [{"tool_name": "produce_synthesis", "tool_input": SYNTHESIS}],
            "iterations": 1, "tokens_used": 100, "input_tokens": 60, "output_tokens": 40,
        })

        with patch("backend.agents.subagents.run_agent_loop", subagent_loop), \
             patch("backend.agents.coordinator.run_agent_loop", synthesis_loop), \
             patch("backend.agents.coordinator.build_user_context", AsyncMock(return_value=make_ctx())), \
             patch("backend.agents.subagents.get_schemas_for_agent", return_value=[]), \
             patch("asyncio.sleep", AsyncMock()):
            result = await run_coordinator("user-1")

        statuses = result["agent_results"]
        assert statuses["sentiment"]["status"] == "failed"
        assert sum(1 for v in statuses.values() if v["status"] == "completed") == 5

        # The synthesis prompt names the failure explicitly — gaps are
        # surfaced to the model, never hidden
        synthesis_prompt = json.dumps(synthesis_loop.call_args.kwargs["messages"])
        assert "FAILED" in synthesis_prompt
        assert "Gamma API exploded" in synthesis_prompt
