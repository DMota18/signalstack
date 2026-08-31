import { useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { formatCurrency, formatPercent } from '../lib/format';
import { Loader2, Sparkles } from 'lucide-react';

interface FairValueGaugeProps {
  ticker: string;
  currentPrice: number;
  financials: any;
  fundamentals: any;
}

/**
 * FairValueGauge — DCF/intrinsic value estimate with visual gauge.
 * Calls /valuation/fair-value with financial data, shows result inline.
 */
export default function FairValueGauge({ ticker, currentPrice, financials, fundamentals }: FairValueGaugeProps) {
  const { isDark } = useTheme();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  const compute = async () => {
    setLoading(true);
    setError(null);
    const res = await api.getFairValue(ticker, currentPrice, financials, fundamentals);
    if (res.status === 'ok' && res.data) {
      setData(res.data);
    } else {
      setError(res.error?.message || 'Failed to compute fair value');
    }
    setLoading(false);
  };

  // Not yet computed — show trigger button
  if (!data && !loading && !error) {
    return (
      <button onClick={compute}
        className="w-full flex items-center justify-center gap-2 py-3 rounded-lg text-sm font-body transition-all hover:scale-[1.005]"
        style={{ background: `${gold}08`, border: `0.5px solid ${gold}20`, color: gold }}>
        <Sparkles size={14} aria-hidden="true" /> Estimate fair value
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 py-6">
        <Loader2 size={16} className="animate-spin" style={{ color: gold }} />
        <span className="text-sm font-body" style={{ color: textMuted }}>Computing intrinsic value...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-4">
        <p className="text-xs font-body mb-2" style={{ color: redColor }}>{error}</p>
        <button onClick={compute} className="text-xs font-body" style={{ color: gold }}>Retry</button>
      </div>
    );
  }

  if (!data) return null;

  const mid = data.fair_value_mid || 0;
  const low = data.fair_value_low || 0;
  const high = data.fair_value_high || 0;
  const upside = data.upside_pct || 0;
  const status = data.valuation_status || 'fairly_valued';
  const statusColor = status === 'undervalued' ? greenColor : status === 'overvalued' ? redColor : gold;
  const statusLabel = status === 'undervalued' ? 'Undervalued' : status === 'overvalued' ? 'Overvalued' : 'Fairly valued';

  // Gauge visualization: position current price within the low-high range
  const rangeSpan = high - low;
  const pricePosition = rangeSpan > 0 ? Math.max(0, Math.min(100, ((currentPrice - low) / rangeSpan) * 100)) : 50;
  const midPosition = rangeSpan > 0 ? Math.max(0, Math.min(100, ((mid - low) / rangeSpan) * 100)) : 50;

  return (
    <div className="space-y-4">
      {/* Main result */}
      <div className="flex items-center justify-between">
        <div>
          <p className="text-[10px] font-body uppercase tracking-wider mb-0.5" style={{ color: textMuted }}>Fair value estimate</p>
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-numeric font-medium" style={{ color: gold }}>
              {formatCurrency(mid)}
            </span>
            <span className="text-sm font-numeric" style={{ color: statusColor }}>
              {formatPercent(upside, { signed: true })} {statusLabel.toLowerCase()}
            </span>
          </div>
        </div>
        <div className="text-right">
          <span className="text-[10px] font-body px-2 py-0.5 rounded-full"
            style={{ background: `${statusColor}12`, color: statusColor }}>
            {statusLabel}
          </span>
          {data.confidence && (
            <p className="text-[9px] font-body mt-1" style={{ color: textMuted }}>
              {data.confidence} confidence
            </p>
          )}
        </div>
      </div>

      {/* Range gauge */}
      <div>
        <div className="relative h-3 rounded-full overflow-hidden"
          style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }}>
          {/* Green zone (undervalued) */}
          <div className="absolute h-full rounded-full" style={{
            left: 0, width: `${midPosition}%`,
            background: `linear-gradient(90deg, ${greenColor}40, ${greenColor}15)`,
          }} />
          {/* Red zone (overvalued) */}
          <div className="absolute h-full rounded-full" style={{
            left: `${midPosition}%`, right: 0,
            background: `linear-gradient(90deg, ${redColor}15, ${redColor}40)`,
          }} />
          {/* Fair value marker */}
          <div className="absolute top-0 h-full w-0.5" style={{
            left: `${midPosition}%`, background: gold,
          }} />
          {/* Current price marker */}
          <div className="absolute top-[-2px]" style={{ left: `${pricePosition}%`, transform: 'translateX(-50%)' }}>
            <div className="w-4 h-4 rounded-full border-2" style={{
              background: surface, borderColor: statusColor,
            }} />
          </div>
        </div>
        <div className="flex justify-between mt-1">
          <span className="text-[9px] font-numeric" style={{ color: textMuted }}>{formatCurrency(low, 0)}</span>
          <span className="text-[9px] font-numeric" style={{ color: gold }}>Fair: {formatCurrency(mid, 0)}</span>
          <span className="text-[9px] font-numeric" style={{ color: textMuted }}>{formatCurrency(high, 0)}</span>
        </div>
      </div>

      {/* Bull/bear cases */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        {data.bull_case && (
          <div className="rounded-lg p-3" style={{ background: `${greenColor}06`, borderLeft: `2px solid ${greenColor}` }}>
            <p className="text-[10px] font-body font-medium mb-1" style={{ color: greenColor }}>Bull case</p>
            <p className="text-xs font-body leading-relaxed" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>{data.bull_case}</p>
          </div>
        )}
        {data.bear_case && (
          <div className="rounded-lg p-3" style={{ background: `${redColor}06`, borderLeft: `2px solid ${redColor}` }}>
            <p className="text-[10px] font-body font-medium mb-1" style={{ color: redColor }}>Bear case</p>
            <p className="text-xs font-body leading-relaxed" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>{data.bear_case}</p>
          </div>
        )}
      </div>

      {/* Methodology + assumptions */}
      {data.methodology && (
        <p className="text-[10px] font-body" style={{ color: textMuted }}>
          <span style={{ color: gold }}>Method:</span> {data.methodology}
        </p>
      )}
      {data.key_assumptions?.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {data.key_assumptions.map((a: string, i: number) => (
            <span key={i} className="text-[9px] font-body px-2 py-0.5 rounded"
              style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
              {a}
            </span>
          ))}
        </div>
      )}

      <p className="text-[9px] font-body" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
        Estimated using simplified DCF + comparable analysis. Educational only, not investment advice.
      </p>
    </div>
  );
}
