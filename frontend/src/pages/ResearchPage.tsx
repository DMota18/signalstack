import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import {
  Loader2, TrendingUp, TrendingDown, ExternalLink, Clock,
  ChevronDown, ChevronUp, BarChart3, Users, Newspaper,
  Activity, Target, CalendarDays, Building2, Globe, MessageCircle,
  FileText, Landmark, GitBranch, Share2, Check,
} from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import PriceChart from '../components/PriceChart';
import SocialFeed from '../components/SocialFeed';
import SignalRadar from '../components/SignalRadar';
import FairValueGauge from '../components/FairValueGauge';
import PerformanceComparison from '../components/PerformanceComparison';
import { formatCurrency, formatCompactCurrency, formatPercent, formatNumber, formatCompactNumber } from '../lib/format';

// ─── Formatting helpers (null-safe wrappers around lib/format) ───────────

function fmtPrice(val: number | null | undefined): string {
  if (val == null || val === 0) return '—';
  return formatCurrency(val);
}

function fmtLargeNum(val: number | null | undefined): string {
  if (val == null) return '—';
  return formatCompactCurrency(val);
}

function fmtPct(val: number | null | undefined): string {
  if (val == null) return '—';
  return formatPercent(val * 100);
}

function fmtRatio(val: number | null | undefined): string {
  if (val == null) return '—';
  return `${val.toFixed(2)}x`;
}

function fmtVol(val: number | null | undefined): string {
  if (val == null) return '—';
  return formatCompactNumber(val);
}

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}


// ─── Section wrapper ─────────────────────────────────────────────────────

function Section({ title, icon: Icon, children, isDark, gold, surface, border, defaultOpen = true }: {
  title: string; icon: any; children: React.ReactNode;
  isDark: boolean; gold: string; surface: string; border: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: surface, border: `0.5px solid ${border}` }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-4"
      >
        <div className="flex items-center gap-2.5">
          <Icon size={15} style={{ color: gold }} aria-hidden="true" />
          <span className="text-sm font-body font-medium">{title}</span>
        </div>
        {open ? <ChevronUp size={15} style={{ color: textMuted }} aria-hidden="true" /> : <ChevronDown size={15} style={{ color: textMuted }} aria-hidden="true" />}
      </button>
      {open && (
        <div className="px-5 pb-5" style={{ borderTop: `0.5px solid ${border}` }}>
          <div className="pt-4">{children}</div>
        </div>
      )}
    </div>
  );
}


// ─── Stat row (two-column key/value grid item) ──────────────────────────

function StatRow({ label, value, isDark }: { label: string; value: string; isDark: boolean }) {
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
      <span className="text-xs font-body" style={{ color: textMuted }}>{label}</span>
      <span className="text-xs font-numeric font-medium">{value}</span>
    </div>
  );
}


// ─── Financial Statements Tabs ──────────────────────────────────────────

