import { useState, useEffect, useRef } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { Loader2, Plus, X } from 'lucide-react';

interface PerformanceComparisonProps {
  baseTicker: string;
  similarTickers?: string[];
}

const LINE_COLORS = ['#D4A843', '#34C759', '#FF453A', '#5856D6', '#FF9500', '#007AFF', '#AF52DE', '#5AC778'];

let lwcPromise: Promise<any> | null = null;
function loadLWC(): Promise<any> {
  if (lwcPromise) return lwcPromise;
  lwcPromise = new Promise((resolve, reject) => {
    if ((window as any).LightweightCharts) { resolve((window as any).LightweightCharts); return; }
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/lightweight-charts@4.1.3/dist/lightweight-charts.standalone.production.js';
    s.async = true;
    s.onload = () => resolve((window as any).LightweightCharts);
    s.onerror = () => reject(new Error('Failed to load chart'));
    document.head.appendChild(s);
  });
  return lwcPromise;
}

/**
 * PerformanceComparison — Normalized % return overlay chart.
 * Shows multiple tickers on one chart, all rebased to 0% at the start.
 */
export default function PerformanceComparison({ baseTicker, similarTickers = [] }: PerformanceComparisonProps) {
  const { isDark } = useTheme();
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);

  const [tickers, setTickers] = useState<string[]>([baseTicker]);
  const [addInput, setAddInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [lwcReady, setLwcReady] = useState(false);
  const [timeframe, setTimeframe] = useState('3M');
  const [chartData, setChartData] = useState<Record<string, any[]>>({});

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const gridColor = isDark ? '#141416' : '#F0EEE8';

  useEffect(() => { loadLWC().then(() => setLwcReady(true)).catch(() => {}); }, []);

  // Fetch data for all tickers
  useEffect(() => {
    if (tickers.length === 0) return;
    setLoading(true);

    Promise.all(
      tickers.map(async (t) => {
        if (chartData[`${t}_${timeframe}`]) return { ticker: t, data: chartData[`${t}_${timeframe}`] };
        try {
          const res = await api.getResearchChart(t, timeframe);
          if (res.status === 'ok' && Array.isArray(res.data) && res.data.length > 0) {
            return { ticker: t, data: res.data };
          }
        } catch {
          /* non-fatal: chart fetch failed for this ticker — fall through to empty data */
        }
        return { ticker: t, data: [] };
      })
    ).then((results) => {
      const newData = { ...chartData };
      results.forEach((r) => { newData[`${r.ticker}_${timeframe}`] = r.data; });
      setChartData(newData);
      setLoading(false);
    });
  }, [tickers.join(','), timeframe]);

  // Build chart
  useEffect(() => {
    if (!lwcReady || !containerRef.current) return;
    const LWC = (window as any).LightweightCharts;
    if (!LWC) return;

    if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; }

    const chart = LWC.createChart(containerRef.current, {
      width: containerRef.current.clientWidth,
      height: 280,
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: textMuted,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: gridColor, style: 4 },
        horzLines: { color: gridColor, style: 4 },
      },
      crosshair: { mode: 0, vertLine: { color: `${gold}60`, width: 1, style: 2 }, horzLine: { color: `${gold}60`, width: 1, style: 2 } },
      rightPriceScale: {
        borderColor: gridColor,
        mode: 0,
      },
      timeScale: { borderColor: gridColor, fixLeftEdge: true, fixRightEdge: true },
      handleScroll: { vertTouchDrag: false },
    });
    chartRef.current = chart;

    // Add a line series for each ticker (normalized to % return)
    tickers.forEach((t, idx) => {
      const raw = chartData[`${t}_${timeframe}`] || [];
      if (raw.length === 0) return;

      const baseClose = raw[0].close || raw[0].value || 1;
      const normalized = raw.map((p: any) => {
        const close = p.close || p.value || 0;
        const pctReturn = ((close - baseClose) / baseClose) * 100;
        return { time: p.timestamp, value: pctReturn };
      });

      const series = chart.addLineSeries({
        color: LINE_COLORS[idx % LINE_COLORS.length],
        lineWidth: idx === 0 ? 2 : 1.5,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 3,
        title: t,
      });
      series.setData(normalized);
    });

    // Zero line
    chart.addLineSeries({
      color: textMuted, lineWidth: 0.5, lineStyle: 2,
      crosshairMarkerVisible: false, priceLineVisible: false, lastValueVisible: false,
    }).setData(
      (chartData[`${tickers[0]}_${timeframe}`] || []).map((p: any) => ({ time: p.timestamp, value: 0 }))
    );

    chart.timeScale().fitContent();

    const ro = new ResizeObserver((entries) => {
      if (entries[0] && chartRef.current) chartRef.current.applyOptions({ width: entries[0].contentRect.width });
    });
    ro.observe(containerRef.current);

    return () => { ro.disconnect(); if (chartRef.current) { chartRef.current.remove(); chartRef.current = null; } };
  }, [lwcReady, tickers, timeframe, chartData, isDark]);

  const addTicker = () => {
    const t = addInput.trim().toUpperCase();
    if (t && !tickers.includes(t) && tickers.length < 8) {
      setTickers([...tickers, t]);
      setAddInput('');
    }
  };

  const removeTicker = (t: string) => {
    if (t === baseTicker) return; // Can't remove base
    setTickers(tickers.filter(x => x !== t));
  };

  const tfOptions = ['1M', '3M', '6M', '1Y', '5Y'];

  return (
    <div>
      {/* Toolbar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        {/* Ticker pills */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {tickers.map((t, i) => (
            <span key={t} className="text-[10px] font-body font-medium px-2 py-0.5 rounded-full flex items-center gap-1"
              style={{ background: `${LINE_COLORS[i % LINE_COLORS.length]}15`, color: LINE_COLORS[i % LINE_COLORS.length], border: `0.5px solid ${LINE_COLORS[i % LINE_COLORS.length]}30` }}>
              <span className="w-1.5 h-1.5 rounded-full" style={{ background: LINE_COLORS[i % LINE_COLORS.length] }} />
              {t}
              {t !== baseTicker && (
                <X size={8} className="cursor-pointer opacity-60 hover:opacity-100" onClick={() => removeTicker(t)} />
              )}
            </span>
          ))}
          {/* Add ticker input */}
          {tickers.length < 8 && (
            <div className="flex items-center gap-1">
              <input
                type="text"
                value={addInput}
                onChange={(e) => setAddInput(e.target.value.toUpperCase())}
                onKeyDown={(e) => e.key === 'Enter' && addTicker()}
                placeholder="Add..."
                maxLength={6}
                className="text-[10px] font-body px-2 py-0.5 rounded-md outline-none w-16"
                style={{ background: isDark ? '#0C0C0E' : '#F8F7F4', border: `0.5px solid ${isDark ? '#2A2A2D' : '#D0D0D0'}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }}
              />
              <button onClick={addTicker} className="text-[10px]" style={{ color: gold }}>
                <Plus size={12} />
              </button>
            </div>
          )}
        </div>

        {/* Timeframe */}
        <div className="flex gap-0.5">
          {tfOptions.map((tf) => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className="text-[10px] font-body px-2 py-1 rounded transition-colors"
              style={{ background: timeframe === tf ? `${gold}20` : 'transparent', color: timeframe === tf ? gold : textMuted }}>
              {tf}
            </button>
          ))}
        </div>
      </div>

      {/* Quick add from similar tickers */}
      {similarTickers.length > 0 && (
        <div className="flex items-center gap-1.5 mb-3 flex-wrap">
          <span className="text-[9px] font-body" style={{ color: textMuted }}>Compare:</span>
          {similarTickers.filter(t => !tickers.includes(t)).slice(0, 5).map((t) => (
            <button key={t} onClick={() => setTickers([...tickers, t].slice(0, 8))}
              className="text-[9px] font-body px-2 py-0.5 rounded-md transition-colors hover:opacity-70"
              style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
              + {t}
            </button>
          ))}
        </div>
      )}

      {/* Chart */}
      <div className="relative rounded-lg overflow-hidden" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: isDark ? 'rgba(12,12,14,0.7)' : 'rgba(248,247,244,0.7)' }}>
            <Loader2 size={18} className="animate-spin" style={{ color: gold }} />
          </div>
        )}
        <div ref={containerRef} style={{ minHeight: 280 }} />
      </div>

      <p className="text-[9px] font-body mt-2" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
        Normalized % return from start of period. Y-axis shows cumulative return.
      </p>
    </div>
  );
}
