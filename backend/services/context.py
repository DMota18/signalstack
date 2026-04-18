"""
SignalStack — User Context Isolation (Domain 1.2, 1.3, 5.1)

Provides isolated per-user context for intelligence runs. Every
coordinator invocation gets a UserContext object that contains:
  - The user's Case Facts Block (injected at TOP of prompt)
  - The user's holdings list (passed to each subagent)
  - The user's investor profile (passed to Profile Agent)
  - The user's tier (for feature gating at the tool layer)

Critical isolation rules:
  - Subagents do NOT inherit the coordinator's conversation history
  - Subagents do NOT share memory with each other
  - Every piece of context a subagent needs is explicitly passed
  - Context objects are created fresh for each run — never reused
"""

from dataclasses import dataclass, field
from typing import Optional
from datetime import datetime, timezone
from backend.services.case_facts import build_case_facts
from backend.services.supabase import get_service_client


@dataclass
class Holding:
    """A single position in the user's portfolio."""
    ticker: str
    security_name: Optional[str]
    security_type: str
    quantity: float
    current_price: Optional[float]
    market_value: Optional[float]
    pct_of_portfolio: Optional[float]


@dataclass
class InvestorPreferences:
    """The three-dimension investor profile."""
    risk_appetite: str = "moderate"
    sector_interests: list[str] = field(default_factory=list)
    discovery_mode: str = "adjacent"


@dataclass
class UserContext:
    """Isolated context for a single intelligence run.
    
    Created fresh for each run. Never reused across runs or users.
    The coordinator receives this; subagents receive only the
    specific fields they need (holdings list, earnings calendar, etc).
    """
    user_id: str
    tier: str
    timezone: str

    # The formatted Case Facts Block — injected at TOP of coordinator prompt
    case_facts_block: str

    # Structured holdings data — passed to subagents as JSON
    holdings: list[Holding]

    # Investor preferences — passed to Profile Agent
    preferences: InvestorPreferences

    # Watchlist tickers (intelligence covers holdings + watchlist)
    watchlist_tickers: list[str]

    # Upcoming earnings within 14 days — passed to Polymarket Agent
    upcoming_earnings: list[dict]

    # Run metadata
    created_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))

    @property
    def all_tickers(self) -> list[str]:
        """All tickers to analyze: holdings + watchlist, deduplicated."""
        holding_tickers = [h.ticker for h in self.holdings]
        all_t = list(dict.fromkeys(holding_tickers + self.watchlist_tickers))
        return all_t

    @property
    def holdings_for_subagent(self) -> list[dict]:
        """Holdings formatted for passing to subagent prompts.
        This is the explicit context passing from Domain 1.3."""
        return [
            {
                "ticker": h.ticker,
                "security_name": h.security_name,
                "security_type": h.security_type,
                "quantity": h.quantity,
                "current_price": h.current_price,
                "pct_of_portfolio": h.pct_of_portfolio,
            }
            for h in self.holdings
        ]

    @property
    def ticker_batches(self) -> list[list[str]]:
        """Split tickers into batches of 8 for attention dilution prevention.
        Domain 1.5: never ask a single agent to analyze more than 10 tickers."""
        tickers = self.all_tickers
        batch_size = 8
        return [tickers[i:i + batch_size] for i in range(0, len(tickers), batch_size)]


async def build_user_context(user_id: str) -> UserContext:
    """Build a fresh, isolated context for an intelligence run.
    
    This is called at the start of every scheduled job, on-demand request,
    or real-time alert. The context is never reused — holdings and prices
    change between runs.
    
    Flow:
      1. Build Case Facts Block (formatted string for prompt injection)
      2. Fetch structured holdings data (for subagent JSON passing)
      3. Fetch investor profile preferences
      4. Fetch watchlist
      5. Fetch upcoming earnings
      6. Assemble UserContext
    """
    db = get_service_client()

    # 1. Case Facts Block
    case_facts = await build_case_facts(user_id)

    # 2. Profile + tier
    profile_result = await db.select(
        table="profiles",
        columns="tier,timezone",
        filters={"id": f"eq.{user_id}"},
        single=True,
    )
    tier = "free"
    tz = "America/New_York"
    if profile_result["status_code"] == 200 and isinstance(profile_result["data"], dict):
        tier = profile_result["data"].get("tier", "free")
        tz = profile_result["data"].get("timezone", "America/New_York")

    # 3. Holdings
    holdings_result = await db.select(
        table="holdings",
        columns=(
            "ticker,security_name,security_type,quantity,"
            "current_price,market_value,pct_of_portfolio"
        ),
        filters={"user_id": f"eq.{user_id}"},
        order="pct_of_portfolio.desc.nullslast",
    )
    holdings = []
    if holdings_result["status_code"] == 200 and isinstance(holdings_result["data"], list):
        holdings = [
            Holding(
                ticker=h["ticker"],
                security_name=h.get("security_name"),
                security_type=h.get("security_type", "equity"),
                quantity=float(h.get("quantity", 0)),
                current_price=float(h["current_price"]) if h.get("current_price") else None,
                market_value=float(h["market_value"]) if h.get("market_value") else None,
                pct_of_portfolio=float(h["pct_of_portfolio"]) if h.get("pct_of_portfolio") else None,
            )
            for h in holdings_result["data"]
        ]

    # 4. Investor profile
    ip_result = await db.select(
        table="investor_profiles",
        columns="risk_appetite,sector_interests,discovery_mode",
        filters={"user_id": f"eq.{user_id}"},
        single=True,
    )
    prefs = InvestorPreferences()
    if ip_result["status_code"] == 200 and isinstance(ip_result["data"], dict):
        prefs = InvestorPreferences(
            risk_appetite=ip_result["data"].get("risk_appetite", "moderate"),
            sector_interests=ip_result["data"].get("sector_interests", []),
            discovery_mode=ip_result["data"].get("discovery_mode", "adjacent"),
        )

    # 5. Watchlist
    wl_result = await db.select(
        table="watchlist",
        columns="ticker",
        filters={"user_id": f"eq.{user_id}"},
    )
    watchlist = []
    if wl_result["status_code"] == 200 and isinstance(wl_result["data"], list):
        watchlist = [w["ticker"] for w in wl_result["data"]]

    # 6. Upcoming earnings (from shared calendar, filtered to user's holdings)
    all_tickers = [h.ticker for h in holdings] + watchlist
    upcoming = []
    if all_tickers:
        # PostgREST IN filter
        ticker_filter = ",".join(all_tickers)
        earn_result = await db.select(
            table="earnings_calendar",
            columns="ticker,report_date,report_time,consensus_eps,consensus_revenue",
            filters={
                "ticker": f"in.({ticker_filter})",
                "report_date": f"gte.{datetime.now(timezone.utc).strftime('%Y-%m-%d')}",
            },
            order="report_date.asc",
            limit=20,
        )
        if earn_result["status_code"] == 200 and isinstance(earn_result["data"], list):
            upcoming = earn_result["data"]

    return UserContext(
        user_id=user_id,
        tier=tier,
        timezone=tz,
        case_facts_block=case_facts,
        holdings=holdings,
        preferences=prefs,
        watchlist_tickers=watchlist,
        upcoming_earnings=upcoming,
    )
