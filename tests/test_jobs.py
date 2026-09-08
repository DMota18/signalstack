"""
SignalStack — Job Infrastructure Tests

Covers the pieces of the job system that silently corrupt when wrong:
timezone-aware delivery (DST!), JobTracker status computation and
retry-row reuse, webhook idempotency claims, and rate limiter behavior.
"""

from datetime import UTC, datetime
from unittest.mock import AsyncMock, patch

import pytest

from backend.jobs.tasks import _is_delivery_hour
from backend.jobs.tracker import JobTracker
from backend.middleware.rate_limit import RateLimitEntry

# ============================================================================
# TIMEZONE-AWARE DELIVERY
# ============================================================================

class TestDeliveryHour:
    """5 PM local must mean 5 PM in January AND July."""

    def test_new_york_winter_est(self):
        # January: New York is UTC-5, so 22:00 UTC == 17:00 local
        now = datetime(2026, 1, 15, 22, 0, tzinfo=UTC)
        assert _is_delivery_hour(now, "America/New_York", 17) is True

    def test_new_york_summer_edt(self):
        # July: New York is UTC-4, so 21:00 UTC == 17:00 local
        now = datetime(2026, 7, 15, 21, 0, tzinfo=UTC)
        assert _is_delivery_hour(now, "America/New_York", 17) is True
        # ...and 22:00 UTC is 18:00 local — not delivery time
        now = datetime(2026, 7, 15, 22, 0, tzinfo=UTC)
        assert _is_delivery_hour(now, "America/New_York", 17) is False

    def test_london_summer_bst(self):
        # July: London is UTC+1, so 16:00 UTC == 17:00 local
        now = datetime(2026, 7, 15, 16, 0, tzinfo=UTC)
        assert _is_delivery_hour(now, "Europe/London", 17) is True

    def test_half_hour_offset_zone(self):
        # Kolkata is UTC+5:30 — impossible to represent in an integer
        # offset table. 11:30 UTC == 17:00 IST
        now = datetime(2026, 7, 15, 11, 30, tzinfo=UTC)
        assert _is_delivery_hour(now, "Asia/Kolkata", 17) is True

    def test_unknown_timezone_falls_back_to_eastern(self):
        now = datetime(2026, 1, 15, 22, 0, tzinfo=UTC)
        assert _is_delivery_hour(now, "Mars/Olympus_Mons", 17) is True


# ============================================================================
# JOB TRACKER
# ============================================================================

def make_tracker_db(run_id="run-1"):
    db = AsyncMock()
    db.insert = AsyncMock(return_value={"status_code": 201, "data": [{"id": run_id}]})
    db.update = AsyncMock(return_value={"status_code": 200, "data": []})
    return db


class TestJobTrackerStatus:
    @pytest.mark.asyncio
    async def test_all_agents_completed_is_completed(self):
        db = make_tracker_db()
        with patch("backend.jobs.tracker.get_service_client", return_value=db):
            tracker = JobTracker("user-1", "daily_digest")
            await tracker.start()
            await tracker.record_agent("sentiment", "completed", duration_ms=10)
            await tracker.record_agent("macro", "completed", duration_ms=12)
            await tracker.complete(alert_id="a-1", tokens_used=100, cost_usd=0.01)

        final = db.update.call_args_list[-1].kwargs["data"]
        assert final["status"] == "completed"
        assert final["estimated_cost_usd"] == 0.01

    @pytest.mark.asyncio
    async def test_mixed_results_is_partial(self):
        db = make_tracker_db()
        with patch("backend.jobs.tracker.get_service_client", return_value=db):
            tracker = JobTracker("user-1", "daily_digest")
            await tracker.start()
            await tracker.record_agent("sentiment", "completed")
            await tracker.record_agent("polymarket", "failed", error="Gamma 429")
            await tracker.complete()

        final = db.update.call_args_list[-1].kwargs["data"]
        assert final["status"] == "partial"

    @pytest.mark.asyncio
    async def test_no_completed_agents_is_failed(self):
        db = make_tracker_db()
        with patch("backend.jobs.tracker.get_service_client", return_value=db):
            tracker = JobTracker("user-1", "daily_digest")
            await tracker.start()
            await tracker.record_agent("sentiment", "failed", error="boom")
            await tracker.complete()

        final = db.update.call_args_list[-1].kwargs["data"]
        assert final["status"] == "failed"

    @pytest.mark.asyncio
    async def test_fail_records_error_and_category(self):
        db = make_tracker_db()
        with patch("backend.jobs.tracker.get_service_client", return_value=db):
            tracker = JobTracker("user-1", "daily_digest")
            await tracker.start()
            await tracker.fail("API exploded", "transient")

        final = db.update.call_args_list[-1].kwargs["data"]
        assert final["status"] == "failed"
        assert final["error_message"] == "API exploded"
        assert final["error_category"] == "transient"


