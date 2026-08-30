import { useState, useEffect } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import AlertCard from '../components/AlertCard';
import PolymarketPanel from '../components/PolymarketPanel';
import {
  Loader2, ExternalLink, TrendingUp, TrendingDown, Activity, CalendarDays, Bell,
  RefreshCw, Newspaper, Landmark,
} from 'lucide-react';

import { getLogoUrl } from '../lib/brandColors';

type MarketTab = 'news' | 'earnings' | 'polymarket' | 'economy' | 'congress' | 'alerts';

function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.floor(hrs / 24)}d ago`;
}

function fmtIndicator(val: any, units: string): string {
  if (val == null) return '—';
  const n = Number(val);
  if (isNaN(n)) return String(val);
  if (units.toLowerCase().includes('percent') || units.toLowerCase().includes('rate')) return `${n.toFixed(2)}%`;
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

const MARKET_TABS: MarketTab[] = ['news', 'earnings', 'polymarket', 'economy', 'congress', 'alerts'];

export default function MarketsPage() {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const requestedTab = (location.state as { tab?: string } | null)?.tab;
  const [tab, setTab] = useState<MarketTab>(
    MARKET_TABS.includes(requestedTab as MarketTab) ? (requestedTab as MarketTab) : 'news'
  );

  // News state
  const [newsMode, setNewsMode] = useState<'holdings' | 'general'>('holdings');
  const [holdingsNews, setHoldingsNews] = useState<any[] | null>(null);
  const [marketNews, setMarketNews] = useState<any[] | null>(null);

  // Earnings state
  const [earnings, setEarnings] = useState<any[]>([]);
  const [earningsLoading, setEarningsLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  // Economy state
  const [economyData, setEconomyData] = useState<any>(null);

  // Congress state
  const [congressTrades, setCongressTrades] = useState<any[] | null>(null);

  // Alerts state
  const [alerts, setAlerts] = useState<any[]>([]);
  const [alertsLoading, setAlertsLoading] = useState(false);

  const [loading, setLoading] = useState(false);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  // Honor tab requests from navigation while already mounted
  useEffect(() => {
    if (MARKET_TABS.includes(requestedTab as MarketTab)) setTab(requestedTab as MarketTab);
  }, [requestedTab]);

  // Load data per tab
  useEffect(() => { loadTab(); }, [tab, newsMode]);

  const loadTab = async () => {
    setLoading(true);
    if (tab === 'news') {
      if (newsMode === 'holdings' && !holdingsNews) {
        const r = await api.getHoldingsNews(40);
        if (r.status === 'ok') setHoldingsNews(r.data?.articles || []);
      }
      if (newsMode === 'general' && !marketNews) {
        // Try NewsAPI first (better sources), fall back to Finnhub
        const r = await api.getNewsApiHeadlines(25);
        if (r.status === 'ok' && r.data?.articles?.length > 0) {
          setMarketNews(r.data.articles);
        } else {
          const fallback = await api.getMarketNews(25);
          if (fallback.status === 'ok') setMarketNews(fallback.data?.articles || []);
        }
      }
    }
    if (tab === 'earnings' && earnings.length === 0) {
      setEarningsLoading(true);
      const r = await api.getEarningsCalendar();
      if (r.status === 'ok') setEarnings(r.data || []);
      setEarningsLoading(false);
    }
    if (tab === 'economy' && !economyData) {
      const r = await api.getEconomyData();
      if (r.status === 'ok') setEconomyData(r.data);
    }
    if (tab === 'congress' && !congressTrades) {
      const r = await api.getCongressTrades(25);
      if (r.status === 'ok') setCongressTrades(r.data?.trades || []);
    }
    if (tab === 'alerts' && alerts.length === 0) {
      setAlertsLoading(true);
      const r = await api.getAlerts({ limit: 50 });
      if (r.status === 'ok') setAlerts(r.data || []);
      setAlertsLoading(false);
    }
    setLoading(false);
  };

  const handleRefreshEarnings = async () => {
    setRefreshing(true);
    await api.refreshEarnings();
    const r = await api.getEarningsCalendar();
    if (r.status === 'ok') setEarnings(r.data || []);
    setRefreshing(false);
  };

  const articles = newsMode === 'holdings' ? (holdingsNews || []) : (marketNews || []);
  const thisWeek = earnings.filter(e => e.days_until <= 7);
  const nextWeek = earnings.filter(e => e.days_until > 7 && e.days_until <= 14);
  const later = earnings.filter(e => e.days_until > 14);

  const tabs: { value: MarketTab; label: string; icon: any }[] = [
    { value: 'news', label: 'News', icon: Newspaper },
    { value: 'earnings', label: 'Earnings', icon: CalendarDays },
    { value: 'polymarket', label: 'Predictions', icon: TrendingUp },
    { value: 'economy', label: 'Economy', icon: Activity },
    { value: 'congress', label: 'Congress', icon: Landmark },
    { value: 'alerts', label: 'Alerts', icon: Bell },
  ];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-xl">Markets</h1>
        <p className="text-sm font-body mt-0.5" style={{ color: textMuted }}>
          Stay on top of what's moving and why.
        </p>
      </div>

      {/* Tab bar */}
      <div className="flex gap-1 flex-wrap">
        {tabs.map((t) => (
          <button key={t.value} onClick={() => setTab(t.value)}
            className="flex items-center gap-1.5 text-[11px] font-body px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: tab === t.value ? `${gold}15` : 'transparent',
              color: tab === t.value ? gold : textMuted,
            }}>
            <t.icon size={12} /> {t.label}
          </button>
        ))}
      </div>

      {/* ── NEWS TAB ── */}
      {tab === 'news' && (
        <div className="space-y-3">
          <div className="flex gap-1">
            {(['holdings', 'general'] as const).map((m) => (
              <button key={m} onClick={() => setNewsMode(m)}
                className="text-[10px] font-body px-2.5 py-1 rounded transition-colors"
                style={{
                  background: newsMode === m ? `${gold}12` : 'transparent',
                  color: newsMode === m ? gold : textMuted,
                }}>
                {m === 'holdings' ? 'Your holdings' : 'General market'}
              </button>
            ))}
          </div>

          {loading && !articles.length ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
            </div>
          ) : articles.length > 0 ? (
            <div className="space-y-1.5">
              {articles.map((a: any, i: number) => {
                const logoUrl = a.ticker ? getLogoUrl(a.ticker) : null;
                return (
                  <a key={i} href={a.url} target="_blank" rel="noopener noreferrer"
                    className="flex items-start gap-3 py-3 px-4 rounded-lg transition-opacity hover:opacity-80 no-underline"
                    style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
                    {/* Logo */}
                    {logoUrl ? (
                      <img src={logoUrl} alt="" className="w-8 h-8 rounded-md object-contain shrink-0 mt-0.5"
                        style={{ background: isDark ? '#1A1A1D' : '#F0EEE8' }}
                        onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }} />
                    ) : a.image_url ? (
                      <img src={a.image_url} alt="" className="w-14 h-10 rounded-md object-cover shrink-0 mt-0.5"
                        onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }} />
                    ) : null}
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-0.5">
                        {a.ticker && (
                          <span className="text-[9px] font-body font-medium px-1.5 py-0.5 rounded shrink-0"
                            style={{ background: `${gold}12`, color: gold }}
                            onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/app/research/${a.ticker}`); }}>
                            {a.ticker}
                          </span>
                        )}
                        <span className="text-[10px] font-body" style={{ color: textMuted }}>{a.source}</span>
                        <span className="text-[10px] font-body" style={{ color: textMuted }}>
                          {timeAgo(a.published_at)}
                        </span>
                      </div>
                      <p className="text-sm font-body leading-snug">{a.headline}</p>
                      {a.summary && (
                        <p className="text-xs font-body line-clamp-1 mt-0.5" style={{ color: textMuted }}>{a.summary}</p>
                      )}
                    </div>
                    <ExternalLink size={11} className="shrink-0 mt-1" style={{ color: textMuted }} />
                  </a>
                );
              })}
            </div>
          ) : (
            <p className="text-sm font-body text-center py-12" style={{ color: textMuted }}>
              {newsMode === 'holdings' ? 'Add holdings to see personalized news.' : 'No market news available right now.'}
            </p>
          )}
        </div>
      )}

      {/* ── EARNINGS TAB ── */}
      {tab === 'earnings' && (
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-xs font-body" style={{ color: textMuted }}>
              Upcoming earnings for your holdings and watchlist
            </p>
            <button onClick={handleRefreshEarnings} disabled={refreshing}
              className="flex items-center gap-1.5 text-[10px] font-body px-2.5 py-1 rounded transition-all disabled:opacity-40"
              style={{ color: textMuted, border: `0.5px solid ${isDark ? '#2A2A2D' : '#D0D0D0'}` }}>
              <RefreshCw size={10} className={refreshing ? 'animate-spin' : ''} />
              Refresh
            </button>
          </div>

          {earningsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
            </div>
          ) : earnings.length > 0 ? (
            <div className="space-y-1">
              {[
                { label: 'THIS WEEK', items: thisWeek },
                { label: 'NEXT WEEK', items: nextWeek },
                { label: 'LATER', items: later },
              ].filter(g => g.items.length > 0).map((group) => (
                <div key={group.label}>
                  <div className="flex items-center gap-2 mt-2 mb-2">
                    <span className="text-[10px] tracking-[1px] font-body" style={{ color: textMuted }}>{group.label}</span>
                    <span className="text-[10px] font-body px-1.5 py-0.5 rounded" style={{ background: `${gold}12`, color: gold }}>{group.items.length}</span>
                    <div className="flex-1 h-px" style={{ background: border }} />
                  </div>
                  <div className="space-y-1.5">
                    {group.items.map((e: any) => (
                      <div key={`${e.ticker}-${e.report_date}`}
                        onClick={() => navigate(`/app/research/${e.ticker}`)}
                        className="flex items-center justify-between py-3 px-4 rounded-lg cursor-pointer hover:opacity-80"
                        style={{
                          background: surface,
                          border: isDark ? 'none' : `0.5px solid ${border}`,
                          borderLeft: e.days_until <= 5 ? `3px solid ${gold}` : undefined,
                        }}>
                        <div className="flex items-center gap-3">
                          <img src={getLogoUrl(e.ticker)} alt="" className="w-7 h-7 rounded-md object-contain shrink-0"
                            style={{ background: isDark ? '#1A1A1D' : '#F0EEE8' }}
                            onError={(ev) => { (ev.currentTarget as HTMLElement).style.display = 'none'; }} />
                          <div>
                            <div className="flex items-center gap-2">
                              <span className="text-sm font-body font-medium">{e.ticker}</span>
                              {e.in_portfolio && (
                                <span className="text-[9px] font-body px-1.5 py-0.5 rounded"
                                  style={{ background: `${gold}12`, color: gold }}>Held</span>
                              )}
                            </div>
                            <p className="text-[10px] font-body" style={{ color: textMuted }}>
                              {new Date(e.report_date + 'T00:00:00').toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })} — {e.report_time}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-4">
                          {e.consensus_eps != null && (
                            <span className="text-[10px] font-numeric" style={{ color: textMuted }}>
                              EPS est ${e.consensus_eps.toFixed(2)}
                            </span>
                          )}
                          <span className="text-sm font-display" style={{ color: e.days_until <= 5 ? gold : textMuted }}>
                            {e.days_until === 0 ? 'Today' : e.days_until === 1 ? 'Tomorrow' : `${e.days_until}d`}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-body text-center py-12" style={{ color: textMuted }}>
              No upcoming earnings. Try refreshing from Finnhub.
            </p>
          )}

          <p className="text-[9px] font-body" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
            Earnings data from Finnhub. Dates may shift — always verify with the company.
          </p>
        </div>
      )}

      {/* ── POLYMARKET TAB ── */}
      {tab === 'polymarket' && <PolymarketPanel />}

      {/* ── ECONOMY TAB ── */}
      {tab === 'economy' && (
        <div className="space-y-5">
          {loading && !economyData ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
            </div>
          ) : economyData ? (
            <>
              {economyData.indicators?.length > 0 && (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                  {economyData.indicators.map((ind: any) => {
                    const cur = Number(ind.latest_value);
                    const prev = Number(ind.previous_value);
                    const chg = !isNaN(cur) && !isNaN(prev) && prev !== 0 ? cur - prev : null;
                    return (
                      <div key={ind.series_id} className="rounded-xl p-4"
                        style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
                        <p className="text-[9px] font-body uppercase tracking-wider mb-1" style={{ color: textMuted }}>{ind.label}</p>
                        <p className="text-lg font-numeric font-medium leading-tight">
                          {fmtIndicator(ind.latest_value, ind.units || '')}
                        </p>
                        {chg !== null && (
                          <div className="flex items-center gap-1 mt-1">
                            {chg > 0 ? <TrendingUp size={10} style={{ color: greenColor }} />
                              : <TrendingDown size={10} style={{ color: redColor }} />}
                            <span className="text-[10px] font-numeric" style={{ color: chg > 0 ? greenColor : redColor }}>
                              {chg > 0 ? '+' : ''}{chg.toFixed(2)}
                            </span>
                          </div>
                        )}
                        {ind.observations?.length > 3 && (
                          <div className="flex items-end gap-px mt-2 h-6">
                            {ind.observations.slice(0, 12).reverse().map((obs: any, i: number) => {
                              const v = Number(obs.value);
                              const vals = ind.observations.slice(0, 12).map((o: any) => Number(o.value)).filter((n: number) => !isNaN(n));
                              const min = Math.min(...vals); const max = Math.max(...vals);
                              const h = max > min ? ((v - min) / (max - min)) * 100 : 50;
                              return <div key={i} className="flex-1 rounded-sm" style={{
                                height: `${Math.max(8, h)}%`,
                                background: i === ind.observations.slice(0, 12).length - 1 ? gold : `${gold}30`,
                              }} />;
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {economyData.calendar?.length > 0 && (
                <div>
                  <p className="text-[10px] tracking-[1px] font-body mb-2" style={{ color: textMuted }}>UPCOMING RELEASES</p>
                  <div className="space-y-1">
                    {economyData.calendar.map((r: any, i: number) => (
                      <div key={i} className="flex items-center justify-between py-2.5 px-4 rounded-lg"
                        style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
                        <p className="text-sm font-body">{r.name || r.series_name}</p>
                        <span className="text-xs font-body" style={{
                          color: (r.days_until || 99) <= 3 ? gold : textMuted,
                        }}>
                          {r.days_until === 0 ? 'Today' : r.days_until === 1 ? 'Tomorrow' : `${r.days_until}d`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* ── CONGRESS TAB ── */}
      {tab === 'congress' && (
        <div className="space-y-3">
          <p className="text-xs font-body" style={{ color: textMuted }}>
            Recent stock trades disclosed by US Congress members.
          </p>
          {loading && !congressTrades ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
            </div>
          ) : (congressTrades || []).length > 0 ? (
            <div className="space-y-1.5">
              {(congressTrades || []).map((t: any, i: number) => {
                const isBuy = (t.transaction_type || '').toLowerCase().includes('purchase') || (t.transaction_type || '').toLowerCase().includes('buy');
                const logoUrl = t.ticker ? getLogoUrl(t.ticker) : null;
                return (
                  <div key={i}
                    onClick={() => t.ticker && navigate(`/app/research/${t.ticker}`)}
                    className="flex items-center gap-3 py-3 px-4 rounded-lg cursor-pointer hover:opacity-80"
                    style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
                    {/* Logo */}
                    {logoUrl ? (
                      <img src={logoUrl} alt="" className="w-7 h-7 rounded-md object-contain shrink-0"
                        style={{ background: isDark ? '#1A1A1D' : '#F0EEE8' }}
                        onError={(e) => { (e.currentTarget as HTMLElement).style.display = 'none'; }} />
                    ) : (
                      <div className="w-7 h-7 rounded-md flex items-center justify-center shrink-0"
                        style={{ background: isDark ? '#1A1A1D' : '#F0EEE8' }}>
                        <Landmark size={12} style={{ color: textMuted }} />
                      </div>
                    )}

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="text-sm font-body font-medium">{t.ticker || 'N/A'}</span>
                        <span className="text-[10px] font-body" style={{ color: textMuted }}>{t.asset_name}</span>
                      </div>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="text-[10px] font-body" style={{ color: textMuted }}>
                          {t.politician}
                        </span>
                        {t.party && (
                          <span className="text-[9px] font-body px-1.5 py-0.5 rounded"
                            style={{
                              background: t.party === 'Democrat' ? '#0066DD12' : t.party === 'Republican' ? '#DC354512' : `${textMuted}12`,
                              color: t.party === 'Democrat' ? '#0066DD' : t.party === 'Republican' ? '#DC3545' : textMuted,
                            }}>
                            {t.party === 'Democrat' ? 'D' : t.party === 'Republican' ? 'R' : t.party}
                          </span>
                        )}
                        {t.state && (
                          <span className="text-[9px] font-body" style={{ color: textMuted }}>{t.state}</span>
                        )}
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <span className="text-[10px] font-body font-medium" style={{
                        color: isBuy ? greenColor : redColor,
                      }}>
                        {isBuy ? 'Buy' : 'Sell'}
                      </span>
                      {t.amount_range && (
                        <p className="text-[9px] font-body" style={{ color: textMuted }}>{t.amount_range}</p>
                      )}
                      {t.transaction_date && (
                        <p className="text-[9px] font-body" style={{ color: textMuted }}>
                          {new Date(t.transaction_date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                        </p>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="text-center py-12">
              <Landmark size={28} style={{ color: `${gold}40` }} className="mx-auto mb-3" />
              <p className="text-sm font-body" style={{ color: textMuted }}>
                Congressional trade data requires an Unusual Whales API key.
              </p>
            </div>
          )}

          <p className="text-[9px] font-body" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
            Data from Unusual Whales. Trades are self-reported by Congress members per the STOCK Act.
          </p>
        </div>
      )}

      {/* ── ALERTS TAB ── */}
      {tab === 'alerts' && (
        <div className="space-y-3">
          {alertsLoading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
            </div>
          ) : alerts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {alerts.map((a) => <AlertCard key={a.id} alert={a} />)}
            </div>
          ) : (
            <div className="text-center py-16">
              <Bell size={28} style={{ color: `${gold}40` }} className="mx-auto mb-3" />
              <p className="font-display text-lg mb-1">No alerts yet</p>
              <p className="text-sm font-body" style={{ color: textMuted }}>
                Intelligence reports and price alerts will appear here.
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
