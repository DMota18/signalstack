"""
SignalStack — Intelligence Pipeline Service

Connects the coordinator's synthesis output to:
  1. Alert creation (stores in alert_history)
  2. Delivery formatting (push, email, in-app)
  3. Output interception (advice language filter, disclaimer)

This is the bridge between the agentic engine (agents/) and the
delivery layer (jobs/tasks, push notifications, email).

Pipeline:
  Coordinator produces synthesis → intercept_output() filters it →
  create_alert() stores it → format + deliver per channel
"""

import json
import logging

from backend.agents.coordinator import COORDINATOR_SYSTEM, SYNTHESIS_TOOL, run_coordinator
from backend.agents.loop import run_agent_loop
from backend.services.cost_control import (
    estimate_cost,
    get_cached_intelligence,
    record_job_cost,
    select_model_for_user,
)
from backend.services.hooks import (
    DISCLAIMER,
    build_reformulation_prompt,
    intercept_output,
    strip_advice_language,
)
from backend.services.supabase import get_service_client

logger = logging.getLogger("services.pipeline")


# ============================================================================
# MAIN PIPELINE ENTRY POINT
# ============================================================================

async def generate_intelligence(
    user_id: str,
    alert_type: str = "daily_digest",
    trigger_source: str = "scheduler",
) -> dict:
    """Run the full intelligence pipeline for a user.

    1. Run coordinator (dispatches subagents, produces synthesis)
    2. Intercept output (advice filter, disclaimer)
    3. Create alert record in Supabase
    4. Return the alert for delivery

    Args:
        user_id: SignalStack user ID
        alert_type: Type of alert to create
        trigger_source: What triggered this run (scheduler, user_request, price_monitor)

    Returns:
        {
            "alert_id": str,
            "alert": dict,
            "synthesis": dict,
            "agent_results": dict,
            "tokens_used": int,
            "duration_ms": int,
        }
    """
    # 0. Check cost budget and select model
    model_decision = await select_model_for_user(user_id)

    if model_decision["use_cache"]:
        # Over daily cap — serve cached intelligence
        cached = await get_cached_intelligence(user_id)
        if cached:
            logger.info(f"Serving cached intelligence for {user_id} (daily cap exceeded)")
            return {
                "alert_id": cached.get("alert_id"),
                "alert": {
                    "id": cached.get("alert_id"),
                    "type": "on_demand",
                    "title": cached.get("title", ""),
                    "related_tickers": [],
                    "signals_used": [],
                },
                "synthesis": cached.get("synthesis", {}),
                "agent_results": {},
                "tokens_used": 0,
                "duration_ms": 0,
                "cached": True,
                "cache_message": cached.get("message", ""),
            }
        # No cache available — allow one more run with fallback model
        logger.warning(f"No cached intelligence for {user_id}, allowing fallback model run")

    # 1. Run the coordinator (with model override if budget constrained)
    coord_result = await run_coordinator(
        user_id,
        model_override=model_decision["model"] if model_decision["reason"] != "within_budget" else None,
    )
    synthesis = coord_result.get("synthesis", {})

    # 2. Build a narrative string for the output interceptor
    narrative_parts = []
    for holding in synthesis.get("per_holding_intelligence", []):
        narrative_parts.append(holding.get("narrative", ""))
    for insight in synthesis.get("portfolio_level_insights", []):
        narrative_parts.append(insight)

    full_narrative = "\n\n".join(narrative_parts)

    # 3. Run output interceptor (advice language filter)
    passed, filtered_text, violations = intercept_output(full_narrative)

    if not passed:
        logger.warning(f"Output interceptor caught violations: {violations}")

        # Reformulation loop: re-prompt the coordinator to fix its language.
        # Max 2 attempts before falling back to regex stripping.
        synthesis, passed = await _reformulate_synthesis(
            synthesis, violations, max_attempts=2,
        )

        if not passed:
            # Final fallback: strip advice language with regex
            logger.warning("Reformulation failed after max attempts, falling back to regex strip")
            for holding in synthesis.get("per_holding_intelligence", []):
                holding["narrative"] = strip_advice_language(holding.get("narrative", ""))
            synthesis["portfolio_level_insights"] = [
                strip_advice_language(i) for i in synthesis.get("portfolio_level_insights", [])
            ]

    # 4. Extract tickers and signals for alert metadata
    related_tickers = [
        h.get("ticker") for h in synthesis.get("per_holding_intelligence", [])
        if h.get("ticker")
    ]
    signals_used = synthesis.get("portfolio_summary", {}).get("signals_available", [])

    # 5. Build alert title
    title = _build_alert_title(alert_type, synthesis)

    # 6. Create alert in Supabase
    alert_id = await _create_alert(
        user_id=user_id,
        alert_type=alert_type,
        trigger_source=trigger_source,
        title=title,
        body_json=synthesis,
        related_tickers=related_tickers,
        signals_used=signals_used,
    )

    # 7. Record cost against user's daily budget
    tokens_used = coord_result.get("total_tokens", 0)
    model_used = model_decision["model"]
    cost_usd = estimate_cost(model_used, tokens_used // 2, tokens_used // 2)  # Approximate split
    await record_job_cost(user_id, tokens_used, cost_usd)

    return {
        "alert_id": alert_id,
        "alert": {
            "id": alert_id,
            "type": alert_type,
            "title": title,
            "related_tickers": related_tickers,
            "signals_used": signals_used,
        },
        "synthesis": synthesis,
        "agent_results": coord_result.get("agent_results", {}),
        "tokens_used": tokens_used,
        "duration_ms": coord_result.get("duration_ms", 0),
        "model_used": model_used,
        "cost_usd": cost_usd,
    }


# ============================================================================
# ON-DEMAND INTELLIGENCE (user-triggered via API)
# ============================================================================

async def generate_on_demand(user_id: str) -> dict:
    """Generate intelligence on demand (user clicked 'refresh' or '/digest')."""
    return await generate_intelligence(
        user_id=user_id,
        alert_type="on_demand",
        trigger_source="user_request",
    )


# ============================================================================
# ALERT CREATION
# ============================================================================

async def _create_alert(
    user_id: str,
    alert_type: str,
    trigger_source: str,
    title: str,
    body_json: dict,
    related_tickers: list[str],
    signals_used: list[str],
) -> str | None:
    """Create an alert record in alert_history. Returns the alert ID."""
    db = get_service_client()

    result = await db.insert(
        table="alert_history",
        data={
            "user_id": user_id,
            "alert_type": alert_type,
            "trigger_source": trigger_source,
            "title": title,
            "body_json": body_json,
            "related_tickers": related_tickers,
            "signals_used": signals_used,
            "channels_sent": {},
        },
    )

    if result["status_code"] in (200, 201):
        data = result["data"]
        if isinstance(data, list) and data:
            return data[0].get("id")
        elif isinstance(data, dict):
            return data.get("id")

    logger.error(f"Failed to create alert for {user_id}: {result}")
    return None


# ============================================================================
# DELIVERY FORMATTING
# ============================================================================

def format_for_push(synthesis: dict, alert_type: str) -> dict:
    """Format synthesis into a push notification payload.

    Push notifications are short — title + body, max ~200 chars body.
    We pick the most important signal to highlight.
    """
    holdings = synthesis.get("per_holding_intelligence", [])

    # Find the most notable holding (conflicting signals or strongest signal)
    notable = None
    for h in holdings:
        if h.get("net_signal") == "conflicting":
            notable = h
            break
        if h.get("net_signal") in ("strongly_bullish", "strongly_bearish"):
            notable = h
            break
    if not notable and holdings:
        notable = holdings[0]

    if notable:
        title = f"{notable['ticker']}: {_signal_to_emoji(notable.get('net_signal', ''))} {notable.get('net_signal', '').replace('_', ' ').title()}"
        body = notable.get("narrative", "")[:180]
    else:
        title = "Portfolio Intelligence Update"
        body = "Your daily portfolio analysis is ready."

    return {
        "title": title,
        "body": body,
        "data": {
            "type": alert_type,
            "tickers": [h.get("ticker") for h in holdings[:5]],
        },
    }


def format_for_email(synthesis: dict, alert_type: str, user_name: str = "") -> dict:
    """Format synthesis into an email payload.

    Emails can be longer — full narrative per holding.
    """
    holdings = synthesis.get("per_holding_intelligence", [])
    insights = synthesis.get("portfolio_level_insights", [])

    subject = _build_alert_title(alert_type, synthesis)

    # Build HTML body
    sections = []

    if insights:
        sections.append("<h2>Portfolio Insights</h2>")
        for insight in insights:
            if insight != DISCLAIMER:
                sections.append(f"<p>{insight}</p>")

    for h in holdings:
        signal = h.get("net_signal", "neutral").replace("_", " ").title()
        emoji = _signal_to_emoji(h.get("net_signal", ""))
        sections.append(f"<h3>{emoji} {h.get('ticker', '')} — {signal}</h3>")
        sections.append(f"<p>{h.get('narrative', '')}</p>")

        if h.get("conflicts"):
            sections.append("<p><strong>Conflicting signals:</strong></p><ul>")
            for c in h["conflicts"]:
                sections.append(f"<li>{c}</li>")
            sections.append("</ul>")

        if h.get("upcoming_catalysts"):
            sections.append("<p><strong>Upcoming:</strong> " + ", ".join(h["upcoming_catalysts"]) + "</p>")

    sections.append(f"<hr><p><em>{DISCLAIMER}</em></p>")

    return {
        "subject": subject,
        "html_body": "\n".join(sections),
        "text_body": "\n\n".join(
            [h.get("narrative", "") for h in holdings] + [DISCLAIMER]
        ),
    }



# ============================================================================
# COMPLIANCE REFORMULATION
# ============================================================================

async def _reformulate_synthesis(
    synthesis: dict,
    violations: list[str],
    max_attempts: int = 2,
) -> tuple[dict, bool]:
    """Re-prompt the coordinator to reformulate its output when the
    advice language filter catches violations.

    Sends the original synthesis + violation details back through the
    agentic loop, asking the coordinator to fix the language while
    keeping all data and analysis intact.

    Args:
        synthesis: The original synthesis dict from the coordinator
        violations: List of specific violations found by the interceptor
        max_attempts: Max reformulation attempts before giving up

    Returns:
        (updated_synthesis, passed) — the reformulated synthesis and
        whether it now passes the output interceptor
    """
    current_synthesis = synthesis

    for attempt in range(1, max_attempts + 1):
        logger.info(f"Reformulation attempt {attempt}/{max_attempts}")

        reformulation_prompt = build_reformulation_prompt(
            json.dumps(current_synthesis, indent=2),
            violations,
        )

        # Re-run the coordinator with the reformulation instructions
        # and the original synthesis as context
        user_msg = (
            f"{reformulation_prompt}\n\n"
            f"=== ORIGINAL OUTPUT (fix the language, keep all data) ===\n"
            f"{json.dumps(current_synthesis, indent=2)}\n\n"
            f"Use the produce_synthesis tool to deliver the corrected output."
        )

        result = await run_agent_loop(
            system_prompt=COORDINATOR_SYSTEM,
            messages=[{"role": "user", "content": user_msg}],
            tools=[SYNTHESIS_TOOL],
            max_tokens=8192,
            tool_choice={"type": "tool", "name": "produce_synthesis"},
        )

        # Extract the reformulated synthesis
        new_synthesis = None
        for tr in result.get("tool_results", []):
            if tr.get("tool_name") == "produce_synthesis":
                new_synthesis = tr.get("tool_input", tr.get("result", {}))
                break

        if not new_synthesis:
            # Reformulation didn't produce output — keep current
            logger.warning(f"Reformulation attempt {attempt} produced no output")
            continue

        # Ensure disclaimer survives
        if "disclaimer" not in new_synthesis or new_synthesis["disclaimer"] != DISCLAIMER:
            new_synthesis["disclaimer"] = DISCLAIMER

        current_synthesis = new_synthesis

        # Re-check with the output interceptor
        narrative_parts = []
        for holding in current_synthesis.get("per_holding_intelligence", []):
            narrative_parts.append(holding.get("narrative", ""))
        for insight in current_synthesis.get("portfolio_level_insights", []):
            narrative_parts.append(insight)

        full_narrative = "\n\n".join(narrative_parts)
        passed, _, new_violations = intercept_output(full_narrative)

        if passed:
            logger.info(f"Reformulation succeeded on attempt {attempt}")
            return current_synthesis, True

        # Update violations for next attempt
        violations = new_violations
        logger.warning(f"Reformulation attempt {attempt} still has violations: {new_violations}")

    return current_synthesis, False


# ============================================================================
# HELPERS
# ============================================================================

def _build_alert_title(alert_type: str, synthesis: dict) -> str:
    """Generate a concise alert title."""
    holdings = synthesis.get("per_holding_intelligence", [])
    count = len(holdings)

    titles = {
        "daily_digest": f"Daily Digest: {count} holdings analyzed",
        "weekly_report": f"Weekly Report: {count} holdings",
        "price_movement": None,  # Set dynamically
        "pre_earnings": None,
        "insider_activity": None,
        "macro_event": None,
        "polymarket_shift": None,
        "explore_idea": "New ideas based on your interests",
        "on_demand": f"Portfolio Intelligence: {count} holdings",
        "system": "SignalStack System Update",
    }

    title = titles.get(alert_type)

    if title is None and holdings:
        # Dynamic title based on most notable holding
        top = holdings[0]
        ticker = top.get("ticker", "")
        signal = top.get("net_signal", "neutral").replace("_", " ")
        title = f"{ticker}: {signal}"

    return title or f"Intelligence Update: {count} holdings"


def _signal_to_emoji(signal: str) -> str:
    """Map a net signal to a simple indicator character."""
    mapping = {
        "strongly_bullish": "+",
        "bullish": "+",
        "neutral": "~",
        "bearish": "-",
        "strongly_bearish": "-",
        "conflicting": "!",
        "insufficient_data": "?",
    }
    return mapping.get(signal, "~")


