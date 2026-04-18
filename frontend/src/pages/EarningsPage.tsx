import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { CalendarDays, RefreshCw, Loader2, Clock, TrendingUp } from 'lucide-react';
import ProbabilityGauge from '../components/ProbabilityGauge';

interface EarningsEvent {
  ticker: string;
  security_name: string;
  report_date: string;
  report_time: string;
  consensus_eps: number | null;
  consensus_revenue: number | null;
  actual_eps: number | null;
  actual_revenue: number | null;
  days_until: number;
  in_portfolio: boolean;
}

interface BeatOdds {
  ticker: string;
  question: string;
  pct: number;
  polymarket_url?: string;
}

export default function EarningsPage() {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [earnings, setEarnings] = useState<EarningsEvent[]>([]);
  const [beatOdds, setBeatOdds] = useState<Record<string, BeatOdds>>({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [lastRefresh, setLastRefresh] = useState<string | null>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const greenColor = isDark ? '#34C759' : '#28A745';

  useEffect(() => {
    loadEarnings();
  }, []);

  const loadEarnings = async () => {
    setLoading(true);
    const res = await api.getEarningsCalendar();
    if (res.status === 'ok') {
      const data = res.data || [];
      setEarnings(data);
      // Fetch Polymarket beat odds for upcoming earnings
      fetchBeatOdds(data);
    }
    setLoading(false);
  };

  const fetchBeatOdds = async (events: EarningsEvent[]) => {
    // Search Polymarket for "earnings" related markets for each ticker
    const upcoming = events.filter((e) => e.days_until <= 14);
    const odds: Record<string, BeatOdds> = {};

    // Batch — search top 6 tickers to avoid rate limits
    const tickers = [...new Set(upcoming.map((e) => e.ticker))].slice(0, 6);

    await Promise.all(
      tickers.map(async (ticker) => {
        try {
          const res = await api.searchPolymarketMarkets(`${ticker} earnings`, 500);
          if (res.status === 'ok' && res.data?.markets?.length > 0) {
            const market = res.data.markets[0];
            const pct = market.implied_probability_pct ?? (market.yes_price ? market.yes_price * 100 : 0);
            odds[ticker] = {
              ticker,
              question: market.question,
              pct,
              polymarket_url: market.polymarket_url,
            };
          }
        } catch {
          // Silently skip failed searches
        }
      })
    );

    setBeatOdds(odds);
  };

  const handleRefresh = async () => {
    setRefreshing(true);
    const res = await api.refreshEarnings();
    if (res.status === 'ok') {
      setLastRefresh(`Refreshed ${res.data?.refreshed || 0} earnings dates`);
      setTimeout(() => setLastRefresh(null), 4000);
      await loadEarnings();
    }
    setRefreshing(false);
  };

  // Group earnings by time window
  const thisWeek = earnings.filter((e) => e.days_until <= 7);
  const nextWeek = earnings.filter((e) => e.days_until > 7 && e.days_until <= 14);
  const later = earnings.filter((e) => e.days_until > 14);

  const formatDate = (dateStr: string) => {
    try {
      return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dateStr;
    }
  };

  const formatRevenue = (val: number | null) => {
    if (val == null) return null;
    if (val >= 1e9) return `$${(val / 1e9).toFixed(1)}B`;
    if (val >= 1e6) return `$${(val / 1e6).toFixed(0)}M`;
    return `$${val.toLocaleString()}`;
  };

  const EarningsCard = ({ e }: { e: EarningsEvent }) => {
    const isUrgent = e.days_until <= 5;
    const accentColor = isUrgent ? gold : textMuted;
    const odds = beatOdds[e.ticker];

    return (
      <div className="rounded-xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 sm:gap-4"
        style={{
          background: surface,
          border: isDark ? 'none' : `0.5px solid ${border}`,
          borderLeft: isUrgent ? `3px solid ${gold}` : undefined,
          borderRadius: isUrgent ? '0 12px 12px 0' : undefined,
          cursor: 'pointer',
        }}
        onClick={() => navigate(`/app/research/${e.ticker}`)}
      >
        <div className="flex items-center gap-4 flex-1 min-w-0">
          <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
            style={{ background: `${accentColor}12` }}>
            <CalendarDays size={18} style={{ color: accentColor }} />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="font-display text-sm">{e.ticker}</span>
              {e.security_name && (
                <span className="text-xs font-body truncate" style={{ color: textMuted }}>{e.security_name}</span>
              )}
              {e.in_portfolio && (
                <span className="text-[9px] font-body px-1.5 py-0.5 rounded shrink-0"
                  style={{ background: `${gold}12`, color: gold }}>
                  Held
                </span>
              )}
            </div>
            <p className="text-xs font-body mt-0.5" style={{ color: textMuted }}>
              {formatDate(e.report_date)} — {e.report_time}
            </p>
            {/* Consensus estimates */}
            {(e.consensus_eps != null || e.consensus_revenue != null) && (
              <div className="flex gap-3 mt-1">
                {e.consensus_eps != null && (
                  <span className="text-[10px] font-body" style={{ color: textMuted }}>
                    Est EPS: <span className="font-numeric">${e.consensus_eps.toFixed(2)}</span>
                  </span>
                )}
                {e.consensus_revenue != null && (
                  <span className="text-[10px] font-body" style={{ color: textMuted }}>
                    Est Rev: <span className="font-numeric">{formatRevenue(e.consensus_revenue)}</span>
                  </span>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Polymarket beat odds gauge */}
        {odds && (
          <a
            href={odds.polymarket_url || '#'}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(ev) => { ev.stopPropagation(); if (!odds.polymarket_url) ev.preventDefault(); }}
            className="shrink-0 flex flex-col items-center gap-0.5 transition-opacity hover:opacity-80"
            title={odds.question}
          >
            <ProbabilityGauge pct={odds.pct} size={48} strokeWidth={4} label={false} />
            <span className="text-[8px] font-body" style={{ color: gold }}>Beat odds</span>
          </a>
        )}

        <div className="text-right shrink-0">
          <p className="font-display text-lg" style={{ color: isUrgent ? gold : textMuted }}>
            {e.days_until === 0 ? 'Today' : e.days_until === 1 ? 'Tomorrow' : `${e.days_until}d`}
          </p>
        </div>
      </div>
    );
  };

  const SectionHeader = ({ label, count }: { label: string; count: number }) => (
    <div className="flex items-center gap-2 mt-2 mb-2">
      <span className="text-[10px] tracking-[1px] font-body" style={{ color: textMuted }}>
        {label}
      </span>
      <span className="text-[10px] font-body px-1.5 py-0.5 rounded"
        style={{ background: `${gold}12`, color: gold }}>
        {count}
      </span>
      <div className="flex-1 h-px" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }} />
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-display text-xl">Earnings calendar</h1>
          <p className="text-sm font-body mt-1" style={{ color: textMuted }}>
            Upcoming earnings for your holdings and watchlist.
          </p>
        </div>
        <button
          onClick={handleRefresh}
          disabled={refreshing}
          className="flex items-center gap-2 text-xs font-body px-3 py-1.5 rounded-lg transition-all disabled:opacity-40"
          style={{ border: `0.5px solid ${isDark ? '#2A2A2D' : '#D0D0D0'}`, color: textMuted }}
        >
          <RefreshCw size={12} className={refreshing ? 'animate-spin' : ''} />
          {refreshing ? 'Refreshing...' : 'Refresh from Finnhub'}
        </button>
      </div>

      {/* Refresh feedback */}
      {lastRefresh && (
        <p className="text-xs font-body" style={{ color: greenColor }}>{lastRefresh}</p>
      )}

      {/* Beat odds legend */}
      {Object.keys(beatOdds).length > 0 && (
        <div className="flex items-center gap-2">
          <TrendingUp size={11} style={{ color: gold }} />
          <span className="text-[10px] font-body" style={{ color: textMuted }}>
            Beat odds from Polymarket — crowd-implied probability of earnings beat
          </span>
        </div>
      )}

      {/* Loading */}
      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin" style={{ color: gold }} />
          <span className="ml-3 text-sm font-body" style={{ color: textMuted }}>Loading earnings...</span>
        </div>
      ) : earnings.length > 0 ? (
        <div className="space-y-1">
          {/* This week */}
          {thisWeek.length > 0 && (
            <>
              <SectionHeader label="THIS WEEK" count={thisWeek.length} />
              <div className="space-y-2">
                {thisWeek.map((e) => <EarningsCard key={`${e.ticker}-${e.report_date}`} e={e} />)}
              </div>
            </>
          )}

          {/* Next week */}
          {nextWeek.length > 0 && (
            <>
              <SectionHeader label="NEXT WEEK" count={nextWeek.length} />
              <div className="space-y-2">
                {nextWeek.map((e) => <EarningsCard key={`${e.ticker}-${e.report_date}`} e={e} />)}
              </div>
            </>
          )}

          {/* Later */}
          {later.length > 0 && (
            <>
              <SectionHeader label="LATER" count={later.length} />
              <div className="space-y-2">
                {later.map((e) => <EarningsCard key={`${e.ticker}-${e.report_date}`} e={e} />)}
              </div>
            </>
          )}
        </div>
      ) : (
        <div className="text-center py-16">
          <CalendarDays size={32} style={{ color: `${gold}40` }} className="mx-auto mb-4" />
          <p className="font-display text-lg mb-2">No upcoming earnings</p>
          <p className="text-sm font-body mb-6" style={{ color: textMuted }}>
            No earnings dates found for your holdings in the next 60 days.
            Try refreshing from Finnhub to pull the latest data.
          </p>
          <button onClick={handleRefresh} disabled={refreshing} className="btn-gold">
            {refreshing ? 'Refreshing...' : 'Refresh earnings data'}
          </button>
        </div>
      )}

      {/* Timestamp */}
      {earnings.length > 0 && (
        <p className="text-[9px] font-body flex items-center gap-1"
          style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
          <Clock size={8} /> Earnings data from Finnhub. Beat odds from Polymarket Gamma API. Dates may shift — always verify with the company.
        </p>
      )}
    </div>
  );
}
