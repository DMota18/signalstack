import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import PortfolioChart from '../components/PortfolioChart';
import HoldingsTable from '../components/HoldingsTable';
import IntelligenceCard from '../components/IntelligenceCard';
import OnboardingModal from '../components/OnboardingModal';
import {
  Loader2, TrendingUp, TrendingDown, Minus,
  ChevronRight, Clock,
} from 'lucide-react';

// ─── Signal helpers ──────────────────────────────────────────────────────────

function signalColor(signal: string, isDark: boolean): string {
  const colors: Record<string, string> = {
    strongly_bullish: isDark ? '#34C759' : '#28A745',
    bullish: isDark ? '#34C759' : '#28A745',
    neutral: isDark ? '#8A8A8D' : '#6A6A6D',
    bearish: isDark ? '#FF453A' : '#DC3545',
    strongly_bearish: isDark ? '#FF453A' : '#DC3545',
    conflicting: isDark ? '#FFD60A' : '#C9A500',
    insufficient_data: isDark ? '#8A8A8D' : '#6A6A6D',
  };
  return colors[signal] || colors.neutral;
}

function signalLabel(signal: string): string {
  const labels: Record<string, string> = {
    strongly_bullish: 'STRONG BUY SIGNAL',
    bullish: 'BULLISH',
    neutral: 'NEUTRAL',
    bearish: 'BEARISH',
    strongly_bearish: 'STRONG SELL SIGNAL',
    conflicting: 'CONFLICTING',
    insufficient_data: 'LOW DATA',
  };
  return labels[signal] || 'NEUTRAL';
}

function changeColor(pct: number, isDark: boolean): string {
  if (pct > 0) return isDark ? '#34C759' : '#28A745';
  if (pct < 0) return isDark ? '#FF453A' : '#DC3545';
  return isDark ? '#8A8A8D' : '#6A6A6D';
}

