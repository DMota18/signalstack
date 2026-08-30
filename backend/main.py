"""
SignalStack — FastAPI Application
Entry point that assembles routes, middleware, and CORS.

Run with: uvicorn backend.main:app --reload --host 0.0.0.0 --port 8000
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.api import (
    alerts,
    auth,
    billing,
    chart,
    connections,
    earnings,
    explore,
    intelligence,
    manual_portfolio,
    market_data,
    news,
    og_image,
    polymarket,
    portfolios,
    price_alerts,
    profiles,
    push_subscriptions,
    referrals,
    research,
    seo,
    stocktwits,
    valuation,
    watchlist,
)
from backend.config import get_settings
from backend.middleware.rate_limit import RateLimitMiddleware


def create_app() -> FastAPI:
    """Application factory. Creates and configures the FastAPI app."""
    settings = get_settings()

    app = FastAPI(
        title=settings.app_name,
        description=(
            "AI-powered portfolio intelligence platform. "
            "Synthesizes market sentiment, prediction markets, insider activity, "
            "institutional flow, and macro context into personalized intelligence."
        ),
        version=settings.api_version,
        docs_url="/docs" if settings.debug else None,
        redoc_url="/redoc" if settings.debug else None,
    )

    # --- CORS ---
    # In development: allow all origins for local PWA dev server.
    # In production: use CORS_ORIGINS env var (comma-separated).
    if settings.debug:
        origins = ["*"]
    elif settings.cors_origins:
        origins = [o.strip() for o in settings.cors_origins.split(",") if o.strip()]
    else:
        origins = ["https://signalstack.app", "https://www.signalstack.app"]

    app.add_middleware(
        CORSMiddleware,
        allow_origins=origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # --- Rate Limiting ---
    app.add_middleware(RateLimitMiddleware)

    # --- Routes ---
    prefix = f"/api/{settings.api_version}"

    app.include_router(auth.router, prefix=prefix)
    app.include_router(profiles.router, prefix=prefix)
    app.include_router(portfolios.router, prefix=prefix)
    app.include_router(watchlist.router, prefix=prefix)
    app.include_router(alerts.router, prefix=prefix)
    app.include_router(connections.router, prefix=prefix)
    app.include_router(intelligence.router, prefix=prefix)
    app.include_router(manual_portfolio.router, prefix=prefix)
    app.include_router(chart.router, prefix=prefix)
    app.include_router(polymarket.router, prefix=prefix)
    app.include_router(earnings.router, prefix=prefix)
    app.include_router(explore.router, prefix=prefix)
    app.include_router(research.router, prefix=prefix)
    app.include_router(price_alerts.router, prefix=prefix)
    app.include_router(push_subscriptions.router, prefix=prefix)
    app.include_router(news.router, prefix=prefix)
    app.include_router(valuation.router, prefix=prefix)
    app.include_router(market_data.router, prefix=prefix)
    app.include_router(stocktwits.router, prefix=prefix)
    app.include_router(billing.router, prefix=prefix)
    app.include_router(og_image.router, prefix=prefix)
    app.include_router(referrals.router, prefix=prefix)

    # --- SEO (root level, not under /api/v1) ---
    app.include_router(seo.router)

    # --- Health Check ---
    @app.get("/health")
    async def health():
        return {
            "status": "ok",
            "app": settings.app_name,
            "version": settings.api_version,
            "env": settings.app_env,
        }

    @app.get("/")
    async def root():
        return {
            "app": settings.app_name,
            "docs": "/docs" if settings.debug else None,
            "api": f"{prefix}/",
        }

    return app


app = create_app()
