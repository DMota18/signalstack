/**
 * API response types — mirrors backend/models/schemas.py and the
 * shapes the route handlers actually return. Timestamps arrive as ISO
 * 8601 strings.
 */

// ── Auth ─────────────────────────────────────────────────────────────────────

export interface AuthTokens {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
}

// ── Profile ──────────────────────────────────────────────────────────────────

export interface Profile {
  id: string;
  email: string;
  display_name: string | null;
  tier: 'free' | 'pro' | 'premium';
  timezone: string;
  push_enabled: boolean;
  email_enabled: boolean;
  onboarded_at: string | null;
  created_at: string;
}

export interface ProfileUpdate {
  display_name?: string;
  timezone?: string;
  push_enabled?: boolean;
  email_enabled?: boolean;
}

export type RiskAppetite = 'conservative' | 'moderate' | 'growth' | 'aggressive';
export type DiscoveryMode = 'adjacent' | 'contrarian' | 'momentum' | 'under_the_radar';

export interface InvestorProfile {
  risk_appetite: RiskAppetite;
  sector_interests: string[];
  discovery_mode: DiscoveryMode;
  updated_at?: string;
}

// ── Portfolio & holdings ─────────────────────────────────────────────────────

export interface Holding {
  id?: string;
  portfolio_id?: string;
  ticker: string;
  security_name: string | null;
  security_type: string;
  quantity: number;
  avg_cost_basis?: number | null;
  current_price: number | null;
  market_value: number | null;
  pct_of_portfolio: number | null;
  total_gain_pct?: number | null;
  total_gain_value?: number | null;
  day_gain_pct?: number | null;
  day_gain_value?: number | null;
  synced_at: string;
}

export interface Portfolio {
  id: string;
  brokerage_name: string;
  account_name: string | null;
  total_value: number | null;
  cash_balance: number | null;
  day_change_pct: number | null;
  holdings: Holding[];
  synced_at: string;
}

export interface BrokerageConnection {
  id: string;
  brokerage_name: string;
  account_name: string | null;
  account_type: string | null;
  status: 'active' | 'disconnected' | 'stale';
  last_sync_at: string | null;
  created_at: string;
}

export interface ManualHoldingInput {
  ticker: string;
  quantity: number;
  security_name?: string;
  security_type?: string;
  avg_cost_basis?: number;
  current_price?: number;
}

// ── Watchlist ────────────────────────────────────────────────────────────────

export interface WatchlistItem {
  ticker: string;
  added_at: string;
}

// ── Intelligence & alerts ────────────────────────────────────────────────────

export type NetSignal =
  | 'strongly_bullish'
  | 'bullish'
  | 'neutral'
  | 'bearish'
  | 'strongly_bearish'
  | 'conflicting'
  | 'insufficient_data';

export interface HoldingIntelligence {
  ticker: string;
  position_pct?: number;
  net_signal: NetSignal;
  signal_breakdown?: Record<string, string | null>;
  narrative: string;
  conflicts?: string[] | null;
  upcoming_catalysts?: string[];
}

export interface Synthesis {
  portfolio_summary?: {
    total_holdings?: number;
    analysis_timestamp?: string;
    signals_available?: string[];
    signals_unavailable?: { dimension: string; reason: string }[];
  };
  per_holding_intelligence?: HoldingIntelligence[];
  portfolio_level_insights?: string[];
  disclaimer?: string;
}

export interface Alert {
  id: string;
  alert_type: string;
  title: string;
  related_tickers: string[] | null;
  signals_used: string[] | null;
  body_json: Synthesis;
  read_at: string | null;
  created_at: string;
}

export interface IntelligenceResult {
  alert_id?: string;
  title: string;
  synthesis: Synthesis;
  cached?: boolean;
  cache_message?: string;
  model_used?: string;
  performance?: {
    duration_ms?: number;
    tokens_used?: number;
    agent_results?: Record<string, { status: string; duration_ms?: number; error?: string }>;
  };
}

