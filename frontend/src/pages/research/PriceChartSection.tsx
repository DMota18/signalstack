import PriceChart from '../../components/PriceChart';
import type { ResearchTheme } from './types';

interface PriceChartSectionProps {
  ticker: string;
  chartType: 'area' | 'candlestick';
  onChartTypeChange: (type: 'area' | 'candlestick') => void;
  theme: ResearchTheme;
}

export default function PriceChartSection({ ticker, chartType, onChartTypeChange, theme }: PriceChartSectionProps) {
  const { gold, textMuted, surface, border } = theme;

  return (
    <div className="rounded-xl p-5" style={{ background: surface, border: `0.5px solid ${border}` }}>
      <PriceChart
        ticker={ticker}
        defaultTimeframe="3M"
        height={350}
        showVolume={true}
        chartType={chartType}
      />
      {/* Chart type toggle */}
      <div className="flex justify-end mt-2 gap-2">
        <button onClick={() => onChartTypeChange('area')} aria-pressed={chartType === 'area'}
          className="text-[10px] font-body px-2 py-0.5 rounded transition-colors"
          style={{ background: chartType === 'area' ? `${gold}15` : 'transparent', color: chartType === 'area' ? gold : textMuted }}>
          Area
        </button>
        <button onClick={() => onChartTypeChange('candlestick')} aria-pressed={chartType === 'candlestick'}
          className="text-[10px] font-body px-2 py-0.5 rounded transition-colors"
          style={{ background: chartType === 'candlestick' ? `${gold}15` : 'transparent', color: chartType === 'candlestick' ? gold : textMuted }}>
          Candles
        </button>
      </div>
    </div>
  );
}
