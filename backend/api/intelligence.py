"""
SignalStack — Intelligence Routes

On-demand intelligence generation endpoints.
Scheduled runs go through Celery tasks; these endpoints
let users trigger intelligence directly from the dashboard.

Includes an SSE streaming endpoint that emits per-agent progress
so the frontend can show real-time status during generation.
"""

import json
import logging

from fastapi import APIRouter, Depends, Request
from fastapi.responses import StreamingResponse

from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.pipeline import generate_intelligence_events, generate_on_demand

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


@router.get("/stream")
async def stream_intelligence(
    request: Request,
    user: CurrentUser = Depends(get_current_user),
):
    """Stream intelligence generation progress via Server-Sent Events.

    A thin SSE adapter over generate_intelligence_events() — the same
    pipeline the REST endpoint and scheduled jobs use, so the output
    interceptor, reformulation loop, alert creation and cost recording
    apply to streamed output too. Events:

      event: status        data: {"message": "...", "phase": "..."}
      event: agent_start   data: {"agent": "sentiment", "index": 1, "total": 7}
      event: agent_done    data: {"agent": "sentiment", "status": "completed", "duration_ms": 1200}
      event: complete      data: {"alert_id": "...", "title": "...", "synthesis": {...}, ...}
      event: error         data: {"message": "..."}
    """
    async def event_stream():
        def sse(event: str, data: dict) -> str:
            return f"event: {event}\ndata: {json.dumps(data)}\n\n"

        try:
            async for event in generate_intelligence_events(
                user.id, alert_type="on_demand", trigger_source="user_request",
            ):
                yield sse(event["event"], event["data"])

                # Stop generating (and spending) for abandoned tabs
                if await request.is_disconnected():
                    logger.info(f"SSE client disconnected for {user.id}")
                    return
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
