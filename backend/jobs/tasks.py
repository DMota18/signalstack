"""
SignalStack — Celery Tasks

Scheduled and on-demand tasks for the intelligence pipeline.

Architecture:
  - "Scan" tasks run on a schedule (via beat). They query Supabase for
    eligible users and dispatch individual per-user tasks.
  - "Per-user" tasks do the actual work: build context, run agents,
    synthesize, deliver.

This separation ensures:
  1. Scans are fast (just a DB query + task dispatch)
  2. Per-user work runs in parallel across Celery workers
  3. One user's slow run doesn't block another's
  4. Failed per-user tasks can be retried independently

Session state rule (Domain 1.6):
  Scheduled jobs always start fresh sessions. Never resume stale sessions.
  Holdings and prices change between runs.
"""

import asyncio
import logging
from datetime import UTC, datetime, timedelta
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from backend.jobs.celery_app import celery_app
from backend.jobs.tracker import JobTracker
from backend.services.supabase import get_service_client

logger = logging.getLogger("tasks")


def run_async(coro):
    """Helper to run async code in Celery's sync task context.
    Creates a new event loop per invocation — safe for Celery workers."""
    loop = asyncio.new_event_loop()
    try:
        return loop.run_until_complete(coro)
    finally:
        loop.close()


async def _start_or_resume(tracker: JobTracker, run_id: str | None) -> None:
    """Start a fresh job_runs row, or re-attach to the one a previous
    retry attempt created."""
    if run_id:
        tracker.resume(run_id)
    else:
        await tracker.start()


async def _retry_or_fail(task, tracker: JobTracker, exc: Exception, task_kwargs: dict):
    """Retry a failed per-user task, reusing the same job_runs row.

    The row is marked failed only once retries are exhausted —
    intermediate attempts pass their run_id forward instead of leaving
    a trail of permanently-'failed' rows for a job that may yet succeed.
    """
    if task.request.retries >= task.max_retries:
        await tracker.fail(str(exc), "transient")
        raise exc
    raise task.retry(exc=exc, kwargs={**task_kwargs, "run_id": tracker.run_id})


# ============================================================================
# DAILY DIGEST
# ============================================================================

@celery_app.task(name="backend.jobs.tasks.run_daily_digest_scan")
def run_daily_digest_scan():
    """Scan for users who should receive their daily digest NOW.

    Runs every hour from 4-10 PM UTC. Checks each user's timezone
    to see if it's their preferred delivery hour (default: 5 PM local).
    Only selects pro and premium users (free tier gets email-only digest
    on a different schedule).
    """
    run_async(_daily_digest_scan())


async def _daily_digest_scan():
    db = get_service_client()

    # Get all pro/premium users with their timezone
    result = await db.select(
        table="profiles",
        columns="id,timezone,tier",
        filters={"tier": "in.(pro,premium)"},
    )

    if result["status_code"] != 200 or not isinstance(result["data"], list):
        logger.error(f"Daily digest scan failed: {result}")
        return

    now_utc = datetime.now(UTC)
    dispatched = 0

    for user in result["data"]:
        user_id = user["id"]
        user_tz = user.get("timezone", "America/New_York")

        # Check if it's the right hour in the user's timezone
        # Default delivery: 5 PM local time (17:00)
        if _is_delivery_hour(now_utc, user_tz, target_hour=17):
            # Check we haven't already sent today
            already_sent = await _digest_sent_today(user_id, "daily_digest")
            if not already_sent:
                run_user_digest.delay(user_id)
                dispatched += 1

    logger.info(f"Daily digest scan: dispatched {dispatched} user digests")


@celery_app.task(
    name="backend.jobs.tasks.run_user_digest",
    bind=True,
    max_retries=2,
    default_retry_delay=300,  # 5 min between retries
)
def run_user_digest(self, user_id: str, run_id: str | None = None):
    """Generate and deliver the daily digest for a single user.

    Pipeline (Domain 1.5 — fixed sequential):
      1. Build fresh UserContext (never resume stale session)
      2. Run all 5 signal agents in parallel
      3. Coordinator synthesizes
      4. Format per delivery channel
      5. Send (push + in-app, email for pro; all for premium)

    This is a stub — the actual intelligence pipeline is built in Phase 1.
    The structure is here so the scheduling infrastructure is complete.
    """
    run_async(_user_digest(self, user_id, run_id))


