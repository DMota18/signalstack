import { useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { TrendingUp, BarChart3, Clock, ChevronRight, AlertCircle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { formatCurrency, formatCompactCurrency } from '../lib/format';

interface PolymarketMarket {
  question: string;
  yes_price: number | null;
  no_price: number | null;
  implied_probability_pct: number | null;
  volume_24h: number;
  liquidity: number;
  end_date: string;
  category?: string;
  confidence?: string;
  polymarket_url?: string;
}

interface TickerMatch {
  markets_found: number;
  markets: PolymarketMarket[];
}

interface PolymarketData {
  tickers_searched: number;
  total_markets_found: number;
  per_ticker: Record<string, TickerMatch>;
  macro_markets: PolymarketMarket[];
  macro_markets_count: number;
}

function confidenceBadge(market: PolymarketMarket, gold: string, textMuted: string, isDark: boolean) {
  const vol = market.volume_24h || 0;
  const liq = market.liquidity || 0;
  let level = 'Low';
  let color = textMuted;
  if (vol > 100000 && liq > 50000) {
    level = 'High';
    color = isDark ? '#34C759' : '#28A745';
  } else if (vol > 10000 && liq > 5000) {
    level = 'Med';
    color = gold;
  }
  return (
    <span className="text-[9px] font-body px-1.5 py-0.5 rounded"
      style={{ background: `${color}12`, color }}>
      {level}
    </span>
  );
}

import ProbabilityGauge from './ProbabilityGauge';

function ProbabilityBar({ pct, gold: _gold, isDark: _isDark }: { pct: number; gold: string; isDark: boolean }) {
  return <ProbabilityGauge pct={pct} size={52} strokeWidth={4} />;
}

function formatEndDate(dateStr: string): string {
  if (!dateStr) return '';
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diff = d.getTime() - now.getTime();
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));
    if (days < 0) return 'Ended';
    if (days === 0) return 'Today';
    if (days === 1) return '1d left';
    if (days < 30) return `${days}d left`;
    if (days < 365) return `${Math.floor(days / 30)}mo left`;
    return d.toLocaleDateString(undefined, { month: 'short', year: '2-digit' });
  } catch { return ''; }
}

function MarketRow({
  market,
  ticker,
  gold,
  textMuted,
  isDark,
}: {
  market: PolymarketMarket;
  ticker?: string;
  gold: string;
  textMuted: string;
  isDark: boolean;
}) {
  const pct = market.implied_probability_pct ?? (market.yes_price ? market.yes_price * 100 : 0);
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';
  const endLabel = formatEndDate(market.end_date);

  return (
    <a href={market.polymarket_url || '#'} target="_blank" rel="noopener noreferrer"
      className="block py-2.5 px-3 rounded-lg transition-opacity hover:opacity-80 no-underline"
      style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}
      onClick={(e) => { if (!market.polymarket_url) e.preventDefault(); }}>
      <div className="flex items-center gap-3 mb-1.5">
        {ticker && (
          <span className="text-[10px] font-body font-medium px-1.5 py-0.5 rounded shrink-0"
            style={{ background: `${gold}12`, color: gold }}>
            {ticker}
          </span>
        )}
        <p className="text-xs font-body flex-1 leading-snug line-clamp-2"
          style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>
          {market.question}
        </p>
        <ProbabilityBar pct={pct} gold={gold} isDark={isDark} />
      </div>
      {/* Details row: yes/no prices, volume, time, confidence */}
      <div className="flex items-center gap-3 pl-0.5 flex-wrap">
        {market.yes_price != null && (
          <span className="text-[9px] font-numeric" style={{ color: greenColor }}>
            Yes {formatCurrency(market.yes_price)}
          </span>
        )}
        {market.no_price != null && (
          <span className="text-[9px] font-numeric" style={{ color: redColor }}>
            No {formatCurrency(market.no_price)}
          </span>
        )}
        {market.volume_24h > 0 && (
          <span className="text-[9px] font-body" style={{ color: textMuted }}>
            Vol {formatCompactCurrency(market.volume_24h)}
          </span>
        )}
        {market.liquidity > 0 && (
          <span className="text-[9px] font-body" style={{ color: textMuted }}>
            Liq {formatCompactCurrency(market.liquidity)}
          </span>
        )}
        {endLabel && (
          <span className="text-[9px] font-body" style={{ color: textMuted }}>
            {endLabel}
          </span>
        )}
        {confidenceBadge(market, gold, textMuted, isDark)}
      </div>
    </a>
  );
}

