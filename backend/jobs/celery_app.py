"""
SignalStack — Celery Application

Celery + Redis job queue for scheduled intelligence runs.

Broker: Redis (also used for result backend and rate limit counters)
Serializer: JSON (all task args must be JSON-serializable — no Python objects)

Run the worker:
  celery -A backend.jobs.celery_app worker --loglevel=info --concurrency=4

Run the beat scheduler:
  celery -A backend.jobs.celery_app beat --loglevel=info

Run both in one process (development only):
  celery -A backend.jobs.celery_app worker --beat --loglevel=info --concurrency=2
"""

import os

from celery import Celery
from celery.schedules import crontab

# Redis URL — defaults to localhost for development
REDIS_URL = os.environ.get("REDIS_URL", "redis://localhost:6379/0")

# Create the Celery app
celery_app = Celery(
    "signalstack",
    broker=REDIS_URL,
    backend=REDIS_URL,
)

celery_app.conf.update(
    # Serialization: JSON only — forces all args to be serializable,
    # which prevents accidentally passing ORM objects or dataclasses
    task_serializer="json",
    result_serializer="json",
    accept_content=["json"],

    # Timezone: UTC for all scheduling, converted to user tz at delivery
    timezone="UTC",
    enable_utc=True,

    # Task behavior
    task_acks_late=True,              # Ack after task completes (not on receive)
    task_reject_on_worker_lost=True,  # Requeue if worker crashes mid-task
    # A full digest runs six sequential agent loops plus synthesis with
    # inter-agent delays — 2-5+ minutes on a real portfolio. The limits
    # must clear the longest legitimate run, or the worker kills digests
    # mid-generation after the Claude spend is already incurred.
    task_soft_time_limit=900,         # 15 min soft limit (raises SoftTimeLimitExceeded)
    task_time_limit=960,              # 16 min hard limit (kills the task)
    worker_prefetch_multiplier=1,     # Don't prefetch — tasks are long-running

    # Result expiration: keep results for 24 hours (for debugging)
    result_expires=86400,

    # Retry policy for broker connection
    broker_connection_retry_on_startup=True,

    # Auto-discover tasks in backend.jobs.tasks
    imports=["backend.jobs.tasks"],
)

# ============================================================================
# BEAT SCHEDULE — Periodic tasks
#
# All times are UTC. User-facing delivery respects their timezone setting.
#
# The schedule defines WHEN to scan for eligible users. The task itself
# filters users by timezone and preferences before generating intelligence.
# ============================================================================

celery_app.conf.beat_schedule = {
    # --- Daily Digest ---
    # Runs at the top of every hour from 4 PM to 10 PM UTC.
    # The task checks each user's timezone to determine if it's their
    # preferred delivery hour (default: 5 PM local time).
    "daily-digest-scan": {
        "task": "backend.jobs.tasks.run_daily_digest_scan",
        "schedule": crontab(minute=0, hour="16-22"),
        "options": {"queue": "intelligence"},
    },

    # --- Weekly Report ---
    # Scans on Sunday afternoons (UTC). Delivers Sunday evening local time.
    "weekly-report-scan": {
        "task": "backend.jobs.tasks.run_weekly_report_scan",
        "schedule": crontab(minute=0, hour="18-23", day_of_week="sunday"),
        "options": {"queue": "intelligence"},
    },

    # --- Portfolio Sync ---
    # Refresh holdings from SnapTrade every 30 minutes during market hours.
    # Also runs once at market open and once at close.
    "portfolio-sync": {
        "task": "backend.jobs.tasks.run_portfolio_sync_scan",
        "schedule": crontab(minute="0,30", hour="13-21"),  # 9 AM - 5 PM ET = 13-21 UTC
        "options": {"queue": "sync"},
    },

    # --- Earnings Calendar Refresh ---
    # Update the shared earnings calendar once daily at 6 AM UTC.
    "earnings-calendar-refresh": {
        "task": "backend.jobs.tasks.refresh_earnings_calendar",
        "schedule": crontab(minute=0, hour=6),
        "options": {"queue": "sync"},
    },

    # --- Pre-Earnings Briefing Scan ---
    # Check for holdings with earnings in the next 5 days, twice daily.
    # Generates briefings for users who haven't received one yet.
    "pre-earnings-briefing-scan": {
        "task": "backend.jobs.tasks.run_pre_earnings_scan",
        "schedule": crontab(minute=0, hour="12,20"),  # 8 AM and 4 PM ET
        "options": {"queue": "intelligence"},
    },

    # --- Price Monitor ---
    # Check for significant price movements (>3%) every 5 minutes
    # during market hours. Triggers "why is this moving?" alerts.
    "price-monitor": {
        "task": "backend.jobs.tasks.run_price_monitor",
        "schedule": crontab(minute="*/5", hour="13-21"),  # Market hours UTC
        "options": {"queue": "monitor"},
    },

    # --- Polymarket Catalog Sync ---
    # Refresh the prediction-market catalog and ticker tags every 30 min.
    # Research pages and the markets panel read from this catalog.
    "polymarket-catalog-sync": {
        "task": "backend.jobs.tasks.sync_polymarket_catalog",
        "schedule": crontab(minute="5,35"),
        "options": {"queue": "sync"},
    },

    # --- Polymarket Cache Cleanup ---
    # Purge expired cache entries hourly.
    "polymarket-cache-cleanup": {
        "task": "backend.jobs.tasks.cleanup_polymarket_cache",
        "schedule": crontab(minute=15, hour="*"),
        "options": {"queue": "maintenance"},
    },
}

# Queue routing: separate queues for different workload types
# so a flood of price monitor checks doesn't block digest generation.
# NOTE: workers must subscribe to these queues explicitly —
#   celery worker -Q intelligence,sync,monitor,maintenance
# A worker started without -Q consumes only the default queue and
# every routed task below would sit unconsumed forever.
celery_app.conf.task_routes = {
    "backend.jobs.tasks.run_daily_digest_scan": {"queue": "intelligence"},
    "backend.jobs.tasks.run_weekly_report_scan": {"queue": "intelligence"},
    "backend.jobs.tasks.run_user_digest": {"queue": "intelligence"},
    "backend.jobs.tasks.run_user_weekly_report": {"queue": "intelligence"},
    "backend.jobs.tasks.run_pre_earnings_scan": {"queue": "intelligence"},
    "backend.jobs.tasks.run_user_earnings_briefing": {"queue": "intelligence"},
    "backend.jobs.tasks.run_portfolio_sync_scan": {"queue": "sync"},
    "backend.jobs.tasks.sync_user_portfolio": {"queue": "sync"},
    "backend.jobs.tasks.refresh_earnings_calendar": {"queue": "sync"},
    "backend.jobs.tasks.run_price_monitor": {"queue": "monitor"},
    "backend.jobs.tasks.run_user_price_alert": {"queue": "intelligence"},
    "backend.jobs.tasks.sync_polymarket_catalog": {"queue": "sync"},
    "backend.jobs.tasks.cleanup_polymarket_cache": {"queue": "maintenance"},
}
