import { useMemo, useState } from 'react';
import { Treemap, ResponsiveContainer, Tooltip } from 'recharts';
import { useTheme } from '../hooks/useTheme';
import { useNavigate } from 'react-router-dom';

interface PortfolioTreemapProps {
  holdings: any[];
}

type TreemapColorMode = 'day_change' | 'total_return' | 'weight';

const CRYPTO_SET = new Set(['BTC','ETH','SOL','XRP','DOGE','ADA','DOT','AVAX','MATIC','LINK','BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD']);
const ETF_SET = new Set(['SPY','QQQ','VTI','VOO','IWM','GLD','SLV','ARKK','XLF','XLE','XLK','SCHD','VGT','DIA','IBIT','BITO']);

function classifyType(ticker: string): string {
  const t = ticker.toUpperCase();
  if (CRYPTO_SET.has(t)) return 'Crypto';
  if (ETF_SET.has(t)) return 'ETFs';
  return 'Equities';
}

/**
 * Color mapping — Finviz-style gradient from deep red through neutral to deep green.
 * Uses HSL interpolation for smooth perceptual transitions.
 */
function changeToColor(pct: number, isDark: boolean): string {
  const clamped = Math.max(-6, Math.min(6, pct));
  const t = (clamped + 6) / 12; // 0 = deep red, 0.5 = neutral, 1 = deep green

  if (isDark) {
    if (t < 0.42) {
      const i = 1 - t / 0.42;
      return `hsl(0, ${Math.round(45 + 30 * i)}%, ${Math.round(15 + 18 * i)}%)`;
    } else if (t > 0.58) {
      const i = (t - 0.58) / 0.42;
      return `hsl(145, ${Math.round(40 + 25 * i)}%, ${Math.round(14 + 16 * i)}%)`;
    }
    return 'hsl(0, 0%, 16%)';
  }
  // Light mode
  if (t < 0.42) {
    const i = 1 - t / 0.42;
    return `hsl(0, ${Math.round(50 + 30 * i)}%, ${Math.round(55 + 20 * i)}%)`;
  } else if (t > 0.58) {
    const i = (t - 0.58) / 0.42;
    return `hsl(145, ${Math.round(45 + 25 * i)}%, ${Math.round(45 + 15 * i)}%)`;
  }
  return 'hsl(0, 0%, 75%)';
}

function fmtPrice(v: number): string {
  if (v >= 1000) return `$${(v / 1000).toFixed(1)}K`;
  return `$${v.toFixed(0)}`;
}

