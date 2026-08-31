import { Target } from 'lucide-react';
import Section from './Section';
import { fmtPrice } from './format';
import { formatPercent } from '../../lib/format';
import type { ResearchTheme } from './types';

interface AnalystOutlookProps {
  analyst: any;
  price: number;
  theme: ResearchTheme;
}

export default function AnalystOutlook({ analyst, price, theme }: AnalystOutlookProps) {
  const { isDark, gold, textMuted, surface, border, greenColor, redColor } = theme;

  return (
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
  );
}
