"""
SignalStack — SEC EDGAR MCP Tools

Provider: SEC EDGAR (sec.gov)
Rate limit: No formal limit — be respectful (max 10 req/sec)
API key: None required
User-Agent: Required (SEC mandates identifying the application)

Tools:
  get_institutional_holders   — Top institutional holders for a ticker
  get_13f_fund_positions      — Check what a major fund holds in a sector/ticker

These tools serve the Institutional Flow Agent subagent.
Focus: Bridgewater, Renaissance, Berkshire, Citadel + other major funds.
"""

import httpx
import logging
from datetime import datetime, timezone
from typing import Optional

from backend.config import get_settings
from backend.tools.base import (
    ToolResult, ToolError, transient_error, validation_error,
    business_error, permission_error, classify_http_error, retry_with_backoff,
)

logger = logging.getLogger("tools.sec_edgar")

SEC_BASE = "https://data.sec.gov"
SEC_EFTS = "https://efts.sec.gov/LATEST"
SEC_TICKERS_URL = "https://www.sec.gov/files/company_tickers.json"

# User-Agent header required by SEC — identifies our application
SEC_HEADERS = {
    "User-Agent": "SignalStack/1.0 (contact@zeladoranalytics.com)",
    "Accept": "application/json",
}

# Major funds tracked for user relevance (CIK -> display name)
MAJOR_FUND_CIKS = {
    "0001067983": "Berkshire Hathaway",
    "0001350694": "Renaissance Technologies",
    "0001336528": "Bridgewater Associates",
    "0001423053": "Citadel Advisors",
    "0001364742": "BlackRock",
    "0000884437": "Vanguard Group",
    "0001037389": "JPMorgan Chase",
    "0001061768": "Two Sigma Investments",
    "0001535392": "D.E. Shaw",
    "0000090631": "State Street Corp",
}


async def _sec_request(url: str, tool_name: str, params: Optional[dict] = None) -> dict:
    """Make a request to SEC EDGAR with retry and rate limit awareness."""
    async def _call():
        async with httpx.AsyncClient(timeout=30.0, headers=SEC_HEADERS) as client:
            resp = await client.get(url, params=params)
            if resp.status_code == 200:
                return {"status_code": 200, "data": resp.json()}
            return {"status_code": resp.status_code, "data": resp.text}

    try:
        result = await retry_with_backoff(_call, max_retries=2, base_delay=2.0, tool_name=tool_name)
        return result
    except httpx.TimeoutException:
        return transient_error(tool_name, "SEC EDGAR request timeout").to_dict()
    except Exception as e:
        return transient_error(tool_name, f"SEC EDGAR request failed: {e}").to_dict()


# ============================================================================
# TOOL: get_institutional_holders
# ============================================================================

INSTITUTIONAL_HOLDERS_SCHEMA = {
    "name": "get_institutional_holders",
    "description": (
        "Get the top institutional holders for a stock ticker from SEC 13F filings. "
        "Returns fund names, shares held, and filing dates for major institutional "
        "investors. Focuses on notable funds (Berkshire, Renaissance, Bridgewater, "
        "Citadel, BlackRock, Vanguard, etc.).\n\n"
        "INPUT: ticker (string, e.g. 'NVDA', 'AAPL').\n\n"
        "EXAMPLE QUERIES: 'What funds hold NVDA?', 'Institutional ownership of AAPL', "
        "'Has Bridgewater changed their NVDA position?'\n\n"
        "EDGE CASES: Foreign-listed tickers (e.g. MTPLF) may have no 13F data. "
        "13F filings are quarterly — data may be 1-3 months old.\n\n"
        "DO NOT USE FOR: Insider trades (use get_insider_trades). "
        "Real-time ownership changes. Retail investor data. ETF holdings."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "ticker": {
                "type": "string",
                "description": "Stock ticker symbol (e.g. NVDA, AAPL, GLD)",
            },
        },
        "required": ["ticker"],
    },
}