function FinancialTabs({ financials, isDark, gold, textMuted, border: _border }: {
  financials: any; isDark: boolean; gold: string; textMuted: string; border: string;
}) {
  const [tab, setTab] = useState<'income' | 'balance' | 'cashflow'>('income');

  const tabs = [
    { key: 'income' as const, label: 'Income', data: financials.income_statement || [] },
    { key: 'balance' as const, label: 'Balance sheet', data: financials.balance_sheet || [] },
    { key: 'cashflow' as const, label: 'Cash flow', data: financials.cash_flow || [] },
  ];

  const activeTab = tabs.find((t) => t.key === tab) || tabs[0];
  const statements = activeTab.data;

  // Get all unique row keys across all periods
  const allKeys = new Set<string>();
  statements.forEach((s: any) => {
    Object.keys(s).forEach((k) => { if (k !== 'period') allKeys.add(k); });
  });

  const formatFinVal = (val: number | null | undefined): string => {
    if (val == null) return '—';
    return formatCompactCurrency(val);
  };

  const formatLabel = (key: string): string => {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (statements.length === 0) return <p className="text-xs font-body" style={{ color: textMuted }}>No financial data available</p>;

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
            className="text-[11px] font-body px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: tab === t.key ? `${gold}15` : 'transparent',
              color: tab === t.key ? gold : textMuted,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] font-body" style={{ color: textMuted }}>
              <th className="text-left py-2 font-normal sticky left-0 min-w-[160px]"
                style={{ background: isDark ? '#111113' : '#FFFFFF' }}>Item</th>
              {statements.map((s: any, si: number) => (
                <th key={s.period} className="text-right py-2 font-normal min-w-[90px]">
                  <div>{s.period ? new Date(s.period).getFullYear() : '—'}</div>
                  {si < statements.length - 1 && (
                    <div className="text-[8px]" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>YoY</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(allKeys).slice(0, 20).map((key) => (
              <tr key={key} style={{ borderTop: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
                <td className="py-2 text-[11px] font-body sticky left-0 pr-4"
                  style={{ background: isDark ? '#111113' : '#FFFFFF', color: textMuted }}>
                  {formatLabel(key)}
                </td>
                {statements.map((s: any, si: number) => {
                  const val = s[key];
                  const prevStatement = statements[si + 1];
                  const prevVal = prevStatement ? prevStatement[key] : null;
                  const yoyPct = (val != null && prevVal != null && prevVal !== 0)
                    ? ((val - prevVal) / Math.abs(prevVal)) * 100
                    : null;

                  return (
                    <td key={s.period} className="py-2 text-right">
                      <div className="text-[11px] font-numeric">{formatFinVal(val)}</div>
                      {si < statements.length - 1 && yoyPct !== null && (
                        <div className="text-[9px] font-numeric flex items-center justify-end gap-0.5"
                          style={{ color: yoyPct >= 0 ? (isDark ? '#34C759' : '#28A745') : (isDark ? '#FF453A' : '#DC3545') }}>
                          {yoyPct >= 0 ? '▲' : '▼'} {formatPercent(Math.abs(yoyPct))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}


// ─── Main page ──────────────────────────────────────────────────────────

export default function ResearchPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const navigate = useNavigate();
  const { isDark } = useTheme();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'area' | 'candlestick'>('area');
  const [technicals, setTechnicals] = useState<any>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const textSecondary = isDark ? '#B0AEA6' : '#4A4A4D';
  const surface = isDark ? '#111113' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  // Load research data
  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    api.getResearch(ticker).then((res) => {
      if (res.status === 'ok' && res.data) {
        setData(res.data);
      } else {
        setError(res.error?.message || `Could not find data for ${ticker}`);
      }
      setLoading(false);
    });
    // Fetch technicals in parallel (non-blocking)
    setTechnicals(null);
    api.getTechnicals(ticker).then((res) => {
      if (res.status === 'ok' && res.data) setTechnicals(res.data);
    });
  }, [ticker]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={28} className="animate-spin" style={{ color: gold }} />
        <span className="ml-3 text-sm font-body" style={{ color: textMuted }}>Loading {ticker}...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-32">
        <p className="font-display text-xl mb-2">Ticker not found</p>
        <p className="text-sm font-body mb-6" style={{ color: textMuted }}>{error || `No data available for ${ticker}`}</p>
        <button onClick={() => navigate('/app')} className="btn-gold">Back to dashboard</button>
      </div>
    );
  }

  const quote = data.quote || {};
  const profile = data.profile || {};
  const fund = data.fundamentals || {};
  const analyst = data.analyst || {};
  const earnings = data.earnings_history || [];
  const news = data.news || [];
  const insider = data.insider || {};
  const polymarket = data.polymarket || {};
  const financials = data.financials || {};
  const institutional = data.institutional || {};
  const similar = data.similar || {};

  const price = quote.price || 0;
  const prevClose = quote.previous_close || 0;
  const dayChange = prevClose > 0 ? price - prevClose : 0;
  const dayChangePct = prevClose > 0 ? (dayChange / prevClose) * 100 : (quote.day_change_pct || 0);
  const isUp = dayChange >= 0;

  return (
    <div className="space-y-5 max-w-5xl">
      {/* ── HEADER ── */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <div className="flex items-center gap-2">
            <span className="text-[10px] font-body px-2 py-0.5 rounded" style={{ background: `${gold}12`, color: gold }}>
              {profile.sector || profile.industry || 'Equity'}
            </span>
            {profile.exchange && (
              <span className="text-[10px] font-body" style={{ color: textMuted }}>{profile.exchange}</span>
            )}
          </div>
          <ShareButton ticker={ticker || ''} price={price} dayChangePct={dayChangePct} isDark={isDark} gold={gold} textMuted={textMuted} />
        </div>
        <div className="flex items-baseline gap-3">
          <h1 className="font-display text-3xl">{ticker}</h1>
          <span className="text-sm font-body" style={{ color: textSecondary }}>{profile.name}</span>
        </div>
        <div className="flex items-baseline gap-3 mt-1">
          <span className="font-numeric text-2xl">{fmtPrice(price)}</span>
          <span className="font-numeric text-sm" style={{ color: isUp ? greenColor : redColor }}>
            {isUp ? '+' : ''}{dayChange.toFixed(2)} ({formatPercent(dayChangePct, { signed: true })})
          </span>
          {isUp ? <TrendingUp size={16} style={{ color: greenColor }} /> : <TrendingDown size={16} style={{ color: redColor }} />}
        </div>
      </div>

      {/* ── PRICE CHART (TradingView Lightweight Charts) ── */}
      <div className="rounded-xl p-5" style={{ background: surface, border: `0.5px solid ${border}` }}>
        <PriceChart
          ticker={ticker || ''}
          defaultTimeframe="3M"
          height={350}
          showVolume={true}
          chartType={chartType}
        />
        {/* Chart type toggle */}
        <div className="flex justify-end mt-2 gap-2">
          <button onClick={() => setChartType('area')} aria-pressed={chartType === 'area'}
            className="text-[10px] font-body px-2 py-0.5 rounded transition-colors"
            style={{ background: chartType === 'area' ? `${gold}15` : 'transparent', color: chartType === 'area' ? gold : textMuted }}>
            Area
          </button>
          <button onClick={() => setChartType('candlestick')} aria-pressed={chartType === 'candlestick'}
            className="text-[10px] font-body px-2 py-0.5 rounded transition-colors"
            style={{ background: chartType === 'candlestick' ? `${gold}15` : 'transparent', color: chartType === 'candlestick' ? gold : textMuted }}>
            Candles
          </button>
        </div>
      </div>

      {/* ── KEY STATS (two-column grid like Public) ── */}
      <Section title="Key statistics" icon={BarChart3} isDark={isDark} gold={gold} surface={surface} border={border}>
        <div className="grid grid-cols-2 gap-x-8">
          <div>
            <StatRow label="Market cap" value={fmtLargeNum(fund.market_cap)} isDark={isDark} />
            <StatRow label="Revenue (TTM)" value={fmtLargeNum(fund.revenue_ttm)} isDark={isDark} />
            <StatRow label="EBITDA" value={fmtLargeNum(fund.ebitda)} isDark={isDark} />
            <StatRow label="P/E ratio" value={fund.trailing_pe != null ? `${fund.trailing_pe.toFixed(2)}x` : '—'} isDark={isDark} />
            <StatRow label="Forward P/E" value={fund.forward_pe != null ? `${fund.forward_pe.toFixed(2)}x` : '—'} isDark={isDark} />
            <StatRow label="EPS (TTM)" value={fund.trailing_eps != null ? formatCurrency(fund.trailing_eps) : '—'} isDark={isDark} />
            <StatRow label="Debt / equity" value={fund.debt_to_equity != null ? `${(fund.debt_to_equity / 100).toFixed(2)}x` : '—'} isDark={isDark} />
            <StatRow label="Current ratio" value={fmtRatio(fund.current_ratio)} isDark={isDark} />
            <StatRow label="Profit margin" value={fmtPct(fund.profit_margin)} isDark={isDark} />
            <StatRow label="Return on equity" value={fmtPct(fund.return_on_equity)} isDark={isDark} />
          </div>
          <div>
            <StatRow label="Today's volume" value={fmtVol(quote.volume)} isDark={isDark} />
            <StatRow label="Avg. daily volume" value={fmtVol(quote.avg_volume)} isDark={isDark} />
            <StatRow label="Open" value={fmtPrice(quote.open)} isDark={isDark} />
            <StatRow label="Today's range" value={`${fmtPrice(quote.day_low)} – ${fmtPrice(quote.day_high)}`} isDark={isDark} />
            <StatRow label="52 week range" value={`${fmtPrice(fund.fifty_two_week_low)} – ${fmtPrice(fund.fifty_two_week_high)}`} isDark={isDark} />
            <StatRow label="Beta" value={fund.beta != null ? `${fund.beta.toFixed(2)}` : '—'} isDark={isDark} />
            <StatRow label="Dividend yield" value={fund.dividend_yield != null ? formatPercent(fund.dividend_yield * 100) : '—'} isDark={isDark} />
            <StatRow label="50-day avg" value={fmtPrice(fund.fifty_day_avg)} isDark={isDark} />
            <StatRow label="200-day avg" value={fmtPrice(fund.two_hundred_day_avg)} isDark={isDark} />
            <StatRow label="Revenue growth" value={fmtPct(fund.revenue_growth)} isDark={isDark} />
          </div>
        </div>
      </Section>

      {/* ── TECHNICAL INDICATORS (Alpha Vantage) ── */}
      {technicals && (technicals.rsi?.value != null || technicals.macd?.value != null) && (
        <Section title="Technical indicators" icon={Activity} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            {/* RSI */}
            {technicals.rsi?.value != null && (
              <div className="rounded-lg p-4" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-body uppercase tracking-wider" style={{ color: textMuted }}>RSI (14)</span>
                  <span className="text-[10px] font-body px-2 py-0.5 rounded-full" style={{
                    background: technicals.rsi.signal === 'overbought' ? `${redColor}12` : technicals.rsi.signal === 'oversold' ? `${greenColor}12` : `${gold}12`,
                    color: technicals.rsi.signal === 'overbought' ? redColor : technicals.rsi.signal === 'oversold' ? greenColor : gold,
                  }}>
                    {technicals.rsi.signal}
                  </span>
                </div>
                <p className="text-2xl font-numeric font-medium">{technicals.rsi.value.toFixed(1)}</p>
                <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }}>
                  <div className="h-full rounded-full transition-all" style={{
                    width: `${Math.min(100, technicals.rsi.value)}%`,
                    background: technicals.rsi.value > 70 ? redColor : technicals.rsi.value < 30 ? greenColor : gold,
                  }} />
                </div>
                <div className="flex justify-between mt-1">
                  <span className="text-[8px] font-numeric" style={{ color: greenColor }}>30</span>
                  <span className="text-[8px] font-numeric" style={{ color: redColor }}>70</span>
                </div>
              </div>
            )}

            {/* MACD */}
            {technicals.macd?.value != null && (
              <div className="rounded-lg p-4" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                <div className="flex items-center justify-between mb-2">
                  <span className="text-[10px] font-body uppercase tracking-wider" style={{ color: textMuted }}>MACD</span>
                  {technicals.macd.signal && (
                    <span className="text-[10px] font-body px-2 py-0.5 rounded-full" style={{
                      background: technicals.macd.signal === 'bullish' ? `${greenColor}12` : `${redColor}12`,
                      color: technicals.macd.signal === 'bullish' ? greenColor : redColor,
                    }}>
                      {technicals.macd.signal}
                    </span>
                  )}
                </div>
                <p className="text-xl font-numeric font-medium">{technicals.macd.value.toFixed(3)}</p>
                <div className="mt-1.5 space-y-0.5">
                  <div className="flex justify-between text-[9px] font-body" style={{ color: textMuted }}>
                    <span>Signal</span>
                    <span className="font-numeric">{technicals.macd.signal_line?.toFixed(3) ?? '—'}</span>
                  </div>
                  <div className="flex justify-between text-[9px] font-body" style={{ color: textMuted }}>
                    <span>Histogram</span>
                    <span className="font-numeric" style={{
                      color: (technicals.macd.histogram || 0) >= 0 ? greenColor : redColor,
                    }}>{technicals.macd.histogram?.toFixed(3) ?? '—'}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Bollinger Bands */}
            {technicals.bollinger_bands?.upper != null && (
              <div className="rounded-lg p-4" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                <span className="text-[10px] font-body uppercase tracking-wider" style={{ color: textMuted }}>Bollinger Bands (20)</span>
                <div className="mt-3 space-y-1.5">
                  <div className="flex justify-between text-xs font-body">
                    <span style={{ color: textMuted }}>Upper</span>
                    <span className="font-numeric">{formatCurrency(technicals.bollinger_bands.upper)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-body">
                    <span style={{ color: gold }}>Middle</span>
                    <span className="font-numeric font-medium" style={{ color: gold }}>{formatCurrency(technicals.bollinger_bands.middle)}</span>
                  </div>
                  <div className="flex justify-between text-xs font-body">
                    <span style={{ color: textMuted }}>Lower</span>
                    <span className="font-numeric">{formatCurrency(technicals.bollinger_bands.lower)}</span>
                  </div>
                </div>
                {price > 0 && (
                  <p className="text-[9px] font-body mt-2" style={{
                    color: price > technicals.bollinger_bands.upper ? redColor : price < technicals.bollinger_bands.lower ? greenColor : textMuted,
                  }}>
                    Price is {price > technicals.bollinger_bands.upper ? 'above upper band' : price < technicals.bollinger_bands.lower ? 'below lower band' : 'within bands'}
                  </p>
                )}
              </div>
            )}
          </div>
          <p className="text-[9px] font-body mt-3" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
            Technical data from Alpha Vantage. Indicators are lagging and should not be used as sole decision criteria.
          </p>
        </Section>
      )}

      {/* ── FAIR VALUE ESTIMATE ── */}
      {price > 0 && (financials.income_statement?.length > 0 || fund.trailing_pe != null) && (
        <Section title="Fair value estimate" icon={Target} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          <FairValueGauge
            ticker={ticker || ''}
            currentPrice={price}
            financials={financials}
            fundamentals={fund}
          />
        </Section>
      )}

      {/* ── PERFORMANCE COMPARISON ── */}
      {similar.tickers?.length > 0 && (
        <Section title="Performance comparison" icon={BarChart3} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          <PerformanceComparison
            baseTicker={ticker || ''}
            similarTickers={similar.tickers?.slice(0, 6) || []}
          />
        </Section>
      )}

      {/* ── SIGNAL RADAR ── */}
      <Section title="Signal strength" icon={Activity} isDark={isDark} gold={gold} surface={surface} border={border}>
        <SignalRadar data={{
          quote,
          fundamentals: fund,
          insider,
          institutional,
          news,
          analyst,
          earnings_history: earnings,
          financials,
        }} />
      </Section>

      {/* ── POLYMARKET — HERO SECTION (always open, visually distinct) ── */}
      {polymarket.markets?.length > 0 && (() => {
        const tickerMarkets = polymarket.markets.filter((m: any) => !m.is_macro);
        const macroMarkets = polymarket.markets.filter((m: any) => m.is_macro);
        const pmGreen = isDark ? '#34C759' : '#28A745';
        const pmRed = isDark ? '#FF453A' : '#DC3545';

        const renderMarketCard = (item: any, i: number) => {
          const title = item.question || item.event_title || '';
          const vol = item.total_volume || item.volume_24h || 0;
          const volStr = formatCompactCurrency(vol);
          const endDate = item.end_date ? new Date(item.end_date) : null;
          const daysLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86400000)) : null;
          const pct = item.yes_price != null ? Math.round(item.yes_price * 100) : null;

          return (
            <a key={`${item.question}-${i}`} href={item.polymarket_url || '#'} target="_blank" rel="noopener noreferrer"
              className="block rounded-xl p-4 no-underline transition-all hover:scale-[1.01]"
              style={{ background: isDark ? '#151517' : '#FFFFFF', border: `0.5px solid ${isDark ? '#1A1A1D' : '#E8E6E1'}` }}>
              {item.is_macro && (
                <span className="text-[9px] font-body px-1.5 py-0.5 rounded mb-2 inline-block"
                  style={{ background: isDark ? '#D4A84312' : '#D4A84310', color: gold }}>Macro</span>
              )}
              <p className="text-xs font-body font-semibold leading-snug mb-3">{title}</p>
              {pct != null && (
                <>
                  <div className="flex items-center justify-between mb-1.5">
                    <span className="text-lg font-numeric font-semibold tabular-nums" style={{ color: '#818CF8' }}>
                      {pct}%
                    </span>
                    <div className="flex gap-1.5">
                      <span className="text-[10px] font-body font-semibold px-2.5 py-0.5 rounded"
                        style={{ background: `${pmGreen}15`, color: pmGreen }}>Yes</span>
                      <span className="text-[10px] font-body font-semibold px-2.5 py-0.5 rounded"
                        style={{ background: `${pmRed}15`, color: pmRed }}>No</span>
                    </div>
                  </div>
                  <div className="w-full h-2 rounded-full overflow-hidden mb-3" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }}>
                    <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct >= 50 ? pmGreen : pmRed }} />
                  </div>
                </>
              )}
              <div className="flex items-center gap-3 text-[10px] font-body" style={{ color: textMuted }}>
                {vol > 0 && <span className="font-numeric tabular-nums">{volStr} volume</span>}
                {daysLeft != null && <span>{daysLeft}d remaining</span>}
              </div>
            </a>
          );
        };

        return (
          <div className="rounded-xl overflow-hidden" style={{
            background: isDark ? '#0F1115' : '#F8F7FF',
            border: `1px solid ${isDark ? '#1E2030' : '#D8D4F0'}`,
          }}>
            <div className="px-5 py-4 flex items-center justify-between" style={{
              borderBottom: `0.5px solid ${isDark ? '#1E2030' : '#D8D4F0'}`,
            }}>
              <div className="flex items-center gap-2.5">
                <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: isDark ? '#6366F115' : '#6366F110' }}>
                  <Activity size={14} style={{ color: '#818CF8' }} />
                </div>
                <div>
                  <span className="text-sm font-body font-medium">What the market is betting</span>
                  <span className="text-[10px] font-body ml-2" style={{ color: textMuted }}>Polymarket</span>
                </div>
              </div>
              <span className="text-[10px] font-body px-2 py-0.5 rounded-full" style={{
                background: isDark ? '#818CF815' : '#818CF810',
                color: '#818CF8',
              }}>
                {polymarket.markets.length} market{polymarket.markets.length !== 1 ? 's' : ''}
              </span>
            </div>
            <div className="p-5 space-y-4">
              {/* Ticker-specific markets */}
              {tickerMarkets.length > 0 && (
                <div>
                  <p className="text-[11px] font-body font-medium mb-2" style={{ color: '#818CF8' }}>
                    {ticker} markets
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {tickerMarkets.map(renderMarketCard)}
                  </div>
                </div>
              )}
              {/* Macro markets */}
              {macroMarkets.length > 0 && (
                <div>
                  <p className="text-[11px] font-body font-medium mb-2" style={{ color: gold }}>
                    Macro bets affecting {ticker}
                  </p>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    {macroMarkets.map(renderMarketCard)}
                  </div>
                </div>
              )}
              <p className="text-[10px] font-body mt-1" style={{ color: textMuted }}>
                Real-money probabilities from Polymarket. Prices reflect market consensus, not editorial opinion.
              </p>
            </div>
          </div>
        );
      })()}

      {/* ── ABOUT ── */}
      {profile.description && (
        <Section title="About" icon={Building2} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          <p className="text-sm font-body leading-relaxed" style={{ color: textSecondary }}>
            {profile.description}
          </p>
          <div className="flex gap-4 mt-3 flex-wrap">
            {profile.industry && (
              <span className="text-[10px] font-body px-2 py-0.5 rounded" style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
                {profile.industry}
              </span>
            )}
            {profile.country && (
              <span className="text-[10px] font-body px-2 py-0.5 rounded" style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
                {profile.country}
              </span>
            )}
            {profile.employees && (
              <span className="text-[10px] font-body" style={{ color: textMuted }}>
                {formatNumber(profile.employees)} employees
              </span>
            )}
            {profile.website && (
              <a href={profile.website} target="_blank" rel="noopener noreferrer"
                className="text-[10px] font-body flex items-center gap-1" style={{ color: gold }}>
                <Globe size={10} /> Website <ExternalLink size={8} />
              </a>
            )}
          </div>
        </Section>
      )}

      {/* ── ANALYST CONSENSUS ── */}
      {(analyst.recommendation || analyst.num_analyst_opinions > 0) && (
        <Section title="Analyst outlook" icon={Target} isDark={isDark} gold={gold} surface={surface} border={border}>
          <div className="flex flex-col sm:flex-row gap-6">
            {/* Recommendation badge */}
            <div className="text-center">
              <div className="w-20 h-20 rounded-full mx-auto flex items-center justify-center mb-2"
                style={{ background: `${gold}12` }}>
                <span className="font-display text-sm" style={{ color: gold }}>
                  {(analyst.recommendation || 'N/A').replace(/_/g, ' ')}
                </span>
              </div>
              {analyst.num_analyst_opinions && (
                <p className="text-[10px] font-body" style={{ color: textMuted }}>
                  Based on {analyst.num_analyst_opinions} analyst{analyst.num_analyst_opinions !== 1 ? 's' : ''}
                </p>
              )}
            </div>

            {/* Price target */}
            <div className="flex-1">
              {analyst.target_mean_price && (
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-xs font-body" style={{ color: textMuted }}>Price target</span>
                    <span className="text-sm font-numeric font-medium" style={{ color: gold }}>
                      {fmtPrice(analyst.target_mean_price)}
                    </span>
                  </div>
                  {price > 0 && analyst.target_mean_price > 0 && (
                    <p className="text-xs font-numeric" style={{
                      color: analyst.target_mean_price > price ? greenColor : redColor,
                    }}>
                      {formatPercent(((analyst.target_mean_price - price) / price) * 100, { signed: true })} from current
                    </p>
                  )}
                  {(analyst.target_low_price || analyst.target_high_price) && (
                    <p className="text-[10px] font-body mt-1" style={{ color: textMuted }}>
                      Range: {fmtPrice(analyst.target_low_price)} – {fmtPrice(analyst.target_high_price)}
                    </p>
                  )}
                </div>
              )}

              {/* Rating distribution bars */}
              {analyst.recommendations_trend?.length > 0 && (() => {
                const latest = analyst.recommendations_trend[analyst.recommendations_trend.length - 1];
                const total = (latest.strong_buy || 0) + (latest.buy || 0) + (latest.hold || 0) + (latest.sell || 0) + (latest.strong_sell || 0);
                if (total === 0) return null;

                const bars = [
                  { label: 'Strong Buy', count: latest.strong_buy, color: greenColor },
                  { label: 'Buy', count: latest.buy, color: isDark ? '#5AC778' : '#3DB860' },
                  { label: 'Hold', count: latest.hold, color: gold },
                  { label: 'Sell', count: latest.sell, color: isDark ? '#FF7A70' : '#E05A50' },
                  { label: 'Strong Sell', count: latest.strong_sell, color: redColor },
                ];

                return (
                  <div className="space-y-1.5">
                    {bars.map((b) => (
                      <div key={b.label} className="flex items-center gap-2">
                        <span className="text-[10px] font-body w-20 text-right" style={{ color: textMuted }}>{b.label}</span>
                        <div className="flex-1 h-2 rounded-full overflow-hidden" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }}>
                          <div className="h-full rounded-full" style={{ width: `${(b.count / total) * 100}%`, background: b.color }} />
                        </div>
                        <span className="text-[10px] font-numeric w-6" style={{ color: textMuted }}>{b.count}</span>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>
          </div>
        </Section>
      )}

      {/* ── EARNINGS HISTORY ── */}
      {earnings.length > 0 && (
        <Section title="Earnings history" icon={CalendarDays} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[10px] font-body" style={{ color: textMuted }}>
                  <th className="text-left py-2 font-normal">Date</th>
                  <th className="text-right py-2 font-normal">Est. EPS</th>
                  <th className="text-right py-2 font-normal">Actual EPS</th>
                  <th className="text-right py-2 font-normal">Surprise</th>
                </tr>
              </thead>
              <tbody>
                {earnings.map((e: any, i: number) => {
                  const surprise = e.surprise_pct;
                  return (
                    <tr key={i} style={{ borderTop: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
                      <td className="py-2.5 text-xs font-body">{e.date}</td>
                      <td className="py-2.5 text-xs font-numeric text-right">
                        {e.eps_estimate != null ? formatCurrency(e.eps_estimate) : '—'}
                      </td>
                      <td className="py-2.5 text-xs font-numeric text-right">
                        {e.reported_eps != null ? formatCurrency(e.reported_eps) : '—'}
                      </td>
                      <td className="py-2.5 text-xs font-numeric text-right" style={{
                        color: surprise == null ? textMuted : surprise >= 0 ? greenColor : redColor,
                      }}>
                        {surprise != null ? formatPercent(surprise, { signed: true }) : '—'}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ── NEWS ── */}
      {news.length > 0 && (
        <Section title={`News (${news.length})`} icon={Newspaper} isDark={isDark} gold={gold} surface={surface} border={border}>
          <div className="space-y-3">
            {news.slice(0, 8).map((article: any, i: number) => (
              <a key={i} href={article.url} target="_blank" rel="noopener noreferrer"
                className="block rounded-lg p-3 transition-opacity hover:opacity-80"
                style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                <p className="text-sm font-body leading-snug mb-1">{article.headline}</p>
                <div className="flex items-center gap-3">
                  <span className="text-[10px] font-body" style={{ color: textMuted }}>{article.source}</span>
                  <span className="text-[10px] font-body flex items-center gap-1" style={{ color: textMuted }}>
                    <Clock size={9} /> {timeAgo(article.published_at)}
                  </span>
                  <ExternalLink size={10} style={{ color: textMuted }} />
                </div>
              </a>
            ))}
          </div>
        </Section>
      )}

      {/* ── SOCIAL SENTIMENT ── */}
      <Section title="Social" icon={MessageCircle} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={true}>
        <SocialFeed ticker={ticker || ''} />
      </Section>

      {/* ── INSIDER TRADES ── */}
      {insider.trades?.length > 0 && (
        <Section title="Insider activity" icon={Users} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          {/* Summary */}
          {insider.summary && (
            <div className="flex gap-4 mb-4 flex-wrap">
              <div className="text-center px-4 py-2 rounded-lg" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                <p className="text-lg font-numeric font-medium" style={{ color: greenColor }}>
                  {insider.summary.open_market_buys || 0}
                </p>
                <p className="text-[10px] font-body" style={{ color: textMuted }}>Buys (90d)</p>
              </div>
              <div className="text-center px-4 py-2 rounded-lg" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                <p className="text-lg font-numeric font-medium" style={{ color: redColor }}>
                  {insider.summary.open_market_sells || 0}
                </p>
                <p className="text-[10px] font-body" style={{ color: textMuted }}>Sells (90d)</p>
              </div>
              {insider.summary.net_buy_value != null && (
                <div className="text-center px-4 py-2 rounded-lg" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                  <p className="text-lg font-numeric font-medium" style={{
                    color: insider.summary.net_buy_value >= 0 ? greenColor : redColor,
                  }}>
                    {fmtLargeNum(Math.abs(insider.summary.net_buy_value))}
                  </p>
                  <p className="text-[10px] font-body" style={{ color: textMuted }}>
                    Net {insider.summary.net_buy_value >= 0 ? 'buying' : 'selling'}
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Trade list */}
          <div className="space-y-2">
            {insider.trades.slice(0, 8).map((trade: any, i: number) => (
              <div key={i} className="flex items-center justify-between py-2"
                style={{ borderBottom: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
                <div>
                  <p className="text-xs font-body font-medium">{trade.name}</p>
                  <p className="text-[10px] font-body" style={{ color: textMuted }}>
                    {trade.title} — {trade.transaction_type}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-xs font-numeric" style={{
                    color: trade.transaction_code === 'P' ? greenColor : trade.transaction_code === 'S' ? redColor : textMuted,
                  }}>
                    {trade.shares != null ? formatNumber(trade.shares) : ''} shares
                  </p>
                  <p className="text-[10px] font-body" style={{ color: textMuted }}>
                    {trade.transaction_date || trade.filing_date}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {/* ── EARNINGS BEAT/MISS CHART ── */}
      {earnings.length > 1 && earnings.some((e: any) => e.reported_eps != null) && (
        <Section title="Earnings vs estimates" icon={BarChart3} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={[...earnings].reverse().filter((e: any) => e.eps_estimate != null || e.reported_eps != null)}>
              <XAxis dataKey="date" axisLine={false} tickLine={false}
                tick={{ fontSize: 10, fill: textMuted }}
                tickFormatter={(d: string) => {
                  try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); }
                  catch { return d; }
                }} />
              <YAxis axisLine={false} tickLine={false}
                tick={{ fontSize: 10, fill: textMuted }}
                tickFormatter={(v: number) => formatCurrency(v)}
                width={50} />
              <ReTooltip
                contentStyle={{
                  background: isDark ? '#151517' : '#FFFFFF',
                  border: `0.5px solid ${border}`,
                  borderRadius: 8, fontSize: 12,
                }}
                formatter={(val: number, name: string) => [formatCurrency(val), name === 'eps_estimate' ? 'Estimate' : 'Actual']}
              />
              <ReferenceLine y={0} stroke={isDark ? '#2A2A2D' : '#D0D0D0'} />
              <Bar dataKey="eps_estimate" fill={isDark ? '#2A2A2D' : '#D0D0D0'} radius={[3, 3, 0, 0]} barSize={16} name="eps_estimate" />
              <Bar dataKey="reported_eps" radius={[3, 3, 0, 0]} barSize={16} name="reported_eps">
                {[...earnings].reverse().filter((e: any) => e.eps_estimate != null || e.reported_eps != null).map((e: any, i: number) => (
                  <Cell key={i} fill={
                    e.reported_eps != null && e.eps_estimate != null
                      ? e.reported_eps >= e.eps_estimate ? greenColor : redColor
                      : gold
                  } />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
          <div className="flex items-center gap-4 mt-2 justify-center">
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: isDark ? '#2A2A2D' : '#D0D0D0' }} />
              <span className="text-[10px] font-body" style={{ color: textMuted }}>Estimate</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: greenColor }} />
              <span className="text-[10px] font-body" style={{ color: textMuted }}>Beat</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2.5 h-2.5 rounded-sm" style={{ background: redColor }} />
              <span className="text-[10px] font-body" style={{ color: textMuted }}>Miss</span>
            </div>
          </div>
        </Section>
      )}

      {/* ── FINANCIAL STATEMENTS ── */}
      {(financials.income_statement?.length > 0 || financials.balance_sheet?.length > 0 || financials.cash_flow?.length > 0) && (
        <Section title="Financial statements" icon={FileText} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          <FinancialTabs financials={financials} isDark={isDark} gold={gold} textMuted={textMuted} border={border} />
        </Section>
      )}

      {/* ── INSTITUTIONAL OWNERSHIP ── */}
      {institutional.holders?.length > 0 && (
        <Section title="Institutional ownership" icon={Landmark} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          {/* Major holders summary */}
          {Object.keys(institutional.major_holders || {}).length > 0 && (
            <div className="flex gap-3 mb-4 flex-wrap">
              {Object.entries(institutional.major_holders).map(([label, val]) => (
                <div key={label} className="text-center px-3 py-2 rounded-lg"
                  style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                  <p className="text-sm font-numeric font-medium">{val as string}</p>
                  <p className="text-[9px] font-body mt-0.5" style={{ color: textMuted }}>{label}</p>
                </div>
              ))}
            </div>
          )}
          {/* Top holders table */}
          <div className="overflow-x-auto">
            <table className="w-full">
              <thead>
                <tr className="text-[10px] font-body" style={{ color: textMuted }}>
                  <th className="text-left py-2 font-normal">Holder</th>
                  <th className="text-right py-2 font-normal">Shares</th>
                  <th className="text-right py-2 font-normal">Value</th>
                  <th className="text-right py-2 font-normal">% Held</th>
                </tr>
              </thead>
              <tbody>
                {institutional.holders.map((h: any, i: number) => (
                  <tr key={i} style={{ borderTop: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
                    <td className="py-2.5 text-xs font-body">{h.holder}</td>
                    <td className="py-2.5 text-xs font-numeric text-right">
                      {h.shares ? formatNumber(h.shares) : '—'}
                    </td>
                    <td className="py-2.5 text-xs font-numeric text-right">
                      {h.value ? fmtLargeNum(h.value) : '—'}
                    </td>
                    <td className="py-2.5 text-xs font-numeric text-right">
                      {h.pct_held != null ? formatPercent(h.pct_held * 100) : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Section>
      )}

      {/* ── SIMILAR STOCKS ── */}
      {similar.tickers?.length > 0 && (
        <Section title={`Similar stocks — ${similar.sector || 'Sector'}`} icon={GitBranch} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          <div className="flex gap-2 flex-wrap">
            {similar.tickers.map((t: string) => (
              <button key={t} onClick={() => navigate(`/app/research/${t}`)}
                className="text-sm font-body font-medium px-4 py-2.5 rounded-lg transition-all hover:scale-105"
                style={{ background: isDark ? '#0C0C0E' : '#F8F7F4', border: `0.5px solid ${border}`, color: gold }}>
                {t}
              </button>
            ))}
          </div>
          {similar.industry && (
            <p className="text-[10px] font-body mt-3" style={{ color: textMuted }}>
              Industry: {similar.industry}
            </p>
          )}
        </Section>
      )}

      {/* ── DISCLAIMER ── */}
      <p className="text-[9px] font-body text-center pb-4" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
        Market data from Yahoo Finance & Finnhub. Prediction markets from Polymarket.
        All data is for informational purposes — not investment advice.
      </p>
    </div>
  );
}


// ─── Share button ────────────────────────────────────────────────────────

function ShareButton({ ticker, price, dayChangePct, isDark, gold: _gold, textMuted }: {
  ticker: string; price: number; dayChangePct: number;
  isDark: boolean; gold: string; textMuted: string;
}) {
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}/research/${ticker}`;

  const shareText = `${ticker} Signal Analysis — ${price > 0 ? formatCurrency(price) : ''}${dayChangePct ? ` (${formatPercent(dayChangePct, { signed: true })})` : ''} — Polymarket odds, insider activity, institutional flow\n${shareUrl}`;

  const handleShare = async () => {
    // Try native share first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${ticker} — Signal Analysis | SignalStack`,
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled or not supported — fall through to clipboard
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: select the URL
      window.prompt('Copy this link:', shareUrl);
    }
  };

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1.5 text-[11px] font-body px-2.5 py-1 rounded-lg transition-colors"
      style={{
        border: `0.5px solid ${isDark ? '#2A2A2D' : '#D0D0D0'}`,
        color: copied ? (isDark ? '#34C759' : '#28A745') : textMuted,
      }}
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Share2 size={12} aria-hidden="true" />}
      {copied ? 'Copied' : 'Share'}
    </button>
  );
}
