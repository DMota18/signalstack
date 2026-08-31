import { Activity } from 'lucide-react';
import { formatCompactCurrency } from '../../lib/format';
import type { ResearchTheme } from './types';

interface PolymarketBetsProps {
  ticker: string;
  polymarket: any;
  theme: ResearchTheme;
}

export default function PolymarketBets({ ticker, polymarket, theme }: PolymarketBetsProps) {
  const { isDark, gold, textMuted } = theme;

  const tickerMarkets = polymarket.markets.filter((m: any) => !m.is_macro);
  const macroMarkets = polymarket.markets.filter((m: any) => m.is_macro);
  const pmGreen = isDark ? '#34C759' : '#28A745';
  const pmRed = isDark ? '#FF453A' : '#DC3545';

  const renderMarketCard = (item: any, i: number) => {
    const title = item.question || item.event_title || '';
    const vol = item.total_volume || item.volume_24h || 0;
    const volStr = formatCompactCurrency(vol);
    const endDate = item.end_date ? new Date(item.end_date) : null;
    const daysLeft = endDate ? Math.max(0, Math.ceil((endDate.getTime() - Date.now()) / 86400000)) : null;
    const pct = item.yes_price != null ? Math.round(item.yes_price * 100) : null;

    return (
      <a key={`${item.question}-${i}`} href={item.polymarket_url || '#'} target="_blank" rel="noopener noreferrer"
        className="block rounded-xl p-4 no-underline transition-all hover:scale-[1.01]"
        style={{ background: isDark ? '#151517' : '#FFFFFF', border: `0.5px solid ${isDark ? '#1A1A1D' : '#E8E6E1'}` }}>
        {item.is_macro && (
          <span className="text-[9px] font-body px-1.5 py-0.5 rounded mb-2 inline-block"
            style={{ background: isDark ? '#D4A84312' : '#D4A84310', color: gold }}>Macro</span>
        )}
        <p className="text-xs font-body font-semibold leading-snug mb-3">{title}</p>
        {pct != null && (
          <>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-lg font-numeric font-semibold tabular-nums" style={{ color: '#818CF8' }}>
                {pct}%
              </span>
              <div className="flex gap-1.5">
                <span className="text-[10px] font-body font-semibold px-2.5 py-0.5 rounded"
                  style={{ background: `${pmGreen}15`, color: pmGreen }}>Yes</span>
                <span className="text-[10px] font-body font-semibold px-2.5 py-0.5 rounded"
                  style={{ background: `${pmRed}15`, color: pmRed }}>No</span>
              </div>
            </div>
            <div className="w-full h-2 rounded-full overflow-hidden mb-3" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }}>
              <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, background: pct >= 50 ? pmGreen : pmRed }} />
            </div>
          </>
        )}
        <div className="flex items-center gap-3 text-[10px] font-body" style={{ color: textMuted }}>
          {vol > 0 && <span className="font-numeric tabular-nums">{volStr} volume</span>}
          {daysLeft != null && <span>{daysLeft}d remaining</span>}
        </div>
      </a>
    );
  };

  return (
    <div className="rounded-xl overflow-hidden" style={{
      background: isDark ? '#0F1115' : '#F8F7FF',
      border: `1px solid ${isDark ? '#1E2030' : '#D8D4F0'}`,
    }}>
      <div className="px-5 py-4 flex items-center justify-between" style={{
        borderBottom: `0.5px solid ${isDark ? '#1E2030' : '#D8D4F0'}`,
      }}>
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md flex items-center justify-center" style={{ background: isDark ? '#6366F115' : '#6366F110' }}>
            <Activity size={14} style={{ color: '#818CF8' }} />
          </div>
          <div>
            <span className="text-sm font-body font-medium">What the market is betting</span>
            <span className="text-[10px] font-body ml-2" style={{ color: textMuted }}>Polymarket</span>
          </div>
        </div>
        <span className="text-[10px] font-body px-2 py-0.5 rounded-full" style={{
          background: isDark ? '#818CF815' : '#818CF810',
          color: '#818CF8',
        }}>
          {polymarket.markets.length} market{polymarket.markets.length !== 1 ? 's' : ''}
        </span>
      </div>
      <div className="p-5 space-y-4">
        {/* Ticker-specific markets */}
        {tickerMarkets.length > 0 && (
          <div>
            <p className="text-[11px] font-body font-medium mb-2" style={{ color: '#818CF8' }}>
              {ticker} markets
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {tickerMarkets.map(renderMarketCard)}
            </div>
          </div>
        )}
        {/* Macro markets */}
        {macroMarkets.length > 0 && (
          <div>
            <p className="text-[11px] font-body font-medium mb-2" style={{ color: gold }}>
              Macro bets affecting {ticker}
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {macroMarkets.map(renderMarketCard)}
            </div>
          </div>
        )}
        <p className="text-[10px] font-body mt-1" style={{ color: textMuted }}>
          Real-money probabilities from Polymarket. Prices reflect market consensus, not editorial opinion.
        </p>
      </div>
    </div>
  );
}
