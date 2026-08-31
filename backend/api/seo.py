"""
SignalStack — SEO Routes

Public endpoints for search engine optimization:
  GET /sitemap.xml   — Dynamic sitemap listing all public research pages
  GET /robots.txt    — Crawler directives

The sitemap includes:
  - Static pages (landing, signin, signup)
  - Dynamic research pages for all tickers held by any user
  - Priority weighting: popular tickers (held by more users) get higher priority
"""

import logging
from datetime import UTC, datetime

from fastapi import APIRouter, Response

from backend.services.supabase import get_service_client

logger = logging.getLogger("api.seo")

router = APIRouter(tags=["seo"])

# Popular tickers to always include even if no users hold them yet
SEED_TICKERS = [
    "AAPL", "MSFT", "GOOGL", "AMZN", "NVDA", "META", "TSLA", "BRK-B",
    "JPM", "V", "UNH", "MA", "HD", "PG", "JNJ", "XOM", "BAC", "ABBV",
    "KO", "PEP", "MRK", "COST", "AVGO", "LLY", "WMT", "AMD", "NFLX",
    "CRM", "ORCL", "ADBE", "PLTR", "COIN", "SQ", "SHOP", "SNOW", "NET",
    "DDOG", "ZS", "CRWD", "PANW", "SOFI", "RIVN", "LCID",
    "SPY", "QQQ", "IWM", "DIA", "GLD", "SLV", "TLT", "VTI",
    "BTC-USD", "ETH-USD", "SOL-USD",
]

def _base_url() -> str:
    """Public origin for sitemap/robots URLs — derived from DOMAIN."""
    from backend.config import get_settings
    return get_settings().app_base_url


@router.get("/sitemap.xml")
async def sitemap():
    """Generate a dynamic XML sitemap for search engines.

    Includes all public research pages plus static pages.
    Tickers held by more users get higher priority scores.
    """
    db = get_service_client()

    # Get all unique tickers from holdings + watchlist
    tickers_set = set(SEED_TICKERS)

    holdings_result = await db.select(
        table="holdings",
        columns="ticker",
    )
    if holdings_result["status_code"] == 200 and isinstance(holdings_result["data"], list):
        for h in holdings_result["data"]:
            if h.get("ticker"):
                tickers_set.add(h["ticker"].upper())

    watchlist_result = await db.select(
        table="watchlist",
        columns="ticker",
    )
    if watchlist_result["status_code"] == 200 and isinstance(watchlist_result["data"], list):
        for w in watchlist_result["data"]:
            if w.get("ticker"):
                tickers_set.add(w["ticker"].upper())

    today = datetime.now(UTC).strftime("%Y-%m-%d")

    # Build XML
    urls = []

    # Static pages
    static_pages = [
        {"loc": "/", "priority": "1.0", "changefreq": "weekly"},
        {"loc": "/signin", "priority": "0.3", "changefreq": "monthly"},
        {"loc": "/signup", "priority": "0.5", "changefreq": "monthly"},
    ]

    for page in static_pages:
        urls.append(
            f"  <url>\n"
            f"    <loc>{_base_url()}{page['loc']}</loc>\n"
            f"    <lastmod>{today}</lastmod>\n"
            f"    <changefreq>{page['changefreq']}</changefreq>\n"
            f"    <priority>{page['priority']}</priority>\n"
            f"  </url>"
        )

    # Research pages — sorted alphabetically
    for ticker in sorted(tickers_set):
        # Popular tickers get higher priority
        priority = "0.8" if ticker in SEED_TICKERS[:20] else "0.6"
        urls.append(
            f"  <url>\n"
            f"    <loc>{_base_url()}/research/{ticker}</loc>\n"
            f"    <lastmod>{today}</lastmod>\n"
            f"    <changefreq>daily</changefreq>\n"
            f"    <priority>{priority}</priority>\n"
            f"  </url>"
        )

    xml = (
        '<?xml version="1.0" encoding="UTF-8"?>\n'
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
        + "\n".join(urls) + "\n"
        '</urlset>'
    )

    return Response(content=xml, media_type="application/xml")


@router.get("/robots.txt")
async def robots():
    """Serve robots.txt for search engine crawlers."""
    content = (
        "User-agent: *\n"
        "Allow: /\n"
        "Allow: /research/\n"
        "Disallow: /app/\n"
        "Disallow: /api/\n"
        "\n"
        f"Sitemap: {_base_url()}/sitemap.xml\n"
    )
    return Response(content=content, media_type="text/plain")