// Custom cell renderer — professional Finviz-style
function TreemapCell(props: any) {
  const { x, y, width, height, ticker, day_gain_pct, total_gain_pct, market_value, current_price, pct_of_portfolio, colorMode, isDark } = props;
  if (width < 3 || height < 3) return null;

  const pctVal = colorMode === 'total_return' ? (total_gain_pct || 0)
    : colorMode === 'weight' ? 0
    : (day_gain_pct || 0);

  // Weight mode: scale the gold intensity by portfolio weight.
  // pct_of_portfolio is 0-100. Use a sqrt scale so small positions are still visible.
  const weightIntensity = Math.sqrt(Math.min(pct_of_portfolio || 0, 100) / 100);
  const bgColor = colorMode === 'weight'
    ? (isDark
      ? `hsl(42, ${30 + weightIntensity * 40}%, ${12 + weightIntensity * 22}%)`
      : `hsl(42, ${35 + weightIntensity * 40}%, ${72 - weightIntensity * 20}%)`)
    : changeToColor(pctVal, isDark);

  const gap = 1.5;
  const rx = x + gap;
  const ry = y + gap;
  const rw = width - gap * 2;
  const rh = height - gap * 2;
  if (rw < 2 || rh < 2) return null;

  const textColor = isDark ? '#FFFFFF' : (colorMode === 'weight' ? '#1A1A1D' : '#FFFFFF');
  const subTextColor = isDark ? 'rgba(255,255,255,0.6)' : (colorMode === 'weight' ? 'rgba(26,26,29,0.5)' : 'rgba(255,255,255,0.65)');

  // Adaptive font sizes based on cell dimensions
  const isLarge = rw > 100 && rh > 70;
  const isMedium = rw > 55 && rh > 45;
  const isSmall = rw > 30 && rh > 22;

  const displayPct = colorMode === 'total_return' ? total_gain_pct
    : colorMode === 'weight' ? pct_of_portfolio
    : day_gain_pct;

  return (
    <g style={{ cursor: 'pointer' }}>
      <rect x={rx} y={ry} width={rw} height={rh} rx={3} fill={bgColor} />

      {/* Ticker */}
      {isSmall && (
        <text x={rx + rw / 2} y={ry + (isLarge ? rh * 0.3 : isMedium ? rh * 0.38 : rh * 0.45)}
          textAnchor="middle" dominantBaseline="central"
          fill={textColor}
          fontSize={isLarge ? 14 : isMedium ? 11 : 9}
          fontFamily="DM Sans, sans-serif"
          fontWeight={700}
          style={{ textShadow: isDark ? '0 1px 2px rgba(0,0,0,0.5)' : 'none' }}
        >
          {ticker}
        </text>
      )}

      {/* Percentage */}
      {isMedium && displayPct != null && (
        <text x={rx + rw / 2} y={ry + rh * (isLarge ? 0.5 : 0.58)}
          textAnchor="middle" dominantBaseline="central"
          fill={subTextColor}
          fontSize={isLarge ? 12 : 10}
          fontFamily="Libre Baskerville, serif"
        >
          {colorMode === 'weight'
            ? `${displayPct.toFixed(1)}%`
            : `${displayPct >= 0 ? '+' : ''}${displayPct.toFixed(2)}%`}
        </text>
      )}

      {/* Price + Value on large cells */}
      {isLarge && (
        <>
          <text x={rx + rw / 2} y={ry + rh * 0.68}
            textAnchor="middle" dominantBaseline="central"
            fill={subTextColor} fontSize={9} fontFamily="Libre Baskerville, serif">
            ${(current_price || 0).toFixed(2)}
          </text>
          <text x={rx + rw / 2} y={ry + rh * 0.82}
            textAnchor="middle" dominantBaseline="central"
            fill={subTextColor} fontSize={8} fontFamily="DM Sans, sans-serif" opacity={0.5}>
            {fmtPrice(market_value || 0)}
          </text>
        </>
      )}
    </g>
  );
}

