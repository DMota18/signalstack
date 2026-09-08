import {
  CandlestickChart, BarChart3, Activity, LineChart,
  Maximize2, Minimize2,
} from 'lucide-react';
import type { ChartMode, ChartTheme, Indicator, Timeframe, ViewMode } from './types';

interface ChartToolbarProps {
  timeframe: Timeframe;
  onTimeframeChange: (tf: Timeframe) => void;
  chartMode: ChartMode;
  onChartModeChange: (mode: ChartMode) => void;
  indicators: Indicator[];
  onToggleIndicator: (key: string) => void;
  showRSI: boolean;
  onToggleRSI: () => void;
  logScale: boolean;
  onToggleLogScale: () => void;
  viewMode: ViewMode;
  onViewModeChange: (v: ViewMode) => void;
  expanded: boolean;
  onToggleExpanded: () => void;
  customStart: string;
  onCustomStartChange: (v: string) => void;
  customEnd: string;
  onCustomEndChange: (v: string) => void;
  theme: ChartTheme;
}

export default function ChartToolbar({
  timeframe, onTimeframeChange, chartMode, onChartModeChange,
  indicators, onToggleIndicator, showRSI, onToggleRSI,
  logScale, onToggleLogScale, viewMode, onViewModeChange,
  expanded, onToggleExpanded,
  customStart, onCustomStartChange, customEnd, onCustomEndChange,
  theme,
}: ChartToolbarProps) {
  const { gold, textPrimary, textMuted, border, inputBg, inputBorder } = theme;

  const timeframes: Timeframe[] = ['1D', '1W', '1M', '3M', 'YTD', '1Y', 'ALL', 'CUSTOM'];
  const chartModes: { mode: ChartMode; icon: any; tip: string }[] = [
    { mode: 'area', icon: Activity, tip: 'Area' },
    { mode: 'candle', icon: CandlestickChart, tip: 'Candle' },
    { mode: 'line', icon: LineChart, tip: 'Line' },
    { mode: 'heikin_ashi', icon: BarChart3, tip: 'Heikin-Ashi' },
  ];

  return (
    <>
      <div className="px-4 pb-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2">
        {/* Timeframes */}
        <div className="flex gap-0.5 flex-wrap">
          {timeframes.map((tf, i) => (
            <button key={tf} onClick={() => onTimeframeChange(tf)} aria-pressed={timeframe === tf}
              className="text-[10px] font-mono px-2 py-1 rounded transition-colors"
              title={i < 7 ? `Key: ${i + 1}` : ''}
              style={{ background: timeframe === tf ? `${gold}20` : 'transparent', color: timeframe === tf ? gold : textMuted }}>
              {tf}
            </button>
          ))}
        </div>

        {/* Right tools */}
        <div className="flex items-center gap-0.5 flex-wrap">
          {/* Chart modes */}
          {chartModes.map(({ mode, icon: Icon, tip }) => (
            <button key={mode} onClick={() => onChartModeChange(mode)} title={tip} aria-label={tip} aria-pressed={chartMode === mode}
              className="p-1.5 rounded transition-colors"
              style={{ background: chartMode === mode ? `${gold}15` : 'transparent', color: chartMode === mode ? gold : textMuted }}>
              <Icon size={13} aria-hidden="true" />
            </button>
          ))}

          <div className="w-px h-4 mx-1" style={{ background: border }} />

          {/* Indicators */}
          {indicators.map((ind) => (
            <button key={ind.key} onClick={() => onToggleIndicator(ind.key)} aria-pressed={ind.active}
              className="text-[9px] font-mono px-1.5 py-1 rounded transition-colors"
              style={{ background: ind.active ? `${ind.color}15` : 'transparent', color: ind.active ? ind.color : textMuted }}>
              {ind.label}
            </button>
          ))}

          <div className="w-px h-4 mx-1" style={{ background: border }} />

          {/* RSI */}
          <button onClick={onToggleRSI} title="RSI (R)" aria-pressed={showRSI}
            className="text-[9px] font-mono px-1.5 py-1 rounded transition-colors"
            style={{ background: showRSI ? '#FFD60A15' : 'transparent', color: showRSI ? '#FFD60A' : textMuted }}>
            RSI
          </button>

          {/* Log scale */}
          <button onClick={onToggleLogScale} title="Log scale (L)" aria-pressed={logScale}
            className="text-[9px] font-mono px-1.5 py-1 rounded transition-colors"
            style={{ background: logScale ? `${gold}15` : 'transparent', color: logScale ? gold : textMuted }}>
            LOG
          </button>

          {/* View mode */}
          {(['all', 'equities', 'crypto', 'etfs'] as ViewMode[]).map((v) => (
            <button key={v} onClick={() => onViewModeChange(v)} aria-pressed={viewMode === v}
              className="text-[9px] font-mono px-1.5 py-1 rounded transition-colors"
              style={{ background: viewMode === v ? `${gold}15` : 'transparent', color: viewMode === v ? gold : textMuted }}>
              {v === 'all' ? 'All' : v === 'equities' ? 'STK' : v === 'crypto' ? 'CRY' : 'ETF'}
            </button>
          ))}

          <div className="w-px h-4 mx-1" style={{ background: border }} />

          {/* Expand */}
          <button onClick={onToggleExpanded} title="Expand (F)" aria-label={expanded ? 'Collapse chart' : 'Expand chart'}
            className="p-1.5 rounded transition-colors"
            style={{ color: textMuted }}>
            {expanded ? <Minimize2 size={12} aria-hidden="true" /> : <Maximize2 size={12} aria-hidden="true" />}
          </button>
        </div>
      </div>

      {/* Custom date range */}
      {timeframe === 'CUSTOM' && (
        <div className="px-4 pb-2 flex items-center gap-2">
          <input type="date" value={customStart} onChange={(e) => onCustomStartChange(e.target.value)}
            aria-label="Custom range start date"
            className="text-[10px] font-mono px-2 py-1 rounded-md outline-none"
            style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: textPrimary }} />
          <span className="text-[10px] font-mono" style={{ color: textMuted }}>to</span>
          <input type="date" value={customEnd} onChange={(e) => onCustomEndChange(e.target.value)}
            aria-label="Custom range end date"
            className="text-[10px] font-mono px-2 py-1 rounded-md outline-none"
            style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: textPrimary }} />
        </div>
      )}
    </>
  );
}
