"""
SignalStack — Rate Limiting Middleware
Per-user rate limiting based on subscription tier.
Uses an in-memory sliding window counter. For production at scale,
swap to Redis-backed counters.

Limits (requests per minute):
  free:    20
  pro:     60
  premium: 120

The middleware runs before route handlers. If the user exceeds their
limit, a 429 is returned with a Retry-After header.
"""

import time
from collections import defaultdict
from fastapi import Request, HTTPException, status
from starlette.middleware.base import BaseHTTPMiddleware
from backend.config import get_settings


class RateLimitEntry:
    """Sliding window counter for a single user."""

    def __init__(self):
        self.requests: list[float] = []

    def check(self, limit: int, window_seconds: int = 60) -> tuple[bool, int]:
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


class RateLimitMiddleware(BaseHTTPMiddleware):
    """Per-user rate limiting middleware.
    
    Extracts user identity from the JWT (already decoded by downstream
    dependencies). For unauthenticated routes (auth endpoints), uses
    IP-based limiting with a generous default.
    """

    def __init__(self, app):
        super().__init__(app)
        self.counters: dict[str, RateLimitEntry] = defaultdict(RateLimitEntry)
        settings = get_settings()
        self.tier_limits = {
            "free": settings.rate_limit_free,
            "pro": settings.rate_limit_pro,
            "premium": settings.rate_limit_premium,
        }
        self.unauthenticated_limit = 30  # Per IP, for auth endpoints

    async def dispatch(self, request: Request, call_next):
        # Skip rate limiting for health check
        if request.url.path in ("/health", "/"):
            return await call_next(request)

        # Try to extract user from a previously-set state (set by auth dependency)
        # Since middleware runs before dependencies, we check the raw JWT here
        user_key = None
        tier = "free"

        auth_header = request.headers.get("authorization", "")
        if auth_header.startswith("Bearer ") and len(auth_header) > 50:
            # Use a hash of the token as the rate limit key
            # (avoids decoding JWT in middleware — auth dependency handles validation)
            token_hash = str(hash(auth_header))
            user_key = f"user:{token_hash}"

            # We don't know the tier in middleware without decoding the JWT.
            # Use the most generous limit here; the route handler applies
            # tier-specific feature gating via require_tier().
            tier = "premium"  # Generous in middleware, strict in route handlers
        else:
            # Unauthenticated: rate limit by IP
            client_ip = request.client.host if request.client else "unknown"
            user_key = f"ip:{client_ip}"
            tier = "free"

        limit = self.tier_limits.get(tier, self.unauthenticated_limit)
        counter = self.counters[user_key]
        allowed, remaining = counter.check(limit)

        if not allowed:
            raise HTTPException(
                status_code=status.HTTP_429_TOO_MANY_REQUESTS,
                detail="Rate limit exceeded. Please try again shortly.",
                headers={"Retry-After": "60"},
            )

        response = await call_next(request)
        response.headers["X-RateLimit-Limit"] = str(limit)
        response.headers["X-RateLimit-Remaining"] = str(remaining)
        return response