export default function PortfolioTreemap({ holdings }: PortfolioTreemapProps) {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [colorMode, setColorMode] = useState<TreemapColorMode>('day_change');

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';

  const treemapData = useMemo(() => {
    return holdings
      .filter((h) => (h.market_value || 0) > 0)
      .map((h) => ({
        name: h.ticker,
        ticker: h.ticker,
        size: h.market_value || 0,
        day_gain_pct: h.day_gain_pct || 0,
        total_gain_pct: h.total_gain_pct || 0,
        market_value: h.market_value || 0,
        current_price: h.current_price || 0,
        pct_of_portfolio: h.pct_of_portfolio || 0,
        security_type: classifyType(h.ticker || ''),
        colorMode,
        isDark,
      }))
      .sort((a, b) => b.size - a.size);
  }, [holdings, isDark, colorMode]);

  if (treemapData.length === 0) return null;

  // Stats
  const totalValue = treemapData.reduce((s, d) => s + d.market_value, 0);
  const gainers = treemapData.filter(d => d.day_gain_pct > 0).length;
  const losers = treemapData.filter(d => d.day_gain_pct < 0).length;

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    const dayPct = d.day_gain_pct || 0;
    const totalPct = d.total_gain_pct || 0;
    const greenC = isDark ? '#34C759' : '#28A745';
    const redC = isDark ? '#FF453A' : '#DC3545';
    return (
      <div className="px-3 py-2.5 rounded-lg shadow-xl"
        style={{
          background: isDark ? '#1A1A1D' : '#FFFFFF',
          border: `0.5px solid ${isDark ? '#3A3A3D' : '#D0D0D0'}`,
          minWidth: 140,
        }}>
        <div className="flex items-center justify-between gap-4 mb-1">
          <span className="text-xs font-body font-semibold">{d.ticker}</span>
          <span className="text-[9px] font-body px-1.5 py-0.5 rounded"
            style={{ background: `${gold}12`, color: gold }}>{d.security_type}</span>
        </div>
        <div className="space-y-0.5">
          <div className="flex justify-between text-[10px] font-body" style={{ color: textMuted }}>
            <span>Price</span>
            <span className="font-numeric">${d.current_price.toFixed(2)}</span>
          </div>
          <div className="flex justify-between text-[10px] font-body" style={{ color: textMuted }}>
            <span>Value</span>
            <span className="font-numeric">${d.market_value.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          </div>
          <div className="flex justify-between text-[10px] font-body" style={{ color: textMuted }}>
            <span>Weight</span>
            <span className="font-numeric">{(totalValue > 0 ? (d.market_value / totalValue) * 100 : 0).toFixed(1)}%</span>
          </div>
          <div className="h-px my-1" style={{ background: isDark ? '#2A2A2D' : '#E8E6E1' }} />
          <div className="flex justify-between text-[10px] font-body">
            <span style={{ color: textMuted }}>Day</span>
            <span className="font-numeric font-medium" style={{ color: dayPct >= 0 ? greenC : redC }}>
              {dayPct >= 0 ? '+' : ''}{dayPct.toFixed(2)}%
            </span>
          </div>
          <div className="flex justify-between text-[10px] font-body">
            <span style={{ color: textMuted }}>Total</span>
            <span className="font-numeric font-medium" style={{ color: totalPct >= 0 ? greenC : redC }}>
              {totalPct >= 0 ? '+' : ''}{totalPct.toFixed(2)}%
            </span>
          </div>
        </div>
      </div>
    );
  };

  const colorModes: { value: TreemapColorMode; label: string }[] = [
    { value: 'day_change', label: '1D change' },
    { value: 'total_return', label: 'Total return' },
    { value: 'weight', label: 'Weight' },
  ];

  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex gap-1">
          {colorModes.map((m) => (
            <button key={m.value} onClick={() => setColorMode(m.value)}
              className="text-[10px] font-body px-2 py-0.5 rounded transition-colors"
              style={{
                background: colorMode === m.value ? `${gold}15` : 'transparent',
                color: colorMode === m.value ? gold : textMuted,
              }}>
              {m.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-3 text-[10px] font-body" style={{ color: textMuted }}>
          <span style={{ color: isDark ? '#34C759' : '#28A745' }}>{gainers} up</span>
          <span style={{ color: isDark ? '#FF453A' : '#DC3545' }}>{losers} down</span>
          <span>{treemapData.length - gainers - losers} flat</span>
        </div>
      </div>

      {/* Treemap */}
      <div className="rounded-lg overflow-hidden" style={{ border: `0.5px solid ${border}` }}>
        <ResponsiveContainer width="100%" height={320}>
          <Treemap
            data={treemapData}
            dataKey="size"
            stroke="none"
            animationDuration={400}
            content={<TreemapCell />}
            onClick={(node: any) => {
              if (node?.ticker) navigate(`/app/research/${node.ticker}`);
            }}
          >
            <Tooltip content={<CustomTooltip />} />
          </Treemap>
        </ResponsiveContainer>
      </div>

      {/* Legend */}
      {colorMode !== 'weight' && (
        <div className="flex items-center justify-center gap-1.5 mt-3">
          <span className="text-[9px] font-numeric" style={{ color: isDark ? '#FF453A' : '#DC3545' }}>-5%</span>
          <div className="flex h-2.5 rounded-full overflow-hidden" style={{ width: 160 }}>
            {[...Array(20)].map((_, i) => (
              <div key={i} className="flex-1" style={{ background: changeToColor(-5 + (i * 10) / 19, isDark) }} />
            ))}
          </div>
          <span className="text-[9px] font-numeric" style={{ color: isDark ? '#34C759' : '#28A745' }}>+5%</span>
        </div>
      )}
      {colorMode === 'weight' && (
        <div className="flex items-center justify-center gap-1.5 mt-3">
          <span className="text-[9px] font-body" style={{ color: textMuted }}>Lighter = smaller position</span>
          <span className="text-[9px] font-body" style={{ color: gold }}>Brighter = larger position</span>
        </div>
      )}
    </div>
  );
}
