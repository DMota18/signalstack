"""
SignalStack — Intelligence Routes

On-demand intelligence generation endpoints.
Scheduled runs go through Celery tasks; these endpoints
let users trigger intelligence directly from the dashboard.

Includes an SSE streaming endpoint that emits per-agent progress
so the frontend can show real-time status during generation.
"""

import asyncio
import json
import logging
import time

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.pipeline import generate_on_demand

logger = logging.getLogger("api.intelligence")

router = APIRouter(prefix="/intelligence", tags=["intelligence"])


@router.post("/generate", response_model=APIResponse)
async def generate_intelligence_now(
    user: CurrentUser = Depends(get_current_user),
):
    """Generate a fresh portfolio intelligence report on demand.

    This runs the full coordinator pipeline: all signal agents
    sequentially, synthesis, and alert creation. Takes 2-5 minutes
    depending on portfolio size.
    """
    result = await generate_on_demand(user.id)

    response_data = {
        "alert_id": result.get("alert_id"),
        "title": result["alert"]["title"],
        "synthesis": result["synthesis"],
        "performance": {
            "duration_ms": result.get("duration_ms"),
            "tokens_used": result.get("tokens_used"),
            "agent_results": result.get("agent_results"),
        },
    }

    # Surface cache/budget info to frontend
    if result.get("cached"):
        response_data["cached"] = True
        response_data["cache_message"] = result.get("cache_message", "")

    if result.get("model_used"):
        response_data["model_used"] = result["model_used"]

    return APIResponse.success(response_data)


@router.get("/latest", response_model=APIResponse)
async def get_latest_intelligence(
    user: CurrentUser = Depends(get_current_user),
):
    """Get the most recent intelligence report for the user.
    Does NOT generate new intelligence — returns the last cached result."""
    from backend.services.supabase import get_anon_client
    db = get_anon_client()

    result = await db.select(
        table="alert_history",
        columns="id,alert_type,title,body_json,related_tickers,signals_used,created_at",
        filters={
            "user_id": f"eq.{user.id}",
            "alert_type": "in.(daily_digest,weekly_report,on_demand)",
        },
        user_jwt=user.jwt_token,
        order="created_at.desc",
        limit=1,
    )

    if result["status_code"] == 200 and isinstance(result["data"], list) and result["data"]:
        return APIResponse.success(result["data"][0])

    return APIResponse.success({"message": "No intelligence reports yet. Generate one or wait for your daily digest."})


# ============================================================================
# SSE STREAMING ENDPOINT
# ============================================================================

AGENT_SEQUENCE = ["sentiment", "polymarket", "insider", "institutional", "macro", "profile", "synthesis"]


