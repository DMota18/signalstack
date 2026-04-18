"""
SignalStack — Explore / Idea Engine Routes (Premium)

Generates personalized investment ideas using Claude API based
on the user's holdings, investor profile, category, and market context.

Premium tier required for generation. Free tier can view cached samples.

Endpoints:
  GET  /explore/ideas          — Get cached ideas
  POST /explore/generate       — Generate fresh ideas (pro/premium)
  POST /explore/deep-dive      — Deep analysis on a single ticker (premium)
  GET  /explore/categories     — List available idea categories
"""

import json
import logging
from datetime import datetime, timezone
from typing import Optional
from fastapi import APIRouter, Depends, Query
from pydantic import BaseModel
from backend.models.schemas import APIResponse
from backend.services.auth import get_current_user, CurrentUser
from backend.services.supabase import get_anon_client, get_service_client
from backend.config import get_settings

logger = logging.getLogger("api.explore")

router = APIRouter(prefix="/explore", tags=["explore"])


# ─── Category definitions ──────────────────────────────────────────────

EXPLORE_CATEGORIES = {
    "for_you": {
        "label": "For you",
        "description": "Personalized ideas based on your portfolio and profile",
        "icon": "sparkles",
        "tier": "pro",
    },
    "adjacent": {
        "label": "Adjacent opportunities",
        "description": "Companies correlated with or in the same ecosystem as your holdings",
        "icon": "git-branch",
        "tier": "pro",
    },
    "contrarian": {
        "label": "Contrarian plays",
        "description": "Beaten-down names with potential reversal catalysts",
        "icon": "rotate-ccw",
        "tier": "pro",
    },
    "momentum": {
        "label": "Momentum leaders",
        "description": "Stocks with strong technical and fundamental momentum",
        "icon": "trending-up",
        "tier": "pro",
    },
    "under_the_radar": {
        "label": "Under the radar",
        "description": "Small and mid caps with low analyst coverage and high potential",
        "icon": "search",
        "tier": "pro",
    },
    "dividends_income": {
        "label": "Dividend & income",
        "description": "High-yield stocks, REITs, and income-generating positions",
        "icon": "dollar-sign",
        "tier": "pro",
    },
    "sector_rotation": {
        "label": "Sector rotation",
        "description": "Sectors gaining momentum based on macro and flow data",
        "icon": "refresh-cw",
        "tier": "pro",
    },
    "hedge_diversify": {
        "label": "Hedge & diversify",
        "description": "Positions to reduce concentration risk in your portfolio",
        "icon": "shield",
        "tier": "pro",
    },
    "ai_semiconductors": {
        "label": "AI & semiconductors",
        "description": "Companies in the AI infrastructure and chip supply chain",
        "icon": "cpu",
        "tier": "pro",
    },
    "crypto_blockchain": {
        "label": "Crypto & blockchain",
        "description": "Crypto assets and blockchain-related equities",
        "icon": "bitcoin",
        "tier": "pro",
    },
}


IDEA_GENERATION_PROMPT = """You are a senior investment research analyst at a tier-1 firm. Given a user's portfolio,
investor profile, and a specific research category, produce 5-8 high-quality research ideas.

RULES:
- NEVER say "buy", "sell", "you should", or "I recommend"
- Frame as "data suggests", "worth researching", "shows strength in"
- Each idea MUST explain WHY it's relevant to their specific holdings or profile
- Include quantitative data points where possible (P/E, revenue growth, correlation, yield)
- Vary risk levels across ideas — don't make all aggressive or all conservative
- Reason should be 2-3 sentences with specific, actionable insight
- For "contrarian": focus on beaten-down names with catalysts (earnings turnaround, insider buying, valuation floor)
- For "momentum": focus on names breaking out with volume and fundamental confirmation
- For "under_the_radar": focus on sub-$10B market cap with <5 analyst coverage
- For "dividends_income": focus on sustainable yield, payout ratio, and dividend growth streak
- For "hedge_diversify": focus on low/negative correlation to their existing holdings
- For "sector_rotation": identify 2-3 sectors gaining relative strength and pick leaders

Return ONLY valid JSON — no markdown, no backticks, no preamble:
{
  "ideas": [
    {
      "ticker": "MSTR",
      "name": "MicroStrategy Inc",
      "reason": "High correlation with BTC (0.85). 30-day relative strength rank 95th percentile. Leveraged Bitcoin exposure without direct crypto custody — relevant given your 15% BTC allocation.",
      "type": "Adjacent to holdings",
      "risk_level": "Aggressive",
      "sector": "Technology",
      "catalyst": "Upcoming earnings + Bitcoin halving tailwind",
      "data_points": {
        "pe_ratio": null,
        "market_cap": "$28B",
        "revenue_growth": "7.2%",
        "dividend_yield": null,
        "correlation_to_portfolio": 0.72
      }
    }
  ],
  "category_insight": "One sentence summarizing the theme for this category and current market conditions."
}
"""


class GenerateRequest(BaseModel):
    category: str = "for_you"