async def _user_digest(task, user_id: str, run_id: str | None = None):
    tracker = JobTracker(user_id, "daily_digest")
    await _start_or_resume(tracker, run_id)

    try:
        from backend.services.email import build_digest_email_html, send_email_to_user
        from backend.services.pipeline import format_for_push, generate_intelligence
        from backend.services.push import send_push_to_user

        result = await generate_intelligence(
            user_id=user_id,
            alert_type="daily_digest",
            trigger_source="scheduler",
        )

        # Record agent results in job tracker
        for agent_name, agent_info in result.get("agent_results", {}).items():
            await tracker.record_agent(
                agent_name,
                agent_info.get("status", "completed"),
                duration_ms=agent_info.get("duration_ms"),
                error=agent_info.get("error"),
            )

        synthesis = result.get("synthesis", {})

        # Send push notification
        push_payload = format_for_push(synthesis, "daily_digest")
        push_result = await send_push_to_user(
            user_id=user_id,
            title=push_payload["title"],
            body=push_payload["body"],
            data=push_payload.get("data"),
            url=f"/app/alerts/{result.get('alert_id', '')}",
        )

        # Send email with branded template
        db = get_service_client()
        user_profile = await db.select(
            table="profiles",
            columns="display_name",
            filters={"id": f"eq.{user_id}"},
            single=True,
        )
        user_name = ""
        if user_profile["status_code"] == 200 and isinstance(user_profile["data"], dict):
            user_name = user_profile["data"].get("display_name", "")

        email_html = build_digest_email_html(synthesis, user_name=user_name)
        email_subject = f"Daily digest: {len(synthesis.get('per_holding_intelligence', []))} holdings analyzed"
        email_result = await send_email_to_user(
            user_id=user_id,
            subject=email_subject,
            html_body=email_html,
        )

        # Update alert with actual delivery channels
        channels_sent = {"in_app": {"created_at": datetime.now(UTC).isoformat()}}
        if push_result.get("sent", 0) > 0:
            channels_sent["push"] = {"created_at": datetime.now(UTC).isoformat(), "devices": push_result["sent"]}
        if email_result.get("sent"):
            channels_sent["email"] = {"created_at": datetime.now(UTC).isoformat()}

        if result.get("alert_id"):
            await db.update(
                table="alert_history",
                data={"channels_sent": channels_sent},
                filters={"id": f"eq.{result['alert_id']}"},
            )

        await tracker.complete(
            alert_id=result.get("alert_id"),
            tokens_used=result.get("tokens_used"),
            cost_usd=result.get("cost_usd"),
        )

        logger.info(
            f"Daily digest for {user_id}: "
            f"alert={result.get('alert_id')}, "
            f"tokens={result.get('tokens_used')}, "
            f"duration={result.get('duration_ms')}ms, "
            f"push={push_result}, email={email_result}"
        )

    except Exception as e:
        logger.error(f"Daily digest failed for {user_id}: {e}")
        await _retry_or_fail(task, tracker, e, {"user_id": user_id})


# ============================================================================
# WEEKLY REPORT
# ============================================================================

@celery_app.task(name="backend.jobs.tasks.run_weekly_report_scan")
def run_weekly_report_scan():
    """Scan for users who should receive the Sunday evening weekly report."""
    run_async(_weekly_report_scan())


async def _weekly_report_scan():
    db = get_service_client()

    result = await db.select(
        table="profiles",
        columns="id,timezone,tier",
        filters={"tier": "in.(pro,premium)"},
    )

    if result["status_code"] != 200 or not isinstance(result["data"], list):
        logger.error(f"Weekly report scan failed: {result}")
        return

    now_utc = datetime.now(UTC)
    dispatched = 0

    for user in result["data"]:
        user_id = user["id"]
        user_tz = user.get("timezone", "America/New_York")

        if _is_delivery_hour(now_utc, user_tz, target_hour=18):
            already_sent = await _digest_sent_today(user_id, "weekly_report")
            if not already_sent:
                run_user_weekly_report.delay(user_id)
                dispatched += 1

    logger.info(f"Weekly report scan: dispatched {dispatched} reports")