class TestJobTrackerRetryReuse:
    @pytest.mark.asyncio
    async def test_resume_reuses_row_without_insert(self):
        db = make_tracker_db()
        with patch("backend.jobs.tracker.get_service_client", return_value=db):
            tracker = JobTracker("user-1", "daily_digest")
            tracker.resume("existing-run")
            await tracker.record_agent("sentiment", "completed")

        db.insert.assert_not_called()
        assert tracker.run_id == "existing-run"
        # The incremental agent update targeted the resumed row
        assert db.update.call_args_list[-1].kwargs["filters"]["id"] == "eq.existing-run"


# ============================================================================
# WEBHOOK IDEMPOTENCY
# ============================================================================

class TestWebhookIdempotency:
    @pytest.mark.asyncio
    async def test_first_delivery_is_claimed(self):
        from backend.api.billing import _claim_webhook_event
        db = AsyncMock()
        db.insert = AsyncMock(return_value={"status_code": 201, "data": []})
        with patch("backend.api.billing.get_service_client", return_value=db):
            assert await _claim_webhook_event("evt_1", "checkout.session.completed") is True

    @pytest.mark.asyncio
    async def test_duplicate_delivery_is_rejected(self):
        from backend.api.billing import _claim_webhook_event
        db = AsyncMock()
        db.insert = AsyncMock(return_value={"status_code": 409, "data": None})
        with patch("backend.api.billing.get_service_client", return_value=db):
            assert await _claim_webhook_event("evt_1", "checkout.session.completed") is False

    @pytest.mark.asyncio
    async def test_idempotency_outage_still_processes(self):
        # Better to risk a duplicate than to drop a lifecycle event
        from backend.api.billing import _claim_webhook_event
        db = AsyncMock()
        db.insert = AsyncMock(return_value={"status_code": 500, "data": None})
        with patch("backend.api.billing.get_service_client", return_value=db):
            assert await _claim_webhook_event("evt_1", "checkout.session.completed") is True

    def test_period_end_supports_both_stripe_shapes(self):
        from backend.api.billing import _sub_period_end
        assert _sub_period_end({"current_period_end": 1750000000}) == 1750000000
        assert _sub_period_end({
            "items": {"data": [{"current_period_end": 1760000000}]},
        }) == 1760000000
        assert _sub_period_end(None) is None
        assert _sub_period_end({}) is None


# ============================================================================
# RATE LIMITER
# ============================================================================

class TestRateLimitEntry:
    def test_allows_up_to_limit(self):
        entry = RateLimitEntry()
        for _ in range(5):
            allowed, _ = entry.check(limit=5)
            assert allowed is True
        allowed, remaining = entry.check(limit=5)
        assert allowed is False
        assert remaining == 0

    def test_window_slides(self):
        entry = RateLimitEntry()
        entry.requests = [0.0, 0.0]  # ancient requests
        allowed, _ = entry.check(limit=2)
        assert allowed is True  # old entries pruned out of the window

    def test_idle_since(self):
        import time as _time
        entry = RateLimitEntry()
        assert entry.idle_since(_time.time()) is True
        entry.check(limit=5)
        assert entry.idle_since(_time.time() - 60) is False