@router.get("/stream")
async def stream_intelligence(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
):
    """Stream intelligence generation progress via Server-Sent Events.

    Emits events as each agent starts/completes:
      event: agent_start   data: {"agent": "sentiment", "index": 1, "total": 7}
      event: agent_done    data: {"agent": "sentiment", "status": "completed", "duration_ms": 1200}
      event: synthesis     data: {"status": "started"}
      event: complete      data: {"alert_id": "...", "synthesis": {...}, "duration_ms": ...}
      event: error         data: {"message": "..."}

    The frontend connects with EventSource and renders a progress UI.
    """
    async def event_stream():
        start_time = time.time()

        def sse(event: str, data: dict) -> str:
            return f"event: {event}\ndata: {json.dumps(data)}\n\n"

        try:
            from backend.agents.coordinator import COORDINATOR_SYSTEM, SYNTHESIS_TOOL, _format_subagent_results
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
            from backend.services.cost_control import (
                estimate_cost,
                get_cached_intelligence,
                record_job_cost,
                select_model_for_user,
            )
            from backend.services.hooks import DISCLAIMER, check_concentration_warnings
            from backend.services.pipeline import _build_alert_title, _create_alert

            # Check cost budget
            yield sse("status", {"message": "Checking budget...", "phase": "init"})

            model_decision = await select_model_for_user(user.id)
            if model_decision["use_cache"]:
                cached = await get_cached_intelligence(user.id)
                if cached:
                    yield sse("complete", {
                        "alert_id": cached.get("alert_id"),
                        "synthesis": cached.get("synthesis", {}),
                        "cached": True,
                        "cache_message": cached.get("message", ""),
                        "duration_ms": int((time.time() - start_time) * 1000),
                    })
                    return

            # Build user context
            yield sse("status", {"message": "Loading portfolio...", "phase": "context"})
            ctx = await build_user_context(user.id)

            if not ctx.holdings:
                yield sse("complete", {
                    "synthesis": {
                        "portfolio_summary": {"total_holdings": 0},
                        "per_holding_intelligence": [],
                        "portfolio_level_insights": ["No holdings found. Connect a brokerage or add holdings manually."],
                        "disclaimer": DISCLAIMER,
                    },
                    "duration_ms": int((time.time() - start_time) * 1000),
                })
                return

            holdings = ctx.holdings_for_subagent
            user_hook_context = {
                "user_id": user.id,
                "tier": ctx.tier,
                "has_investor_profile": ctx.preferences.risk_appetite != "moderate" or bool(ctx.preferences.sector_interests),
            }

            # Run signal agents sequentially with progress events
            agent_results = {}
            total_agents = len(AGENT_SEQUENCE)

            # Agents in sequence with inter-agent delays
            agent_coros = [
                ("sentiment", run_sentiment_agent(holdings, user_hook_context)),
                ("polymarket", run_polymarket_agent(holdings, ctx.upcoming_earnings, user_hook_context)),
                ("insider", run_insider_agent(holdings, user_hook_context)),
                ("institutional", run_institutional_agent(holdings, user_hook_context)),
                ("macro", run_macro_agent(holdings, None, user_hook_context)),
            ]

            for i, (name, coro) in enumerate(agent_coros):
                if i > 0:
                    await asyncio.sleep(5)  # Inter-agent rate limit delay

                # Emit start event
                yield sse("agent_start", {"agent": name, "index": i + 1, "total": total_agents})

                t0 = time.time()
                try:
                    result = await coro
                    elapsed = int((time.time() - t0) * 1000)
                    status = "completed" if result.get("ok") else "failed"
                    agent_results[name] = result
                except Exception as e:
                    elapsed = int((time.time() - t0) * 1000)
                    status = "failed"
                    agent_results[name] = {"ok": False, "agent": name, "error": str(e)}

                yield sse("agent_done", {"agent": name, "status": status, "duration_ms": elapsed, "index": i + 1})

                # Check if client disconnected
                if await request.is_disconnected():
                    logger.info(f"SSE client disconnected during agent {name}")
                    return

            # Profile agent (runs after signal agents)
            await asyncio.sleep(5)
            yield sse("agent_start", {"agent": "profile", "index": 6, "total": total_agents})

            t0 = time.time()
            try:
                profile_result = await run_profile_agent(
                    holdings,
                    {
                        "risk_appetite": ctx.preferences.risk_appetite,
                        "sector_interests": ctx.preferences.sector_interests,
                        "discovery_mode": ctx.preferences.discovery_mode,
                    },
                    user_hook_context,
                )
                elapsed = int((time.time() - t0) * 1000)
                status = "completed" if profile_result.get("ok") else "failed"
                agent_results["profile"] = profile_result
            except Exception as e:
                elapsed = int((time.time() - t0) * 1000)
                status = "failed"
                agent_results["profile"] = {"ok": False, "error": str(e)}

            yield sse("agent_done", {"agent": "profile", "status": status, "duration_ms": elapsed, "index": 6})

            # Synthesis phase
            yield sse("agent_start", {"agent": "synthesis", "index": 7, "total": total_agents})

            subagent_summary = _format_subagent_results(agent_results)
            concentration_warnings = check_concentration_warnings(holdings)

            coordinator_user_msg = f"""{ctx.case_facts_block}

=== SUBAGENT RESULTS ===
{subagent_summary}

=== CONCENTRATION WARNINGS ===
{json.dumps(concentration_warnings) if concentration_warnings else "None"}

TASK: Synthesize all subagent results into a coherent portfolio intelligence report.
Use the produce_synthesis tool to deliver the structured output.
Reference actual holdings and position sizes. Call out conflicting signals explicitly."""

            model_override = model_decision["model"] if model_decision["reason"] != "within_budget" else None

            synthesis_result = await run_agent_loop(
                system_prompt=COORDINATOR_SYSTEM,
                messages=[{"role": "user", "content": coordinator_user_msg}],
                tools=[SYNTHESIS_TOOL],
                user_context=user_hook_context,
                model=model_override,
                max_tokens=8192,
                tool_choice={"type": "tool", "name": "produce_synthesis"},
            )

            # Extract synthesis
            synthesis = None
            for tr in synthesis_result.get("tool_results", []):
                if tr.get("tool_name") == "produce_synthesis":
                    synthesis = tr.get("tool_input", tr.get("result", {}))
                    break

            if not synthesis:
                synthesis = {
                    "portfolio_summary": {"total_holdings": len(ctx.holdings)},
                    "per_holding_intelligence": [],
                    "portfolio_level_insights": ["Intelligence synthesis could not be completed."],
                    "disclaimer": DISCLAIMER,
                }

            if "disclaimer" not in synthesis or synthesis["disclaimer"] != DISCLAIMER:
                synthesis["disclaimer"] = DISCLAIMER

            if concentration_warnings:
                existing = synthesis.get("portfolio_level_insights", [])
                synthesis["portfolio_level_insights"] = concentration_warnings + existing

            yield sse("agent_done", {"agent": "synthesis", "status": "completed", "index": 7})

            # Create alert
            related_tickers = [h.get("ticker") for h in synthesis.get("per_holding_intelligence", []) if h.get("ticker")]
            signals_used = synthesis.get("portfolio_summary", {}).get("signals_available", [])
            title = _build_alert_title("on_demand", synthesis)

            alert_id = await _create_alert(
                user_id=user.id,
                alert_type="on_demand",
                trigger_source="user_request",
                title=title,
                body_json=synthesis,
                related_tickers=related_tickers,
                signals_used=signals_used,
            )

            # Record cost
            total_tokens = synthesis_result.get("tokens_used", 0)
            for ar in agent_results.values():
                total_tokens += ar.get("tokens_used", 0)

            model_used = model_decision["model"]
            cost_usd = estimate_cost(model_used, total_tokens // 2, total_tokens // 2)
            await record_job_cost(user.id, total_tokens, cost_usd)

            duration_ms = int((time.time() - start_time) * 1000)

            yield sse("complete", {
                "alert_id": alert_id,
                "title": title,
                "synthesis": synthesis,
                "duration_ms": duration_ms,
                "tokens_used": total_tokens,
            })

        except Exception as e:
            logger.error(f"SSE intelligence stream error for {user.id}: {e}")
            yield sse("error", {"message": str(e)})

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",  # Disable nginx buffering
        },
    )
