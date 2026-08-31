import { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { LightweightCharts, loadLightweightCharts } from '../lib/charts';
import { formatCurrency } from '../lib/format';
import { Loader2 } from 'lucide-react';
import {
  classifyHolding, labelToBusinessDay, calcLocalStdDev,
  calcSMA, calcEMA, calcBollingerBands, calcRSI, toHeikinAshi,
} from './portfolio-chart/indicators';
import { fmtDate } from './portfolio-chart/format';
import type {
  Timeframe, ChartMode, ViewMode, Indicator, SavedView, CrosshairInfo, ChartTheme,
} from './portfolio-chart/types';
import ChartLegend from './portfolio-chart/ChartLegend';
import ChartToolbar from './portfolio-chart/ChartToolbar';
import ChartFooter from './portfolio-chart/ChartFooter';

// ─── Main Component ──────────────────────────────────────────────────────────

export default function PortfolioChart({ holdings }: { holdings: any[] }) {
  const { isDark } = useTheme();
  const mainContainerRef = useRef<HTMLDivElement>(null);
  const rsiContainerRef = useRef<HTMLDivElement>(null);
  const mainChartRef = useRef<any>(null);
  const rsiChartRef = useRef<any>(null);
  const mainSeriesRef = useRef<any>(null);

  const [timeframe, setTimeframe] = useState<Timeframe>('1M');
  const [chartMode, setChartMode] = useState<ChartMode>('area');
  const [viewMode, setViewMode] = useState<ViewMode>('all');
  const [customStart, setCustomStart] = useState('');
  const [customEnd, setCustomEnd] = useState('');
  const [chartData, setChartData] = useState<any[]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [lwcReady, setLwcReady] = useState(false);
  const [logScale, setLogScale] = useState(false);
  const [showRSI, setShowRSI] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [crosshairInfo, setCrosshairInfo] = useState<CrosshairInfo | null>(null);

  const [indicators, setIndicators] = useState<Indicator[]>([
    { key: 'sma20', label: 'SMA 20', color: '#5AC8FA', active: false },
    { key: 'ema50', label: 'EMA 50', color: '#AF52DE', active: false },
    { key: 'bb', label: 'BB(20,2)', color: '#FF9500', active: false },
    { key: 'vol', label: 'Δ%', color: '#8A8A8D', active: true },
  ]);

  const [savedViews, setSavedViews] = useState<SavedView[]>(() => {
    try { return JSON.parse(localStorage.getItem('ss_saved_views') || '[]'); } catch { return []; }
  });

  // Theme
  const gold = isDark ? '#D4A843' : '#8B6914';
  const textPrimary = isDark ? '#E8E6E1' : '#1A1A1D';
  const textMuted = isDark ? '#6A6A6D' : '#9A9A9D';
  const textSecondary = isDark ? '#9A9A9D' : '#5A5A5D';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const inputBg = isDark ? '#0C0C0E' : '#F5F3EE';
  const inputBorder = isDark ? '#2A2A2D' : '#D0D0D0';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';
  const chartBg = isDark ? '#0A0A0B' : '#FAFAF8';
  const gridColor = isDark ? '#111113' : '#F0EEE8';

  const theme: ChartTheme = {
    isDark, gold, textPrimary, textMuted, textSecondary,
    border, inputBg, inputBorder, greenColor, redColor,
  };

  const showVol = indicators.find(i => i.key === 'vol')?.active ?? false;
  const showSMA = indicators.find(i => i.key === 'sma20')?.active ?? false;
  const showEMA = indicators.find(i => i.key === 'ema50')?.active ?? false;
  const showBB = indicators.find(i => i.key === 'bb')?.active ?? false;

  const chartHeight = expanded ? 640 : 480;
  const rsiHeight = 120;

  // Filter holdings
  const filteredHoldings = useMemo(() => {
    if (viewMode === 'all') return holdings;
    return holdings.filter(h => classifyHolding(h) === viewMode);
  }, [holdings, viewMode]);

  const filteredTotalValue = filteredHoldings.reduce((s, h) => s + (h.market_value || 0), 0);
  const totalValue = holdings.reduce((s, h) => s + (h.market_value || 0), 0);
  const filterRatio = totalValue > 0 ? filteredTotalValue / totalValue : 1;

  const adjustedChartData = useMemo(() => {
    if (viewMode === 'all' || filterRatio === 1) return chartData;
    return chartData.map(d => ({ ...d, portfolio: d.portfolio * filterRatio }));
  }, [chartData, filterRatio, viewMode]);

  const currentValue = adjustedChartData.length > 0 ? adjustedChartData[adjustedChartData.length - 1]?.portfolio || 0 : filteredTotalValue;
  const startValue = adjustedChartData.length > 0 ? adjustedChartData[0]?.portfolio || 0 : currentValue;

  const displayValue = crosshairInfo?.value ?? currentValue;
  const displayChange = displayValue - startValue;
  const displayPct = startValue > 0 ? (displayChange / startValue) * 100 : 0;

  // Stats
  const holdingStats = useMemo(() => {
    if (!filteredHoldings.length) return null;
    const sorted = [...filteredHoldings].sort((a, b) => (b.day_gain_pct || 0) - (a.day_gain_pct || 0));
    return {
      best: sorted[0],
      worst: sorted[sorted.length - 1],
      totalDayChange: filteredHoldings.reduce((s, h) => s + (h.day_gain_value || 0), 0),
      high: adjustedChartData.length ? Math.max(...adjustedChartData.map(d => d.portfolio)) : 0,
      low: adjustedChartData.length ? Math.min(...adjustedChartData.map(d => d.portfolio)) : 0,
    };
  }, [filteredHoldings, adjustedChartData]);

  // Computed portfolio metrics from chart data
  const portfolioMetrics = useMemo(() => {
    if (adjustedChartData.length < 2) return null;
    const values = adjustedChartData.map(d => d.portfolio);

    // Period returns (per-bar)
    const returns: number[] = [];
    for (let i = 1; i < values.length; i++) {
      if (values[i - 1] !== 0) returns.push((values[i] - values[i - 1]) / values[i - 1]);
    }
    if (returns.length === 0) return null;

    // Volatility (std dev of returns)
    const meanReturn = returns.reduce((s, r) => s + r, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - meanReturn) ** 2, 0) / returns.length;
    const volatility = Math.sqrt(variance);

    // Max drawdown
    let peak = values[0];
    let maxDrawdown = 0;
    for (const v of values) {
      if (v > peak) peak = v;
      const dd = (peak - v) / peak;
      if (dd > maxDrawdown) maxDrawdown = dd;
    }

    // Annualized return: estimate trading days from timeframe
    const totalReturn = (values[values.length - 1] - values[0]) / values[0];
    const barsPerYear = timeframe === '1D' ? 252 * 6.5 * 60 : // minute bars
                        timeframe === '1W' ? 252 * 6.5 * 12 : // 5-min bars
                        252; // daily bars
    const years = returns.length / barsPerYear;
    const annualizedReturn = years > 0 ? Math.pow(1 + totalReturn, 1 / years) - 1 : totalReturn;

    // Sharpe ratio (annualized, 0% risk-free)
    const annualizedVol = volatility * Math.sqrt(barsPerYear);
    const sharpe = annualizedVol !== 0 ? annualizedReturn / annualizedVol : 0;

    return { volatility, maxDrawdown, annualizedReturn, sharpe };
  }, [adjustedChartData, timeframe]);

  // ── Toggle indicator ─────────────────────────────────────────────────────

  const toggleIndicator = useCallback((key: string) => {
    setIndicators(prev => prev.map(i => i.key === key ? { ...i, active: !i.active } : i));
  }, []);

  // ── Keyboard shortcuts ───────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      const map: Record<string, Timeframe> = { '1': '1D', '2': '1W', '3': '1M', '4': '3M', '5': 'YTD', '6': '1Y', '7': 'ALL' };
      if (map[e.key]) { e.preventDefault(); setTimeframe(map[e.key]); }
      if (e.key === 'l' || e.key === 'L') { e.preventDefault(); setLogScale(p => !p); }
      if (e.key === 'r' || e.key === 'R') { e.preventDefault(); setShowRSI(p => !p); }
      if (e.key === 'f' || e.key === 'F') { e.preventDefault(); setExpanded(p => !p); }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // ── Load LWC ─────────────────────────────────────────────────────────────

  useEffect(() => { loadLightweightCharts().then(() => setLwcReady(true)).catch(() => {}); }, []);

  // ── Fetch data ───────────────────────────────────────────────────────────

  useEffect(() => {
    if (holdings.length === 0) return;
    if (timeframe === 'CUSTOM' && (!customStart || !customEnd)) return;
    const fetchChart = async () => {
      setChartLoading(true);
      const res = await api.getChartData(
        timeframe === 'CUSTOM' ? '1M' : timeframe,
        timeframe === 'CUSTOM' ? customStart : undefined,
        timeframe === 'CUSTOM' ? customEnd : undefined,
      );
      if (res.status === 'ok' && Array.isArray(res.data)) setChartData(res.data);
      setChartLoading(false);
    };
    fetchChart();
  }, [timeframe, customStart, customEnd, holdings.length]);

  // ── Build charts ─────────────────────────────────────────────────────────

  useEffect(() => {
    if (!lwcReady || !mainContainerRef.current || adjustedChartData.length === 0) return;
    const LWC = LightweightCharts;

    // Cleanup
    if (mainChartRef.current) { mainChartRef.current.remove(); mainChartRef.current = null; }
    if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; }

    // ── Prepare data ──────────────────────────────────────────────────────

    const total = adjustedChartData.length;

    // For intraday timeframes (1D, 1W), use Unix timestamps so LWC renders
    // minute/hour granularity. For daily+ timeframes, use business-day strings
    // to avoid timezone issues with daily candles.
    const isIntraday = timeframe === '1D' || timeframe === '1W';

    const seriesData = adjustedChartData.map((d, i) => {
      // For intraday (1D/1W): use Unix timestamps directly so LWC renders minute/hour granularity
      // For daily+: convert timestamp to YYYY-MM-DD string, fall back to label parsing
      if (isIntraday && d.timestamp && d.timestamp > 0) {
        return { time: d.timestamp as any, value: d.portfolio };
      }
      return {
        time: labelToBusinessDay(d.label || '', i, total, d.timestamp),
        value: d.portfolio,
      };
    });

    // Deduplicate (by time key)
    const deduped: any[] = [];
    const seen = new Set<string | number>();
    for (let i = seriesData.length - 1; i >= 0; i--) {
      const key = String(seriesData[i].time);
      if (!seen.has(key)) { seen.add(key); deduped.unshift(seriesData[i]); }
    }

    // Candle data — deterministic OHLC derived from actual portfolio values
    const allValues = deduped.map(d => d.value);
    const candleData = deduped.map((d, i) => {
      const open = i > 0 ? deduped[i - 1].value : d.value;
      const close = d.value;
      // Use local std dev as a proportional buffer for high/low wicks
      const localVol = calcLocalStdDev(allValues, i, 5);
      const buffer = localVol * 0.3; // 30% of local std dev for realistic wicks
      const high = Math.max(open, close) + buffer;
      const low = Math.min(open, close) - buffer;
      return { time: d.time, open, close, high, low };
    });

    // Technical indicators
    const sma20 = calcSMA(deduped, 20);
    const ema50 = calcEMA(deduped, 50);
    const bb = calcBollingerBands(deduped, 20, 2);
    const rsiValues = calcRSI(deduped, 14);

    // ── Main chart ────────────────────────────────────────────────────────

    const chart = LWC.createChart(mainContainerRef.current, {
      width: mainContainerRef.current.clientWidth,
      height: chartHeight,
      layout: {
        background: { type: LightweightCharts.ColorType.Solid, color: 'transparent' },
        textColor: textMuted,
        fontFamily: "'JetBrains Mono', 'SF Mono', 'Fira Code', monospace",
        fontSize: 10,
      },
      grid: {
        vertLines: { color: gridColor, style: 4 },
        horzLines: { color: gridColor, style: 4 },
      },
      crosshair: {
        mode: 0,
        vertLine: { color: `${gold}50`, width: 1, style: 0, labelBackgroundColor: isDark ? '#1A1A1D' : '#E8E6E1' },
        horzLine: { color: `${gold}50`, width: 1, style: 0, labelBackgroundColor: isDark ? '#1A1A1D' : '#E8E6E1' },
      },
      rightPriceScale: {
        borderColor: gridColor,
        scaleMargins: { top: 0.06, bottom: showVol ? 0.20 : 0.06 },
        mode: logScale ? 1 : 0,
      },
      timeScale: {
        borderColor: gridColor,
        fixLeftEdge: true,
        fixRightEdge: true,
        timeVisible: isIntraday,    // Show HH:MM for 1D/1W
        secondsVisible: false,
      },
      watermark: {
        visible: true,
        text: viewMode === 'all' ? 'PORTFOLIO' : viewMode.toUpperCase(),
        color: isDark ? 'rgba(212,168,67,0.04)' : 'rgba(139,105,20,0.04)',
        fontSize: 72,
        fontFamily: "'DM Sans', system-ui",
        fontStyle: 'bold',
        horzAlign: 'center',
        vertAlign: 'center',
      },
      handleScroll: { vertTouchDrag: false },
    });

    mainChartRef.current = chart;

    // ── Price series ──────────────────────────────────────────────────────

    if (chartMode === 'candle' || chartMode === 'heikin_ashi') {
      const data = chartMode === 'heikin_ashi' ? toHeikinAshi(candleData) : candleData;
      mainSeriesRef.current = chart.addCandlestickSeries({
        upColor: greenColor, downColor: redColor,
        borderUpColor: greenColor, borderDownColor: redColor,
        wickUpColor: `${greenColor}80`, wickDownColor: `${redColor}80`,
      });
      mainSeriesRef.current.setData(data);
    } else if (chartMode === 'line') {
      mainSeriesRef.current = chart.addLineSeries({
        color: gold, lineWidth: 2,
        crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
        crosshairMarkerBorderColor: gold, crosshairMarkerBackgroundColor: chartBg,
      });
      mainSeriesRef.current.setData(deduped);
    } else {
      mainSeriesRef.current = chart.addAreaSeries({
        topColor: isDark ? `${gold}25` : `${gold}18`,
        bottomColor: 'transparent',
        lineColor: gold, lineWidth: 2,
        crosshairMarkerVisible: true, crosshairMarkerRadius: 3,
        crosshairMarkerBorderColor: gold, crosshairMarkerBackgroundColor: chartBg,
      });
      mainSeriesRef.current.setData(deduped);
    }

    // ── High / Low markers ────────────────────────────────────────────────

    if (deduped.length > 5) {
      let highIdx = 0, lowIdx = 0;
      for (let i = 1; i < deduped.length; i++) {
        if (deduped[i].value > deduped[highIdx].value) highIdx = i;
        if (deduped[i].value < deduped[lowIdx].value) lowIdx = i;
      }
      mainSeriesRef.current.setMarkers([
        ...(highIdx !== deduped.length - 1 ? [{
          time: deduped[highIdx].time, position: 'aboveBar' as const, shape: 'circle' as const,
          color: greenColor, size: 0.5, text: `H ${formatCurrency(deduped[highIdx].value)}`,
        }] : []),
        ...(lowIdx !== 0 ? [{
          time: deduped[lowIdx].time, position: 'belowBar' as const, shape: 'circle' as const,
          color: redColor, size: 0.5, text: `L ${formatCurrency(deduped[lowIdx].value)}`,
        }] : []),
      ].sort((a, b) => a.time < b.time ? -1 : 1));
    }

    // ── Overlay indicators ────────────────────────────────────────────────

    if (showSMA && deduped.length > 20) {
      const s = chart.addLineSeries({ color: '#5AC8FA', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
      s.setData(deduped.flatMap((d, i) => (sma20[i] !== null ? [{ time: d.time, value: sma20[i] as number }] : [])));
    }

    if (showEMA && deduped.length > 50) {
      const s = chart.addLineSeries({ color: '#AF52DE', lineWidth: 1, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
      s.setData(deduped.flatMap((d, i) => (ema50[i] !== null ? [{ time: d.time, value: ema50[i] as number }] : [])));
    }

    if (showBB && deduped.length > 20) {
      const sUpper = chart.addLineSeries({ color: '#FF950040', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
      const sLower = chart.addLineSeries({ color: '#FF950040', lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
      sUpper.setData(deduped.flatMap((d, i) => (bb.upper[i] !== null ? [{ time: d.time, value: bb.upper[i] as number }] : [])));
      sLower.setData(deduped.flatMap((d, i) => (bb.lower[i] !== null ? [{ time: d.time, value: bb.lower[i] as number }] : [])));
    }

    // ── Volume ────────────────────────────────────────────────────────────

    if (showVol) {
      const volSeries = chart.addHistogramSeries({ priceFormat: { type: 'volume' }, priceScaleId: 'vol' });
      chart.priceScale('vol').applyOptions({ scaleMargins: { top: 0.88, bottom: 0 } });

      // Compute all change magnitudes first, then normalize to 0–1 range
      const rawChanges = deduped.map((d, i) => {
        const prev = i > 0 ? deduped[i - 1].value : d.value;
        return { abs: prev !== 0 ? Math.abs((d.value - prev) / prev) : 0, up: d.value >= prev };
      });
      const maxChange = Math.max(...rawChanges.map(c => c.abs), 0.0001); // avoid div/0

      volSeries.setData(deduped.map((d, i) => ({
        time: d.time,
        value: rawChanges[i].abs / maxChange, // normalized 0–1
        color: rawChanges[i].up
          ? (isDark ? 'rgba(52,199,89,0.12)' : 'rgba(40,167,69,0.15)')
          : (isDark ? 'rgba(255,69,58,0.12)' : 'rgba(220,53,69,0.15)'),
      })));
    }

    // ── Crosshair data legend ─────────────────────────────────────────────

    const timeToIdx = new Map(deduped.map((d, i) => [String(d.time), i]));
    chart.subscribeCrosshairMove((param: any) => {
      if (!param?.time || !param.seriesData) { setCrosshairInfo(null); return; }
      const data = param.seriesData.get(mainSeriesRef.current);
      if (!data) return;

      const t = param.time;
      let timeKey: string;
      if (typeof t === 'number') {
        // Unix timestamp (intraday) — format as date + time
        timeKey = String(t);
      } else if (typeof t === 'object') {
        timeKey = `${t.year}-${String(t.month).padStart(2,'0')}-${String(t.day).padStart(2,'0')}`;
      } else {
        timeKey = String(t);
      }

      const idx = timeToIdx.get(timeKey) ?? -1;
      const val = data.value ?? data.close ?? 0;
      const candle = candleData[idx];

      // Format display time — include hours for intraday
      const displayTime = typeof t === 'number'
        ? new Date(t * 1000).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
        : fmtDate(typeof t === 'object' ? `${t.year}-${String(t.month).padStart(2,'0')}-${String(t.day).padStart(2,'0')}` : String(t));

      // Period return: % from first data point to hovered point
      const firstVal = deduped.length > 0 ? deduped[0].value : val;
      const periodReturn = firstVal !== 0 ? ((val - firstVal) / firstVal) * 100 : 0;

      // Daily change: % from previous point
      const prevVal = idx > 0 ? deduped[idx - 1].value : (idx === 0 ? val : undefined);
      const dailyChange = prevVal !== undefined && prevVal !== 0 ? ((val - prevVal) / prevVal) * 100 : 0;

      // Delta % for volume display
      const deltaPct = idx > 0 && deduped[idx - 1].value !== 0
        ? Math.abs((deduped[idx].value - deduped[idx - 1].value) / deduped[idx - 1].value) * 100
        : undefined;

      setCrosshairInfo({
        time: displayTime,
        value: val,
        open: candle?.open,
        high: candle?.high,
        low: candle?.low,
        close: candle?.close,
        volume: deltaPct,
        sma20: showSMA && idx >= 0 ? sma20[idx] ?? undefined : undefined,
        ema50: showEMA && idx >= 0 ? ema50[idx] ?? undefined : undefined,
        bbUpper: showBB && idx >= 0 ? bb.upper[idx] ?? undefined : undefined,
        bbLower: showBB && idx >= 0 ? bb.lower[idx] ?? undefined : undefined,
        rsi: showRSI && idx >= 0 ? rsiValues[idx] ?? undefined : undefined,
        periodReturn,
        dailyChange,
      });
    });

    chart.timeScale().fitContent();

    // ── RSI sub-chart ─────────────────────────────────────────────────────

    if (showRSI && rsiContainerRef.current && deduped.length > 14) {
      const rsiChart = LWC.createChart(rsiContainerRef.current, {
        width: rsiContainerRef.current.clientWidth,
        height: rsiHeight,
        layout: {
          background: { type: LightweightCharts.ColorType.Solid, color: 'transparent' },
          textColor: textMuted,
          fontFamily: "'JetBrains Mono', monospace",
          fontSize: 9,
        },
        grid: { vertLines: { color: gridColor, style: 4 }, horzLines: { color: gridColor, style: 4 } },
        crosshair: {
          mode: 0,
          vertLine: { color: `${gold}50`, width: 1, style: 0, labelVisible: false },
          horzLine: { color: `${gold}50`, width: 1, style: 0, labelBackgroundColor: isDark ? '#1A1A1D' : '#E8E6E1' },
        },
        rightPriceScale: { borderColor: gridColor, scaleMargins: { top: 0.05, bottom: 0.05 } },
        timeScale: { visible: false },
        handleScroll: { vertTouchDrag: false },
      });
      rsiChartRef.current = rsiChart;

      // RSI line
      const rsiSeries = rsiChart.addLineSeries({ color: '#FFD60A', lineWidth: 2, crosshairMarkerVisible: false });
      rsiSeries.setData(deduped.flatMap((d, i) => (rsiValues[i] !== null ? [{ time: d.time, value: rsiValues[i] as number }] : [])));

      // Overbought/oversold lines
      const ob = rsiChart.addLineSeries({ color: `${redColor}40`, lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
      const os = rsiChart.addLineSeries({ color: `${greenColor}40`, lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
      const mid = rsiChart.addLineSeries({ color: `${textMuted}20`, lineWidth: 1, lineStyle: 2, crosshairMarkerVisible: false, lastValueVisible: false, priceLineVisible: false });
      const rsiTimeRange = deduped.filter((_, i) => rsiValues[i] !== null);
      if (rsiTimeRange.length > 1) {
        ob.setData([{ time: rsiTimeRange[0].time, value: 70 }, { time: rsiTimeRange[rsiTimeRange.length - 1].time, value: 70 }]);
        os.setData([{ time: rsiTimeRange[0].time, value: 30 }, { time: rsiTimeRange[rsiTimeRange.length - 1].time, value: 30 }]);
        mid.setData([{ time: rsiTimeRange[0].time, value: 50 }, { time: rsiTimeRange[rsiTimeRange.length - 1].time, value: 50 }]);
      }

      rsiChart.timeScale().fitContent();

      // Sync time scales
      chart.timeScale().subscribeVisibleLogicalRangeChange((range: any) => {
        if (range) rsiChart.timeScale().setVisibleLogicalRange(range);
      });
      rsiChart.timeScale().subscribeVisibleLogicalRangeChange((range: any) => {
        if (range) chart.timeScale().setVisibleLogicalRange(range);
      });
    }

    // ── Resize observer ───────────────────────────────────────────────────

    const ro = new ResizeObserver((entries) => {
      if (entries[0] && mainChartRef.current) {
        const w = entries[0].contentRect.width;
        mainChartRef.current.applyOptions({ width: w });
        if (rsiChartRef.current) rsiChartRef.current.applyOptions({ width: w });
      }
    });
    ro.observe(mainContainerRef.current);

    return () => {
      ro.disconnect();
      if (mainChartRef.current) { mainChartRef.current.remove(); mainChartRef.current = null; }
      if (rsiChartRef.current) { rsiChartRef.current.remove(); rsiChartRef.current = null; }
    };
  }, [lwcReady, adjustedChartData, chartMode, isDark, showSMA, showEMA, showBB, showVol, showRSI, logScale, startValue, chartHeight]);

  // ── Empty state ──────────────────────────────────────────────────────────

  if (holdings.length === 0 || totalValue <= 0) {
    return (
      <div className="p-5">
        <p className="text-sm font-body mb-1" style={{ color: textMuted }}>Portfolio performance</p>
        <p className="font-numeric text-3xl mt-1" style={{ color: gold }}>$0.00</p>
        <div className="flex items-center justify-center py-16">
          <p className="text-xs font-body" style={{ color: textMuted }}>Add holdings to see your portfolio performance chart</p>
        </div>
      </div>
    );
  }

  // ── Render ───────────────────────────────────────────────────────────────

  const saveCurrentView = () => {
    const name = prompt('Name this view:');
    if (name) {
      const updated = [...savedViews, { name, timeframe, viewMode }];
      setSavedViews(updated);
      localStorage.setItem('ss_saved_views', JSON.stringify(updated));
    }
  };

  const deleteView = (i: number) => {
    const u = savedViews.filter((_, j) => j !== i);
    setSavedViews(u);
    localStorage.setItem('ss_saved_views', JSON.stringify(u));
  };

  return (
    <div style={{ background: chartBg }}>

      {/* ═══ DATA LEGEND (Bloomberg-style) ═══ */}
      <ChartLegend
        crosshairInfo={crosshairInfo}
        chartMode={chartMode}
        displayValue={displayValue}
        displayChange={displayChange}
        displayPct={displayPct}
        holdingStats={holdingStats}
        portfolioMetrics={portfolioMetrics}
        positionsCount={filteredHoldings.length}
        theme={theme}
      />

      {/* ═══ TOOLBAR ═══ */}
      <ChartToolbar
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        chartMode={chartMode}
        onChartModeChange={setChartMode}
        indicators={indicators}
        onToggleIndicator={toggleIndicator}
        showRSI={showRSI}
        onToggleRSI={() => setShowRSI(!showRSI)}
        logScale={logScale}
        onToggleLogScale={() => setLogScale(!logScale)}
        viewMode={viewMode}
        onViewModeChange={setViewMode}
        expanded={expanded}
        onToggleExpanded={() => setExpanded(!expanded)}
        customStart={customStart}
        onCustomStartChange={setCustomStart}
        customEnd={customEnd}
        onCustomEndChange={setCustomEnd}
        theme={theme}
      />

      {/* ═══ MAIN CHART ═══ */}
      <div className="relative">
        {chartLoading && (
          <div className="absolute inset-0 flex items-center justify-center z-10" style={{ background: `${chartBg}DD` }}>
            <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
          </div>
        )}
        <div ref={mainContainerRef} role="img" aria-label="Portfolio value chart" style={{ minHeight: chartHeight }} />
        {!lwcReady && !chartLoading && (
          <div className="absolute inset-0 flex items-center justify-center">
            <p className="text-xs font-mono" style={{ color: textMuted }}>Loading chart engine...</p>
          </div>
        )}
      </div>

      {/* ═══ RSI SUB-CHART ═══ */}
      {showRSI && (
        <div style={{ borderTop: `1px solid ${border}` }}>
          <div className="px-4 py-1 flex items-center gap-2">
            <span className="text-[8px] font-mono uppercase tracking-wider" style={{ color: '#FFD60A' }}>RSI(14)</span>
            {crosshairInfo?.rsi != null && (
              <span className="text-[9px] font-mono" style={{ color: textSecondary }}>{crosshairInfo.rsi.toFixed(1)}</span>
            )}
          </div>
          <div ref={rsiContainerRef} style={{ minHeight: rsiHeight }} />
        </div>
      )}

      {/* ═══ BOTTOM LEGEND ═══ */}
      <ChartFooter
        showSMA={showSMA}
        showEMA={showEMA}
        showBB={showBB}
        showRSI={showRSI}
        savedViews={savedViews}
        onApplyView={(v) => { setTimeframe(v.timeframe); setViewMode(v.viewMode || 'all'); }}
        onDeleteView={deleteView}
        onSaveView={saveCurrentView}
        theme={theme}
      />
    </div>
  );
}
