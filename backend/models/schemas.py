"""
SignalStack — Pydantic Models
Request/response schemas for all API endpoints.
These enforce validation at the API boundary — invalid data
never reaches the service layer.
"""

from pydantic import BaseModel, EmailStr, Field
from typing import Optional, Literal
from datetime import datetime


# ============================================================================
# STANDARD RESPONSE ENVELOPE
# Every endpoint returns this shape. No exceptions.
# ============================================================================

class APIResponse(BaseModel):
    """Standard response envelope. All endpoints return this."""
    status: Literal["ok", "error"]
    data: Optional[dict | list] = None
    error: Optional[dict] = None

    @classmethod
    def success(cls, data: dict | list | None = None) -> "APIResponse":
        return cls(status="ok", data=data)

    @classmethod
    def fail(cls, message: str, code: str = "unknown", details: Optional[dict] = None) -> "APIResponse":
        error = {"code": code, "message": message}
        if details:
            error["details"] = details
        return cls(status="error", error=error)


# ============================================================================
# AUTH
# ============================================================================

class SignUpRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    display_name: Optional[str] = Field(None, max_length=100)

class SignInRequest(BaseModel):
    email: EmailStr
    password: str

class RefreshRequest(BaseModel):
    refresh_token: str

class AuthResponse(BaseModel):
    access_token: str
    refresh_token: str
    expires_in: int
    user_id: str


# ============================================================================
# PROFILES
# ============================================================================

class ProfileUpdate(BaseModel):
    """Fields a user can update on their own profile."""
    display_name: Optional[str] = Field(None, max_length=100)
    timezone: Optional[str] = Field(None, max_length=50)
    push_enabled: Optional[bool] = None
    email_enabled: Optional[bool] = None

class ProfileResponse(BaseModel):
    id: str
    email: str
    display_name: Optional[str]
    tier: str
    timezone: str
    push_enabled: bool
    email_enabled: bool
    onboarded_at: Optional[datetime]
    created_at: datetime


# ============================================================================
# INVESTOR PROFILES
# ============================================================================

VALID_SECTORS = [
    "ai_semiconductors", "crypto_blockchain", "clean_energy", "biotech",
    "real_estate", "defense", "dividends_income", "small_cap_growth",
]

class InvestorProfileUpdate(BaseModel):
    risk_appetite: Optional[Literal["conservative", "moderate", "growth", "aggressive"]] = None
    sector_interests: Optional[list[str]] = None
    discovery_mode: Optional[Literal["adjacent", "contrarian", "momentum", "under_the_radar"]] = None

    def model_post_init(self, __context):
        if self.sector_interests is not None:
            invalid = [s for s in self.sector_interests if s not in VALID_SECTORS]
            if invalid:
                raise ValueError(f"Invalid sector interests: {invalid}. Valid: {VALID_SECTORS}")

class InvestorProfileResponse(BaseModel):
    risk_appetite: str
    sector_interests: list[str]
    discovery_mode: str
    updated_at: datetime


# ============================================================================
# HOLDINGS & PORTFOLIOS
# ============================================================================

class HoldingResponse(BaseModel):
    ticker: str
    security_name: Optional[str]
    security_type: str
    quantity: float
    current_price: Optional[float]
    market_value: Optional[float]
    pct_of_portfolio: Optional[float]
    total_gain_pct: Optional[float]
    day_gain_pct: Optional[float]
    synced_at: datetime

class PortfolioResponse(BaseModel):
    id: str
    brokerage_name: str
    account_name: Optional[str]
    total_value: Optional[float]
    cash_balance: Optional[float]
    day_change_pct: Optional[float]
    holdings: list[HoldingResponse]
    synced_at: datetime


# ============================================================================
# WATCHLIST
# ============================================================================

class WatchlistAddRequest(BaseModel):
    ticker: str = Field(min_length=1, max_length=10, pattern=r"^[A-Z0-9.\-]+$")

class WatchlistItemResponse(BaseModel):
    ticker: str
    added_at: datetime


# ============================================================================
# ALERTS
# ============================================================================

class AlertResponse(BaseModel):
    id: str
    alert_type: str
    title: str
    related_tickers: Optional[list[str]]
    signals_used: Optional[list[str]]
    body_json: dict
    read_at: Optional[datetime]
    created_at: datetime

class AlertFeedbackRequest(BaseModel):
    feedback: Literal["useful", "not_useful"]


# ============================================================================
# BROKERAGE CONNECTIONS
# ============================================================================

class BrokerageConnectionResponse(BaseModel):
    id: str
    brokerage_name: str
    account_name: Optional[str]
    account_type: Optional[str]
    status: str
    last_sync_at: Optional[datetime]
    created_at: datetime
