import { useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';

/**
 * FearGreedWidget — Market Fear & Greed Index gauge.
 * Compact widget for dashboard or markets page.
 */
export default function FearGreedWidget() {
  const { isDark } = useTheme();
  const [data, setData] = useState<any>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';

  useEffect(() => {
    api.getFearGreed().then((res) => {
      if (res.status === 'ok' && res.data?.value != null) setData(res.data);
    });
  }, []);

  if (!data || data.value == null) return null;

  const value = data.value;
  const classification = data.classification || 'Neutral';
  const prev = data.previous_close;
  const change = prev != null ? value - prev : null;

  // Color based on value
  const getColor = (v: number) => {
    if (v <= 25) return isDark ? '#FF453A' : '#DC3545';
    if (v <= 45) return isDark ? '#FF9500' : '#E08A00';
    if (v <= 55) return gold;
    if (v <= 75) return isDark ? '#5AC778' : '#3DB860';
    return isDark ? '#34C759' : '#28A745';
  };

  const color = getColor(value);

  // SVG arc gauge
  const size = 80;
  const sw = 6;
  const center = size / 2;
  const radius = (size - sw) / 2;
  const startAngle = 150;
  const arcDeg = 240;
  const fillAngle = startAngle + (value / 100) * arcDeg;
  const toRad = (d: number) => (d * Math.PI) / 180;

  const arcPath = (start: number, end: number) => {
    const s = toRad(start);
    const e = toRad(end);
    const x1 = center + radius * Math.cos(s);
    const y1 = center + radius * Math.sin(s);
    const x2 = center + radius * Math.cos(e);
    const y2 = center + radius * Math.sin(e);
    const large = end - start > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  };

  return (
    <div className="flex items-center gap-4">
      {/* Gauge */}
      <div className="relative" style={{ width: size, height: size * 0.7 }}>
        <svg width={size} height={size * 0.7} viewBox={`0 0 ${size} ${size * 0.8}`}>
          <path d={arcPath(startAngle, startAngle + arcDeg)} fill="none"
            stroke={isDark ? '#1A1A1D' : '#E8E6E1'} strokeWidth={sw} strokeLinecap="round" />
          {value > 0 && (
            <path d={arcPath(startAngle, fillAngle)} fill="none"
              stroke={color} strokeWidth={sw} strokeLinecap="round"
              style={{ transition: 'all 0.8s ease-out' }} />
          )}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center" style={{ paddingTop: 4 }}>
          <span className="font-numeric text-lg font-medium leading-none" style={{ color }}>{value}</span>
        </div>
      </div>

      {/* Label */}
      <div>
        <p className="text-xs font-body font-medium" style={{ color }}>{classification}</p>
        <p className="text-[10px] font-body" style={{ color: textMuted }}>Fear & Greed</p>
        {change != null && (
          <p className="text-[10px] font-numeric" style={{ color: change >= 0 ? (isDark ? '#34C759' : '#28A745') : (isDark ? '#FF453A' : '#DC3545') }}>
            {change >= 0 ? '+' : ''}{change} from yesterday
          </p>
        )}
      </div>

      {/* Mini sparkline from history */}
      {data.history?.length > 2 && (
        <div className="flex items-end gap-px h-8 ml-auto">
          {data.history.slice(0, 7).reverse().map((h: any, i: number) => {
            const v = h.value || 0;
            return (
              <div key={i} className="w-2 rounded-sm" style={{
                height: `${Math.max(12, v)}%`,
                background: i === data.history.slice(0, 7).length - 1 ? getColor(v) : `${getColor(v)}40`,
              }} />
            );
          })}
        </div>
      )}
    </div>
  );
}
