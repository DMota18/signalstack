"""
SignalStack — NewsAPI Tool

Provider: NewsAPI.org
Rate limit: 100 req/day (free), 1000/day (paid)
Auth: API key in header or query param

Tools:
  get_market_headlines — Top headlines from business/finance sources
  search_news — Full-text search across 150K+ sources
"""

import httpx
import logging
from datetime import datetime, timezone, timedelta
from backend.tools.base import (
    ToolResult, transient_error, validation_error,
    business_error, retry_with_backoff,
)
from backend.config import get_settings

logger = logging.getLogger("tools.newsapi")

NEWSAPI_BASE = "https://newsapi.org/v2"


async def get_market_headlines(category: str = "business", country: str = "us", page_size: int = 20) -> dict:
    """Fetch top headlines from NewsAPI."""
    tool_name = "get_market_headlines"
    settings = get_settings()

    if not settings.newsapi_api_key:
        return business_error(tool_name, "NewsAPI key not configured — using Finnhub fallback").to_dict()

    async def _call():
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{NEWSAPI_BASE}/top-headlines",
                params={
                    "category": category,
                    "country": country,
                    "pageSize": min(page_size, 50),
                    "apiKey": settings.newsapi_api_key,
                },
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    try:
        result = await retry_with_backoff(_call, max_retries=1, base_delay=5.0, tool_name=tool_name)
    except Exception as e:
        return transient_error(tool_name, f"NewsAPI request failed: {e}").to_dict()

    if result.get("status_code") != 200:
        return transient_error(tool_name, f"NewsAPI error: {result.get('data', {}).get('message', '')}").to_dict()

    data = result["data"]
    articles = data.get("articles", [])

    normalized = []
    for a in articles:
        if not a.get("title") or a["title"] == "[Removed]":
            continue
        normalized.append({
            "headline": a.get("title", ""),
            "source": a.get("source", {}).get("name", ""),
            "url": a.get("url", ""),
            "summary": a.get("description", ""),
            "image_url": a.get("urlToImage"),
            "published_at": a.get("publishedAt", ""),
        })

    return ToolResult(
        ok=True, tool_name=tool_name,
        data={"articles": normalized, "total_results": data.get("totalResults", 0)},
    ).to_dict()


async def search_news(query: str, days_back: int = 7, page_size: int = 15) -> dict:
    """Search news articles by keyword."""
    tool_name = "search_news"
    settings = get_settings()

    if not settings.newsapi_api_key:
        return business_error(tool_name, "NewsAPI key not configured").to_dict()

    from_date = (datetime.now(timezone.utc) - timedelta(days=days_back)).strftime("%Y-%m-%d")

    async def _call():
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.get(
                f"{NEWSAPI_BASE}/everything",
                params={
                    "q": query,
                    "from": from_date,
                    "sortBy": "publishedAt",
                    "pageSize": min(page_size, 50),
                    "language": "en",
                    "apiKey": settings.newsapi_api_key,
                },
            )
            return {"status_code": resp.status_code, "data": resp.json()}

    try:
        result = await retry_with_backoff(_call, max_retries=1, base_delay=5.0, tool_name=tool_name)
    except Exception as e:
        return transient_error(tool_name, f"NewsAPI search failed: {e}").to_dict()

    if result.get("status_code") != 200:
        return transient_error(tool_name, f"NewsAPI error: {result.get('data', {}).get('message', '')}").to_dict()

    data = result["data"]
    articles = []
    for a in data.get("articles", []):
        if not a.get("title") or a["title"] == "[Removed]":
            continue
        articles.append({
            "headline": a.get("title", ""),
            "source": a.get("source", {}).get("name", ""),
            "url": a.get("url", ""),
            "summary": a.get("description", ""),
            "image_url": a.get("urlToImage"),
            "published_at": a.get("publishedAt", ""),
        })

    return ToolResult(
        ok=True, tool_name=tool_name,
        data={"query": query, "articles": articles, "total_results": data.get("totalResults", 0)},
    ).to_dict()
