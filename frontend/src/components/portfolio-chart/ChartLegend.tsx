import { formatCurrency, formatPercent } from '../../lib/format';
import { fmtPrice } from './format';
import type { ChartMode, ChartTheme, CrosshairInfo, HoldingStats, PortfolioMetrics } from './types';

interface ChartLegendProps {
  crosshairInfo: CrosshairInfo | null;
  chartMode: ChartMode;
  displayValue: number;
  displayChange: number;
  displayPct: number;
  holdingStats: HoldingStats | null;
  portfolioMetrics: PortfolioMetrics | null;
  positionsCount: number;
  theme: ChartTheme;
}

export default function ChartLegend({
  crosshairInfo, chartMode, displayValue, displayChange, displayPct,
  holdingStats, portfolioMetrics, positionsCount, theme,
}: ChartLegendProps) {
  const { textPrimary, textMuted, textSecondary, inputBg, greenColor, redColor } = theme;

  return (
    <div className="px-4 pt-4 pb-2">
      <div className="flex flex-col lg:flex-row lg:items-start justify-between gap-2">
        {/* Left: Price + Change */}
        <div>
          <div className="flex items-center gap-3">
            <span className="font-numeric text-2xl font-medium" style={{ color: textPrimary }}>
              {formatCurrency(displayValue)}
            </span>
            <span className="text-sm font-numeric" style={{ color: displayChange >= 0 ? greenColor : redColor }}>
              {displayChange >= 0 ? '+' : ''}{fmtPrice(Math.abs(displayChange))}
              {' '}({formatPercent(displayPct, { signed: true })})
            </span>
            {crosshairInfo?.time && (
              <span className="text-[10px] font-mono" style={{ color: textMuted }}>{crosshairInfo.time}</span>
            )}
          </div>

          {/* OHLC on crosshair */}
          {crosshairInfo && (chartMode === 'candle' || chartMode === 'heikin_ashi') && crosshairInfo.open != null && (
            <div className="flex gap-3 mt-1">
              <span className="text-[10px] font-mono" style={{ color: textMuted }}>
                O <span style={{ color: textSecondary }}>{fmtPrice(crosshairInfo.open)}</span>
              </span>
              <span className="text-[10px] font-mono" style={{ color: textMuted }}>
                H <span style={{ color: greenColor }}>{fmtPrice(crosshairInfo.high!)}</span>
              </span>
              <span className="text-[10px] font-mono" style={{ color: textMuted }}>
                L <span style={{ color: redColor }}>{fmtPrice(crosshairInfo.low!)}</span>
              </span>
              <span className="text-[10px] font-mono" style={{ color: textMuted }}>
                C <span style={{ color: textSecondary }}>{fmtPrice(crosshairInfo.close!)}</span>
              </span>
            </div>
          )}

          {/* Period return + daily change on crosshair */}
          {crosshairInfo && (
            <div className="flex gap-3 mt-0.5 flex-wrap">
              {crosshairInfo.periodReturn != null && (
                <span className="text-[9px] font-mono" style={{ color: crosshairInfo.periodReturn >= 0 ? greenColor : redColor }}>
                  Period {formatPercent(crosshairInfo.periodReturn, { signed: true })}
                </span>
              )}
              {crosshairInfo.dailyChange != null && (
                <span className="text-[9px] font-mono" style={{ color: crosshairInfo.dailyChange >= 0 ? greenColor : redColor }}>
                  Chg {formatPercent(crosshairInfo.dailyChange, { signed: true })}
                </span>
              )}
              {crosshairInfo.volume != null && (
                <span className="text-[9px] font-mono" style={{ color: textMuted }}>
                  {'Δ'}% {crosshairInfo.volume.toFixed(2)}
                </span>
              )}
            </div>
          )}

          {/* Indicator values on crosshair */}
          <div className="flex gap-3 mt-0.5 flex-wrap">
            {crosshairInfo?.sma20 != null && (
              <span className="text-[9px] font-mono" style={{ color: '#5AC8FA' }}>SMA20 {fmtPrice(crosshairInfo.sma20)}</span>
            )}
            {crosshairInfo?.ema50 != null && (
              <span className="text-[9px] font-mono" style={{ color: '#AF52DE' }}>EMA50 {fmtPrice(crosshairInfo.ema50)}</span>
            )}
            {crosshairInfo?.bbUpper != null && (
              <span className="text-[9px] font-mono" style={{ color: '#FF9500' }}>BB {fmtPrice(crosshairInfo.bbLower!)}–{fmtPrice(crosshairInfo.bbUpper)}</span>
            )}
            {crosshairInfo?.rsi != null && (
              <span className="text-[9px] font-mono" style={{ color: '#FFD60A' }}>RSI {crosshairInfo.rsi.toFixed(1)}</span>
            )}
          </div>
        </div>

        {/* Right: Stats badges */}
        {holdingStats && (
          <div className="flex gap-1.5 flex-wrap">
            <div className="px-2 py-1 rounded" style={{ background: inputBg }}>
              <p className="text-[7px] font-mono uppercase tracking-wider" style={{ color: textMuted }}>Day P&L</p>
              <p className="text-[11px] font-numeric font-medium" style={{ color: holdingStats.totalDayChange >= 0 ? greenColor : redColor }}>
                {(holdingStats.totalDayChange >= 0 ? '+' : '-') + formatCurrency(Math.abs(holdingStats.totalDayChange), 0)}
              </p>
            </div>
            <div className="px-2 py-1 rounded" style={{ background: inputBg }}>
              <p className="text-[7px] font-mono uppercase tracking-wider" style={{ color: textMuted }}>High</p>
              <p className="text-[11px] font-numeric" style={{ color: greenColor }}>{formatCurrency(holdingStats.high)}</p>
            </div>
            <div className="px-2 py-1 rounded" style={{ background: inputBg }}>
              <p className="text-[7px] font-mono uppercase tracking-wider" style={{ color: textMuted }}>Low</p>
              <p className="text-[11px] font-numeric" style={{ color: redColor }}>{formatCurrency(holdingStats.low)}</p>
            </div>
            <div className="px-2 py-1 rounded" style={{ background: inputBg }}>
              <p className="text-[7px] font-mono uppercase tracking-wider" style={{ color: textMuted }}>Positions</p>
              <p className="text-[11px] font-numeric" style={{ color: textSecondary }}>{positionsCount}</p>
            </div>
            {portfolioMetrics && (
              <>
                <div className="px-2 py-1 rounded" style={{ background: inputBg }}>
                  <p className="text-[7px] font-mono uppercase tracking-wider" style={{ color: textMuted }}>Max DD</p>
                  <p className="text-[11px] font-numeric" style={{ color: redColor }}>-{formatPercent(portfolioMetrics.maxDrawdown * 100)}</p>
                </div>
                <div className="px-2 py-1 rounded" style={{ background: inputBg }}>
                  <p className="text-[7px] font-mono uppercase tracking-wider" style={{ color: textMuted }}>Vol</p>
                  <p className="text-[11px] font-numeric" style={{ color: textSecondary }}>{formatPercent(portfolioMetrics.volatility * 100)}</p>
                </div>
                <div className="px-2 py-1 rounded" style={{ background: inputBg }}>
                  <p className="text-[7px] font-mono uppercase tracking-wider" style={{ color: textMuted }}>Sharpe</p>
                  <p className="text-[11px] font-numeric" style={{ color: portfolioMetrics.sharpe >= 0 ? greenColor : redColor }}>{portfolioMetrics.sharpe.toFixed(2)}</p>
                </div>
                <div className="px-2 py-1 rounded" style={{ background: inputBg }}>
                  <p className="text-[7px] font-mono uppercase tracking-wider" style={{ color: textMuted }}>Ann. Ret</p>
                  <p className="text-[11px] font-numeric" style={{ color: portfolioMetrics.annualizedReturn >= 0 ? greenColor : redColor }}>{formatPercent(portfolioMetrics.annualizedReturn * 100, { signed: true })}</p>
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
