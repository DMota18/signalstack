import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { Zap, ChevronRight, Clock } from 'lucide-react';

export default function IntelligenceCard() {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [latest, setLatest] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#111113' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';

  useEffect(() => {
    api.getLatestIntelligence().then((res) => {
      if (res.status === 'ok' && res.data && res.data.id) {
        setLatest(res.data);
      }
      setLoading(false);
    });
  }, []);

  if (loading || !latest) return null;

  const synthesis = latest.body_json || {};
  const holdings = synthesis.per_holding_intelligence || [];
  const insights = synthesis.portfolio_level_insights || [];
  const signalCount = (latest.signals_used || []).length;

  // Time ago
  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  const signalColor = (signal: string) => {
    if (signal?.includes('bullish')) return isDark ? '#34C759' : '#28A745';
    if (signal?.includes('bearish')) return isDark ? '#FF453A' : '#DC3545';
    if (signal === 'conflicting') return gold;
    return textMuted;
  };

  return (
    <div
      onClick={() => navigate(`/app/alerts/${latest.id}`)}
      className="rounded-xl overflow-hidden cursor-pointer transition-all hover:scale-[1.005]"
      style={{ background: surface, border: `0.5px solid ${border}` }}
    >
      {/* Gold top accent bar */}
      <div style={{ height: 3, background: gold }} />

      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg flex items-center justify-center" style={{ background: `${gold}15` }}>
              <Zap size={14} style={{ color: gold }} />
            </div>
            <div>
              <p className="text-xs font-body font-medium">Latest intelligence</p>
              <p className="text-[10px] font-body flex items-center gap-1" style={{ color: textMuted }}>
                <Clock size={10} /> {timeAgo(latest.created_at)} — {signalCount} signal dimensions — {holdings.length} holdings
              </p>
            </div>
          </div>
          <ChevronRight size={16} style={{ color: textMuted }} />
        </div>

        {/* Top insight */}
        {insights.length > 0 && (
          <p className="text-sm font-body leading-relaxed mb-4" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>
            {insights[0].length > 200 ? insights[0].substring(0, 200) + '...' : insights[0]}
          </p>
        )}

        {/* Signal summary — top 5 holdings as mini cards */}
        <div className="flex gap-2 overflow-x-auto pb-1">
          {holdings.slice(0, 5).map((h: any) => (
            <div key={h.ticker} className="flex-shrink-0 rounded-lg px-3 py-2 min-w-[100px]"
              style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs font-body font-medium">{h.ticker}</span>
                <span className="w-1.5 h-1.5 rounded-full" style={{ background: signalColor(h.net_signal) }} />
              </div>
              <p className="text-[10px] font-body" style={{ color: signalColor(h.net_signal) }}>
                {(h.net_signal || 'neutral').replace(/_/g, ' ')}
              </p>
              {h.position_pct && (
                <p className="text-[9px] font-body" style={{ color: textMuted }}>
                  {h.position_pct.toFixed(1)}%
                </p>
              )}
            </div>
          ))}
        </div>

        {/* Signal dimension badges */}
        {latest.signals_used?.length > 0 && (
          <div className="flex gap-1.5 mt-3 flex-wrap">
            {latest.signals_used.map((s: string) => (
              <span key={s} className="text-[9px] font-body px-2 py-0.5 rounded"
                style={{ background: `${gold}10`, color: gold }}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </span>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