class DeepDiveRequest(BaseModel):
    ticker: str


@router.get("/categories", response_model=APIResponse)
async def list_categories(user: CurrentUser = Depends(get_current_user)):
    """List available explore categories with tier requirements."""
    cats = []
    for key, cat in EXPLORE_CATEGORIES.items():
        cats.append({
            "key": key,
            "label": cat["label"],
            "description": cat["description"],
            "icon": cat["icon"],
            "tier": cat["tier"],
            "locked": cat["tier"] == "pro" and user.tier == "free",
        })
    return APIResponse.success(cats)


@router.get("/ideas", response_model=APIResponse)
async def get_ideas(
    category: str = Query("for_you"),
    user: CurrentUser = Depends(get_current_user),
):
    """Get cached explore ideas for a category."""
    db = get_anon_client()

    # Fetch the most recent ideas for this category
    result = await db.select(
        table="alert_history",
        columns="body_json,created_at",
        filters={
            "user_id": f"eq.{user.id}",
            "alert_type": f"eq.explore_{category}",
        },
        user_jwt=user.jwt_token,
        order="created_at.desc",
        limit=1,
    )

    # Fallback: try the old "explore_idea" type for backwards compat
    if (result["status_code"] != 200 or not result.get("data")) and category == "for_you":
        result = await db.select(
            table="alert_history",
            columns="body_json,created_at",
            filters={
                "user_id": f"eq.{user.id}",
                "alert_type": "eq.explore_idea",
            },
            user_jwt=user.jwt_token,
            order="created_at.desc",
            limit=1,
        )

    if result["status_code"] == 200 and isinstance(result["data"], list) and result["data"]:
        cached = result["data"][0]
        body = cached.get("body_json", {})
        return APIResponse.success({
            "ideas": body.get("ideas", []),
            "category_insight": body.get("category_insight", ""),
            "generated_at": cached.get("created_at"),
            "category": category,
            "cached": True,
        })

    return APIResponse.success({
        "ideas": [],
        "category_insight": "",
        "generated_at": None,
        "category": category,
        "cached": False,
    })


