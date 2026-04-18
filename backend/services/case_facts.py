"""
SignalStack — Case Facts Block Builder (Domain 5.1)

Builds the persistent portfolio context block that is injected at the
TOP of every coordinator prompt. This prevents progressive summarization
from degrading "NVDA: 45 shares at 11.2%, earnings in 8 days" into
"user has some tech stocks."

The block is built from the user_case_facts view (defined in the
Supabase migration) which assembles holdings, investor profile,
upcoming earnings, and alert state in a single query.

Placement rule (Domain 5.2):
  - Case Facts → TOP of prompt (primacy effect)
  - Tool results / subagent outputs → MIDDLE
  - Synthesis instructions + schema → END (recency effect)
"""

from typing import Optional
from datetime import datetime, timezone
from backend.services.supabase import get_service_client


async def build_case_facts(user_id: str) -> str:
    """Build the Case Facts Block for a user.
    
    Fetches from the user_case_facts view (service client — this runs
    in the backend, not in a user-facing request).
    
    Returns a formatted string ready to inject at the top of the
    coordinator system prompt.
    """
    db = get_service_client()

    result = await db.select(
        table="user_case_facts",
        filters={"user_id": f"eq.{user_id}"},
        single=True,
    )

    if result["status_code"] != 200 or not isinstance(result["data"], dict):
        # Fallback: minimal context if the view query fails
        return _minimal_case_facts(user_id)

    facts = result["data"]
    return _format_case_facts(facts)


def _format_case_facts(facts: dict) -> str:
    """Format the raw view data into the Case Facts Block string."""
    lines = ["=== USER PORTFOLIO CONTEXT (always include) ==="]

    # User identity + tier
    lines.append(f"User ID: {facts.get('user_id', 'unknown')}")
    lines.append(f"Tier: {facts.get('tier', 'free')}")

    # Holdings
    holdings = facts.get("holdings") or []
    if holdings:
        holdings_parts = []
        for h in holdings:
            ticker = h.get("ticker", "?")
            qty = h.get("quantity", 0)
            pct = h.get("pct_of_portfolio")
            price = h.get("current_price")

            part = f"{ticker}: {_fmt_quantity(qty)} shares"
            if pct is not None:
                part += f", {float(pct):.1f}%"
            if price is not None:
                part += f" @ ${float(price):,.2f}"
            holdings_parts.append(part)

        lines.append(f"Holdings ({len(holdings)} positions):")
        for part in holdings_parts:
            lines.append(f"  {part}")
    else:
        lines.append("Holdings: None synced")

    # Watchlist
    watchlist = facts.get("watchlist_tickers") or []
    if watchlist:
        lines.append(f"Watchlist: {', '.join(watchlist)}")

    # Investor profile
    risk = facts.get("risk_appetite", "not set")
    sectors = facts.get("sector_interests") or []
    discovery = facts.get("discovery_mode", "not set")
    lines.append(f"Investor Profile: {risk}, {sectors if sectors else 'no sectors'}, {discovery}")

    # Last digest
    last_digest = facts.get("last_digest_at")
    if last_digest:
        lines.append(f"Last digest sent: {last_digest}")
    else:
        lines.append("Last digest sent: never")

    # Pending alerts
    unread = facts.get("unread_alert_count", 0)
    lines.append(f"Pending alerts: {unread}")

    # Upcoming earnings
    earnings = facts.get("upcoming_earnings") or []
    if earnings:
        earnings_parts = []
        for e in earnings:
            ticker = e.get("ticker", "?")
            date = e.get("report_date", "?")
            time_of_day = e.get("report_time", "unknown")
            earnings_parts.append(f"{ticker} on {date} ({time_of_day})")
        lines.append(f"Active earnings in next 14 days: {', '.join(earnings_parts)}")
    else:
        lines.append("Active earnings in next 14 days: none")

    # Concentration warnings (Domain: compliance guardrail #4)
    concentration_warnings = []
    for h in (facts.get("holdings") or []):
        pct = h.get("pct_of_portfolio")
        if pct is not None and float(pct) >= 25.0:
            concentration_warnings.append(
                f"  WARNING: {h['ticker']} is {float(pct):.1f}% of portfolio (>25% threshold)"
            )
    if concentration_warnings:
        lines.append("Concentration flags:")
        lines.extend(concentration_warnings)

    lines.append("=== END PORTFOLIO CONTEXT ===")

    return "\n".join(lines)


def _minimal_case_facts(user_id: str) -> str:
    """Fallback when the view query fails. Gives the coordinator
    enough context to know something is wrong."""
    return (
        "=== USER PORTFOLIO CONTEXT (always include) ===\n"
        f"User ID: {user_id}\n"
        "Tier: unknown\n"
        "Holdings: UNABLE TO FETCH — database query failed\n"
        "Investor Profile: not available\n"
        "NOTE: Case facts could not be loaded. Proceed with caution.\n"
        "=== END PORTFOLIO CONTEXT ==="
    )


def _fmt_quantity(qty) -> str:
    """Format quantity: whole numbers as int, fractional with decimals."""
    qty = float(qty)
    if qty == int(qty):
        return str(int(qty))
    return f"{qty:.4f}".rstrip("0").rstrip(".")