// ─── Main Component ──────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { isDark } = useTheme();
  const navigate = useNavigate();

  const [holdings, setHoldings] = useState<any[]>([]);
  const [alerts, setAlerts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showOnboarding, setShowOnboarding] = useState(false);

  // Theme tokens
  const gold = isDark ? '#D4A843' : '#8B6914';
  const textPrimary = isDark ? '#E8E6E1' : '#1A1A1D';
  const textMuted = isDark ? '#6A6A6D' : '#9A9A9D';
  const textSecondary = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#111113' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const headerBg = isDark ? '#0A0A0B' : '#F0EDE6';

  // ── Data loading ──────────────────────────────────────────────────────────

  useEffect(() => { loadData(); }, []);

  useEffect(() => {
    if (holdings.length === 0) return;
    const interval = setInterval(async () => {
      const res = await api.refreshPrices();
      if (res.status === 'ok' && res.data?.updated > 0) {
        const holdingsRes = await api.getAllHoldings();
        if (holdingsRes.status === 'ok') setHoldings(holdingsRes.data || []);
      }
    }, 120_000);
    return () => clearInterval(interval);
  }, [holdings.length]);

  const loadData = async () => {
    setLoading(true);
    const [holdingsRes, alertsRes] = await Promise.all([
      api.getAllHoldings(),
      api.getAlerts({ limit: 6 }),
    ]);

    if (holdingsRes.status === 'ok') setHoldings(holdingsRes.data || []);
    if (alertsRes.status === 'ok') setAlerts(alertsRes.data || []);
    setLoading(false);

    const dismissed = sessionStorage.getItem('ss_onboarding_dismissed');
    if (holdingsRes.status === 'ok' && (!holdingsRes.data || holdingsRes.data.length === 0) && !dismissed) {
      setShowOnboarding(true);
    }
  };

  const totalValue = holdings.reduce((sum, h) => sum + (h.market_value || 0), 0);
  const totalDayChange = holdings.reduce((sum, h) => sum + (h.day_gain_value || 0), 0);
  const totalDayPct = totalValue > 0 ? (totalDayChange / (totalValue - totalDayChange)) * 100 : 0;

  const sortedHoldings = [...holdings].sort((a, b) => (b.day_gain_pct || 0) - (a.day_gain_pct || 0));

  if (loading) {
    return (
      <div className="flex items-center justify-center py-20">
        <Loader2 size={24} className="animate-spin" style={{ color: gold }} />
        <span className="ml-3 text-sm font-body" style={{ color: textMuted }}>Loading your portfolio...</span>
      </div>
    );
  }

  // ── Page Content (renders inside AppShell's main area) ────────────────────

  return (
    <div className="flex gap-0 h-full">
      {showOnboarding && (
        <OnboardingModal
          onClose={() => { setShowOnboarding(false); sessionStorage.setItem('ss_onboarding_dismissed', '1'); }}
          onHoldingsAdded={loadData}
        />
      )}

      {/* ─── CENTER CONTENT ─── */}
      <div className="flex-1 overflow-y-auto p-4 lg:p-5 space-y-4">

        {/* Featured intelligence / hero area */}
        {alerts.length > 0 ? (
          <div className="rounded-xl overflow-hidden" style={{ background: surface, border: `0.5px solid ${border}` }}>
            <div className="px-5 pt-4 pb-2">
              <PortfolioChart holdings={holdings} />
            </div>

            <div className="px-5 pb-4">
              <button
                onClick={() => navigate(alerts[0]?.id ? `/app/alerts/${alerts[0].id}` : '/app/alerts')}
                className="w-full text-left group"
              >
                <h2 className="font-display text-base group-hover:opacity-80 transition-all" style={{ color: textPrimary }}>
                  {alerts[0]?.title || 'Latest Intelligence'}
                </h2>
                <p className="text-xs font-body mt-1 line-clamp-2" style={{ color: textSecondary }}>
                  {alerts[0]?.body_json?.portfolio_level_insights?.[0] ||
                   `${holdings.length} holdings analyzed across 6 signal dimensions.`}
                </p>
                <div className="flex items-center gap-2 mt-2">
                  <Clock size={10} style={{ color: textMuted }} />
                  <span className="text-[10px] font-body" style={{ color: textMuted }}>
                    {alerts[0]?.created_at ? new Date(alerts[0].created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
                  </span>
                  {alerts[0]?.alert_type && (
                    <span className="text-[9px] font-body font-semibold px-1.5 py-0.5 rounded"
                      style={{ background: `${gold}20`, color: gold }}>
                      {alerts[0].alert_type.replace('_', ' ').toUpperCase()}
                    </span>
                  )}
                </div>
              </button>
            </div>
          </div>
        ) : (
          <div className="rounded-xl overflow-hidden" style={{ background: surface, border: `0.5px solid ${border}` }}>
            <div className="px-5 pt-4 pb-2">
              <PortfolioChart holdings={holdings} />
            </div>
            <div className="px-5 pb-4">
              <p className="text-xs font-body" style={{ color: textMuted }}>
                Run an analysis to see intelligence here.
              </p>
            </div>
          </div>
        )}

        {/* Signal feed — stacked alert cards */}
        {alerts.length > 1 && (
          <div className="space-y-1">
            {alerts.slice(1, 6).map((alert: any, i: number) => {
              const alertDate = alert.created_at
                ? new Date(alert.created_at).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })
                : '';
              const holdingData = alert.body_json?.per_holding_intelligence?.[0];
              const netSignal = holdingData?.net_signal || '';

              return (
                <button
                  key={alert.id || i}
                  onClick={() => navigate(alert.id ? `/app/alerts/${alert.id}` : '/app/alerts')}
                  className="w-full rounded-lg px-4 py-3 text-left transition-all hover:opacity-80"
                  style={{ background: surface, border: `0.5px solid ${border}` }}
                >
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-body" style={{ color: textMuted }}>{alertDate}</span>
                    {netSignal && (
                      <span className="text-[9px] font-body font-bold tracking-wide"
                        style={{ color: signalColor(netSignal, isDark) }}>
                        {signalLabel(netSignal)}
                      </span>
                    )}
                  </div>
                  <p className="text-[13px] font-body font-medium mt-1" style={{ color: textPrimary }}>
                    {alert.title}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Holdings table */}
        {holdings.length > 0 && (
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-body font-semibold tracking-wider uppercase" style={{ color: gold }}>
                Positions
              </p>
              <button onClick={() => navigate('/app/holdings')}
                className="text-[10px] font-body hover:opacity-70" style={{ color: gold }}>
                Manage <ChevronRight size={10} className="inline" />
              </button>
            </div>
            <HoldingsTable holdings={holdings} />
          </div>
        )}

        {/* Empty state */}
        {holdings.length === 0 && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <button onClick={() => navigate('/app/holdings')}
              className="rounded-xl p-5 text-left transition-all hover:scale-[1.005]"
              style={{ background: surface, border: `0.5px solid ${border}` }}>
              <p className="font-display text-sm mb-1">Add holdings</p>
              <p className="text-xs font-body" style={{ color: textMuted }}>
                Enter positions manually or connect a brokerage.
              </p>
            </button>
            <button onClick={() => navigate('/app/explore')}
              className="rounded-xl p-5 text-left transition-all hover:scale-[1.005]"
              style={{ background: surface, border: `0.5px solid ${border}` }}>
              <p className="font-display text-sm mb-1">Explore markets</p>
              <p className="text-xs font-body" style={{ color: textMuted }}>
                Browse news, earnings, and economic data.
              </p>
            </button>
          </div>
        )}
      </div>

      {/* ─── RIGHT SIDEBAR: Holdings Leaderboard ─── */}
      <div className="hidden lg:block w-[280px] shrink-0 overflow-y-auto p-4"
        style={{ borderLeft: `1px solid ${border}` }}>

        {/* Portfolio header */}
        <div className="mb-3">
          <p className="text-[10px] font-body font-semibold tracking-wider uppercase" style={{ color: gold }}>
            Portfolio
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="font-display text-lg" style={{ color: textPrimary }}>
              ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            </span>
            {totalDayChange !== 0 && (
              <span className="text-[11px] font-body font-medium"
                style={{ color: changeColor(totalDayChange, isDark) }}>
                {totalDayChange >= 0 ? '+' : ''}{totalDayPct.toFixed(2)}%
              </span>
            )}
          </div>
        </div>

        {/* Leaderboard table */}
        {sortedHoldings.length > 0 ? (
          <div className="rounded-lg overflow-hidden" style={{ border: `0.5px solid ${border}` }}>
            <div className="grid grid-cols-[24px_1fr_52px_52px] gap-1 px-3 py-2"
              style={{ background: headerBg, borderBottom: `1px solid ${border}` }}>
              <span className="text-[9px] font-body font-semibold" style={{ color: textMuted }}>#</span>
              <span className="text-[9px] font-body font-semibold" style={{ color: textMuted }}>Ticker</span>
              <span className="text-[9px] font-body font-semibold text-right" style={{ color: textMuted }}>Day</span>
              <span className="text-[9px] font-body font-semibold text-right" style={{ color: textMuted }}>Value</span>
            </div>

            {sortedHoldings.map((h, i) => {
              const dayPct = h.day_gain_pct || 0;
              return (
                <button
                  key={h.ticker}
                  onClick={() => navigate(`/app/research/${h.ticker}`)}
                  className="w-full grid grid-cols-[24px_1fr_52px_52px] gap-1 items-center px-3 py-2 text-left transition-all hover:opacity-80"
                  style={{
                    background: i === 0 ? `${gold}08` : 'transparent',
                    borderBottom: i < sortedHoldings.length - 1 ? `0.5px solid ${border}` : 'none',
                  }}
                >
                  <span className="text-[10px] font-numeric" style={{ color: textMuted }}>{i + 1}</span>
                  <div className="flex items-center gap-1.5 min-w-0">
                    {dayPct > 0 ? <TrendingUp size={10} style={{ color: changeColor(dayPct, isDark) }} /> :
                     dayPct < 0 ? <TrendingDown size={10} style={{ color: changeColor(dayPct, isDark) }} /> :
                     <Minus size={10} style={{ color: textMuted }} />}
                    <span className="text-[11px] font-body font-semibold truncate" style={{ color: textPrimary }}>
                      {h.ticker}
                    </span>
                  </div>
                  <span className="text-[10px] font-numeric text-right" style={{ color: changeColor(dayPct, isDark) }}>
                    {dayPct >= 0 ? '+' : ''}{dayPct.toFixed(1)}%
                  </span>
                  <span className="text-[10px] font-numeric text-right" style={{ color: textSecondary }}>
                    {h.market_value >= 1000
                      ? `$${(h.market_value / 1000).toFixed(1)}k`
                      : `$${h.market_value?.toFixed(0) || '0'}`}
                  </span>
                </button>
              );
            })}
          </div>
        ) : (
          <p className="text-[10px] font-body" style={{ color: textMuted }}>
            Add holdings to see your leaderboard.
          </p>
        )}

        {/* Latest Intelligence card (compact) */}
        <div className="mt-4">
          <IntelligenceCard />
        </div>
      </div>
    </div>
  );
}
