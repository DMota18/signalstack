import { useTheme } from '../hooks/useTheme';
import { useNavigate } from 'react-router-dom';

const typeColors: Record<string, string> = {
  daily_digest: '#D4A843',
  weekly_report: '#D4A843',
  pre_earnings: '#D4A843',
  price_movement: '#FF453A',
  insider_activity: '#34C759',
  macro_event: '#34C759',
  polymarket_shift: '#D4A843',
  explore_idea: '#8A8A8D',
  on_demand: '#D4A843',
};

const typeLabels: Record<string, string> = {
  daily_digest: 'DAILY DIGEST',
  weekly_report: 'WEEKLY REPORT',
  pre_earnings: 'PRE-EARNINGS',
  price_movement: 'PRICE MOVEMENT',
  insider_activity: 'INSIDER ACTIVITY',
  macro_event: 'MACRO EVENT',
  polymarket_shift: 'POLYMARKET',
  explore_idea: 'EXPLORE',
  on_demand: 'ON DEMAND',
};

export default function AlertCard({ alert }: { alert: any }) {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const accentColor = typeColors[alert.alert_type] || '#D4A843';

  const timeAgo = (dateStr: string) => {
    const diff = Date.now() - new Date(dateStr).getTime();
    const mins = Math.floor(diff / 60000);
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    return `${days}d ago`;
  };

  return (
    <div
      onClick={() => navigate(`/app/alerts/${alert.id}`)}
      className="rounded-xl p-4 cursor-pointer transition-opacity hover:opacity-80"
      style={{
        background: isDark ? '#151517' : '#FFFFFF',
        borderLeft: `3px solid ${accentColor}`,
        borderRadius: '0 12px 12px 0',
        border: isDark ? undefined : `0.5px solid #E8E6E1`,
        borderLeftWidth: '3px',
        borderLeftColor: accentColor,
        borderLeftStyle: 'solid',
      }}
    >
      <p className="text-[10px] tracking-[1px] font-body mb-1" style={{ color: accentColor }}>
        {typeLabels[alert.alert_type] || alert.alert_type?.toUpperCase()}
      </p>
      <p className="font-display text-sm mb-1">{alert.title}</p>
      {alert.related_tickers?.length > 0 && (
        <div className="flex gap-1 flex-wrap mb-1">
          {alert.related_tickers.slice(0, 5).map((t: string) => (
            <span key={t} className="text-[10px] font-body px-1.5 py-0.5 rounded"
              style={{ background: `${accentColor}12`, color: accentColor }}>
              {t}
            </span>
          ))}
        </div>
      )}
      <p className="text-[10px] font-body" style={{ color: isDark ? '#4A4A4D' : '#AAACB0' }}>
        {timeAgo(alert.created_at)}
        {!alert.read_at && <span style={{ color: accentColor }}> — Unread</span>}
      </p>
    </div>
  );
}
