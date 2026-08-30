"""
SignalStack — OG Image Generator

Generates social sharing images (1200x630) for research pages.
Returns an SVG that renders as a signal card showing:
  - Ticker + company name
  - Price + daily change
  - Signal scores (sentiment, insider, institutional, polymarket, macro)
  - SignalStack branding

Used by Open Graph and Twitter Card meta tags on public research pages.

Endpoint:
  GET /research/{ticker}/og-image  — Returns SVG image
"""

import asyncio
import logging

from fastapi import APIRouter, Response

from backend.api.research import (
    QUOTE_CACHE_TTL,
    _fetch_yf_fundamentals,
    _get_cached,
    _set_cached,
)

logger = logging.getLogger("api.og_image")

router = APIRouter(prefix="/research", tags=["og-image"])


@router.get("/{ticker}/og-image")
async def get_og_image(ticker: str):
    """Generate an OG image SVG for a ticker's research page.

    Returns a 1200x630 SVG suitable for social media sharing.
    Cached alongside the research data.
    """
    ticker = ticker.upper().strip()
    if not ticker or len(ticker) > 10:
        return _fallback_image(ticker)

    # Check cache
    cache_key = f"og_image:{ticker}"
    cached = _get_cached(cache_key, QUOTE_CACHE_TTL)
    if cached:
        return Response(content=cached, media_type="image/svg+xml",
                        headers={"Cache-Control": "public, max-age=300"})

    # Fetch basic data
    loop = asyncio.get_event_loop()
    yf_data = await loop.run_in_executor(None, _fetch_yf_fundamentals, ticker)

    if not yf_data.get("ok"):
        return _fallback_image(ticker)

    quote = yf_data.get("quote", {})
    profile = yf_data.get("profile", {})
    fund = yf_data.get("fundamentals", {})

    price = quote.get("price", 0)
    prev_close = quote.get("previous_close", 0)
    day_change = price - prev_close if prev_close else 0
    day_change_pct = (day_change / prev_close * 100) if prev_close else 0
    is_up = day_change >= 0

    name = profile.get("name", "")
    sector = profile.get("sector", "")
    market_cap = fund.get("market_cap")
    pe = fund.get("trailing_pe")

    # Format values
    price_str = f"${price:,.2f}" if price else "—"
    change_str = f"{'+'if is_up else ''}{day_change_pct:.2f}%"
    change_color = "#34C759" if is_up else "#FF453A"
    cap_str = _fmt_cap(market_cap)
    pe_str = f"{pe:.1f}" if pe else "—"

    # Build stats row
    stats = []
    if cap_str != "—":
        stats.append(("Mkt Cap", cap_str))
    if pe_str != "—":
        stats.append(("P/E", pe_str))
    if fund.get("dividend_yield"):
        stats.append(("Div Yield", f"{fund['dividend_yield']*100:.1f}%"))
    if fund.get("beta"):
        stats.append(("Beta", f"{fund['beta']:.2f}"))

    stats_svg = ""
    for i, (label, value) in enumerate(stats[:4]):
        x = 60 + i * 270
        stats_svg += f"""
        <text x="{x}" y="440" fill="#6A6A6D" font-size="13" font-family="-apple-system,BlinkMacSystemFont,sans-serif">{label}</text>
        <text x="{x}" y="462" fill="#E8E6E1" font-size="16" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,sans-serif">{value}</text>
        """

    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#0C0C0E"/>
      <stop offset="100%" stop-color="#111115"/>
    </linearGradient>
  </defs>

  <!-- Background -->
  <rect width="1200" height="630" fill="url(#bg)"/>

  <!-- Top accent line -->
  <rect x="0" y="0" width="1200" height="3" fill="#D4A843" opacity="0.6"/>

  <!-- Brand -->
  <text x="60" y="60" fill="#D4A843" font-size="18" font-weight="600" font-family="Georgia,serif" letter-spacing="1">
    SignalStack
  </text>
  <text x="1140" y="60" fill="#4A4A4D" font-size="13" font-family="-apple-system,BlinkMacSystemFont,sans-serif" text-anchor="end">
    Signal Analysis
  </text>

  <!-- Divider -->
  <line x1="60" y1="80" x2="1140" y2="80" stroke="#1A1A1D" stroke-width="0.5"/>

  <!-- Ticker -->
  <text x="60" y="160" fill="#E8E6E1" font-size="72" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,sans-serif">
    {_escape(ticker)}
  </text>

  <!-- Company name -->
  <text x="60" y="200" fill="#6A6A6D" font-size="20" font-family="-apple-system,BlinkMacSystemFont,sans-serif">
    {_escape(name[:50])}{'' if len(name) <= 50 else '...'}
  </text>

  <!-- Price -->
  <text x="60" y="290" fill="#E8E6E1" font-size="48" font-weight="600" font-family="-apple-system,BlinkMacSystemFont,sans-serif">
    {price_str}
  </text>

  <!-- Change -->
  <text x="60" y="330" fill="{change_color}" font-size="22" font-weight="500" font-family="-apple-system,BlinkMacSystemFont,sans-serif">
    {change_str}
  </text>

  <!-- Sector badge -->
  {f'<rect x="60" y="350" width="{len(sector)*9 + 20}" height="28" rx="6" fill="#D4A84312"/><text x="70" y="369" fill="#D4A843" font-size="12" font-family="-apple-system,BlinkMacSystemFont,sans-serif">{_escape(sector)}</text>' if sector else ''}

  <!-- Stats row -->
  <line x1="60" y1="410" x2="1140" y2="410" stroke="#1A1A1D" stroke-width="0.5"/>
  {stats_svg}

  <!-- Bottom bar -->
  <rect x="0" y="500" width="1200" height="130" fill="#0A0A0C"/>
  <line x1="0" y1="500" x2="1200" y2="500" stroke="#1A1A1D" stroke-width="0.5"/>

  <!-- Signal dimensions label -->
  <text x="60" y="535" fill="#6A6A6D" font-size="11" font-family="-apple-system,BlinkMacSystemFont,sans-serif" letter-spacing="2">
    SIGNAL DIMENSIONS
  </text>

  <!-- Signal dimension pills -->
  <rect x="60" y="552" width="120" height="30" rx="6" fill="#818CF815"/>
  <text x="120" y="572" fill="#818CF8" font-size="12" font-weight="500" font-family="-apple-system,BlinkMacSystemFont,sans-serif" text-anchor="middle">Polymarket</text>

  <rect x="195" y="552" width="86" height="30" rx="6" fill="#D4A84312"/>
  <text x="238" y="572" fill="#D4A843" font-size="12" font-weight="500" font-family="-apple-system,BlinkMacSystemFont,sans-serif" text-anchor="middle">Insider</text>

  <rect x="296" y="552" width="110" height="30" rx="6" fill="#D4A84312"/>
  <text x="351" y="572" fill="#D4A843" font-size="12" font-weight="500" font-family="-apple-system,BlinkMacSystemFont,sans-serif" text-anchor="middle">Institutional</text>

  <rect x="421" y="552" width="100" height="30" rx="6" fill="#D4A84312"/>
  <text x="471" y="572" fill="#D4A843" font-size="12" font-weight="500" font-family="-apple-system,BlinkMacSystemFont,sans-serif" text-anchor="middle">Sentiment</text>

  <rect x="536" y="552" width="72" height="30" rx="6" fill="#D4A84312"/>
  <text x="572" y="572" fill="#D4A843" font-size="12" font-weight="500" font-family="-apple-system,BlinkMacSystemFont,sans-serif" text-anchor="middle">Macro</text>

  <!-- CTA -->
  <text x="1140" y="572" fill="#4A4A4D" font-size="13" font-family="-apple-system,BlinkMacSystemFont,sans-serif" text-anchor="end">
    signalstack.app/research/{_escape(ticker)}
  </text>

  <!-- Disclaimer -->
  <text x="60" y="612" fill="#2A2A2D" font-size="10" font-family="-apple-system,BlinkMacSystemFont,sans-serif">
    Educational market intelligence. Not investment advice.
  </text>
