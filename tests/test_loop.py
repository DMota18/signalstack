"""
SignalStack — Agentic Loop Tests

Tests for:
  - Correct stop_reason handling (tool_use → execute → loop, end_turn → return)
  - Safety cap (25 iterations) triggers correctly
  - produce_synthesis passthrough behavior
  - Tool execution and error propagation
  - Token tracking across iterations
"""

import json
from unittest.mock import AsyncMock, patch

import pytest

from backend.agents.loop import MAX_ITERATIONS, run_agent_loop
from tests.conftest import (
    make_claude_end_turn,
    make_claude_tool_use,
    make_synthesis_tool_use,
    make_user_context,
)

SIMPLE_SYSTEM = "You are a test agent."
SIMPLE_TOOLS = [{
    "name": "test_tool",
    "description": "A test tool",
    "input_schema": {
        "type": "object",
        "properties": {"query": {"type": "string"}},
        "required": ["query"],
    },
}]


# ============================================================================
# STOP_REASON HANDLING
# ============================================================================

class TestStopReasonEndTurn:
    """stop_reason == 'end_turn' must terminate the loop and return text."""

    @pytest.mark.asyncio
    async def test_end_turn_returns_final_text(self, mock_settings):
        with patch("backend.agents.loop._call_claude_api", new_callable=AsyncMock) as mock_api:
            mock_api.return_value = make_claude_end_turn("The analysis is complete.")

            result = await run_agent_loop(
                system_prompt=SIMPLE_SYSTEM,
                messages=[{"role": "user", "content": "Analyze NVDA"}],
                tools=SIMPLE_TOOLS,
            )

            assert result["stop_reason"] == "end_turn"
            assert result["text"] == "The analysis is complete."
            assert result["iterations"] == 1

    @pytest.mark.asyncio
    async def test_end_turn_tracks_tokens(self, mock_settings):
        with patch("backend.agents.loop._call_claude_api", new_callable=AsyncMock) as mock_api:
            mock_api.return_value = make_claude_end_turn(
                "Done.", usage={"input_tokens": 300, "output_tokens": 100}
            )

            result = await run_agent_loop(
                system_prompt=SIMPLE_SYSTEM,
                messages=[{"role": "user", "content": "test"}],
                tools=[],
            )

            assert result["tokens_used"] == 400


class TestStopReasonToolUse:
    """stop_reason == 'tool_use' must execute tools and continue the loop."""

    @pytest.mark.asyncio
    async def test_tool_use_executes_and_loops(self, mock_settings):
        with patch("backend.agents.loop._call_claude_api", new_callable=AsyncMock) as mock_api, \
             patch("backend.agents.loop.execute_tool", new_callable=AsyncMock) as mock_exec:

            # First call: tool_use, second call: end_turn
            mock_api.side_effect = [
                make_claude_tool_use("test_tool", {"query": "NVDA"}),
                make_claude_end_turn("Analysis done."),
            ]
            mock_exec.return_value = {"ok": True, "data": {"price": 950.0}}

            result = await run_agent_loop(
                system_prompt=SIMPLE_SYSTEM,
                messages=[{"role": "user", "content": "Get NVDA price"}],
                tools=SIMPLE_TOOLS,
            )

            assert result["stop_reason"] == "end_turn"
            assert result["iterations"] == 2
            assert len(result["tool_results"]) == 1
            assert result["tool_results"][0]["tool_name"] == "test_tool"
            mock_exec.assert_called_once_with("test_tool", {"query": "NVDA"})

    @pytest.mark.asyncio
    async def test_multiple_tool_calls_in_sequence(self, mock_settings):
        with patch("backend.agents.loop._call_claude_api", new_callable=AsyncMock) as mock_api, \
             patch("backend.agents.loop.execute_tool", new_callable=AsyncMock) as mock_exec:

            mock_api.side_effect = [
                make_claude_tool_use("test_tool", {"query": "NVDA"}, "toolu_1"),
                make_claude_tool_use("test_tool", {"query": "AAPL"}, "toolu_2"),
                make_claude_end_turn("Both analyzed."),
            ]
            mock_exec.return_value = {"ok": True, "data": {"price": 100.0}}

            result = await run_agent_loop(
                system_prompt=SIMPLE_SYSTEM,
                messages=[{"role": "user", "content": "Analyze both"}],
                tools=SIMPLE_TOOLS,
            )

            assert result["iterations"] == 3
            assert len(result["tool_results"]) == 2


class TestProduceSynthesisPassthrough:
    """produce_synthesis is a passthrough — input IS the output."""

    @pytest.mark.asyncio
    async def test_produce_synthesis_captures_input(self, mock_settings):
        with patch("backend.agents.loop._call_claude_api", new_callable=AsyncMock) as mock_api:
            mock_api.side_effect = [
                make_synthesis_tool_use(),
                make_claude_end_turn("Synthesis delivered."),
            ]

            result = await run_agent_loop(
                system_prompt=SIMPLE_SYSTEM,
                messages=[{"role": "user", "content": "Synthesize"}],
                tools=[{"name": "produce_synthesis", "description": "test", "input_schema": {"type": "object"}}],
            )

            assert len(result["tool_results"]) == 1
            tr = result["tool_results"][0]
            assert tr["tool_name"] == "produce_synthesis"
            assert "portfolio_summary" in tr["tool_input"]
            # produce_synthesis should NOT call execute_tool
            assert tr["result"]["ok"] is True


