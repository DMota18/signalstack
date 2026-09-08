// ─── Types ───────────────────────────────────────────────────────────────────

export type Timeframe = '1D' | '1W' | '1M' | '3M' | 'YTD' | '1Y' | 'ALL' | 'CUSTOM';
export type ChartMode = 'area' | 'candle' | 'line' | 'heikin_ashi';
export type ViewMode = 'all' | 'equities' | 'crypto' | 'etfs';

export interface Indicator {
  key: string;
  label: string;
  color: string;
  active: boolean;
}

export interface SavedView {
  name: string;
  timeframe: Timeframe;
  viewMode: ViewMode;
}

export interface CrosshairInfo {
  time: string;
  value: number;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
  sma20?: number;
  ema50?: number;
  bbUpper?: number;
  bbLower?: number;
  rsi?: number;
  periodReturn?: number;   // % from start to hovered point
  dailyChange?: number;    // % from previous point
}

/** Derived per-render stats for the top legend badges. */
export interface HoldingStats {
  best: any;
  worst: any;
  totalDayChange: number;
  high: number;
  low: number;
}

/** Computed portfolio metrics from chart data. */
export interface PortfolioMetrics {
  volatility: number;
  maxDrawdown: number;
  annualizedReturn: number;
  sharpe: number;
}

/** Theme colors derived once in PortfolioChart (from useTheme) and passed
 * down so every extracted piece renders with identical values. */
export interface ChartTheme {
  isDark: boolean;
  gold: string;
  textPrimary: string;
  textMuted: string;
  textSecondary: string;
  border: string;
  inputBg: string;
  inputBorder: string;
  greenColor: string;
  redColor: string;
}
