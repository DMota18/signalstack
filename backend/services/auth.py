"""
SignalStack — Authentication Service
Verifies Supabase JWTs server-side and provides the current user
context as a FastAPI dependency.

Supabase projects may use either HS256 (symmetric, verified with JWT secret)
or ES256 (asymmetric, verified with JWKS public keys). This implementation
supports both by trying JWKS first, then falling back to HS256.
"""

import logging
import time

import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from jwt import PyJWKClient
from pydantic import BaseModel

from backend.config import get_settings
from backend.services.supabase import get_service_client

logger = logging.getLogger("services.auth")

security = HTTPBearer()

_jwks_client: PyJWKClient | None = None
_jwks_last_refresh: float = 0
JWKS_CACHE_TTL = 3600


class CurrentUser(BaseModel):
    id: str
    email: str
    tier: str
    jwt_token: str


def _get_jwks_client() -> PyJWKClient:
    global _jwks_client, _jwks_last_refresh
    settings = get_settings()
    now = time.time()
    if _jwks_client is None or (now - _jwks_last_refresh) > JWKS_CACHE_TTL:
        jwks_url = f"{settings.supabase_url}/auth/v1/.well-known/jwks.json"
        _jwks_client = PyJWKClient(jwks_url)
        _jwks_last_refresh = now
    return _jwks_client


def _decode_token(token: str) -> dict:
    settings = get_settings()
    header = jwt.get_unverified_header(token)
    alg = header.get("alg", "")

    if alg.startswith("ES") or alg.startswith("RS") or alg.startswith("PS"):
        jwks_client = _get_jwks_client()
        signing_key = jwks_client.get_signing_key_from_jwt(token)
        return jwt.decode(
            token,
            signing_key.key,
            algorithms=[alg],
            audience="authenticated",
        )
    else:
        return jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256", "HS384", "HS512"],
            audience="authenticated",
        )


async def get_current_user(
    credentials: HTTPAuthorizationCredentials = Depends(security),
) -> CurrentUser:
    token = credentials.credentials
    try:
        payload = _decode_token(token)
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token expired. Use /auth/refresh to get a new token.",
        ) from None
    except jwt.InvalidTokenError as e:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Invalid token: {e}",
        ) from e
    except Exception as e:
        logger.error(f"Token verification failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=f"Token verification failed: {e}",
        ) from e

    user_id = payload.get("sub")
    email = payload.get("email", "")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Token missing 'sub' claim.",
        )

    db = get_service_client()
    result = await db.select(
        table="profiles",
        columns="tier",
        filters={"id": f"eq.{user_id}"},
        single=True,
    )
    tier = "free"
    if result["status_code"] == 200 and isinstance(result["data"], dict):
        tier = result["data"].get("tier", "free")
        # Legacy: treat premium as pro (two-tier system)
        if tier == "premium":
            tier = "pro"

    return CurrentUser(id=user_id, email=email, tier=tier, jwt_token=token)


def require_tier(*allowed_tiers: str):
    async def check_tier(user: CurrentUser = Depends(get_current_user)):
        if user.tier not in allowed_tiers:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail={
                    "code": "tier_required",
                    "message": f"This feature requires {' or '.join(allowed_tiers)} tier.",
                    "current_tier": user.tier,
                    "upgrade_url": "/settings/billing",
                },
            )
        return user
    return check_tier
