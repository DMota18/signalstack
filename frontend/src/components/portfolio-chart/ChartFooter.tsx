import { X } from 'lucide-react';
import type { ChartTheme, SavedView } from './types';

interface ChartFooterProps {
  showSMA: boolean;
  showEMA: boolean;
  showBB: boolean;
  showRSI: boolean;
  savedViews: SavedView[];
  onApplyView: (view: SavedView) => void;
  onDeleteView: (index: number) => void;
  onSaveView: () => void;
  theme: ChartTheme;
}

export default function ChartFooter({
  showSMA, showEMA, showBB, showRSI,
  savedViews, onApplyView, onDeleteView, onSaveView, theme,
}: ChartFooterProps) {
  const { isDark, gold, textMuted, border, inputBg, inputBorder } = theme;

  return (
    <div className="px-4 py-2 flex flex-col sm:flex-row sm:items-center justify-between gap-2" style={{ borderTop: `1px solid ${border}` }}>
      <div className="flex gap-3 items-center flex-wrap">
        <div className="flex items-center gap-1 text-[9px] font-mono" style={{ color: textMuted }}>
          <span className="w-3 h-0.5 rounded-full" style={{ background: gold }} /> Portfolio
        </div>
        {showSMA && <div className="flex items-center gap-1 text-[9px] font-mono" style={{ color: '#5AC8FA' }}><span className="w-3 h-0.5 rounded-full" style={{ background: '#5AC8FA' }} /> SMA(20)</div>}
        {showEMA && <div className="flex items-center gap-1 text-[9px] font-mono" style={{ color: '#AF52DE' }}><span className="w-3 h-0.5 rounded-full" style={{ background: '#AF52DE' }} /> EMA(50)</div>}
        {showBB && <div className="flex items-center gap-1 text-[9px] font-mono" style={{ color: '#FF9500' }}><span className="w-3 h-0.5 rounded-full" style={{ background: '#FF950060' }} /> BB(20,2)</div>}
        {showRSI && <div className="flex items-center gap-1 text-[9px] font-mono" style={{ color: '#FFD60A' }}><span className="w-3 h-0.5 rounded-full" style={{ background: '#FFD60A' }} /> RSI(14)</div>}
      </div>
      <div className="flex gap-1.5 flex-wrap items-center">
        {savedViews.map((v, i) => (
          <button key={i} onClick={() => onApplyView(v)}
            className="text-[8px] font-mono px-2 py-0.5 rounded flex items-center gap-1"
            style={{ background: inputBg, color: textMuted, border: `0.5px solid ${inputBorder}` }}>
            {v.name}
            <X size={7} role="button" aria-label={`Delete saved view ${v.name}`} onClick={(e) => { e.stopPropagation(); onDeleteView(i); }} className="opacity-40 hover:opacity-100" />
          </button>
        ))}
        <button onClick={onSaveView}
          className="text-[8px] font-mono px-2 py-0.5 rounded"
          style={{ background: inputBg, color: textMuted, border: `0.5px solid ${inputBorder}` }}>
          <span style={{ color: gold }}>+</span> Save
        </button>
        <span className="text-[8px] font-mono" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
          Keys: 1-7 timeframes | L log | R rsi | F expand
        </span>
      </div>
    </div>
  );
}
