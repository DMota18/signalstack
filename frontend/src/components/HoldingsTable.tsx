import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { getLogoUrl, getBrandColor } from '../lib/brandColors';
import { formatCurrency, formatPercent, formatNumber } from '../lib/format';

type ChangeMode = 'unrealized' | 'day' | 'weight';

export default function HoldingsTable({ holdings, onRemove: _onRemove }: { holdings: any[]; onRemove?: (ticker: string) => void }) {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [changeMode, setChangeMode] = useState<ChangeMode>('day');

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const rowBorder = isDark ? '#1A1A1D' : '#F0EEE8';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  const getChangePct = (h: any): number => {
    if (changeMode === 'unrealized') {
      const cost = h.avg_cost_basis || 0;
      const price = h.current_price || 0;
      if (cost > 0 && price > 0) return ((price - cost) / cost) * 100;
      return h.total_gain_pct || 0;
    }
    if (changeMode === 'day') return h.day_gain_pct || 0;
    return h.pct_of_portfolio || 0;
  };

  const getChangeVal = (h: any): number => {
    if (changeMode === 'unrealized') {
      const cost = h.avg_cost_basis || 0;
      const price = h.current_price || 0;
      if (cost > 0 && price > 0) return (price - cost) * (h.quantity || 0);
      return h.total_gain_value || 0;
    }
    if (changeMode === 'day') return h.day_gain_value || 0;
    return 0;
  };

  const modes: { value: ChangeMode; label: string }[] = [
    { value: 'day', label: '1D' },
    { value: 'unrealized', label: 'Total' },
    { value: 'weight', label: 'Weight' },
  ];

  return (
    <div>
      {/* Toggle */}
      <div className="flex gap-1 mb-2">
        {modes.map((m) => (
          <button key={m.value} onClick={() => setChangeMode(m.value)} aria-pressed={changeMode === m.value}
            className="text-[10px] font-body px-2 py-0.5 rounded transition-colors"
            style={{
              background: changeMode === m.value ? `${gold}15` : 'transparent',
              color: changeMode === m.value ? gold : textMuted,
            }}>
            {m.label}
          </button>
        ))}
      </div>

      {/* Header row — desktop */}
      <div className="hidden lg:grid items-center py-1.5 text-[10px] font-body"
        style={{ color: textMuted, gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr' }}>
        <span>Holding</span>
        <span className="text-right">Price</span>
        <span className="text-right">{changeMode === 'day' ? '1D change' : changeMode === 'unrealized' ? 'Total P&L' : 'Weight'}</span>
        <span className="text-right">Value</span>
        <span className="text-right">Shares</span>
        <span className="text-right">Signal</span>
      </div>

      {/* Rows */}
      {holdings.map((h, i) => {
        const pct = getChangePct(h);
        const val = getChangeVal(h);
        const marketValue = h.market_value || (h.quantity || 0) * (h.current_price || 0);
        const logoUrl = getLogoUrl(h.ticker || '');
        const brandColor = getBrandColor(h.ticker || '', gold);
        const isWeight = changeMode === 'weight';
        const changeColor = isWeight ? gold : pct === 0 ? textMuted : pct > 0 ? greenColor : redColor;

        const gain = h.total_gain_pct || h.day_gain_pct || 0;
        const signalLabel = gain > 10 ? 'Bullish' : gain < -10 ? 'Bearish' : Math.abs(gain) > 3 ? 'Mixed' : 'Neutral';
        const signalColor = gain > 10 ? greenColor : gain < -10 ? redColor : Math.abs(gain) > 3 ? gold : textMuted;

        return (
          <div key={h.ticker || i}
            onClick={() => h.ticker && navigate(`/app/research/${h.ticker}`)}
            className="grid items-center py-2.5 cursor-pointer hover:opacity-80 transition-opacity"
            style={{
              borderBottom: `0.5px solid ${rowBorder}`,
              gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
            }}>

            {/* Col 1: Logo + Ticker + Name */}
            <div className="flex items-center gap-2.5 min-w-0 pr-2">
              <img src={logoUrl} alt={h.ticker}
                className="w-8 h-8 rounded-lg object-contain shrink-0"
                style={{ background: isDark ? '#1A1A1D' : '#F0EEE8' }}
                onError={(e) => {
                  const el = e.currentTarget;
                  const parent = el.parentElement;
                  if (parent) {
                    const fb = document.createElement('div');
                    fb.className = 'w-8 h-8 rounded-lg flex items-center justify-center text-[11px] font-body font-semibold shrink-0';
                    fb.style.background = `${brandColor}18`;
                    fb.style.color = brandColor;
                    fb.textContent = (h.ticker || '?')[0];
                    parent.replaceChild(fb, el);
                  }
                }}
              />
              <div className="min-w-0">
                <span className="text-sm font-body font-medium block leading-tight">{h.ticker}</span>
                <span className="text-[10px] font-body block truncate leading-tight" style={{ color: textMuted }}>
                  {h.security_name || ''}
                </span>
              </div>
            </div>

            {/* Col 2: Price */}
            <div className="text-right">
              <span className="text-sm font-numeric font-semibold tabular-nums tracking-tight">
                {formatCurrency(h.current_price || 0)}
              </span>
            </div>

            {/* Col 3: Change */}
            <div className="text-right flex items-center justify-end gap-1">
              {!isWeight && pct !== 0 && (
                <span className="text-[10px] shrink-0" style={{ color: changeColor }}>
                  {pct > 0 ? '▲' : '▼'}
                </span>
              )}
              <div>
                <span className="text-xs font-numeric font-semibold tabular-nums block leading-tight" style={{ color: changeColor }}>
                  {isWeight ? formatPercent(pct) : formatPercent(pct, { signed: true })}
                </span>
                {!isWeight && val !== 0 && (
                  <span className="text-[10px] font-numeric tabular-nums block leading-tight" style={{ color: changeColor, opacity: 0.65 }}>
                    {(val >= 0 ? '+' : '-') + formatCurrency(Math.abs(val), 0)}
                  </span>
                )}
              </div>
            </div>

            {/* Col 4: Market Value */}
            <div className="text-right">
              <span className="text-xs font-numeric font-medium tabular-nums" style={{ color: textMuted }}>
                {formatCurrency(marketValue, 0)}
              </span>
            </div>

            {/* Col 5: Shares — hidden on mobile */}
            <div className="text-right hidden lg:block">
              <span className="text-xs font-numeric tabular-nums" style={{ color: textMuted }}>
                {formatNumber(h.quantity || 0, 4)}
              </span>
            </div>

            {/* Col 6: Signal — hidden on mobile */}
            <div className="text-right hidden lg:block">
              <span className="text-[10px] font-body px-2 py-0.5 rounded-full"
                style={{ background: `${signalColor}12`, color: signalColor }}>
                {signalLabel}
              </span>
            </div>
          </div>
        );
      })}

      {holdings.length === 0 && (
        <p className="text-sm font-body py-8 text-center" style={{ color: textMuted }}>
          No holdings synced yet.
        </p>
      )}
    </div>
  );
}
