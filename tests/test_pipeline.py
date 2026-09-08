"""
SignalStack — Intelligence Pipeline Tests

generate_intelligence_events() is the single implementation behind the
blocking pipeline, the SSE stream, and scheduled jobs. These tests lock
in the compliance behavior of that shared core: the output interceptor
runs on every path, reformulation is attempted on violations, and the
regex strip guarantees delivery-safe output when reformulation fails.
"""

from unittest.mock import AsyncMock, patch

import pytest

from backend.services.hooks import DISCLAIMER, intercept_output
from backend.services.pipeline import (
    generate_intelligence,
    generate_intelligence_events,
)


def make_synthesis(narrative: str) -> dict:
    return {
        "portfolio_summary": {"total_holdings": 1, "signals_available": ["sentiment"]},
        "per_holding_intelligence": [
            {"ticker": "NVDA", "net_signal": "bullish", "narrative": narrative},
        ],
        "portfolio_level_insights": [],
        "disclaimer": DISCLAIMER,
    }


def make_coordinator_events(synthesis: dict):
    """Fake run_coordinator_events yielding one agent plus the result."""
    async def _events(user_id, model_override=None):
        yield {"event": "agent_start", "data": {"agent": "sentiment", "index": 1, "total": 7}}
        yield {"event": "agent_done", "data": {
            "agent": "sentiment", "status": "completed", "duration_ms": 5, "index": 1,
        }}
        yield {"event": "coordinator_done", "data": {
            "synthesis": synthesis,
            "agent_results": {"sentiment": {"status": "completed", "duration_ms": 5}},
            "total_tokens": 1000,
            "duration_ms": 10,
        }}
    return _events


BUDGET_OK = {"use_cache": False, "model": "claude-sonnet-test", "reason": "within_budget"}


def pipeline_patches(synthesis, budget=BUDGET_OK, reformulation_loop=None):
    """Patch every collaborator of the pipeline core."""
    return [
        patch("backend.services.pipeline.run_coordinator_events", make_coordinator_events(synthesis)),
        patch("backend.services.pipeline.select_model_for_user", AsyncMock(return_value=budget)),
        patch("backend.services.pipeline.get_cached_intelligence", AsyncMock(return_value=None)),
        patch("backend.services.pipeline.record_job_cost", AsyncMock()),
        patch("backend.services.pipeline.estimate_cost", lambda *a, **k: 0.01),
        patch("backend.services.pipeline._create_alert", AsyncMock(return_value="alert-123")),
        patch("backend.services.pipeline.run_agent_loop",
              reformulation_loop or AsyncMock(return_value={"tool_results": []})),
    ]


async def collect_events(gen):
    return [event async for event in gen]


class TestPipelineEventStream:
    @pytest.mark.asyncio
    async def test_events_relay_agent_progress_and_finish_with_complete(self):
        patches = pipeline_patches(make_synthesis("The data suggests bullish momentum."))
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            events = await collect_events(generate_intelligence_events("user-1", "on_demand", "user_request"))

        kinds = [e["event"] for e in events]
        assert "agent_start" in kinds
        assert "agent_done" in kinds
        assert kinds[-1] == "complete"

        complete = events[-1]["data"]
        assert complete["alert_id"] == "alert-123"
        assert complete["title"]
        assert complete["synthesis"]["per_holding_intelligence"][0]["ticker"] == "NVDA"

    @pytest.mark.asyncio
    async def test_blocking_wrapper_returns_complete_payload(self):
        patches = pipeline_patches(make_synthesis("The data suggests bullish momentum."))
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await generate_intelligence("user-1", "daily_digest", "scheduler")

        assert result["alert_id"] == "alert-123"
        assert result["tokens_used"] == 1000
        assert result["alert"]["type"] == "daily_digest"


class TestPipelineComplianceOnEveryPath:
    @pytest.mark.asyncio
    async def test_clean_synthesis_skips_reformulation(self):
        loop = AsyncMock(return_value={"tool_results": []})
        patches = pipeline_patches(make_synthesis("The signal is bullish."), reformulation_loop=loop)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await generate_intelligence("user-1")

        loop.assert_not_called()
        assert result["synthesis"]["per_holding_intelligence"][0]["narrative"] == "The signal is bullish."

    @pytest.mark.asyncio
    async def test_advice_language_triggers_reformulation(self):
        clean = make_synthesis("The data suggests strong momentum.")
        loop = AsyncMock(return_value={
            "tool_results": [{"tool_name": "produce_synthesis", "tool_input": clean}],
        })
        patches = pipeline_patches(make_synthesis("You should buy NVDA now."), reformulation_loop=loop)
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await generate_intelligence("user-1")

        loop.assert_called()
        narrative = result["synthesis"]["per_holding_intelligence"][0]["narrative"]
        assert narrative == "The data suggests strong momentum."

    @pytest.mark.asyncio
    async def test_failed_reformulation_falls_back_to_strip(self):
        # Reformulation loop never returns a synthesis → strip fallback
        patches = pipeline_patches(make_synthesis("You should buy NVDA now. I recommend adding more."))
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            result = await generate_intelligence("user-1")

        narrative = result["synthesis"]["per_holding_intelligence"][0]["narrative"]
        passed, _, violations = intercept_output(narrative)
        assert passed is True, f"delivered narrative still trips the filter: {violations}"
        assert "You should buy" not in narrative

    @pytest.mark.asyncio
    async def test_streamed_path_is_compliance_filtered_too(self):
        """The SSE endpoint consumes these same events — a violation must
        never reach the complete event."""
        patches = pipeline_patches(make_synthesis("You should buy NVDA now."))
        with patches[0], patches[1], patches[2], patches[3], patches[4], patches[5], patches[6]:
            events = await collect_events(generate_intelligence_events("user-1", "on_demand", "user_request"))

        complete = events[-1]["data"]
        narrative = complete["synthesis"]["per_holding_intelligence"][0]["narrative"]
        passed, _, violations = intercept_output(narrative)
        assert passed is True, f"streamed narrative still trips the filter: {violations}"


class TestPipelineCachedPath:
    @pytest.mark.asyncio
    async def test_daily_cap_serves_cache_without_running_agents(self):
        budget = {"use_cache": True, "model": "claude-haiku-test", "reason": "over_cap"}
        cached = {"alert_id": "cached-1", "title": "Cached digest", "synthesis": {}, "message": "cap hit"}
        patches = pipeline_patches(make_synthesis("unused"), budget=budget)
        with patches[0], patches[1], \
             patch("backend.services.pipeline.get_cached_intelligence", AsyncMock(return_value=cached)), \
             patches[3], patches[4], patches[5], patches[6]:
            events = await collect_events(generate_intelligence_events("user-1"))

        kinds = [e["event"] for e in events]
        assert "agent_start" not in kinds
        complete = events[-1]["data"]
        assert complete["cached"] is True
        assert complete["alert_id"] == "cached-1"
