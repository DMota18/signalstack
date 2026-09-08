"""
SignalStack — Valuation / Fair Value Routes

Uses financial statement data + Claude to estimate intrinsic value
via simplified DCF analysis.

Endpoints:
  POST /valuation/fair-value  — Compute fair value estimate for a ticker
"""

import json
import logging

from fastapi import APIRouter, Depends
from pydantic import BaseModel

from backend.config import get_settings
from backend.models.schemas import APIResponse
from backend.services.auth import CurrentUser, get_current_user

logger = logging.getLogger("api.valuation")

router = APIRouter(prefix="/valuation", tags=["valuation"])


class FairValueRequest(BaseModel):
    ticker: str
    current_price: float
    financials: dict  # income_statement, balance_sheet, cash_flow from research data
    fundamentals: dict  # P/E, market cap, revenue, etc.


@router.post("/fair-value", response_model=APIResponse)
async def compute_fair_value(
    body: FairValueRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Estimate intrinsic/fair value using Claude with financial data.

    Takes the financial statements and fundamentals already fetched by the
    research page and asks Claude to perform a simplified DCF + comparative
    valuation analysis.
    """
    import httpx

    settings = get_settings()
    ticker = body.ticker.upper().strip()

    # Build financial context for Claude
    income = body.financials.get("income_statement", [])
    cashflow = body.financials.get("cash_flow", [])
    fund = body.fundamentals

    # Summarize financials concisely
    fin_summary = f"""TICKER: {ticker}
CURRENT PRICE: ${body.current_price:.2f}

FUNDAMENTALS:
- Market Cap: {fund.get('market_cap')}
- P/E (TTM): {fund.get('trailing_pe')}
- Forward P/E: {fund.get('forward_pe')}
- EPS (TTM): {fund.get('trailing_eps')}
- Revenue (TTM): {fund.get('revenue_ttm')}
- Revenue Growth: {fund.get('revenue_growth')}
- Profit Margin: {fund.get('profit_margin')}
- EBITDA: {fund.get('ebitda')}
- ROE: {fund.get('return_on_equity')}
- Debt/Equity: {fund.get('debt_to_equity')}
- Current Ratio: {fund.get('current_ratio')}
- Beta: {fund.get('beta')}
- Dividend Yield: {fund.get('dividend_yield')}
- 52W High: {fund.get('fifty_two_week_high')}
- 52W Low: {fund.get('fifty_two_week_low')}

INCOME STATEMENT (most recent {len(income)} periods):
{json.dumps(income[:3], default=str)[:1500]}

CASH FLOW (most recent {len(cashflow)} periods):
{json.dumps(cashflow[:3], default=str)[:1500]}
"""

    prompt = f"""{fin_summary}

Based on this financial data, estimate a fair value range for {ticker}. Use a simplified approach combining:
1. DCF (if cash flow data available) — project free cash flow, apply reasonable discount rate
2. Comparable valuation — P/E, P/S, EV/EBITDA relative to growth rate
3. Asset-based floor (book value)

Return ONLY valid JSON — no markdown, no preamble:
{{
  "fair_value_low": <number>,
  "fair_value_mid": <number>,
  "fair_value_high": <number>,
  "current_price": {body.current_price},
  "valuation_status": "undervalued" | "fairly_valued" | "overvalued",
  "upside_pct": <number, positive = upside, negative = downside>,
  "methodology": "1-2 sentence summary of primary method used",
  "bull_case": "2-3 sentence bull case with specific price target reasoning",
  "bear_case": "2-3 sentence bear case with specific downside reasoning",
  "key_assumptions": ["assumption 1", "assumption 2", "assumption 3"],
  "confidence": "high" | "medium" | "low"
}}

RULES:
- Never say buy/sell/recommend. Frame as educational analysis.
- Be specific with numbers. Don't hedge excessively.
- If data is insufficient for DCF, rely on comparables and say so.
- Fair value range should reflect genuine uncertainty, not just ±10%."""

    try:
        async with httpx.AsyncClient(timeout=60.0) as client:
            resp = await client.post(
                "https://api.anthropic.com/v1/messages",
                headers={
                    "Content-Type": "application/json",
                    "x-api-key": settings.anthropic_api_key,
                    "anthropic-version": "2023-06-01",
                },
                json={
                    "model": "claude-sonnet-4-20250514",
                    "max_tokens": 1500,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )

        if resp.status_code != 200:
            logger.error(f"Claude valuation error {resp.status_code}: {resp.text[:200]}")
            return APIResponse.fail(message="Fair value computation failed", code="claude_error")

        text = ""
        for block in resp.json().get("content", []):
            if block.get("type") == "text":
                text += block["text"]

        text = text.strip().removeprefix("```json").removesuffix("```").strip()
        result = json.loads(text)
        return APIResponse.success(result)

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse valuation response: {e}")
        return APIResponse.fail(message="Failed to parse valuation", code="parse_error")
    except Exception as e:
        logger.error(f"Valuation error: {e}")
        return APIResponse.fail(message="Fair value computation failed", code="generation_error")
