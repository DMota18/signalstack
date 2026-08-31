import { Users } from 'lucide-react';
import Section from './Section';
import { fmtLargeNum } from './format';
import { formatNumber } from '../../lib/format';
import type { ResearchTheme } from './types';

interface InsiderActivityProps {
  insider: any;
  theme: ResearchTheme;
}

export default function InsiderActivity({ insider, theme }: InsiderActivityProps) {
  const { isDark, gold, textMuted, surface, border, greenColor, redColor } = theme;

  return (
    <Section title="Insider activity" icon={Users} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
      {/* Summary */}
      {insider.summary && (
        <div className="flex gap-4 mb-4 flex-wrap">
          <div className="text-center px-4 py-2 rounded-lg" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
            <p className="text-lg font-numeric font-medium" style={{ color: greenColor }}>
              {insider.summary.open_market_buys || 0}
            </p>
            <p className="text-[10px] font-body" style={{ color: textMuted }}>Buys (90d)</p>
          </div>
          <div className="text-center px-4 py-2 rounded-lg" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
            <p className="text-lg font-numeric font-medium" style={{ color: redColor }}>
              {insider.summary.open_market_sells || 0}
            </p>
            <p className="text-[10px] font-body" style={{ color: textMuted }}>Sells (90d)</p>
          </div>
          {insider.summary.net_buy_value != null && (
            <div className="text-center px-4 py-2 rounded-lg" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
              <p className="text-lg font-numeric font-medium" style={{
                color: insider.summary.net_buy_value >= 0 ? greenColor : redColor,
              }}>
                {fmtLargeNum(Math.abs(insider.summary.net_buy_value))}
              </p>
              <p className="text-[10px] font-body" style={{ color: textMuted }}>
                Net {insider.summary.net_buy_value >= 0 ? 'buying' : 'selling'}
              </p>
            </div>
          )}
        </div>
      )}

      {/* Trade list */}
      <div className="space-y-2">
        {insider.trades.slice(0, 8).map((trade: any, i: number) => (
          <div key={i} className="flex items-center justify-between py-2"
            style={{ borderBottom: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
            <div>
              <p className="text-xs font-body font-medium">{trade.name}</p>
              <p className="text-[10px] font-body" style={{ color: textMuted }}>
                {trade.title} — {trade.transaction_type}
              </p>
            </div>
            <div className="text-right">
              <p className="text-xs font-numeric" style={{
                color: trade.transaction_code === 'P' ? greenColor : trade.transaction_code === 'S' ? redColor : textMuted,
              }}>
                {trade.shares != null ? formatNumber(trade.shares) : ''} shares
              </p>
              <p className="text-[10px] font-body" style={{ color: textMuted }}>
                {trade.transaction_date || trade.filing_date}
              </p>
            </div>
          </div>
        ))}
      </div>
    </Section>
  );
}
