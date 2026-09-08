import { TrendingUp, TrendingDown } from 'lucide-react';
import ShareButton from './ShareButton';
import { fmtPrice } from './format';
import { formatPercent } from '../../lib/format';
import type { ResearchTheme } from './types';

interface ResearchHeaderProps {
  ticker: string;
  profile: any;
  price: number;
  dayChange: number;
  dayChangePct: number;
  isUp: boolean;
  theme: ResearchTheme;
}

export default function ResearchHeader({ ticker, profile, price, dayChange, dayChangePct, isUp, theme }: ResearchHeaderProps) {
  const { isDark, gold, textMuted, textSecondary, greenColor, redColor } = theme;

  return (
    <div>
      <div className="flex items-center justify-between mb-1">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-body px-2 py-0.5 rounded" style={{ background: `${gold}12`, color: gold }}>
            {profile.sector || profile.industry || 'Equity'}
          </span>
          {profile.exchange && (
            <span className="text-[10px] font-body" style={{ color: textMuted }}>{profile.exchange}</span>
          )}
        </div>
        <ShareButton ticker={ticker} price={price} dayChangePct={dayChangePct} isDark={isDark} gold={gold} textMuted={textMuted} />
      </div>
      <div className="flex items-baseline gap-3">
        <h1 className="font-display text-3xl">{ticker}</h1>
        <span className="text-sm font-body" style={{ color: textSecondary }}>{profile.name}</span>
      </div>
      <div className="flex items-baseline gap-3 mt-1">
        <span className="font-numeric text-2xl">{fmtPrice(price)}</span>
        <span className="font-numeric text-sm" style={{ color: isUp ? greenColor : redColor }}>
          {isUp ? '+' : ''}{dayChange.toFixed(2)} ({formatPercent(dayChangePct, { signed: true })})
        </span>
        {isUp ? <TrendingUp size={16} style={{ color: greenColor }} /> : <TrendingDown size={16} style={{ color: redColor }} />}
      </div>
    </div>
  );
}
