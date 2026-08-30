"""
SignalStack — Hooks Pipeline (Domain 1.4 + Compliance Guardrails)

Two hook types enforce business rules programmatically:

1. PRE-EXECUTION HOOKS (tool call interception):
   Run BEFORE a tool executes. Can block, modify, or allow the call.
   - Block execute_trade entirely (SignalStack never executes trades)
   - Block generate_idea until investor profile exists
   - Block send_push_notification until disclaimer check passes

2. POST-EXECUTION HOOKS (PostToolUse):
   Run AFTER a tool executes, before Claude sees the result.
   - Normalize timestamps to ISO 8601
   - Sanitize financial data formats
   - Inject compliance metadata
   - Redact PII from brokerage data

3. OUTPUT INTERCEPTORS:
   Run on the FINAL coordinator output before delivery to user.
   - Disclaimer injection (appended by hook, not by model)
   - Advice language filter (blocks "buy", "sell", "you should")
   - Position concentration warnings

The rule: if consequences involve financial data presentation,
compliance, or user-facing alerts → programmatic enforcement.
If it's tone, formatting, or depth → prompt guidance is acceptable.
"""

import logging
import re
from dataclasses import dataclass
from datetime import UTC, datetime

logger = logging.getLogger("hooks")


# ============================================================================
# DATA TYPES
# ============================================================================

@dataclass
class HookResult:
    """Result of a hook execution."""
    allowed: bool = True           # For pre-hooks: whether the call proceeds
    modified_input: dict | None = None   # For pre-hooks: modified tool input
    modified_result: dict | None = None  # For post-hooks: modified tool result
    block_reason: str | None = None      # For pre-hooks: why blocked
    warnings: list[str] = None     # Non-blocking warnings to surface

    def __post_init__(self):
        if self.warnings is None:
            self.warnings = []


# ============================================================================
# 1. PRE-EXECUTION HOOKS
# ============================================================================

# Tools that are ALWAYS blocked — SignalStack never executes trades
BLOCKED_TOOLS = frozenset({
    "execute_trade",
    "submit_order",
    "place_order",
    "cancel_order",
})

# Tools that require an investor profile to exist
PROFILE_REQUIRED_TOOLS = frozenset({
    "generate_idea",
    "screen_adjacent_tickers",
    "get_leverage_products",
    "get_correlation_matrix",
})


async def pre_execution_hook(
    tool_name: str,
    tool_input: dict,
    user_context: dict | None = None,
) -> HookResult:
    """Run before a tool executes. Returns HookResult indicating
    whether the call should proceed.

    Args:
        tool_name: The tool being called
        tool_input: The input parameters
        user_context: Dict with user_id, tier, has_investor_profile, etc.
    """
    context = user_context or {}

    # --- Block trade execution tools entirely ---
    if tool_name in BLOCKED_TOOLS:
        logger.warning(f"BLOCKED: {tool_name} — SignalStack never executes trades")
        return HookResult(
            allowed=False,
            block_reason=(
                f"Tool '{tool_name}' is blocked. SignalStack is an intelligence platform "
                "and does not execute trades. This tool should not be in the agent's tool list."
            ),
        )

    # --- Block idea generation without investor profile ---
    if tool_name in PROFILE_REQUIRED_TOOLS:
        has_profile = context.get("has_investor_profile", False)
        if not has_profile:
            logger.info(f"BLOCKED: {tool_name} — no investor profile set")
            return HookResult(
                allowed=False,
                block_reason=(
                    f"Tool '{tool_name}' requires an investor profile (risk appetite, "
                    "sector interests, discovery mode). The user has not set up their "
                    "profile yet. Prompt them to complete /profile/investor first."
                ),
            )

    # --- Block push notifications without disclaimer ---
    if tool_name == "send_push_notification":
        body = tool_input.get("body", "")
        if not _has_disclaimer(body):
            logger.info("BLOCKED: push notification missing disclaimer")
            return HookResult(
                allowed=False,
                block_reason=(
                    "Push notification body is missing the required disclaimer. "
                    "All user-facing outputs must include: "
                    "'This is market intelligence for educational purposes, not investment advice.'"
                ),
            )

    # --- Tier-based tool access ---
    tier = context.get("tier", "free")
    premium_only_tools = {"get_congressional_trades", "get_13f_filings", "run_scenario"}
    if tool_name in premium_only_tools and tier != "premium":
        return HookResult(
            allowed=False,
            block_reason=f"Tool '{tool_name}' requires premium tier. Current tier: {tier}.",
        )

    pro_only_tools = {"search_polymarket_markets", "get_correlation_matrix", "screen_adjacent_tickers"}
    if tool_name in pro_only_tools and tier == "free":
        return HookResult(
            allowed=False,
            block_reason=f"Tool '{tool_name}' requires pro or premium tier. Current tier: free.",
        )

    return HookResult(allowed=True)


