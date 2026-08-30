"""
SignalStack — Rate Limiting Middleware
Per-user rate limiting based on subscription tier.
Uses an in-memory sliding window counter. For production at scale,
swap to Redis-backed counters.

Limits (requests per minute) come from config:
  free: rate_limit_free (default 20)
  pro:  rate_limit_pro  (default 100)

Keying: the JWT's sub claim, decoded WITHOUT signature verification.
That is deliberate — the identity here only selects a counter bucket
and a limit; authorization is enforced by the route's fully verified
decode. A forged sub can at most borrow a different bucket, and the
stable key means token refreshes don't reset a user's window (the old
token-hash key churned on every refresh).

Tier is looked up once per user and cached for five minutes, so the
middleware costs one profile query per user per TTL, not per request.
"""

import logging
import time
from collections import defaultdict

import jwt
from fastapi import Request
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.responses import JSONResponse

from backend.config import get_settings
from backend.services.supabase import get_service_client

logger = logging.getLogger("middleware.rate_limit")

TIER_CACHE_TTL = 300          # seconds a cached tier stays valid
MAX_TRACKED_KEYS = 10_000     # prune idle counters beyond this
WINDOW_SECONDS = 60


class RateLimitEntry:
    """Sliding window counter for a single user."""

    def __init__(self):
        self.requests: list[float] = []

    def check(self, limit: int, window_seconds: int = WINDOW_SECONDS) -> tuple[bool, int]:
        """Check if the user is within their rate limit.

        Returns:
            (allowed, remaining) — whether the request is allowed and
            how many requests remain in the window.
        """
        now = time.time()
        cutoff = now - window_seconds

        # Prune old entries
        self.requests = [t for t in self.requests if t > cutoff]

        if len(self.requests) >= limit:
            return False, 0

        self.requests.append(now)
        return True, limit - len(self.requests)

    def idle_since(self, cutoff: float) -> bool:
        return not self.requests or self.requests[-1] <= cutoff


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-user, per-tier rate limiting middleware.

    Authenticated requests are keyed by the JWT sub claim and limited by
    the user's actual tier; unauthenticated requests are keyed by IP.
    """

    def __init__(self, app):
        super().__init__(app)
        self.counters: dict[str, RateLimitEntry] = defaultdict(RateLimitEntry)
        self.tier_cache: dict[str, tuple[str, float]] = {}
        settings = get_settings()
        self.tier_limits = {
            "free": settings.rate_limit_free,
            "pro": settings.rate_limit_pro,
            "premium": settings.rate_limit_pro,  # legacy alias — maps to pro
        }
        self.unauthenticated_limit = 30  # Per IP, for auth endpoints

    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting for health check
        if request.url.path in ("/health", "/"):
            return await call_next(request)

        user_key, user_id = self._identify(request)

        if user_id:
            tier = await self._get_tier(user_id)
            limit = self.tier_limits.get(tier, self.tier_limits["free"])
        else:
            limit = self.unauthenticated_limit

        self._prune_if_needed()
        counter = self.counters[user_key]
        allowed, remaining = counter.check(limit)

        if not allowed:
            # A raised HTTPException inside BaseHTTPMiddleware surfaces
            # as a 500 — return the response directly, in the standard
            # APIResponse envelope the frontend parses.
            return JSONResponse(
                status_code=429,
                content={
                    "status": "error",
                    "data": None,
                    "error": {
                        "code": "rate_limited",
                        "message": "Rate limit exceeded. Please try again shortly.",
                    },
                },
                headers={"Retry-After": str(WINDOW_SECONDS)},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response

    def _identify(self, request: Request) -> tuple[str, str | None]:
        """Derive (counter_key, user_id) for the request."""
        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer "):
            token = auth_header[7:]
            try:
                payload = jwt.decode(token, options={"verify_signature": False})
                sub = payload.get("sub")
                if sub:
                    return f"user:{sub}", sub
            except jwt.PyJWTError:
                pass  # malformed token — fall through to IP keying

        client_ip = request.client.host if request.client else "unknown"
        return f"ip:{client_ip}", None

    async def _get_tier(self, user_id: str) -> str:
        """Fetch the user's tier, cached for TIER_CACHE_TTL seconds."""
        now = time.time()
        cached = self.tier_cache.get(user_id)
        if cached and now - cached[1] < TIER_CACHE_TTL:
            return cached[0]

        tier = "free"
        try:
            db = get_service_client()
            result = await db.select(
                table="profiles",
                columns="tier",
                filters={"id": f"eq.{user_id}"},
                single=True,
            )
            if result["status_code"] == 200 and isinstance(result["data"], dict):
                tier = result["data"].get("tier", "free")
        except Exception as e:
            logger.warning(f"Tier lookup failed for rate limiting ({user_id}): {e}")

        self.tier_cache[user_id] = (tier, now)
        return tier

    def _prune_if_needed(self) -> None:
        """Bound memory: drop counters idle for a full window and stale
        tier cache entries once the maps grow large."""
        if len(self.counters) > MAX_TRACKED_KEYS:
            cutoff = time.time() - WINDOW_SECONDS
            idle = [k for k, entry in self.counters.items() if entry.idle_since(cutoff)]
            for k in idle:
                del self.counters[k]
            logger.info(f"Rate limiter pruned {len(idle)} idle counters")

        if len(self.tier_cache) > MAX_TRACKED_KEYS:
            cutoff = time.time() - TIER_CACHE_TTL
            stale = [k for k, (_, fetched) in self.tier_cache.items() if fetched <= cutoff]
            for k in stale:
                del self.tier_cache[k]