async def get_institutional_holders(ticker: str) -> dict:
    """Fetch institutional holders for a ticker from SEC EDGAR 13F data.

    Uses SEC EDGAR full-text search to find recent 13F filings mentioning
    the ticker, then extracts fund information.
    """
    tool_name = "get_institutional_holders"
    ticker = ticker.upper().strip()

    if not ticker or len(ticker) > 10:
        return validation_error(tool_name, f"Invalid ticker: '{ticker}'").to_dict()

    # Step 1: Search SEC EDGAR for recent 13F filings mentioning this ticker
    result = await _sec_request(
        f"{SEC_EFTS}/search-index",
        tool_name,
        params={
            "q": f'"{ticker}"',
            "forms": "13F-HR,13F-HR/A",
            "dateRange": "custom",
            "startdt": _quarter_ago(),
            "enddt": datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        },
    )

    if isinstance(result, dict) and result.get("ok") is False:
        return result

    if result.get("status_code") != 200:
        return classify_http_error(tool_name, result["status_code"]).to_dict()

    data = result["data"]
    hits = data.get("hits", {}).get("hits", [])

    if not hits:
        return business_error(
            tool_name,
            f"No recent 13F filings found mentioning '{ticker}'. "
            f"This may be a foreign listing, small-cap, or recently IPO'd company.",
            {"ticker": ticker},
        ).to_dict()

    # Step 2: Extract unique filers and match against major fund list
    holders = []
    seen_filers = set()

    for hit in hits[:50]:  # Cap at 50 to stay responsive
        source = hit.get("_source", {})
        filer_name = source.get("display_names", [""])[0] if source.get("display_names") else source.get("entity_name", "")
        filer_cik = source.get("entity_id", "")
        filed_at = source.get("file_date", "")
        form_type = source.get("form_type", "")

        if not filer_name or filer_cik in seen_filers:
            continue
        seen_filers.add(filer_cik)

        # Check if this is one of our tracked major funds
        padded_cik = filer_cik.zfill(10)
        is_major = padded_cik in MAJOR_FUND_CIKS
        display_name = MAJOR_FUND_CIKS.get(padded_cik, filer_name)

        holders.append({
            "fund_name": display_name,
            "cik": filer_cik,
            "filing_date": filed_at,
            "form_type": form_type,
            "is_major_fund": is_major,
        })

    # Sort: major funds first, then by filing date
    holders.sort(key=lambda h: (not h["is_major_fund"], h.get("filing_date", "") or ""), reverse=False)
    holders.sort(key=lambda h: h["is_major_fund"], reverse=True)

    major_count = sum(1 for h in holders if h["is_major_fund"])

    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "ticker": ticker,
            "total_filers": len(holders),
            "major_fund_filers": major_count,
            "holders": holders[:20],  # Top 20 by relevance
            "data_freshness": "13F filings are quarterly — data may be 1-3 months old",
        },
    ).to_dict()


# ============================================================================
# TOOL: get_13f_fund_positions
# ============================================================================

GET_13F_FUND_POSITIONS_SCHEMA = {
    "name": "get_13f_fund_positions",
    "description": (
        "Check a specific major fund's recent 13F filing for position changes. "
        "Returns the fund's latest filing summary — useful for tracking what "
        "Berkshire, Renaissance, Bridgewater, etc. are buying or selling.\n\n"
        "INPUT: fund_name (string, e.g. 'Berkshire Hathaway', 'Renaissance Technologies').\n\n"
        "EXAMPLE QUERIES: 'What has Bridgewater been buying?', "
        "'Renaissance Technologies latest 13F', 'Citadel position changes'\n\n"
        "EDGE CASES: If the fund name doesn't match a tracked fund, returns available options. "
        "13F filings cover only US-listed equity positions over $100M AUM threshold.\n\n"
        "DO NOT USE FOR: Specific ticker institutional holders (use get_institutional_holders). "
        "Insider trades. Real-time position data. Non-US fund filings."
    ),
    "input_schema": {
        "type": "object",
        "properties": {
            "fund_name": {
                "type": "string",
                "description": "Fund name to look up (e.g. 'Berkshire Hathaway', 'Renaissance')",
            },
        },
        "required": ["fund_name"],
    },
}