# ============================================================================
# 2. POST-EXECUTION HOOKS
# ============================================================================

async def post_execution_hook(tool_name: str, tool_result: dict) -> dict:
    """Run after a tool executes, before Claude processes the result.

    Applies all normalization and compliance injection in sequence.
    Returns the modified result.
    """
    result = tool_result.copy() if isinstance(tool_result, dict) else {"data": tool_result}

    # --- Normalize timestamps to ISO 8601 ---
    result = _normalize_timestamps(result)

    # --- Sanitize financial data formats ---
    result = _sanitize_financial_data(result)

    # --- Redact PII ---
    result = _redact_pii(result)

    # --- Inject compliance metadata ---
    result["_compliance"] = {
        "disclaimer_required": True,
        "advice_flag": False,
        "processed_at": datetime.now(UTC).isoformat(),
    }

    return result


def _normalize_timestamps(data: dict) -> dict:
    """Convert common timestamp formats to ISO 8601."""
    timestamp_keys = {"timestamp", "date", "report_date", "filed_date", "trade_date",
                      "created_at", "updated_at", "synced_at", "fetched_at"}

    for key in timestamp_keys:
        if key in data and data[key]:
            val = data[key]
            if isinstance(val, (int, float)):
                # Unix timestamp
                data[key] = datetime.fromtimestamp(val, tz=UTC).isoformat()
            elif isinstance(val, str) and not val.endswith("Z") and "T" not in val:
                # Try common date formats
                for fmt in ("%Y-%m-%d", "%m/%d/%Y", "%Y-%m-%d %H:%M:%S"):
                    try:
                        parsed = datetime.strptime(val, fmt).replace(tzinfo=UTC)
                        data[key] = parsed.isoformat()
                        break
                    except ValueError:
                        continue

    # Recurse into nested dicts and lists
    for key, val in data.items():
        if isinstance(val, dict):
            data[key] = _normalize_timestamps(val)
        elif isinstance(val, list):
            data[key] = [_normalize_timestamps(item) if isinstance(item, dict) else item for item in val]

    return data


def _sanitize_financial_data(data: dict) -> dict:
    """Strip currency symbols, normalize prices to float."""
    price_keys = {"price", "current_price", "avg_price", "cost_basis", "market_value",
                  "volume", "volume_24h", "liquidity", "yes_price", "no_price",
                  "consensus_eps", "consensus_revenue"}

    for key in price_keys:
        if key in data and data[key] is not None:
            val = data[key]
            if isinstance(val, str):
                cleaned = val.replace("$", "").replace(",", "").replace("%", "").strip()
                try:
                    data[key] = float(cleaned)
                except ValueError:
                    pass  # Leave as-is if unparseable

    # Recurse
    for key, val in data.items():
        if isinstance(val, dict):
            data[key] = _sanitize_financial_data(val)
        elif isinstance(val, list):
            data[key] = [_sanitize_financial_data(item) if isinstance(item, dict) else item for item in val]

    return data


