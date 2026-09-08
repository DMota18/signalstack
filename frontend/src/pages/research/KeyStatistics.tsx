import { BarChart3 } from 'lucide-react';
import Section from './Section';
import { fmtPrice, fmtLargeNum, fmtPct, fmtRatio, fmtVol } from './format';
import { formatCurrency, formatPercent } from '../../lib/format';
import type { ResearchTheme } from './types';

// ─── Stat row (two-column key/value grid item) ──────────────────────────

interface StatRowProps {
  label: string;
  value: string;
  isDark: boolean;
}

function StatRow({ label, value, isDark }: StatRowProps) {
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  return (
    <div className="flex items-center justify-between py-2" style={{ borderBottom: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
      <span className="text-xs font-body" style={{ color: textMuted }}>{label}</span>
      <span className="text-xs font-numeric font-medium">{value}</span>
    </div>
  );
}

interface KeyStatisticsProps {
  quote: any;
  fund: any;
  theme: ResearchTheme;
}

export default function KeyStatistics({ quote, fund, theme }: KeyStatisticsProps) {
  const { isDark, gold, surface, border } = theme;

  return (
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
  );
}
