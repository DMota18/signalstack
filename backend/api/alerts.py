"""
SignalStack — Alert Routes
Read and interact with intelligence alerts. Alerts are created by the
backend (service role) — users can only read, mark as read, and submit feedback.
"""

from fastapi import APIRouter, Depends, Query

from backend.models.schemas import AlertFeedbackRequest, APIResponse
from backend.services.auth import CurrentUser, get_current_user
from backend.services.supabase import get_anon_client

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("", response_model=APIResponse)
async def list_alerts(
    user: CurrentUser = Depends(get_current_user),
    alert_type: str = Query(None, description="Filter by type, e.g. 'daily_digest'"),
    unread_only: bool = Query(False),
    limit: int = Query(20, ge=1, le=100),
):
    """List alerts for the current user, newest first."""
    db = get_anon_client()

    filters = {"user_id": f"eq.{user.id}"}
    if alert_type:
        filters["alert_type"] = f"eq.{alert_type}"
    if unread_only:
        filters["read_at"] = "is.null"
        filters["dismissed_at"] = "is.null"

    result = await db.select(
        table="alert_history",
        columns=(
            "id,alert_type,trigger_source,related_tickers,title,"
            "signals_used,channels_sent,read_at,dismissed_at,feedback,created_at"
        ),
        filters=filters,
        user_jwt=user.jwt_token,
        order="created_at.desc",
        limit=limit,
    )

    if result["status_code"] != 200:
        return APIResponse.fail(message="Failed to fetch alerts", code="fetch_error")

    return APIResponse.success(result["data"] if isinstance(result["data"], list) else [])


@router.get("/unread-count", response_model=APIResponse)
async def unread_count(user: CurrentUser = Depends(get_current_user)):
    """Get the count of unread alerts (for badge display)."""
    db = get_anon_client()
    result = await db.select(
        table="alert_history",
        columns="id",
        filters={
            "user_id": f"eq.{user.id}",
            "read_at": "is.null",
            "dismissed_at": "is.null",
        },
        user_jwt=user.jwt_token,
    )

    count = 0
    if result["status_code"] == 200 and isinstance(result["data"], list):
        count = len(result["data"])

    return APIResponse.success({"unread_count": count})


@router.get("/{alert_id}", response_model=APIResponse)
async def get_alert(
    alert_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Get a single alert with full body content. Marks it as read."""
    db = get_anon_client()

    # Fetch the alert
    result = await db.select(
        table="alert_history",
        filters={"id": f"eq.{alert_id}", "user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        single=True,
    )

    if result["status_code"] != 200:
        return APIResponse.fail(message="Alert not found", code="not_found")

    # Mark as read if not already
    alert = result["data"]
    if alert and not alert.get("read_at"):
        await db.update(
            table="alert_history",
            data={"read_at": "now()"},
            filters={"id": f"eq.{alert_id}", "user_id": f"eq.{user.id}"},
            user_jwt=user.jwt_token,
        )
        alert["read_at"] = "just_now"

    return APIResponse.success(alert)


@router.post("/{alert_id}/feedback", response_model=APIResponse)
async def submit_feedback(
    alert_id: str,
    req: AlertFeedbackRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Submit feedback on an alert (useful / not_useful).
    Used to improve intelligence quality over time."""
    db = get_anon_client()
    result = await db.update(
        table="alert_history",
        data={"feedback": req.feedback},
        filters={"id": f"eq.{alert_id}", "user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    if result["status_code"] == 200:
        return APIResponse.success({"alert_id": alert_id, "feedback": req.feedback})

    return APIResponse.fail(message="Failed to save feedback", code="update_error")


@router.post("/{alert_id}/dismiss", response_model=APIResponse)
async def dismiss_alert(
    alert_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Dismiss an alert without reading it."""
    db = get_anon_client()
    result = await db.update(
        table="alert_history",
        data={"dismissed_at": "now()"},
        filters={"id": f"eq.{alert_id}", "user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    if result["status_code"] == 200:
        return APIResponse.success({"alert_id": alert_id, "dismissed": True})

    return APIResponse.fail(message="Failed to dismiss alert", code="update_error")


@router.post("/{alert_id}/email", response_model=APIResponse)
async def email_alert(
    alert_id: str,
    user: CurrentUser = Depends(get_current_user),
):
    """Send an alert report to the user's email.

    Phase 1 stub — records the request and returns success.
    Phase 2 will integrate with an email provider (SES/Resend/Postmark).
    """
    import logging
    logger = logging.getLogger("alerts")

    # Verify the alert belongs to this user
    db = get_anon_client()
    result = await db.select(
        table="alert_history",
        columns="id,title,alert_type",
        filters={"id": f"eq.{alert_id}", "user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )

    if result["status_code"] != 200 or not result["data"]:
        return APIResponse.fail(message="Alert not found", code="not_found")

    alert = result["data"][0] if isinstance(result["data"], list) else result["data"]
    logger.info(f"Email delivery requested: alert={alert_id} user={user.id} title={alert.get('title')}")

    # Phase 2: integrate email provider here
    # For now, return success to indicate the request was received
    return APIResponse.success({
        "alert_id": alert_id,
        "email_queued": True,
        "message": "Email delivery will be available in a future update.",
    })
