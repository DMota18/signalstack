"""
SignalStack — Configuration
Loads environment variables and provides typed settings.
All secrets come from .env — never hardcoded.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
    )

    # --- Supabase ---
    supabase_url: str
    supabase_anon_key: str          # For user-context operations (respects RLS)
    supabase_service_role_key: str  # For backend operations (bypasses RLS)

    # --- Encryption ---
    # Fernet key for encrypting SnapTrade tokens at the application layer.
    # Generate with: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
    encryption_key: str

    # --- Claude API ---
    anthropic_api_key: str
    claude_model: str = "claude-sonnet-4-20250514"

    # --- SnapTrade (Phase 1) ---
    snaptrade_client_id: str = ""
    snaptrade_consumer_key: str = ""

    # --- Data Providers ---
    finnhub_api_key: str = ""
    fred_api_key: str = ""
    alpha_vantage_api_key: str = ""
    newsapi_api_key: str = ""
    unusual_whales_api_key: str = ""
    # Polymarket Gamma API: no key needed (free, unauthenticated)
    # Fear & Greed: no key needed (free endpoint)

    # --- App ---
    app_name: str = "SignalStack"
    app_env: str = "development"       # development | staging | production
    debug: bool = True
    api_version: str = "v1"
    # Comma-separated list of allowed CORS origins for production
    cors_origins: str = ""
    # Public hostname of the deployed app (e.g. signalstack.example.com).
    # Shared with Caddy via the same DOMAIN env var; drives email links,
    # referral links, SEO/OG URLs, OAuth redirects, and the CORS fallback.
    domain: str = ""

    @property
    def app_base_url(self) -> str:
        """Public origin of the deployed app — never hardcode a domain."""
        if self.domain:
            return f"https://{self.domain}"
        if self.cors_origins:
            first = self.cors_origins.split(",")[0].strip()
            if first:
                return first
        return "http://localhost:3000"
    # --- Redis ---
    redis_url: str = "redis://localhost:6379/0"
    redis_password: str = ""

    # --- Rate Limiting ---
    # Requests per minute by tier (two tiers: free / pro)
    rate_limit_free: int = 20
    rate_limit_pro: int = 100
    rate_limit_premium: int = 100  # Legacy alias — maps to pro

    # --- JWT ---
    # Supabase Auth handles JWT signing/verification. We just need the
    # JWT secret to verify tokens server-side without calling Supabase.
    supabase_jwt_secret: str

    # --- VAPID (Web Push, Phase 1) ---
    vapid_private_key: str = ""
    vapid_public_key: str = ""
    vapid_email: str = ""

    # --- Stripe (Payments) ---
    stripe_secret_key: str = ""
    stripe_webhook_secret: str = ""
    stripe_pro_price_id: str = ""          # Stripe Price ID for Pro tier ($15/mo)
    stripe_portal_return_url: str = ""     # URL to redirect after Stripe portal
    stripe_success_url: str = ""           # URL after successful checkout
    stripe_cancel_url: str = ""            # URL after cancelled checkout

    # --- Email (Resend) ---
    resend_api_key: str = ""
    email_from: str = "SignalStack <noreply@signalstack.app>"

    # --- Email (SMTP, legacy fallback) ---
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_password: str = ""

    # --- Claude API Cost Controls ---
    claude_daily_cost_cap_usd: float = 0.50   # Per-user daily spend cap
    claude_fallback_model: str = "claude-haiku-4-5-20251001"


@lru_cache
def get_settings() -> Settings:
    """Cached settings instance. Call this instead of constructing Settings() directly."""
    return Settings()