// ── Price alerts ─────────────────────────────────────────────────────────────

export interface PriceAlert {
  id: string;
  ticker: string;
  threshold_pct: number;
  direction: 'above' | 'below';
  enabled: boolean;
  triggered_at: string | null;
  created_at: string;
}

// ── Earnings ─────────────────────────────────────────────────────────────────

export interface EarningsEntry {
  ticker: string;
  report_date: string;
  report_time: string | null;
  days_until?: number;
  consensus_eps?: number | null;
  consensus_revenue?: number | null;
  actual_eps?: number | null;
  actual_revenue?: number | null;
}

// ── News & market data ───────────────────────────────────────────────────────

export interface NewsArticle {
  headline?: string;
  title?: string;
  summary?: string;
  source?: string;
  url?: string;
  datetime?: number | string;
  image?: string;
  related?: string;
  tickers?: string[];
  [key: string]: unknown;
}

/** Loosely-shaped analytics payloads (economy, congress, technicals,
 * options flow, StockTwits, fear & greed, research, deep dives) — the
 * backend composes these from several providers and the shape varies
 * by data availability. Typed as a JSON object rather than `any` so
 * property access still requires a narrowing step. */
export type AnalyticsPayload = Record<string, unknown>;

// ── Explore ──────────────────────────────────────────────────────────────────

export interface ExploreCategory {
  key: string;
  label: string;
  description: string;
  icon: string;
  tier: string;
  locked: boolean;
}

export interface ExploreIdea {
  ticker: string;
  name: string;
  reason: string;
  type: string;
  risk_level: string;
  sector?: string;
  catalyst?: string;
  data_points?: {
    pe_ratio?: number | string | null;
    market_cap?: string | null;
    revenue_growth?: string | null;
    dividend_yield?: string | null;
    correlation_to_portfolio?: number | null;
  };
}

export interface ExploreIdeasResponse {
  ideas?: ExploreIdea[];
  category_insight?: string;
  generated_at?: string | null;
  [key: string]: unknown;
}

export interface ExploreDeepDive {
  ticker: string;
  bull_case: string;
  bear_case: string;
  key_catalysts: string[];
  key_risks: string[];
  valuation_context: string;
  portfolio_fit: string;
  conviction_level: string;
  time_horizon: string;
}

// ── Research ─────────────────────────────────────────────────────────────────

export interface ResearchPayload {
  quote?: {
    price?: number;
    previous_close?: number;
    day_change_pct?: number;
    [key: string]: unknown;
  };
  fundamentals?: {
    market_cap?: number | null;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

// ── Charts ───────────────────────────────────────────────────────────────────

/** A point from the chart endpoints — area series carry value, OHLCV
 * series carry open/high/low/close/volume. */
export interface ChartPoint {
  timestamp?: number;
  time?: number | string;
  label?: string;
  value?: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  [key: string]: unknown;
}

// ── Polymarket ───────────────────────────────────────────────────────────────

export interface PolymarketMarket {
  question: string;
  yes_price: number | null;
  no_price: number | null;
  implied_probability_pct: number | null;
  volume_24h: number;
  liquidity: number;
  end_date: string;
  category?: string;
  polymarket_url?: string;
  event_title?: string;
  [key: string]: unknown;
}

export interface PolymarketMatches {
  tickers_searched: number;
  total_markets_found: number;
  per_ticker: Record<string, { markets_found: number; markets: PolymarketMarket[] }>;
  macro_markets: PolymarketMarket[];
  macro_markets_count: number;
}

// ── Billing & referrals ──────────────────────────────────────────────────────

export interface BillingStatus {
  tier: string;
  has_billing: boolean;
  subscription_status: string | null;
  current_period_end: string | null;
  can_manage: boolean;
}

export interface ReferralStats {
  code?: string;
  link?: string;
  referral_count?: number;
  credits?: number;
  [key: string]: unknown;
}