async def get_13f_fund_positions(fund_name: str) -> dict:
    """Fetch recent 13F filing details for a specific major fund.

    Looks up the fund's CIK, fetches their latest submissions,
    and returns filing metadata.
    """
    tool_name = "get_13f_fund_positions"
    fund_name = fund_name.strip()

    if not fund_name:
        return validation_error(tool_name, "Fund name is required").to_dict()

    # Match fund name to CIK (fuzzy match against our tracked funds)
    matched_cik = None
    matched_name = None
    fund_lower = fund_name.lower()

    for cik, name in MAJOR_FUND_CIKS.items():
        if fund_lower in name.lower() or name.lower() in fund_lower:
            matched_cik = cik
            matched_name = name
            break

    # Try partial word match
    if not matched_cik:
        for cik, name in MAJOR_FUND_CIKS.items():
            name_words = name.lower().split()
            if any(word in fund_lower for word in name_words if len(word) > 3):
                matched_cik = cik
                matched_name = name
                break

    if not matched_cik:
        available = list(MAJOR_FUND_CIKS.values())
        return business_error(
            tool_name,
            f"Fund '{fund_name}' not found in tracked major funds. "
            f"Available funds: {', '.join(available)}",
            {"available_funds": available},
        ).to_dict()

    # Fetch the fund's submissions from SEC EDGAR
    result = await _sec_request(
        f"{SEC_BASE}/submissions/CIK{matched_cik}.json",
        tool_name,
    )

    if isinstance(result, dict) and result.get("ok") is False:
        return result

    if result.get("status_code") != 200:
        return classify_http_error(tool_name, result["status_code"]).to_dict()

    data = result["data"]

    # Extract recent 13F filings from the submissions
    recent_filings = data.get("filings", {}).get("recent", {})
    forms = recent_filings.get("form", [])
    dates = recent_filings.get("filingDate", [])
    accessions = recent_filings.get("accessionNumber", [])
    primary_docs = recent_filings.get("primaryDocument", [])

    filings_13f = []
    for i, form in enumerate(forms):
        if form in ("13F-HR", "13F-HR/A") and i < len(dates):
            filings_13f.append({
                "form_type": form,
                "filing_date": dates[i] if i < len(dates) else "",
                "accession_number": accessions[i] if i < len(accessions) else "",
                "document": primary_docs[i] if i < len(primary_docs) else "",
            })

    if not filings_13f:
        return business_error(
            tool_name,
            f"No recent 13F filings found for {matched_name}.",
            {"fund_name": matched_name, "cik": matched_cik},
        ).to_dict()

    # Return the most recent filings (up to 4 quarters)
    return ToolResult(
        ok=True,
        tool_name=tool_name,
        data={
            "fund_name": matched_name,
            "cik": matched_cik,
            "total_filings_found": len(filings_13f),
            "recent_filings": filings_13f[:4],
            "entity_name": data.get("name", matched_name),
            "entity_type": data.get("entityType", ""),
            "sic": data.get("sic", ""),
            "sic_description": data.get("sicDescription", ""),
            "data_freshness": "13F filings are quarterly — most recent may be 1-3 months old",
        },
    ).to_dict()


# ============================================================================
# HELPERS
# ============================================================================

def _quarter_ago() -> str:
    """Return a date string ~3 months ago for 13F filing search range."""
    from datetime import timedelta
    dt = datetime.now(timezone.utc) - timedelta(days=120)
    return dt.strftime("%Y-%m-%d")


# ============================================================================
# SCHEMA REGISTRY
# ============================================================================

SEC_EDGAR_TOOL_SCHEMAS = [
    INSTITUTIONAL_HOLDERS_SCHEMA,
    GET_13F_FUND_POSITIONS_SCHEMA,
]

SEC_EDGAR_TOOL_EXECUTORS = {
    "get_institutional_holders": get_institutional_holders,
    "get_13f_fund_positions": get_13f_fund_positions,
}
