import { useEffect, useRef, useState, useCallback } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { LightweightCharts, loadLightweightCharts } from '../lib/charts';
import { Loader2 } from 'lucide-react';

interface PriceChartProps {
  ticker: string;
  defaultTimeframe?: string;
  height?: number;
  showVolume?: boolean;
  chartType?: 'area' | 'candlestick';
}

interface OHLCVPoint {
  timestamp: number;
  label: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface CrosshairData {
  time: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  change: number | null;
}

const TIMEFRAMES = ['1D', '1W', '1M', '3M', '6M', '1Y', '5Y'];
const INTRADAY_TIMEFRAMES = ['1D', '1W'];

function formatVolume(vol: number): string {
  if (vol >= 1_000_000_000) return (vol / 1_000_000_000).toFixed(1) + 'B';
  if (vol >= 1_000_000) return (vol / 1_000_000).toFixed(1) + 'M';
  if (vol >= 1_000) return (vol / 1_000).toFixed(1) + 'K';
  return vol.toFixed(0);
}

function formatPrice(price: number): string {
  return price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function computeSMA(data: OHLCVPoint[], period: number): { time: any; value: number }[] {
  const result: { time: any; value: number }[] = [];
  for (let i = period - 1; i < data.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += data[j].close;
    }
    result.push({ time: data[i].timestamp, value: sum / period });
  }
  return result;
}

export default function PriceChart({
  ticker,
  defaultTimeframe = '3M',
  height = 350,
  showVolume = true,
  chartType: initialChartType = 'area',
}: PriceChartProps) {
  const { isDark } = useTheme();
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<any>(null);
  const seriesRef = useRef<any>(null);
  const volumeRef = useRef<any>(null);
  const sma20Ref = useRef<any>(null);
  const sma50Ref = useRef<any>(null);
  const rawDataRef = useRef<OHLCVPoint[]>([]);

  const [timeframe, setTimeframe] = useState(defaultTimeframe);
  const [activeChartType, setActiveChartType] = useState(initialChartType);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [lwcLoaded, setLwcLoaded] = useState(false);

  const [showSMA20, setShowSMA20] = useState(false);
  const [showSMA50, setShowSMA50] = useState(false);

  const [crosshair, setCrosshair] = useState<CrosshairData | null>(null);

  // Stats derived from data
  const [stats, setStats] = useState<{
    currentPrice: number;
    dayChange: number;
    dayChangePct: number;
    periodHigh: number;
    periodLow: number;
    avgVolume: number;
  } | null>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const greenColor = '#26a69a';
  const redColor = '#ef5350';
  const sma20Color = '#5AC8FA';
  const sma50Color = '#AF52DE';

  const bgColor = isDark ? '#0C0C0E' : '#F8F7F4';
  const gridColor = isDark ? '#1A1A1D' : '#E8E6E1';
  const textColor = isDark ? '#9A9A9D' : '#5A5A5D';
  const crosshairColor = isDark ? '#D4A84380' : '#8B691480';

  const isIntraday = INTRADAY_TIMEFRAMES.includes(timeframe);

  // Format time for display in the crosshair legend
  const formatTime = useCallback((timestamp: number) => {
    const d = new Date(timestamp * 1000);
    if (isIntraday) {
      return d.toLocaleString('en-US', {
        month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
      });
    }
    return d.toLocaleString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
  }, [isIntraday]);

  // Load the library
  useEffect(() => {
    loadLightweightCharts()
      .then(() => setLwcLoaded(true))
      .catch(() => setError(true));
  }, []);

  // Create chart instance
  useEffect(() => {
    if (!lwcLoaded || !chartContainerRef.current) return;

    const LWC = LightweightCharts;

    // Destroy previous chart
    if (chartRef.current) {
      chartRef.current.remove();
      chartRef.current = null;
      seriesRef.current = null;
      volumeRef.current = null;
      sma20Ref.current = null;
      sma50Ref.current = null;
    }

    const chart = LWC.createChart(chartContainerRef.current, {
      width: chartContainerRef.current.clientWidth,
      height: height,
      layout: {
        background: { type: LightweightCharts.ColorType.Solid, color: 'transparent' },
        textColor: textColor,
        fontFamily: "'DM Sans', system-ui, sans-serif",
        fontSize: 11,
      },
      grid: {
        vertLines: { color: gridColor, style: 4 },
        horzLines: { color: gridColor, style: 4 },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: crosshairColor, width: 1, style: 2, labelBackgroundColor: gold },
        horzLine: { color: crosshairColor, width: 1, style: 2, labelBackgroundColor: gold },
      },
      rightPriceScale: {
        borderColor: gridColor,
        scaleMargins: { top: 0.1, bottom: showVolume ? 0.25 : 0.1 },
      },
      timeScale: {
        borderColor: gridColor,
        timeVisible: true,
        secondsVisible: false,
        fixLeftEdge: true,
        fixRightEdge: true,
      },
      handleScroll: { vertTouchDrag: false },
    });

    chartRef.current = chart;

    // Create main series
    if (activeChartType === 'candlestick') {
      seriesRef.current = chart.addCandlestickSeries({
        upColor: greenColor,
        downColor: redColor,
        borderUpColor: greenColor,
        borderDownColor: redColor,
        wickUpColor: greenColor,
        wickDownColor: redColor,
      });
    } else {
      seriesRef.current = chart.addAreaSeries({
        topColor: isDark ? 'rgba(212, 168, 67, 0.25)' : 'rgba(139, 105, 20, 0.15)',
        bottomColor: isDark ? 'rgba(212, 168, 67, 0.01)' : 'rgba(139, 105, 20, 0.01)',
        lineColor: gold,
        lineWidth: 2,
        crosshairMarkerVisible: true,
        crosshairMarkerRadius: 4,
        crosshairMarkerBorderColor: gold,
        crosshairMarkerBackgroundColor: isDark ? '#0C0C0E' : '#FFFFFF',
      });
    }

    // SMA series (created hidden, toggled via visibility)
    sma20Ref.current = chart.addLineSeries({
      color: sma20Color,
      lineWidth: 1,
      lineStyle: 0,
      visible: showSMA20,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    sma50Ref.current = chart.addLineSeries({
      color: sma50Color,
      lineWidth: 1,
      lineStyle: 0,
      visible: showSMA50,
      priceLineVisible: false,
      lastValueVisible: false,
    });

    // Volume series
    if (showVolume) {
      volumeRef.current = chart.addHistogramSeries({
        color: isDark ? '#2A2A2D' : '#D0D0D0',
        priceFormat: { type: 'volume' },
        priceScaleId: 'volume',
      });

      chart.priceScale('volume').applyOptions({
        scaleMargins: { top: 0.8, bottom: 0 },
      });
    }

    // Crosshair move handler
    chart.subscribeCrosshairMove((param: any) => {
      if (!param || !param.time || !param.point || param.point.x < 0 || param.point.y < 0) {
        setCrosshair(null);
        return;
      }

      const data = rawDataRef.current;
      if (!data || data.length === 0) return;

      // Find the matching data point by timestamp
      const ts = typeof param.time === 'object'
        ? new Date(param.time.year, param.time.month - 1, param.time.day).getTime() / 1000
        : param.time;

      const point = data.find((p) => p.timestamp === ts);
      if (!point) {
        setCrosshair(null);
        return;
      }

      const idx = data.indexOf(point);
      const prevClose = idx > 0 ? data[idx - 1].close : null;
      const change = prevClose ? ((point.close - prevClose) / prevClose) * 100 : null;

      setCrosshair({
        time: formatTime(point.timestamp),
        open: point.open,
        high: point.high,
        low: point.low,
        close: point.close,
        volume: point.volume,
        change,
      });
    });

    // Handle resize
    const resizeObserver = new ResizeObserver((entries) => {
      if (entries.length > 0 && chartRef.current) {
        const { width } = entries[0].contentRect;
        chartRef.current.applyOptions({ width });
      }
    });
    resizeObserver.observe(chartContainerRef.current);

    return () => {
      resizeObserver.disconnect();
      if (chartRef.current) {
        chartRef.current.remove();
        chartRef.current = null;
      }
    };
  }, [lwcLoaded, isDark, activeChartType, height, showVolume]);

  // Toggle SMA visibility without recreating chart
  useEffect(() => {
    if (sma20Ref.current) {
      sma20Ref.current.applyOptions({ visible: showSMA20 });
    }
  }, [showSMA20]);

  useEffect(() => {
    if (sma50Ref.current) {
      sma50Ref.current.applyOptions({ visible: showSMA50 });
    }
  }, [showSMA50]);

  // Fetch and set data when timeframe changes
  useEffect(() => {
    if (!seriesRef.current || !ticker) return;

    setLoading(true);
    setError(false);

    api.getResearchChart(ticker, timeframe).then((res) => {
      if (res.status === 'ok' && Array.isArray(res.data) && res.data.length > 0) {
        const points: OHLCVPoint[] = res.data;
        rawDataRef.current = points;

        // Prepare time values based on timeframe
        const toTime = (p: OHLCVPoint) => {
          if (isIntraday) {
            // Use Unix timestamp directly for intraday so LWC shows HH:MM
            return p.timestamp;
          }
          // For daily+, use YYYY-MM-DD string in UTC to avoid timezone skew
          const d = new Date(p.timestamp * 1000);
          const yyyy = d.getUTCFullYear();
          const mm = String(d.getUTCMonth() + 1).padStart(2, '0');
          const dd = String(d.getUTCDate()).padStart(2, '0');
          return `${yyyy}-${mm}-${dd}`;
        };

        if (activeChartType === 'candlestick') {
          const candleData = points.map((p) => ({
            time: toTime(p),
            open: p.open,
            high: p.high,
            low: p.low,
            close: p.close,
          }));
          seriesRef.current.setData(candleData);
        } else {
          const areaData = points.map((p) => ({
            time: toTime(p),
            value: p.close,
          }));
          seriesRef.current.setData(areaData);
        }

        // Volume data with green/red coloring
        if (volumeRef.current) {
          const volData = points.map((p) => ({
            time: toTime(p),
            value: p.volume || 0,
            color: p.close >= p.open
              ? (isDark ? 'rgba(38, 166, 154, 0.35)' : 'rgba(38, 166, 154, 0.45)')
              : (isDark ? 'rgba(239, 83, 80, 0.35)' : 'rgba(239, 83, 80, 0.45)'),
          }));
          volumeRef.current.setData(volData);
        }

        // SMA overlays
        // Helper to convert Unix timestamp to UTC date string for LWC
        const tsToDateStr = (ts: number) => {
          const dt = new Date(ts * 1000);
          return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`;
        };

        if (sma20Ref.current) {
          const sma20Data = computeSMA(points, 20).map((d) => ({
            ...d,
            time: isIntraday ? d.time : tsToDateStr(d.time),
          }));
          sma20Ref.current.setData(sma20Data);
        }

        if (sma50Ref.current) {
          const sma50Data = computeSMA(points, 50).map((d) => ({
            ...d,
            time: isIntraday ? d.time : tsToDateStr(d.time),
          }));
          sma50Ref.current.setData(sma50Data);
        }

        // High/Low markers
        if (seriesRef.current) {
          let highIdx = 0;
          let lowIdx = 0;
          for (let i = 1; i < points.length; i++) {
            if (points[i].high > points[highIdx].high) highIdx = i;
            if (points[i].low < points[lowIdx].low) lowIdx = i;
          }

          const markers: any[] = [];
          markers.push({
            time: toTime(points[highIdx]),
            position: 'aboveBar',
            color: greenColor,
            shape: 'arrowDown',
            text: `H $${formatPrice(points[highIdx].high)}`,
          });
          markers.push({
            time: toTime(points[lowIdx]),
            position: 'belowBar',
            color: redColor,
            shape: 'arrowUp',
            text: `L $${formatPrice(points[lowIdx].low)}`,
          });

          // Sort markers by time (required by LWC)
          markers.sort((a, b) => {
            const tA = typeof a.time === 'string' ? new Date(a.time).getTime() : a.time;
            const tB = typeof b.time === 'string' ? new Date(b.time).getTime() : b.time;
            return tA - tB;
          });

          seriesRef.current.setMarkers(markers);
        }

        // Compute stats
        const lastPoint = points[points.length - 1];
        const prevPoint = points.length > 1 ? points[points.length - 2] : null;
        const periodHigh = Math.max(...points.map((p) => p.high));
        const periodLow = Math.min(...points.map((p) => p.low));
        const totalVol = points.reduce((sum, p) => sum + (p.volume || 0), 0);
        const avgVol = totalVol / points.length;

        const dayChange = prevPoint ? lastPoint.close - prevPoint.close : 0;
        const dayChangePct = prevPoint ? (dayChange / prevPoint.close) * 100 : 0;

        setStats({
          currentPrice: lastPoint.close,
          dayChange,
          dayChangePct,
          periodHigh,
          periodLow,
          avgVolume: avgVol,
        });

        // Update timeScale options for this timeframe and fit content
        if (chartRef.current) {
          chartRef.current.timeScale().applyOptions({
            timeVisible: isIntraday,
          });
          chartRef.current.timeScale().fitContent();
        }
      } else {
        setError(true);
      }
      setLoading(false);
    }).catch(() => {
      setError(true);
      setLoading(false);
    });
  }, [ticker, timeframe, lwcLoaded, activeChartType, isDark, isIntraday]);

  const toggleChartType = () => {
    setActiveChartType((prev) => (prev === 'area' ? 'candlestick' : 'area'));
  };

  return (
    <div>
      {/* Crosshair OHLCV Legend */}
      <div
        className="flex flex-wrap items-center gap-x-3 gap-y-0.5 mb-2 min-h-[20px]"
        style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
      >
        {crosshair ? (
          <>
            <span className="text-[10px]" style={{ color: textMuted }}>{crosshair.time}</span>
            <span className="text-[10px]" style={{ color: textMuted }}>
              O <span style={{ color: isDark ? '#E5E5E7' : '#1A1A1D' }}>{formatPrice(crosshair.open)}</span>
            </span>
            <span className="text-[10px]" style={{ color: textMuted }}>
              H <span style={{ color: greenColor }}>{formatPrice(crosshair.high)}</span>
            </span>
            <span className="text-[10px]" style={{ color: textMuted }}>
              L <span style={{ color: redColor }}>{formatPrice(crosshair.low)}</span>
            </span>
            <span className="text-[10px]" style={{ color: textMuted }}>
              C <span style={{ color: isDark ? '#E5E5E7' : '#1A1A1D' }}>{formatPrice(crosshair.close)}</span>
            </span>
            <span className="text-[10px]" style={{ color: textMuted }}>
              Vol <span style={{ color: isDark ? '#E5E5E7' : '#1A1A1D' }}>{formatVolume(crosshair.volume)}</span>
            </span>
            {crosshair.change !== null && (
              <span className="text-[10px]" style={{ color: crosshair.change >= 0 ? greenColor : redColor }}>
                {crosshair.change >= 0 ? '+' : ''}{crosshair.change.toFixed(2)}%
              </span>
            )}
          </>
        ) : (
          <span className="text-[10px]" style={{ color: textMuted }}>Hover over chart for details</span>
        )}
      </div>

      {/* Timeframe toggles + indicators + chart type */}
      <div className="flex items-center justify-between mb-2">
        <div className="flex gap-1">
          {TIMEFRAMES.map((tf) => (
            <button key={tf} onClick={() => setTimeframe(tf)}
              className="text-[10px] font-body px-2.5 py-1 rounded-md transition-colors"
              style={{
                background: timeframe === tf ? `${gold}15` : 'transparent',
                color: timeframe === tf ? gold : textMuted,
              }}>
              {tf}
            </button>
          ))}
        </div>

        <div className="flex gap-1 items-center">
          {/* SMA toggles */}
          <button
            onClick={() => setShowSMA20((v) => !v)}
            className="text-[9px] font-body px-2 py-0.5 rounded transition-colors"
            style={{
              background: showSMA20 ? `${sma20Color}20` : 'transparent',
              color: showSMA20 ? sma20Color : textMuted,
              border: showSMA20 ? `1px solid ${sma20Color}40` : '1px solid transparent',
            }}
          >
            SMA20
          </button>
          <button
            onClick={() => setShowSMA50((v) => !v)}
            className="text-[9px] font-body px-2 py-0.5 rounded transition-colors"
            style={{
              background: showSMA50 ? `${sma50Color}20` : 'transparent',
              color: showSMA50 ? sma50Color : textMuted,
              border: showSMA50 ? `1px solid ${sma50Color}40` : '1px solid transparent',
            }}
          >
            SMA50
          </button>

          {/* Chart type toggle */}
          <button
            onClick={toggleChartType}
            className="text-[9px] font-body px-2 py-0.5 rounded transition-colors"
            style={{
              background: `${gold}10`,
              color: textMuted,
            }}
            title={activeChartType === 'area' ? 'Switch to candlestick' : 'Switch to area'}
          >
            {activeChartType === 'candlestick' ? '\u{1F56F}\uFE0F' : '\uD83D\uDCC8'}
          </button>
        </div>
      </div>

      {/* Stats row */}
      {stats && !error && (
        <div
          className="flex flex-wrap items-center gap-x-4 gap-y-0.5 mb-2 px-1"
          style={{ fontFamily: "'DM Sans', system-ui, sans-serif" }}
        >
          <span className="text-[10px]" style={{ color: textMuted }}>
            Price{' '}
            <span style={{ color: isDark ? '#E5E5E7' : '#1A1A1D', fontWeight: 600 }}>
              ${formatPrice(stats.currentPrice)}
            </span>
          </span>
          <span className="text-[10px]" style={{ color: stats.dayChange >= 0 ? greenColor : redColor }}>
            {stats.dayChange >= 0 ? '+' : ''}{formatPrice(stats.dayChange)} ({stats.dayChange >= 0 ? '+' : ''}{stats.dayChangePct.toFixed(2)}%)
          </span>
          <span className="text-[10px]" style={{ color: textMuted }}>
            Hi <span style={{ color: greenColor }}>${formatPrice(stats.periodHigh)}</span>
          </span>
          <span className="text-[10px]" style={{ color: textMuted }}>
            Lo <span style={{ color: redColor }}>${formatPrice(stats.periodLow)}</span>
          </span>
          {stats.avgVolume > 0 && (
            <span className="text-[10px]" style={{ color: textMuted }}>
              Avg Vol <span style={{ color: isDark ? '#E5E5E7' : '#1A1A1D' }}>{formatVolume(stats.avgVolume)}</span>
            </span>
          )}
        </div>
      )}

      {/* Chart container */}
      <div className="relative rounded-lg overflow-hidden" style={{ background: bgColor }}>
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10"
            style={{ background: isDark ? 'rgba(12,12,14,0.8)' : 'rgba(248,247,244,0.8)' }}>
            <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
          </div>
        )}

        {error && !loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <p className="text-xs font-body" style={{ color: textMuted }}>Chart data unavailable</p>
          </div>
        )}

        <div ref={chartContainerRef} style={{ minHeight: height }} />
      </div>
    </div>
  );
}
