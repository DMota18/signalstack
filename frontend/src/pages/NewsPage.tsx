import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import {
  Newspaper, Loader2, Clock, ExternalLink, TrendingUp, TrendingDown,
  Briefcase, Globe, Activity, ChevronRight, BarChart3,
} from 'lucide-react';

type NewsTab = 'holdings' | 'markets' | 'economy';

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

function fmtIndicatorValue(val: any, units: string): string {
  if (val == null) return '—';
  const n = Number(val);
  if (isNaN(n)) return String(val);
  if (units.toLowerCase().includes('percent') || units.toLowerCase().includes('rate')) return `${n.toFixed(2)}%`;
  if (Math.abs(n) >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  return n.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export default function NewsPage() {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [tab, setTab] = useState<NewsTab>('holdings');
  const [holdingsNews, setHoldingsNews] = useState<any[]>([]);
  const [marketNews, setMarketNews] = useState<any[]>([]);
  const [economyData, setEconomyData] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  useEffect(() => { loadTab(); }, [tab]);

  const loadTab = async () => {
    setLoading(true);
    if (tab === 'holdings' && holdingsNews.length === 0) {
      const res = await api.getHoldingsNews(40);
      if (res.status === 'ok') setHoldingsNews(res.data?.articles || []);
    }
    if (tab === 'markets' && marketNews.length === 0) {
      const res = await api.getMarketNews(25);
      if (res.status === 'ok') setMarketNews(res.data?.articles || []);
    }
    if (tab === 'economy' && !economyData) {
      const res = await api.getEconomyData();
      if (res.status === 'ok') setEconomyData(res.data);
    }
    setLoading(false);
  };

  const articles = tab === 'holdings' ? holdingsNews : tab === 'markets' ? marketNews : [];
  const tabs: { value: NewsTab; label: string; icon: any }[] = [
    { value: 'holdings', label: 'Your Holdings', icon: Briefcase },
    { value: 'markets', label: 'Markets', icon: Globe },
    { value: 'economy', label: 'Economy', icon: Activity },
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl">News & Macro</h1>
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {tabs.map((t) => (
          <button key={t.value} onClick={() => setTab(t.value)}
            className="flex items-center gap-1.5 text-[11px] font-body px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: tab === t.value ? `${gold}15` : 'transparent',
              color: tab === t.value ? gold : textMuted,
            }}>
            <t.icon size={12} />
            {t.label}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin" style={{ color: gold }} />
        </div>
      ) : tab === 'economy' ? (
        /* ── ECONOMY TAB ── */
        <div className="space-y-5">
          {/* Macro indicators grid */}
          {economyData?.indicators?.length > 0 && (
            <div>
              <p className="text-[10px] tracking-[1px] font-body mb-3" style={{ color: textMuted }}>KEY INDICATORS</p>
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
                {economyData.indicators.map((ind: any) => {
                  const current = Number(ind.latest_value);
                  const prev = Number(ind.previous_value);
                  const change = !isNaN(current) && !isNaN(prev) && prev !== 0 ? current - prev : null;
                  const isUp = change !== null && change > 0;

                  return (
                    <div key={ind.series_id} className="rounded-xl p-4"
                      style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
                      <p className="text-[9px] font-body uppercase tracking-wider mb-1" style={{ color: textMuted }}>
                        {ind.label}
                      </p>
                      <p className="text-lg font-numeric font-medium leading-tight">
                        {fmtIndicatorValue(ind.latest_value, ind.units || '')}
                      </p>
                      {change !== null && (
                        <div className="flex items-center gap-1 mt-1">
                          {isUp ? <TrendingUp size={10} style={{ color: greenColor }} />
                            : <TrendingDown size={10} style={{ color: redColor }} />}
                          <span className="text-[10px] font-numeric" style={{ color: isUp ? greenColor : redColor }}>
                            {isUp ? '+' : ''}{change.toFixed(2)}
                          </span>
                        </div>
                      )}
                      {ind.latest_date && (
                        <p className="text-[9px] font-body mt-1" style={{ color: textMuted }}>
                          {new Date(ind.latest_date).toLocaleDateString(undefined, { month: 'short', year: 'numeric' })}
                        </p>
                      )}
                      {/* Sparkline from observations */}
                      {ind.observations?.length > 3 && (
                        <div className="flex items-end gap-px mt-2 h-6">
                          {ind.observations.slice(0, 12).reverse().map((obs: any, i: number) => {
                            const v = Number(obs.value);
                            const vals = ind.observations.slice(0, 12).map((o: any) => Number(o.value)).filter((n: number) => !isNaN(n));
                            const min = Math.min(...vals);
                            const max = Math.max(...vals);
                            const range = max - min || 1;
                            const h = ((v - min) / range) * 100;
                            return (
                              <div key={i} className="flex-1 rounded-sm"
                                style={{
                                  height: `${Math.max(8, h)}%`,
                                  background: i === ind.observations.slice(0, 12).length - 1 ? gold : `${gold}30`,
                                }} />
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Economic calendar */}
          {economyData?.calendar?.length > 0 && (
            <div>
              <p className="text-[10px] tracking-[1px] font-body mb-3" style={{ color: textMuted }}>UPCOMING RELEASES</p>
              <div className="space-y-1.5">
                {economyData.calendar.map((release: any, i: number) => (
                  <div key={i} className="flex items-center justify-between py-2.5 px-4 rounded-lg"
                    style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
                    <div>
                      <p className="text-sm font-body">{release.name || release.series_name}</p>
                      <p className="text-[10px] font-body" style={{ color: textMuted }}>
                        {release.release_date ? new Date(release.release_date).toLocaleDateString(undefined, {
                          weekday: 'short', month: 'short', day: 'numeric',
                        }) : ''}
                      </p>
                    </div>
                    <span className="text-xs font-body px-2 py-0.5 rounded" style={{
                      background: (release.days_until || 99) <= 3 ? `${gold}12` : 'transparent',
                      color: (release.days_until || 99) <= 3 ? gold : textMuted,
                    }}>
                      {release.days_until === 0 ? 'Today' : release.days_until === 1 ? 'Tomorrow' : `${release.days_until}d`}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          )}

          <p className="text-[9px] font-body" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
            Data from Federal Reserve Economic Data (FRED). Updated {economyData?.fetched_at ? timeAgo(economyData.fetched_at) : 'recently'}.
          </p>
        </div>
      ) : (
        /* ── HOLDINGS / MARKETS NEWS ── */
        <div className="space-y-2">
          {articles.length > 0 ? articles.map((article: any, i: number) => (
            <a key={i} href={article.url} target="_blank" rel="noopener noreferrer"
              className="flex items-start gap-4 py-3 px-4 rounded-lg transition-opacity hover:opacity-80 no-underline"
              style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  {article.ticker && (
                    <span className="text-[9px] font-body font-medium px-1.5 py-0.5 rounded shrink-0"
                      style={{ background: `${gold}12`, color: gold }}
                      onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/app/research/${article.ticker}`); }}>
                      {article.ticker}
                    </span>
                  )}
                  <span className="text-[10px] font-body" style={{ color: textMuted }}>{article.source}</span>
                  <span className="text-[10px] font-body flex items-center gap-0.5" style={{ color: textMuted }}>
                    <Clock size={8} /> {timeAgo(article.published_at)}
                  </span>
                </div>
                <p className="text-sm font-body leading-snug mb-1">{article.headline}</p>
                {article.summary && (
                  <p className="text-xs font-body line-clamp-2" style={{ color: textMuted }}>{article.summary}</p>
                )}
              </div>
              <ExternalLink size={12} className="shrink-0 mt-1" style={{ color: textMuted }} />
            </a>
          )) : (
            <div className="text-center py-16">
              <Newspaper size={32} style={{ color: `${gold}40` }} className="mx-auto mb-4" />
              <p className="font-display text-lg mb-2">No news yet</p>
              <p className="text-sm font-body" style={{ color: textMuted }}>
                {tab === 'holdings' ? 'Add holdings to see personalized news.' : 'Check back soon for market updates.'}
              </p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
