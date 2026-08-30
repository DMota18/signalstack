"""
SignalStack — Job Run Tracker

Manages the job_runs table in Supabase. Every scheduled and on-demand
intelligence run gets a tracked record with per-subagent status,
duration, token usage, and error details.

Maps directly to the graceful degradation strategy:
  5/5 agents succeeded → status: "completed"
  3-4/5 succeeded      → status: "partial"
  0/5 or critical fail → status: "failed"

Usage in tasks:
    tracker = JobTracker(user_id, "daily_digest")
    run_id = await tracker.start()
    await tracker.record_agent("sentiment", "completed", duration_ms=1200)
    await tracker.record_agent("polymarket", "failed", error="Gamma API 429")
    await tracker.complete(alert_id=alert_id, tokens_used=4500)
"""

import time
from datetime import UTC, datetime

from backend.services.supabase import get_service_client


class JobTracker:
    """Tracks a single job run from start to completion."""

    def __init__(self, user_id: str, job_type: str):
        self.user_id = user_id
        self.job_type = job_type
        self.run_id: str | None = None
        self.agent_results: dict = {}
        self.start_time: float = 0

    async def start(self) -> str:
        """Create a new job_runs record with status 'running'.
        Returns the run ID."""
        self.start_time = time.time()
        db = get_service_client()

        result = await db.insert(
            table="job_runs",
            data={
                "user_id": self.user_id,
                "job_type": self.job_type,
                "status": "running",
                "agent_results": {},
                "started_at": datetime.now(UTC).isoformat(),
            },
        )

        if result["status_code"] in (200, 201):
            row = result["data"]
            if isinstance(row, list) and row:
                self.run_id = row[0]["id"]
            elif isinstance(row, dict):
                self.run_id = row["id"]

        return self.run_id

    def resume(self, run_id: str) -> None:
        """Attach to an existing job_runs row instead of creating one.

        Used by Celery retries: each retry attempt re-executes the task
        from scratch, and without this every attempt would leave behind
        its own permanently-'failed' row for a job that may yet succeed.
        """
        self.run_id = run_id
        self.start_time = time.time()

    async def record_agent(
        self,
        agent_name: str,
        status: str,
        duration_ms: int | None = None,
        error: str | None = None,
        error_category: str | None = None,
        metadata: dict | None = None,
    ):
        """Record a subagent's result. Called after each agent completes.

        Args:
            agent_name: e.g. "sentiment", "polymarket", "insider"
            status: "completed", "failed", "skipped"
            duration_ms: Execution time in milliseconds
            error: Error message if failed
            error_category: transient/validation/business/permission
            metadata: Additional data (tickers_processed, markets_found, etc.)
        """
        entry = {"status": status}
        if duration_ms is not None:
            entry["duration_ms"] = duration_ms
        if error:
            entry["error"] = error
        if error_category:
            entry["error_category"] = error_category
        if metadata:
            entry.update(metadata)

        self.agent_results[agent_name] = entry

        # Update the record in Supabase (incremental — don't wait for completion)
        if self.run_id:
            db = get_service_client()
            await db.update(
                table="job_runs",
                data={"agent_results": self.agent_results},
                filters={"id": f"eq.{self.run_id}"},
            )

    async def complete(
        self,
        alert_id: str | None = None,
        tokens_used: int | None = None,
        cost_usd: float | None = None,
        error_message: str | None = None,
        error_category: str | None = None,
    ):
        """Finalize the job run. Computes status from agent results.

        Status logic:
          - All agents completed → "completed"
          - Some agents completed, some failed → "partial"
          - Critical failure or no agents completed → "failed"
        """
        if not self.run_id:
            return

        elapsed_ms = int((time.time() - self.start_time) * 1000)

        # Determine overall status from agent results
        if error_message:
            status = "failed"
        else:
            completed_count = sum(
                1 for a in self.agent_results.values()
                if a.get("status") == "completed"
            )
            total_count = len(self.agent_results)

            if total_count == 0:
                status = "failed"
            elif completed_count == total_count:
                status = "completed"
            elif completed_count > 0:
                status = "partial"
            else:
                status = "failed"

        # Cost comes from the pipeline (services/cost_control.estimate_cost
        # with the real input/output split and the model actually used) —
        # never re-derived here with hardcoded pricing.

        data = {
            "status": status,
            "agent_results": self.agent_results,
            "total_duration_ms": elapsed_ms,
            "completed_at": datetime.now(UTC).isoformat(),
        }
        if alert_id:
            data["alert_id"] = alert_id
        if tokens_used:
            data["tokens_used"] = tokens_used
        if cost_usd:
            data["estimated_cost_usd"] = round(cost_usd, 6)
        if error_message:
            data["error_message"] = error_message
        if error_category:
            data["error_category"] = error_category

        db = get_service_client()
        await db.update(
            table="job_runs",
            data=data,
            filters={"id": f"eq.{self.run_id}"},
        )

    async def fail(self, error_message: str, error_category: str = "transient"):
        """Convenience: mark the job as failed with an error."""
        await self.complete(error_message=error_message, error_category=error_category)