@celery_app.task(
    name="backend.jobs.tasks.run_user_weekly_report",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def run_user_weekly_report(self, user_id: str, run_id: str | None = None):
    """Generate and deliver the weekly portfolio intelligence report for a user.

    Pipeline (same as daily digest with weekly framing):
      1. Build fresh UserContext (never resume stale session)
      2. Run all 5 signal agents in parallel
      3. Coordinator synthesizes with weekly context
      4. Format per delivery channel (weekly email template)
      5. Send (push + in-app + email for pro/premium)
    """
    run_async(_user_weekly_report(self, user_id, run_id))


async def _user_weekly_report(task, user_id: str, run_id: str | None = None):
    tracker = JobTracker(user_id, "weekly_report")
    await _start_or_resume(tracker, run_id)

    try:
        from backend.services.email import build_weekly_email_html, send_email_to_user
        from backend.services.pipeline import format_for_push, generate_intelligence
        from backend.services.push import send_push_to_user

        result = await generate_intelligence(
            user_id=user_id,
            alert_type="weekly_report",
            trigger_source="scheduler",
        )

        # Record agent results in job tracker
        for agent_name, agent_info in result.get("agent_results", {}).items():
            await tracker.record_agent(
                agent_name,
                agent_info.get("status", "completed"),
                duration_ms=agent_info.get("duration_ms"),
                error=agent_info.get("error"),
            )

        synthesis = result.get("synthesis", {})

        # Send push notification
        push_payload = format_for_push(synthesis, "weekly_report")
        push_result = await send_push_to_user(
            user_id=user_id,
            title=push_payload["title"],
            body=push_payload["body"],
            data=push_payload.get("data"),
            url=f"/app/alerts/{result.get('alert_id', '')}",
        )

        # Send email with weekly template
        db = get_service_client()
        user_profile = await db.select(
            table="profiles",
            columns="display_name",
            filters={"id": f"eq.{user_id}"},
            single=True,
        )
        user_name = ""
        if user_profile["status_code"] == 200 and isinstance(user_profile["data"], dict):
            user_name = user_profile["data"].get("display_name", "")

        email_html = build_weekly_email_html(synthesis, user_name=user_name)
        holdings_count = len(synthesis.get("per_holding_intelligence", []))
        email_subject = f"Weekly Report: {holdings_count} holdings analyzed"
        email_result = await send_email_to_user(
            user_id=user_id,
            subject=email_subject,
            html_body=email_html,
        )

        # Update alert with actual delivery channels
        channels_sent = {"in_app": {"created_at": datetime.now(UTC).isoformat()}}
        if push_result.get("sent", 0) > 0:
            channels_sent["push"] = {"created_at": datetime.now(UTC).isoformat(), "devices": push_result["sent"]}
        if email_result.get("sent"):
            channels_sent["email"] = {"created_at": datetime.now(UTC).isoformat()}

        if result.get("alert_id"):
            await db.update(
                table="alert_history",
                data={"channels_sent": channels_sent},
                filters={"id": f"eq.{result['alert_id']}"},
            )

        await tracker.complete(
            alert_id=result.get("alert_id"),
            tokens_used=result.get("tokens_used"),
            cost_usd=result.get("cost_usd"),
        )

        logger.info(
            f"Weekly report for {user_id}: "
            f"alert={result.get('alert_id')}, "
            f"tokens={result.get('tokens_used')}, "
            f"duration={result.get('duration_ms')}ms, "
            f"push={push_result}, email={email_result}"
        )

    except Exception as e:
        logger.error(f"Weekly report failed for {user_id}: {e}")
        await _retry_or_fail(task, tracker, e, {"user_id": user_id})


# ============================================================================
# PORTFOLIO SYNC
# ============================================================================

@celery_app.task(name="backend.jobs.tasks.run_portfolio_sync_scan")
def run_portfolio_sync_scan():
    """Scan for users with active brokerage connections and sync holdings."""
    run_async(_portfolio_sync_scan())


async def _portfolio_sync_scan():
    db = get_service_client()

    # Include stale connections — they may have recovered and should be retried
    result = await db.select(
        table="brokerage_connections",
        columns="id,user_id",
        filters={"status": "in.(active,stale)"},
    )

    if result["status_code"] != 200 or not isinstance(result["data"], list):
        logger.error(f"Portfolio sync scan failed: {result}")
        return

    dispatched = 0
    for conn in result["data"]:
        sync_user_portfolio.delay(conn["user_id"], conn["id"])
        dispatched += 1

    logger.info(f"Portfolio sync scan: dispatched {dispatched} syncs")


@celery_app.task(
    name="backend.jobs.tasks.sync_user_portfolio",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def sync_user_portfolio(self, user_id: str, connection_id: str, run_id: str | None = None):
    """Sync a single user's portfolio from SnapTrade.

    Fetches accounts + holdings via SnapTrade API, upserts into
    SignalStack's portfolios and holdings tables, then removes
    any stale holdings no longer present in the brokerage.
    """
    run_async(_sync_user_portfolio(self, user_id, connection_id, run_id))


async def _sync_user_portfolio(task, user_id: str, connection_id: str, run_id: str | None = None):
    tracker = JobTracker(user_id, "portfolio_sync")
    await _start_or_resume(tracker, run_id)

    try:
        from backend.services.snaptrade import sync_user_holdings
        sync_result = await sync_user_holdings(user_id)

        if sync_result["errors"]:
            await tracker.record_agent(
                "snaptrade_sync", "partial",
                metadata={
                    "accounts_synced": sync_result["accounts_synced"],
                    "holdings_synced": sync_result["holdings_synced"],
                    "errors": sync_result["errors"],
                },
            )
            await tracker.complete()
        else:
            await tracker.record_agent(
                "snaptrade_sync", "completed",
                metadata={
                    "accounts_synced": sync_result["accounts_synced"],
                    "holdings_synced": sync_result["holdings_synced"],
                },
            )
            await tracker.complete()

        # Remove stale holdings — positions the user no longer holds.
        # Scoped to portfolios that synced successfully in this run:
        # a failed account's holdings must never be deleted as "sold".
        if sync_result["holdings_synced"] > 0:
            stale_deleted = await _cleanup_stale_holdings(
                user_id, sync_result.get("synced_portfolio_ids", []),
            )
            if stale_deleted > 0:
                logger.info(f"Portfolio sync for {user_id}: removed {stale_deleted} stale holdings")

        logger.info(
            f"Portfolio sync for {user_id}: "
            f"{sync_result['accounts_synced']} accounts, "
            f"{sync_result['holdings_synced']} holdings"
        )

    except Exception as e:
        logger.error(f"Portfolio sync failed for {user_id}: {e}")
        await _retry_or_fail(task, tracker, e, {"user_id": user_id, "connection_id": connection_id})


# ============================================================================
# EARNINGS CALENDAR
# ============================================================================

@celery_app.task(name="backend.jobs.tasks.refresh_earnings_calendar")
def refresh_earnings_calendar():
    """Refresh the shared earnings calendar from Finnhub.
    Runs daily at 6 AM UTC. Fetches earnings dates for the next 30 days
    for all tickers held across all users."""
    run_async(_refresh_earnings_calendar())


async def _refresh_earnings_calendar():
    db = get_service_client()

    # Get all unique tickers held by any user
    result = await db.select(
        table="holdings",
        columns="ticker",
    )

    if result["status_code"] != 200 or not isinstance(result["data"], list):
        logger.error(f"Earnings calendar refresh failed to fetch tickers: {result}")
        return

    tickers = list(set(h["ticker"] for h in result["data"] if h.get("ticker")))
    if not tickers:
        logger.info("Earnings calendar: no tickers to refresh")
        return

    logger.info(f"Earnings calendar: refreshing for {len(tickers)} unique tickers")

    # Finnhub earnings calendar covers a date range (not per-ticker),
    # so one call gets all upcoming earnings. We then filter to our tickers.
    from backend.tools.finnhub import _finnhub_request

    today = datetime.now(UTC).strftime("%Y-%m-%d")
    future = (datetime.now(UTC) + timedelta(days=60)).strftime("%Y-%m-%d")

    api_result = await _finnhub_request(
        "/calendar/earnings",
        {"from": today, "to": future},
        "refresh_earnings_calendar",
    )

    if isinstance(api_result, dict) and api_result.get("ok") is False:
        logger.error(f"Earnings calendar: Finnhub request failed: {api_result.get('message')}")
        return

    if api_result.get("status_code") != 200:
        logger.error(f"Earnings calendar: Finnhub returned {api_result.get('status_code')}")
        return

    data = api_result["data"]
    all_earnings = data.get("earningsCalendar", []) if isinstance(data, dict) else []

    # Filter to tickers held by our users
    tickers_set = set(t.upper() for t in tickers)
    matched = [e for e in all_earnings if e.get("symbol", "").upper() in tickers_set]

    # Upsert into earnings_calendar
    hour_map = {"bmo": "Before market", "amc": "After market", "dmh": "During market"}
    upserted = 0

    for e in matched:
        ticker = e.get("symbol", "").upper()
        report_date = e.get("date", "")
        if not ticker or not report_date:
            continue

        row = {
            "ticker": ticker,
            "report_date": report_date,
            "report_time": hour_map.get((e.get("hour", "") or "").lower().strip(), "Time TBD"),
            "consensus_eps": e.get("epsEstimate"),
            "consensus_revenue": e.get("revenueEstimate"),
            "actual_eps": e.get("epsActual"),
            "actual_revenue": e.get("revenueActual"),
            "briefing_sent": False,
        }

        insert_res = await db.insert(
            table="earnings_calendar",
            data=row,
            upsert=True,
            on_conflict="ticker,report_date",
        )

        if insert_res["status_code"] in (200, 201):
            upserted += 1

    logger.info(
        f"Earnings calendar refresh: {upserted} upserted from "
        f"{len(matched)} matched / {len(all_earnings)} total Finnhub results"
    )


# ============================================================================
# PRE-EARNINGS BRIEFINGS
# ============================================================================

@celery_app.task(name="backend.jobs.tasks.run_pre_earnings_scan")
def run_pre_earnings_scan():
    """Scan for holdings with earnings in the next 5 days.
    Dispatch briefing generation for users who haven't received one yet."""
    run_async(_pre_earnings_scan())


async def _pre_earnings_scan():
    db = get_service_client()

    # Find tickers reporting in the next 5 days with no briefing sent.
    # PostgREST filters go into query params via a dict, so we can't use
    # two "report_date" keys. Fetch all unbriefed entries and filter in Python
    # (the earnings_calendar table is small — dozens of rows at most).
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    cutoff = (datetime.now(UTC) + timedelta(days=5)).strftime("%Y-%m-%d")

    earnings_result = await db.select(
        table="earnings_calendar",
        columns="ticker,report_date,report_time,consensus_eps,consensus_revenue",
        filters={"briefing_sent": "eq.false"},
    )

    if earnings_result["status_code"] != 200 or not isinstance(earnings_result["data"], list):
        logger.error(f"Pre-earnings scan failed: {earnings_result}")
        return

    # Filter to tickers reporting between today and 5 days from now
    upcoming = [
        e for e in earnings_result["data"]
        if e.get("report_date") and today <= e["report_date"] <= cutoff
    ]
    upcoming_tickers = [e["ticker"] for e in upcoming]
    if not upcoming_tickers:
        logger.info("Pre-earnings scan: no upcoming earnings needing briefings")
        return

    # Find pro/premium users holding these tickers
    ticker_filter = ",".join(upcoming_tickers)
    holdings_result = await db.select(
        table="holdings",
        columns="user_id,ticker",
        filters={"ticker": f"in.({ticker_filter})"},
    )

    if holdings_result["status_code"] != 200 or not isinstance(holdings_result["data"], list):
        return

    # Build earnings metadata lookup for the per-user task
    earnings_meta = {}
    for e in upcoming:
        earnings_meta[e["ticker"]] = {
            "report_date": e.get("report_date", ""),
            "report_time": e.get("report_time", "Time TBD"),
            "consensus_eps": e.get("consensus_eps"),
            "consensus_revenue": e.get("consensus_revenue"),
        }

    # Group by user and dispatch
    user_tickers: dict[str, list[str]] = {}
    for h in holdings_result["data"]:
        uid = h["user_id"]
        if uid not in user_tickers:
            user_tickers[uid] = []
        user_tickers[uid].append(h["ticker"])

    dispatched = 0
    for uid, tickers in user_tickers.items():
        run_user_earnings_briefing.delay(uid, tickers, earnings_meta)
        dispatched += 1

    logger.info(f"Pre-earnings scan: dispatched {dispatched} briefings for {len(upcoming_tickers)} tickers")


@celery_app.task(
    name="backend.jobs.tasks.run_user_earnings_briefing",
    bind=True,
    max_retries=2,
    default_retry_delay=300,
)
def run_user_earnings_briefing(self, user_id: str, tickers: list[str], earnings_meta: dict = None, run_id: str | None = None):
    """Generate pre-earnings intelligence briefing for specific tickers.

    Runs the intelligence pipeline scoped to tickers with upcoming earnings,
    then delivers via push + email with earnings-specific context
    (report date, time, consensus estimates).

    Args:
        user_id: The user who holds these tickers
        tickers: List of tickers with upcoming earnings
        earnings_meta: Dict of ticker -> {report_date, report_time, consensus_eps, consensus_revenue}
    """
    run_async(_user_earnings_briefing(self, user_id, tickers, earnings_meta or {}, run_id))


async def _user_earnings_briefing(task, user_id: str, tickers: list[str], earnings_meta: dict, run_id: str | None = None):
    tracker = JobTracker(user_id, "earnings_briefing")
    await _start_or_resume(tracker, run_id)

    try:
        from backend.services.email import build_earnings_briefing_email_html, send_email_to_user
        from backend.services.pipeline import generate_intelligence
        from backend.services.push import send_push_to_user

        result = await generate_intelligence(
            user_id=user_id,
            alert_type="pre_earnings",
            trigger_source="scheduler",
        )

        # Record agent results in job tracker
        for agent_name, agent_info in result.get("agent_results", {}).items():
            await tracker.record_agent(
                agent_name,
                agent_info.get("status", "completed"),
                duration_ms=agent_info.get("duration_ms"),
                error=agent_info.get("error"),
            )

        synthesis = result.get("synthesis", {})

        # Build push notification
        if len(tickers) == 1:
            push_title = f"{tickers[0]} earnings coming up"
        else:
            push_title = f"{tickers[0]} +{len(tickers) - 1} more — earnings ahead"

        push_body = "Pre-earnings intelligence briefing ready."
        holdings = synthesis.get("per_holding_intelligence", [])
        for h in holdings:
            if h.get("ticker") == tickers[0] and h.get("narrative"):
                push_body = h["narrative"][:180]
                break

        push_result = await send_push_to_user(
            user_id=user_id,
            title=push_title,
            body=push_body,
            data={"type": "pre_earnings", "tickers": tickers},
            url=f"/app/alerts/{result.get('alert_id', '')}",
        )

        # Send email
        db = get_service_client()
        user_profile = await db.select(
            table="profiles",
            columns="display_name",
            filters={"id": f"eq.{user_id}"},
            single=True,
        )
        user_name = ""
        if user_profile["status_code"] == 200 and isinstance(user_profile["data"], dict):
            user_name = user_profile["data"].get("display_name", "")

        email_html = build_earnings_briefing_email_html(
            synthesis=synthesis,
            earnings_meta=earnings_meta,
            tickers=tickers,
            user_name=user_name,
        )
        email_subject = f"Earnings preview: {', '.join(tickers[:3])}"
        if len(tickers) > 3:
            email_subject += f" +{len(tickers) - 3} more"
        email_result = await send_email_to_user(
            user_id=user_id,
            subject=email_subject,
            html_body=email_html,
        )

        # Update alert with delivery channels
        channels_sent = {"in_app": {"created_at": datetime.now(UTC).isoformat()}}
        if push_result.get("sent", 0) > 0:
            channels_sent["push"] = {"created_at": datetime.now(UTC).isoformat(), "devices": push_result["sent"]}
        if email_result.get("sent"):
            channels_sent["email"] = {"created_at": datetime.now(UTC).isoformat()}

        if result.get("alert_id"):
            await db.update(
                table="alert_history",
                data={"channels_sent": channels_sent},
                filters={"id": f"eq.{result['alert_id']}"},
            )

        # Mark briefing_sent on earnings_calendar for these tickers
        for ticker in tickers:
            await db.update(
                table="earnings_calendar",
                data={"briefing_sent": True},
                filters={
                    "ticker": f"eq.{ticker}",
                    "briefing_sent": "eq.false",
                },
            )

        await tracker.complete(
            alert_id=result.get("alert_id"),
            tokens_used=result.get("tokens_used"),
            cost_usd=result.get("cost_usd"),
        )

        logger.info(
            f"Earnings briefing for {user_id}: tickers={tickers}, "
            f"alert={result.get('alert_id')}, "
            f"tokens={result.get('tokens_used')}, "
            f"push={push_result}, email={email_result}"
        )

    except Exception as e:
        logger.error(f"Earnings briefing failed for {user_id}: {e}")
        await _retry_or_fail(task, tracker, e, {
            "user_id": user_id, "tickers": tickers, "earnings_meta": earnings_meta,
        })


# ============================================================================
# PRICE MONITOR
# ============================================================================

@celery_app.task(name="backend.jobs.tasks.run_price_monitor")
def run_price_monitor():
    """Check for significant price movements (>3%) across all tracked tickers.

    Runs every 5 minutes during market hours. When a move is detected,
    dispatches a "why is this moving?" alert for affected users.

    Dynamic decomposition (Domain 1.5): The coordinator determines which
    signal dimensions are relevant to the move, spawns only those subagents,
    synthesizes, and sends the alert if the threshold is met.

    Stub — implemented in Phase 2.
    """
    run_async(_price_monitor())


async def _price_monitor():
    """Check for significant price movements across tracked tickers.

    Pipeline:
    1. Fetch all enabled price alerts from price_alerts table
    2. Batch-fetch current prices via Finnhub (respecting 60 calls/min)
    3. Evaluate each alert: compare change_pct against threshold_pct + direction
    4. For triggered alerts: dispatch per-user "why is this moving?" intelligence
    5. Mark triggered alerts (update triggered_at) to avoid re-firing
    """
    import asyncio as _asyncio

    from backend.tools.finnhub import get_price_data

    db = get_service_client()

    # 1. Get all enabled price alerts that haven't been triggered today
    today = datetime.now(UTC).strftime("%Y-%m-%d")
    alerts_result = await db.select(
        table="price_alerts",
        columns="id,user_id,ticker,threshold_pct,direction,enabled,triggered_at",
        filters={"enabled": "eq.true"},
    )

    if alerts_result["status_code"] != 200:
        logger.warning("Price monitor: failed to fetch price alerts")
        return

    alerts = alerts_result.get("data", [])
    if not alerts:
        logger.info("Price monitor: no active price alerts configured")
        return

    # Filter out alerts already triggered today (avoid re-firing)
    active_alerts = []
    for a in alerts:
        if not isinstance(a, dict) or not a.get("ticker"):
            continue
        triggered_at = a.get("triggered_at")
        if triggered_at and triggered_at[:10] == today:
            continue  # Already fired today
        active_alerts.append(a)

    if not active_alerts:
        logger.info("Price monitor: all alerts already triggered today")
        return

    # 2. Get unique tickers and batch-fetch prices
    unique_tickers = list(set(a["ticker"] for a in active_alerts))
    logger.info(f"Price monitor: checking {len(unique_tickers)} tickers with {len(active_alerts)} active alerts")

    # Fetch prices in batches of 8 to respect Finnhub 60 calls/min
    # Monitor runs every 5 min, so 8 per run is conservative
    prices: dict[str, dict] = {}
    batch_size = 8

    for i in range(0, len(unique_tickers), batch_size):
        batch = unique_tickers[i:i + batch_size]
        results = await _asyncio.gather(
            *[get_price_data(ticker) for ticker in batch],
            return_exceptions=True,
        )

        for ticker, result in zip(batch, results, strict=True):
            if isinstance(result, Exception):
                logger.warning(f"Price monitor: failed to fetch {ticker}: {result}")
                continue
            if isinstance(result, dict) and result.get("ok"):
                prices[ticker] = result["data"]

        # Brief pause between batches if more remain
        if i + batch_size < len(unique_tickers):
            await _asyncio.sleep(2)

    if not prices:
        logger.warning("Price monitor: no prices fetched successfully")
        return

    # 3. Evaluate alerts against current prices
    triggered: list[dict] = []  # alerts that crossed threshold

    for alert in active_alerts:
        ticker = alert["ticker"]
        price_data = prices.get(ticker)
        if not price_data:
            continue

        change_pct = price_data.get("change_pct")
        if change_pct is None:
            continue

        threshold = alert.get("threshold_pct", 3.0)
        direction = alert.get("direction", "above")

        # "above" triggers when price moves UP by threshold_pct or more
        # "below" triggers when price moves DOWN by threshold_pct or more
        fired = False
        if direction == "above" and change_pct >= threshold:
            fired = True
        elif direction == "below" and change_pct <= -threshold:
            fired = True

        if fired:
            triggered.append({
                "alert_id": alert["id"],
                "user_id": alert["user_id"],
                "ticker": ticker,
                "direction": direction,
                "threshold_pct": threshold,
                "actual_change_pct": change_pct,
                "current_price": price_data.get("current_price"),
            })

    logger.info(f"Price monitor: {len(triggered)} alerts triggered out of {len(active_alerts)} active")

    if not triggered:
        return

    # 4. Group triggered alerts by user and dispatch intelligence tasks
    user_triggers: dict[str, list[dict]] = {}
    for t in triggered:
        uid = t["user_id"]
        if uid not in user_triggers:
            user_triggers[uid] = []
        user_triggers[uid].append(t)

    dispatched = 0
    for user_id, user_triggered in user_triggers.items():
        tickers = [t["ticker"] for t in user_triggered]
        trigger_data = {t["ticker"]: t for t in user_triggered}
        run_user_price_alert.delay(user_id, tickers, trigger_data)
        dispatched += 1

    logger.info(f"Price monitor: dispatched {dispatched} user alert tasks")

    # 5. Mark triggered alerts (update triggered_at)
    now_iso = datetime.now(UTC).isoformat()
    for t in triggered:
        await db.update(
            table="price_alerts",
            data={"triggered_at": now_iso},
            filters={"id": f"eq.{t['alert_id']}"},
        )


# ============================================================================
# PER-USER PRICE ALERT
# ============================================================================

@celery_app.task(
    name="backend.jobs.tasks.run_user_price_alert",
    bind=True,
    max_retries=1,
    default_retry_delay=120,
)
def run_user_price_alert(self, user_id: str, tickers: list[str], trigger_data: dict, run_id: str | None = None):
    """Generate "why is this moving?" intelligence for price-triggered tickers.

    Dispatched by the price monitor when one or more of a user's alerts fire.
    Runs the intelligence pipeline scoped to the triggered tickers, then
    delivers via push + email.

    Args:
        user_id: The user whose alerts fired
        tickers: List of tickers that triggered
        trigger_data: Dict of ticker -> {actual_change_pct, threshold_pct, direction, current_price}
    """
    run_async(_user_price_alert(self, user_id, tickers, trigger_data, run_id))


async def _user_price_alert(task, user_id: str, tickers: list[str], trigger_data: dict, run_id: str | None = None):
    tracker = JobTracker(user_id, "price_alert")
    await _start_or_resume(tracker, run_id)

    try:
        from backend.services.email import build_price_alert_email_html, send_email_to_user
        from backend.services.pipeline import generate_intelligence
        from backend.services.push import send_push_to_user

        result = await generate_intelligence(
            user_id=user_id,
            alert_type="price_movement",
            trigger_source="price_monitor",
        )

        # Record agent results in job tracker
        for agent_name, agent_info in result.get("agent_results", {}).items():
            await tracker.record_agent(
                agent_name,
                agent_info.get("status", "completed"),
                duration_ms=agent_info.get("duration_ms"),
                error=agent_info.get("error"),
            )

        synthesis = result.get("synthesis", {})

        # Build a concise push notification highlighting the move
        top_ticker = tickers[0] if tickers else ""
        top_data = trigger_data.get(top_ticker, {})
        change_pct = top_data.get("actual_change_pct", 0)
        direction_arrow = "+" if change_pct > 0 else ""

        push_title = f"{top_ticker} {direction_arrow}{change_pct:.1f}%"
        if len(tickers) > 1:
            push_title += f" (+{len(tickers) - 1} more)"

        push_body = "Analyzing why this is moving..."
        # Use the synthesis narrative if available
        holdings = synthesis.get("per_holding_intelligence", [])
        for h in holdings:
            if h.get("ticker") == top_ticker and h.get("narrative"):
                push_body = h["narrative"][:180]
                break

        push_result = await send_push_to_user(
            user_id=user_id,
            title=push_title,
            body=push_body,
            data={"type": "price_movement", "tickers": tickers},
            url=f"/app/alerts/{result.get('alert_id', '')}",
        )

        # Send email
        db = get_service_client()
        user_profile = await db.select(
            table="profiles",
            columns="display_name",
            filters={"id": f"eq.{user_id}"},
            single=True,
        )
        user_name = ""
        if user_profile["status_code"] == 200 and isinstance(user_profile["data"], dict):
            user_name = user_profile["data"].get("display_name", "")

        email_html = build_price_alert_email_html(
            synthesis=synthesis,
            trigger_data=trigger_data,
            tickers=tickers,
            user_name=user_name,
        )
        email_subject = f"{top_ticker} {direction_arrow}{change_pct:.1f}% — Price alert triggered"
        email_result = await send_email_to_user(
            user_id=user_id,
            subject=email_subject,
            html_body=email_html,
        )

        # Update alert with delivery channels
        channels_sent = {"in_app": {"created_at": datetime.now(UTC).isoformat()}}
        if push_result.get("sent", 0) > 0:
            channels_sent["push"] = {"created_at": datetime.now(UTC).isoformat(), "devices": push_result["sent"]}
        if email_result.get("sent"):
            channels_sent["email"] = {"created_at": datetime.now(UTC).isoformat()}

        if result.get("alert_id"):
            await db.update(
                table="alert_history",
                data={"channels_sent": channels_sent},
                filters={"id": f"eq.{result['alert_id']}"},
            )

        await tracker.complete(
            alert_id=result.get("alert_id"),
            tokens_used=result.get("tokens_used"),
            cost_usd=result.get("cost_usd"),
        )

        logger.info(
            f"Price alert for {user_id}: tickers={tickers}, "
            f"alert={result.get('alert_id')}, "
            f"tokens={result.get('tokens_used')}, "
            f"push={push_result}, email={email_result}"
        )

    except Exception as e:
        logger.error(f"Price alert failed for {user_id}: {e}")
        await _retry_or_fail(task, tracker, e, {
            "user_id": user_id, "tickers": tickers, "trigger_data": trigger_data,
        })


# ============================================================================
# POLYMARKET CATALOG SYNC
# ============================================================================

@celery_app.task(name="backend.jobs.tasks.sync_polymarket_catalog")
def sync_polymarket_catalog():
    """Fetch all active finance events from Polymarket and tag to tickers.

    Runs every 30 minutes. Fetches events, filters to finance/economy/crypto,
    auto-tags to stock tickers, and stores in polymarket_ticker_tags.
    """
    run_async(_sync_polymarket_catalog())


async def _sync_polymarket_catalog():
    from backend.services.polymarket_tagger import sync_polymarket_catalog
    result = await sync_polymarket_catalog()
    logger.info(f"Polymarket catalog sync: {result}")


# ============================================================================
# MAINTENANCE
# ============================================================================

@celery_app.task(name="backend.jobs.tasks.cleanup_polymarket_cache")
def cleanup_polymarket_cache():
    """Purge expired Polymarket cache entries."""
    run_async(_cleanup_polymarket_cache())


async def _cleanup_polymarket_cache():
    db = get_service_client()

    now = datetime.now(UTC).isoformat()
    result = await db.delete(
        table="polymarket_cache",
        filters={"expires_at": f"lt.{now}"},
    )

    if result["status_code"] == 200:
        deleted = result["data"]
        count = len(deleted) if isinstance(deleted, list) else 0
        logger.info(f"Polymarket cache cleanup: purged {count} expired entries")
    else:
        logger.warning(f"Polymarket cache cleanup failed: {result}")


# ============================================================================
# HELPERS
# ============================================================================

def _is_delivery_hour(now_utc: datetime, user_tz: str, target_hour: int) -> bool:
    """Check if the current UTC time corresponds to target_hour in the
    user's IANA timezone, DST-aware via stdlib zoneinfo.

    Unknown timezone names fall back to America/New_York.
    """
    try:
        zone = ZoneInfo(user_tz)
    except (ZoneInfoNotFoundError, ValueError):
        logger.warning(f"Unknown timezone '{user_tz}', defaulting to America/New_York")
        zone = ZoneInfo("America/New_York")

    return now_utc.astimezone(zone).hour == target_hour


async def _cleanup_stale_holdings(user_id: str, synced_portfolio_ids: list[str]) -> int:
    """Remove holdings that are no longer reported by the brokerage.

    Scoped to portfolios that were SUCCESSFULLY synced in this run: a
    holding there with an old synced_at was not refreshed, meaning the
    position was sold or removed. Portfolios whose sync failed are left
    untouched — otherwise one brokerage erroring while another succeeds
    would delete the failed account's entire position list as "sold".

    We use a 2-hour window (not exact timestamp matching) to handle
    cases where a sync partially fails and retries.

    Returns the count of deleted holdings.
    """
    if not synced_portfolio_ids:
        return 0

    db = get_service_client()

    cutoff = (datetime.now(UTC) - timedelta(hours=2)).isoformat()

    result = await db.delete(
        table="holdings",
        filters={
            "user_id": f"eq.{user_id}",
            "portfolio_id": f"in.({','.join(synced_portfolio_ids)})",
            "synced_at": f"lt.{cutoff}",
        },
    )

    if result["status_code"] == 200 and isinstance(result["data"], list):
        return len(result["data"])
    return 0


async def _digest_sent_today(user_id: str, alert_type: str) -> bool:
    """Check if a digest/report of the given type was already sent today."""
    db = get_service_client()
    today = datetime.now(UTC).strftime("%Y-%m-%d")

    result = await db.select(
        table="alert_history",
        columns="id",
        filters={
            "user_id": f"eq.{user_id}",
            "alert_type": f"eq.{alert_type}",
            "created_at": f"gte.{today}T00:00:00Z",
        },
        limit=1,
    )

    if result["status_code"] == 200 and isinstance(result["data"], list):
        return len(result["data"]) > 0
    return False