# ============================================================================
# PRE-EXECUTION HOOKS
# ============================================================================

class TestPreExecutionHookInLoop:
    """Pre-hooks can block tool calls within the loop."""

    @pytest.mark.asyncio
    async def test_blocked_tool_returns_error_to_claude(self, mock_settings):
        with patch("backend.agents.loop._call_claude_api", new_callable=AsyncMock) as mock_api:

            # Call execute_trade (blocked) then end_turn
            mock_api.side_effect = [
                make_claude_tool_use("execute_trade", {"ticker": "NVDA", "shares": 100}),
                make_claude_end_turn("Trade was blocked."),
            ]

            result = await run_agent_loop(
                system_prompt=SIMPLE_SYSTEM,
                messages=[{"role": "user", "content": "Buy NVDA"}],
                tools=SIMPLE_TOOLS,
                user_context=make_user_context(),
            )

            # The blocked tool result should be recorded
            assert len(result["tool_results"]) == 1
            tr = result["tool_results"][0]
            assert tr["result"]["ok"] is False
            assert "permission" in json.dumps(tr["result"]).lower() or "blocked" in json.dumps(tr["result"]).lower()


# ============================================================================
# SAFETY CAP
# ============================================================================

class TestSafetyCap:
    """The 25-iteration safety cap should trigger as a backstop."""

    @pytest.mark.asyncio
    async def test_safety_cap_stops_runaway_loop(self, mock_settings):
        with patch("backend.agents.loop._call_claude_api", new_callable=AsyncMock) as mock_api, \
             patch("backend.agents.loop.execute_tool", new_callable=AsyncMock) as mock_exec:

            # Return tool_use forever — should hit the cap
            mock_api.return_value = make_claude_tool_use("test_tool", {"query": "loop"})
            mock_exec.return_value = {"ok": True, "data": {}}

            result = await run_agent_loop(
                system_prompt=SIMPLE_SYSTEM,
                messages=[{"role": "user", "content": "Loop forever"}],
                tools=SIMPLE_TOOLS,
            )

            assert result["iterations"] == MAX_ITERATIONS
            assert result["stop_reason"] == "max_iterations"


# ============================================================================
# ERROR HANDLING
# ============================================================================

class TestLoopErrorHandling:
    """API errors should be handled gracefully."""

    @pytest.mark.asyncio
    async def test_api_error_returns_error_result(self, mock_settings):
        with patch("backend.agents.loop._call_claude_api", new_callable=AsyncMock) as mock_api:
            mock_api.side_effect = Exception("Connection refused")

            result = await run_agent_loop(
                system_prompt=SIMPLE_SYSTEM,
                messages=[{"role": "user", "content": "test"}],
                tools=[],
            )

            assert result["stop_reason"] == "error"
            assert "failed" in result["text"].lower()

    @pytest.mark.asyncio
    async def test_tool_execution_error_continues_loop(self, mock_settings):
        with patch("backend.agents.loop._call_claude_api", new_callable=AsyncMock) as mock_api, \
             patch("backend.agents.loop.execute_tool", new_callable=AsyncMock) as mock_exec:

            mock_api.side_effect = [
                make_claude_tool_use("test_tool", {"query": "fail"}),
                make_claude_end_turn("Handled the error."),
            ]
            mock_exec.side_effect = Exception("Tool crashed")

            result = await run_agent_loop(
                system_prompt=SIMPLE_SYSTEM,
                messages=[{"role": "user", "content": "test"}],
                tools=SIMPLE_TOOLS,
            )

            # Loop should continue despite tool error
            assert result["stop_reason"] == "end_turn"
            assert result["iterations"] == 2
            assert result["tool_results"][0]["result"]["ok"] is False
            assert result["tool_results"][0]["result"]["isRetryable"] is True


class TestToolChoiceFirstIteration:
    """tool_choice should only apply to the first iteration."""

    @pytest.mark.asyncio
    async def test_tool_choice_sent_on_first_iteration_only(self, mock_settings):
        with patch("backend.agents.loop._call_claude_api", new_callable=AsyncMock) as mock_api, \
             patch("backend.agents.loop.execute_tool", new_callable=AsyncMock) as mock_exec:

            mock_api.side_effect = [
                make_claude_tool_use("test_tool", {"query": "first"}),
                make_claude_end_turn("Done."),
            ]
            mock_exec.return_value = {"ok": True, "data": {}}

            await run_agent_loop(
                system_prompt=SIMPLE_SYSTEM,
                messages=[{"role": "user", "content": "test"}],
                tools=SIMPLE_TOOLS,
                tool_choice={"type": "tool", "name": "test_tool"},
            )

            # First call should include tool_choice
            first_call_body = mock_api.call_args_list[0][0][0]
            assert "tool_choice" in first_call_body

            # Second call should NOT include tool_choice
            if len(mock_api.call_args_list) > 1:
                second_call_body = mock_api.call_args_list[1][0][0]
                assert "tool_choice" not in second_call_body