export default function PolymarketCard({ holdingTickers }: { holdingTickers: string[] }) {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [data, setData] = useState<PolymarketData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#111113' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';

  useEffect(() => {
    if (holdingTickers.length === 0) {
      setLoading(false);
      return;
    }

    api.getPolymarketMatches(true).then((res) => {
      console.log('[PolymarketCard] API response:', JSON.stringify(res).slice(0, 500));
      if (res.status === 'ok' && res.data) {
        setData(res.data);
      } else {
        setError(res.error?.message || 'Failed to load prediction markets');
        console.warn('[PolymarketCard] Error response:', res);
      }
      setLoading(false);
    }).catch((err) => {
      console.error('[PolymarketCard] Fetch error:', err);
      setError('Network error loading prediction markets');
      setLoading(false);
    });
  }, [holdingTickers.length]);

  // Don't render if no holdings
  if (holdingTickers.length === 0) return null;

  // Skeleton loading
  if (loading) {
    return (
      <div className="rounded-xl overflow-hidden" style={{ background: surface, border: `0.5px solid ${border}` }}>
        <div style={{ height: 3, background: `${gold}40` }} />
        <div className="p-5 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg animate-pulse" style={{ background: `${gold}15` }} />
            <div className="h-3 w-32 rounded animate-pulse" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }} />
          </div>
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-10 rounded-lg animate-pulse"
              style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }} />
          ))}
        </div>
      </div>
    );
  }

  // Error state — show it, don't hide it
  if (error) {
    return (
      <div className="rounded-xl overflow-hidden" style={{ background: surface, border: `0.5px solid ${border}` }}>
        <div style={{ height: 3, background: `${gold}40` }} />
        <div className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={14} style={{ color: textMuted }} />
            <p className="text-xs font-body" style={{ color: textMuted }}>Prediction markets</p>
          </div>
          <p className="text-xs font-body" style={{ color: textMuted }}>{error}</p>
        </div>
      </div>
    );
  }

  // Flatten all ticker markets + macro into a single display list
  // Filter out extreme probabilities (< 5% or > 95%) — not useful signal
  const isUseful = (m: PolymarketMarket) => {
    const pct = m.implied_probability_pct ?? (m.yes_price ? m.yes_price * 100 : 50);
    return pct >= 5 && pct <= 95;
  };

  const tickerMarkets: { ticker: string; market: PolymarketMarket }[] = [];
  if (data?.per_ticker) {
    for (const [ticker, match] of Object.entries(data.per_ticker)) {
      for (const market of (match.markets || []).filter(isUseful).slice(0, 2)) {
        tickerMarkets.push({ ticker, market });
      }
    }
  }

  const macroMarkets = (data?.macro_markets || []).filter(isUseful).slice(0, 3);
  const totalShown = tickerMarkets.length + macroMarkets.length;

  // Empty state — visible, not hidden
  if (totalShown === 0) {
    return (
      <div className="rounded-xl overflow-hidden" style={{ background: surface, border: `0.5px solid ${border}` }}>
        <div style={{ height: 3, background: `${gold}40` }} />
        <div className="p-5">
          <div className="flex items-center gap-2 mb-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: `${gold}15` }}>
              <TrendingUp size={14} style={{ color: gold }} />
            </div>
            <p className="text-xs font-body font-medium">Prediction markets</p>
          </div>
          <p className="text-xs font-body" style={{ color: textMuted }}>
            No active prediction markets match your {data?.tickers_searched || 0} holdings right now.
            Check the{' '}
            <button onClick={() => navigate('/app/markets', { state: { tab: 'polymarket' } })}
              className="underline" style={{ color: gold }}>
              Polymarket tab
            </button>
            {' '}to search for specific topics.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: surface, border: `0.5px solid ${border}` }}>
      {/* Gold accent bar */}
      <div style={{ height: 3, background: gold }} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center"
              style={{ background: `${gold}15` }}>
              <TrendingUp size={14} style={{ color: gold }} />
            </div>
            <div>
              <p className="text-xs font-body font-medium">Prediction markets</p>
              <p className="text-[10px] font-body flex items-center gap-1" style={{ color: textMuted }}>
                <BarChart3 size={9} />
                {data?.total_markets_found || 0} markets across {data?.tickers_searched || 0} holdings
              </p>
            </div>
          </div>
          <button
            onClick={() => navigate('/app/markets', { state: { tab: 'polymarket' } })}
            className="flex items-center gap-1 text-[10px] font-body transition-opacity hover:opacity-70"
            style={{ color: gold }}
          >
            View all <ChevronRight size={12} aria-hidden="true" />
          </button>
        </div>

        {/* Ticker-matched markets */}
        <div className="space-y-1.5">
          {tickerMarkets.slice(0, 5).map(({ ticker, market }, i) => (
            <MarketRow key={`${ticker}-${i}`} market={market} ticker={ticker}
              gold={gold} textMuted={textMuted} isDark={isDark} />
          ))}

          {/* Macro section */}
          {macroMarkets.length > 0 && (
            <>
              <div className="flex items-center gap-2 pt-2 pb-0.5">
                <span className="text-[9px] tracking-[1px] font-body" style={{ color: textMuted }}>
                  MACRO
                </span>
                <div className="flex-1 h-px" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }} />
              </div>
              {macroMarkets.map((market, i) => (
                <MarketRow key={`macro-${i}`} market={market}
                  gold={gold} textMuted={textMuted} isDark={isDark} />
              ))}
            </>
          )}
        </div>

        {/* Timestamp */}
        <p className="text-[9px] font-body mt-3 flex items-center gap-1" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
          <Clock size={8} /> As of {new Date().toLocaleTimeString()} — Polymarket Gamma API
        </p>
      </div>
    </div>
  );
}

export { ProbabilityBar, confidenceBadge };
export type { PolymarketMarket, PolymarketData, TickerMatch };
