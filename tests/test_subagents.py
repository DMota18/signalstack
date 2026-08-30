"""
SignalStack — Subagent Contract Tests

Subagents must return structured JSON. Prose is a contract failure and
must be reported as such — otherwise job status accounting (5/5 =
completed, partial, failed) silently corrupts and the coordinator is
fed an unusable SUCCESS section.
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.agents.subagents import run_subagent


def _loop_result(text: str) -> dict:
    return {"text": text, "iterations": 2, "tokens_used": 500, "tool_results": []}


class TestSubagentJsonContract:
    @pytest.mark.asyncio
    async def test_valid_json_is_success(self):
        payload = '{"results": [{"ticker": "NVDA", "sentiment_score": 0.6}]}'
        with patch("backend.agents.subagents.run_agent_loop", new_callable=AsyncMock) as loop, \
             patch("backend.agents.subagents.get_schemas_for_agent", return_value=[]):
            loop.return_value = _loop_result(payload)
            result = await run_subagent("sentiment", "system", "message")

        assert result["ok"] is True
        assert result["data"]["results"][0]["ticker"] == "NVDA"

    @pytest.mark.asyncio
    async def test_fenced_json_is_success(self):
        payload = '```json\n{"results": []}\n```'
        with patch("backend.agents.subagents.run_agent_loop", new_callable=AsyncMock) as loop, \
             patch("backend.agents.subagents.get_schemas_for_agent", return_value=[]):
            loop.return_value = _loop_result(payload)
            result = await run_subagent("macro", "system", "message")

        assert result["ok"] is True
        assert result["data"] == {"results": []}

    @pytest.mark.asyncio
    async def test_prose_output_is_failure_not_success(self):
        prose = "NVDA looks bullish based on my analysis of recent headlines."
        with patch("backend.agents.subagents.run_agent_loop", new_callable=AsyncMock) as loop, \
             patch("backend.agents.subagents.get_schemas_for_agent", return_value=[]):
            loop.return_value = _loop_result(prose)
            result = await run_subagent("sentiment", "system", "message")

        assert result["ok"] is False
        assert result["error"] == "invalid_json"
        # Raw text preserved for debugging, never presented as data
        assert result["raw_text"] == prose
        assert "data" not in result

    @pytest.mark.asyncio
    async def test_no_output_is_failure(self):
        with patch("backend.agents.subagents.run_agent_loop", new_callable=AsyncMock) as loop, \
             patch("backend.agents.subagents.get_schemas_for_agent", return_value=[]):
            loop.return_value = _loop_result("")
            result = await run_subagent("insider", "system", "message")

        assert result["ok"] is False
        assert result["error"] == "no_output"