@router.post("/generate", response_model=APIResponse)
async def generate_ideas(
    body: GenerateRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Generate fresh explore ideas using Claude API.

    Requires pro or premium tier. Category determines the research angle.
    """
    import httpx

    category = body.category
    cat_def = EXPLORE_CATEGORIES.get(category)

    if not cat_def:
        return APIResponse.fail(message=f"Unknown category: {category}", code="invalid_category")

    # Tier gating — all explore categories require Pro
    if cat_def["tier"] == "pro" and user.tier == "free":
        return APIResponse.fail(
            message=f"'{cat_def['label']}' requires Pro tier. Upgrade to unlock all research categories.",
            code="tier_required",
            details={"upgrade_url": "/app/settings"},
        )

    settings = get_settings()
    db_anon = get_anon_client()
    db_service = get_service_client()

    # 1. Get holdings
    holdings_res = await db_anon.select(
        table="holdings",
        columns="ticker,security_name,security_type,pct_of_portfolio,current_price,day_gain_pct,total_gain_pct",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        order="pct_of_portfolio.desc.nullslast",
    )

    holdings = holdings_res["data"] if holdings_res["status_code"] == 200 and isinstance(holdings_res["data"], list) else []

    if not holdings:
        return APIResponse.fail(message="No holdings found. Add holdings first.", code="no_holdings")

    # 2. Get investor profile
    profile_res = await db_anon.select(
        table="investor_profiles",
        columns="risk_appetite,sector_interests,discovery_mode",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
        single=True,
    )

    profile = profile_res["data"] if profile_res["status_code"] == 200 and isinstance(profile_res["data"], dict) else {
        "risk_appetite": "moderate",
        "sector_interests": [],
        "discovery_mode": "adjacent",
    }

    # 3. Build category-aware prompt
    holdings_text = "\n".join(
        f"- {h['ticker']}: {h.get('security_name', '')} ({h.get('security_type', 'equity')}, "
        f"{h.get('pct_of_portfolio', 0):.1f}% weight, "
        f"price ${h.get('current_price', 0):.2f}, "
        f"day {h.get('day_gain_pct', 0):+.1f}%, "
        f"total {h.get('total_gain_pct', 0):+.1f}%)"
        for h in holdings[:15]
    )

    # Portfolio summary stats
    total_value = sum(h.get("current_price", 0) * 1 for h in holdings)  # approximate
    sectors = set(h.get("security_type", "equity") for h in holdings)

    user_msg = f"""CATEGORY: {cat_def['label']} — {cat_def['description']}

USER PORTFOLIO ({len(holdings)} positions):
{holdings_text}

INVESTOR PROFILE:
- Risk appetite: {profile.get('risk_appetite', 'moderate')}
- Sector interests: {', '.join(profile.get('sector_interests', [])) or 'none specified'}
- Discovery preference: {profile.get('discovery_mode', 'adjacent')}

RESEARCH FOCUS: {cat_def['description']}
Generate 5-8 ticker ideas specifically matching the "{cat_def['label']}" category.
Each idea must be clearly relevant to this category angle and the user's existing positions.
Return ONLY the JSON object with "ideas" array and "category_insight" string."""

    # 4. Call Claude API
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
                    "max_tokens": 3000,
                    "system": IDEA_GENERATION_PROMPT,
                    "messages": [{"role": "user", "content": user_msg}],
                },
            )

        if resp.status_code != 200:
            logger.error(f"Claude API error {resp.status_code}: {resp.text[:300]}")
            return APIResponse.fail(message="Idea generation failed", code="claude_error")

        response_data = resp.json()
        text = ""
        for block in response_data.get("content", []):
            if block.get("type") == "text":
                text += block["text"]

        text = text.strip().removeprefix("```json").removesuffix("```").strip()
        parsed = json.loads(text)

        if isinstance(parsed, list):
            ideas = parsed
            category_insight = ""
        elif isinstance(parsed, dict):
            ideas = parsed.get("ideas", [])
            category_insight = parsed.get("category_insight", "")
        else:
            ideas = []
            category_insight = ""

    except json.JSONDecodeError as e:
        logger.error(f"Failed to parse Claude ideas response: {e}")
        return APIResponse.fail(message="Failed to parse ideas", code="parse_error")
    except Exception as e:
        logger.error(f"Idea generation error: {e}")
        return APIResponse.fail(message=f"Idea generation failed: {str(e)[:100]}", code="generation_error")

    # 5. Cache
    alert_data = {
        "user_id": user.id,
        "alert_type": f"explore_{category}",
        "title": f"{cat_def['label']} ({len(ideas)} ideas)",
        "body_json": {"ideas": ideas, "category_insight": category_insight, "category": category},
        "related_tickers": [i.get("ticker", "") for i in ideas if i.get("ticker")],
        "signals_used": ["profile", category],
        "created_at": datetime.now(timezone.utc).isoformat(),
    }

    await db_service.insert(table="alert_history", data=alert_data)

    return APIResponse.success({
        "ideas": ideas,
        "category_insight": category_insight,
        "generated_at": alert_data["created_at"],
        "category": category,
        "cached": False,
    })


@router.post("/deep-dive", response_model=APIResponse)
async def deep_dive(
    body: DeepDiveRequest,
    user: CurrentUser = Depends(get_current_user),
):
    """Generate a deep-dive analysis on a single ticker. Premium only.

    Returns: bull/bear thesis, key risks, catalysts, valuation context,
    and how it fits the user's portfolio.
    """
    import httpx

    # Pro tier required
    if user.tier == "free":
        return APIResponse.fail(
            message="Deep-dive analysis requires Pro tier.",
            code="tier_required",
            details={"upgrade_url": "/app/settings"},
        )

    settings = get_settings()
    db_anon = get_anon_client()
    ticker = body.ticker.upper().strip()

    # Get user holdings for portfolio context
    holdings_res = await db_anon.select(
        table="holdings",
        columns="ticker,security_name,pct_of_portfolio",
        filters={"user_id": f"eq.{user.id}"},
        user_jwt=user.jwt_token,
    )
    holdings = holdings_res["data"] if holdings_res["status_code"] == 200 and isinstance(holdings_res["data"], list) else []
    holdings_text = ", ".join(f"{h['ticker']} ({h.get('pct_of_portfolio', 0):.0f}%)" for h in holdings[:10])

    prompt = f"""Produce a deep-dive research brief on {ticker} for a user whose current portfolio is: {holdings_text or 'not provided'}.

Return ONLY valid JSON:
{{
  "ticker": "{ticker}",
  "bull_case": "2-3 sentence bull thesis with specific data points",
  "bear_case": "2-3 sentence bear thesis with specific risks",
  "key_catalysts": ["catalyst 1", "catalyst 2", "catalyst 3"],
  "key_risks": ["risk 1", "risk 2", "risk 3"],
  "valuation_context": "1-2 sentences on current valuation vs history/peers",
  "portfolio_fit": "1-2 sentences on how this fits or diversifies their existing portfolio",
  "conviction_level": "high" | "medium" | "low",
  "time_horizon": "short" | "medium" | "long"
}}

RULES: Never say buy/sell/recommend. Frame as educational research. Use specific data."""

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
                    "max_tokens": 2000,
                    "messages": [{"role": "user", "content": prompt}],
                },
            )

        if resp.status_code != 200:
            return APIResponse.fail(message="Deep-dive generation failed", code="claude_error")

        text = ""
        for block in resp.json().get("content", []):
            if block.get("type") == "text":
                text += block["text"]

        text = text.strip().removeprefix("```json").removesuffix("```").strip()
        analysis = json.loads(text)
        return APIResponse.success(analysis)

    except Exception as e:
        logger.error(f"Deep-dive error: {e}")
        return APIResponse.fail(message="Deep-dive failed", code="generation_error")