</svg>"""

    _set_cached(cache_key, svg)
    return Response(
        content=svg,
        media_type="image/svg+xml",
        headers={"Cache-Control": "public, max-age=300"},
    )


def _fallback_image(ticker: str) -> Response:
    """Return a minimal fallback OG image when data is unavailable."""
    svg = f"""<?xml version="1.0" encoding="UTF-8"?>
<svg width="1200" height="630" viewBox="0 0 1200 630" xmlns="http://www.w3.org/2000/svg">
  <rect width="1200" height="630" fill="#0C0C0E"/>
  <rect x="0" y="0" width="1200" height="3" fill="#D4A843" opacity="0.6"/>
  <text x="600" y="280" fill="#E8E6E1" font-size="72" font-weight="700" font-family="-apple-system,BlinkMacSystemFont,sans-serif" text-anchor="middle">
    {_escape(ticker.upper())}
  </text>
  <text x="600" y="330" fill="#6A6A6D" font-size="22" font-family="-apple-system,BlinkMacSystemFont,sans-serif" text-anchor="middle">
    Signal Analysis
  </text>
  <text x="600" y="420" fill="#D4A843" font-size="18" font-family="Georgia,serif" text-anchor="middle">
    SignalStack
  </text>
</svg>"""
    return Response(content=svg, media_type="image/svg+xml",
                    headers={"Cache-Control": "public, max-age=60"})


def _escape(text: str) -> str:
    """Escape text for SVG XML."""
    return text.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;")


def _fmt_cap(val) -> str:
    """Format market cap for display."""
    if not val:
        return "—"
    if val >= 1e12:
        return f"${val/1e12:.2f}T"
    if val >= 1e9:
        return f"${val/1e9:.1f}B"
    if val >= 1e6:
        return f"${val/1e6:.0f}M"
    return f"${val:,.0f}"
