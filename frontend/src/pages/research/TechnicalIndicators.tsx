import { Activity } from 'lucide-react';
import Section from './Section';
import { formatCurrency } from '../../lib/format';
import type { ResearchTheme } from './types';

interface TechnicalIndicatorsProps {
  technicals: any;
  price: number;
  theme: ResearchTheme;
}

export default function TechnicalIndicators({ technicals, price, theme }: TechnicalIndicatorsProps) {
  const { isDark, gold, textMuted, surface, border, greenColor, redColor } = theme;

  return (
    <Section title="Technical indicators" icon={Activity} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {/* RSI */}
        {technicals.rsi?.value != null && (
          <div className="rounded-lg p-4" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-body uppercase tracking-wider" style={{ color: textMuted }}>RSI (14)</span>
              <span className="text-[10px] font-body px-2 py-0.5 rounded-full" style={{
                background: technicals.rsi.signal === 'overbought' ? `${redColor}12` : technicals.rsi.signal === 'oversold' ? `${greenColor}12` : `${gold}12`,
                color: technicals.rsi.signal === 'overbought' ? redColor : technicals.rsi.signal === 'oversold' ? greenColor : gold,
              }}>
                {technicals.rsi.signal}
              </span>
            </div>
            <p className="text-2xl font-numeric font-medium">{technicals.rsi.value.toFixed(1)}</p>
            <div className="mt-2 h-2 rounded-full overflow-hidden" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }}>
              <div className="h-full rounded-full transition-all" style={{
                width: `${Math.min(100, technicals.rsi.value)}%`,
                background: technicals.rsi.value > 70 ? redColor : technicals.rsi.value < 30 ? greenColor : gold,
              }} />
            </div>
            <div className="flex justify-between mt-1">
              <span className="text-[8px] font-numeric" style={{ color: greenColor }}>30</span>
              <span className="text-[8px] font-numeric" style={{ color: redColor }}>70</span>
            </div>
          </div>
        )}

        {/* MACD */}
        {technicals.macd?.value != null && (
          <div className="rounded-lg p-4" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-[10px] font-body uppercase tracking-wider" style={{ color: textMuted }}>MACD</span>
              {technicals.macd.signal && (
                <span className="text-[10px] font-body px-2 py-0.5 rounded-full" style={{
                  background: technicals.macd.signal === 'bullish' ? `${greenColor}12` : `${redColor}12`,
                  color: technicals.macd.signal === 'bullish' ? greenColor : redColor,
                }}>
                  {technicals.macd.signal}
                </span>
              )}
            </div>
            <p className="text-xl font-numeric font-medium">{technicals.macd.value.toFixed(3)}</p>
            <div className="mt-1.5 space-y-0.5">
              <div className="flex justify-between text-[9px] font-body" style={{ color: textMuted }}>
                <span>Signal</span>
                <span className="font-numeric">{technicals.macd.signal_line?.toFixed(3) ?? '—'}</span>
              </div>
              <div className="flex justify-between text-[9px] font-body" style={{ color: textMuted }}>
                <span>Histogram</span>
                <span className="font-numeric" style={{
                  color: (technicals.macd.histogram || 0) >= 0 ? greenColor : redColor,
                }}>{technicals.macd.histogram?.toFixed(3) ?? '—'}</span>
              </div>
            </div>
          </div>
        )}

        {/* Bollinger Bands */}
        {technicals.bollinger_bands?.upper != null && (
          <div className="rounded-lg p-4" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
            <span className="text-[10px] font-body uppercase tracking-wider" style={{ color: textMuted }}>Bollinger Bands (20)</span>
            <div className="mt-3 space-y-1.5">
              <div className="flex justify-between text-xs font-body">
                <span style={{ color: textMuted }}>Upper</span>
                <span className="font-numeric">{formatCurrency(technicals.bollinger_bands.upper)}</span>
              </div>
              <div className="flex justify-between text-xs font-body">
                <span style={{ color: gold }}>Middle</span>
                <span className="font-numeric font-medium" style={{ color: gold }}>{formatCurrency(technicals.bollinger_bands.middle)}</span>
              </div>
              <div className="flex justify-between text-xs font-body">
                <span style={{ color: textMuted }}>Lower</span>
                <span className="font-numeric">{formatCurrency(technicals.bollinger_bands.lower)}</span>
              </div>
            </div>
            {price > 0 && (
              <p className="text-[9px] font-body mt-2" style={{
                color: price > technicals.bollinger_bands.upper ? redColor : price < technicals.bollinger_bands.lower ? greenColor : textMuted,
              }}>
                Price is {price > technicals.bollinger_bands.upper ? 'above upper band' : price < technicals.bollinger_bands.lower ? 'below lower band' : 'within bands'}
              </p>
            )}
          </div>
        )}
      </div>
      <p className="text-[9px] font-body mt-3" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
        Technical data from Alpha Vantage. Indicators are lagging and should not be used as sole decision criteria.
      </p>
    </Section>
  );
}