# PII patterns to redact
_SSN_PATTERN = re.compile(r"\b\d{3}-\d{2}-\d{4}\b")
_ACCOUNT_PATTERN = re.compile(r"\b\d{8,16}\b")  # 8-16 digit account numbers
_EMAIL_PATTERN = re.compile(r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b")

# Keys that commonly contain PII from brokerage data
_PII_KEYS = frozenset({
    "account_number", "ssn", "social_security", "tax_id",
    "full_name", "legal_name", "date_of_birth", "address",
    "routing_number", "bank_account",
})


def _redact_pii(data: dict) -> dict:
    """Remove PII fields and redact patterns from brokerage data."""
    for key in list(data.keys()):
        if key.lower() in _PII_KEYS:
            data[key] = "[REDACTED]"
            continue

        val = data[key]
        if isinstance(val, str):
            val = _SSN_PATTERN.sub("[SSN_REDACTED]", val)
            val = _ACCOUNT_PATTERN.sub("[ACCT_REDACTED]", val)
            # Only redact emails in brokerage context, not in user profiles
            if key not in ("email", "user_email"):
                val = _EMAIL_PATTERN.sub("[EMAIL_REDACTED]", val)
            data[key] = val
        elif isinstance(val, dict):
            data[key] = _redact_pii(val)
        elif isinstance(val, list):
            data[key] = [_redact_pii(item) if isinstance(item, dict) else item for item in val]

    return data


# ============================================================================
# 3. OUTPUT INTERCEPTORS
# ============================================================================

# The disclaimer appended to every user-facing output
DISCLAIMER = "This is market intelligence for educational purposes, not investment advice."

# Phrases that indicate investment advice — blocked from output
_ADVICE_PATTERNS = re.compile(
    r"\b(you\s+should\s+(buy|sell|invest|hold|short|sell\s+off|dump|load\s+up))"
    r"|\b(i\s+recommend\s+(buying|selling|investing|holding))"
    r"|\b(we\s+recommend)"
    r"|\b(buy\s+now|sell\s+now|strong\s+buy|must\s+buy|definitely\s+(buy|sell))"
    r"|\b(my\s+recommendation\s+is)",
    re.IGNORECASE,
)


def intercept_output(output_text: str) -> tuple[bool, str, list[str]]:
    """Final interceptor for coordinator output before delivery to user.

    Returns:
        (passed, output_text, violations)
        - passed: True if output is safe to deliver
        - output_text: The (potentially modified) output
        - violations: List of specific violations found (empty if passed)
    """
    violations = []

    # --- Check for advice language ---
    matches = _ADVICE_PATTERNS.findall(output_text)
    if matches:
        # Flatten match groups and filter empties
        found_phrases = [m for group in matches for m in group if m]
        violations.extend([f"Advice language detected: '{phrase}'" for phrase in found_phrases[:3]])

    if violations:
        return False, output_text, violations

    # --- Inject disclaimer if not already present ---
    if DISCLAIMER not in output_text:
        output_text = output_text.rstrip() + f"\n\n{DISCLAIMER}"

    return True, output_text, []


def build_reformulation_prompt(original_output: str, violations: list[str]) -> str:
    """Build a prompt to send back to the coordinator when output
    fails the advice language filter.

    The coordinator receives this and must reformulate its output
    without the flagged language.
    """
    violation_list = "\n".join(f"  - {v}" for v in violations)
    return (
        "Your previous output was blocked by the compliance filter. "
        "The following violations were detected:\n"
        f"{violation_list}\n\n"
        "RULES REMINDER:\n"
        "- NEVER say 'buy', 'sell', 'you should', or 'I recommend'\n"
        "- Use instead: 'the data suggests', 'the signal is', 'historically this pattern has...'\n"
        "- Present information objectively — let the user make their own decisions\n\n"
        "Reformulate your output to comply with these rules. "
        "Keep all the same data and analysis, just change the language."
    )


def _has_disclaimer(text: str) -> bool:
    """Check if text contains the required disclaimer."""
    return DISCLAIMER.lower() in text.lower()


def check_concentration_warnings(holdings: list[dict]) -> list[str]:
    """Check for position concentration exceeding 25% threshold.
    Compliance guardrail #4: enforced programmatically, not by the model.

    Returns list of warning strings to include in output.
    """
    warnings = []
    for h in holdings:
        pct = h.get("pct_of_portfolio")
        if pct is not None and float(pct) >= 25.0:
            ticker = h.get("ticker", "Unknown")
            warnings.append(
                f"Concentration notice: {ticker} represents {float(pct):.1f}% of your portfolio, "
                f"which exceeds the 25% single-position threshold. "
                f"Diversification may help manage risk."
            )
    return warnings
