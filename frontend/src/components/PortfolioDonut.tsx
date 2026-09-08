import { useMemo, useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import { useNavigate } from 'react-router-dom';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getBrandColor } from '../lib/brandColors';
import { formatCompactCurrency, formatPercent } from '../lib/format';

interface PortfolioDonutProps {
  holdings: any[];
}

type DonutView = 'ticker' | 'type' | 'sector' | 'cap';

// Color palette — gold-adjacent warm tones + signal colors
const COLORS_DARK = [
  '#D4A843', '#C4963B', '#B48433', '#A4722B',
  '#34C759', '#5AC778', '#8A8A8D', '#FF9500',
  '#FF453A', '#AF52DE', '#5856D6', '#007AFF',
];
const COLORS_LIGHT = [
  '#8B6914', '#9B7924', '#AB8934', '#BB9944',
  '#28A745', '#3DB860', '#6A6A6D', '#E08A00',
  '#DC3545', '#9B3FC4', '#4845B5', '#0066DD',
];

// Fixed colors for category views
const TYPE_COLORS: Record<string, { dark: string; light: string }> = {
  Equities: { dark: '#34C759', light: '#28A745' },
  Crypto: { dark: '#F7931A', light: '#D47B0A' },
  ETFs: { dark: '#5856D6', light: '#4845B5' },
  Other: { dark: '#8A8A8D', light: '#6A6A6D' },
};

const CAP_COLORS: Record<string, { dark: string; light: string }> = {
  'Mega Cap': { dark: '#D4A843', light: '#8B6914' },
  'Large Cap': { dark: '#34C759', light: '#28A745' },
  'Mid Cap': { dark: '#5856D6', light: '#4845B5' },
  'Small Cap': { dark: '#FF9500', light: '#E08A00' },
  Unknown: { dark: '#8A8A8D', light: '#6A6A6D' },
};

function classifySecurityType(h: any): string {
  const type = (h.security_type || '').toLowerCase();
  const ticker = (h.ticker || '').toUpperCase();
  const CRYPTO = new Set(['BTC', 'ETH', 'SOL', 'XRP', 'DOGE', 'ADA', 'DOT', 'AVAX', 'MATIC', 'LINK',
    'BTC-USD', 'ETH-USD', 'SOL-USD', 'XRP-USD', 'DOGE-USD']);
  const ETF = new Set(['SPY', 'QQQ', 'VTI', 'VOO', 'IWM', 'GLD', 'SLV', 'ARKK', 'XLF', 'XLE', 'XLK',
    'SCHD', 'VGT', 'DIA', 'IBIT', 'BITO']);

  if (CRYPTO.has(ticker) || type.includes('crypto')) return 'Crypto';
  if (ETF.has(ticker) || type.includes('etf')) return 'ETFs';
  return 'Equities';
}

// Client-side sector mapping — covers common tickers when the backend
// doesn't return a sector field on holdings.
const TICKER_SECTORS: Record<string, string> = {
  // Technology
  AAPL: 'Technology', GOOGL: 'Technology', GOOG: 'Technology', MSFT: 'Technology',
  META: 'Technology', NVDA: 'Technology', INTC: 'Technology', AMD: 'Technology',
  ADBE: 'Technology', CRM: 'Technology', ORCL: 'Technology', NFLX: 'Technology',
  SNOW: 'Technology', PLTR: 'Technology', MU: 'Technology', TSM: 'Technology',
  AVGO: 'Technology', QCOM: 'Technology', TXN: 'Technology', LRCX: 'Technology',
  KLAC: 'Technology', AMAT: 'Technology', MRVL: 'Technology', ARM: 'Technology',
  SMCI: 'Technology', DELL: 'Technology', NET: 'Technology', CRWD: 'Technology',
  ZS: 'Technology', DDOG: 'Technology', MDB: 'Technology', PANW: 'Technology',
  FTNT: 'Technology', OKTA: 'Technology', NOW: 'Technology', WDAY: 'Technology',
  TEAM: 'Technology', SHOP: 'Technology', ZM: 'Technology', DOCU: 'Technology',
  TWLO: 'Technology', RBLX: 'Technology', U: 'Technology', EA: 'Technology',
  TTWO: 'Technology', ATVI: 'Technology', SPOT: 'Technology', SNAP: 'Technology',
  PINS: 'Technology', ROKU: 'Technology',

  // E-Commerce / Consumer Internet
  AMZN: 'Consumer Cyclical', BABA: 'Consumer Cyclical', JD: 'Consumer Cyclical',
  PDD: 'Consumer Cyclical', BIDU: 'Technology',

  // Automotive / EV / Transportation
  TSLA: 'Transportation', RIVN: 'Transportation', LCID: 'Transportation',
  NIO: 'Transportation', LI: 'Transportation', XPEV: 'Transportation',
  F: 'Transportation', GM: 'Transportation',
  UPS: 'Transportation', FDX: 'Transportation', DAL: 'Transportation',
  UAL: 'Transportation', LUV: 'Transportation', AAL: 'Transportation',
  UBER: 'Transportation', BA: 'Aerospace & Defense',

  // Finance
  JPM: 'Financials', BAC: 'Financials', GS: 'Financials', MS: 'Financials',
  V: 'Financials', MA: 'Financials', PYPL: 'Financials', SQ: 'Financials',
  AXP: 'Financials', SCHW: 'Financials', BLK: 'Financials', ICE: 'Financials',
  CME: 'Financials', WFC: 'Financials', C: 'Financials', USB: 'Financials',
  BK: 'Financials', STT: 'Financials', COIN: 'Financials', HOOD: 'Financials',
  SOFI: 'Financials', DKNG: 'Financials',

  // Healthcare
  JNJ: 'Healthcare', PFE: 'Healthcare', UNH: 'Healthcare', LLY: 'Healthcare',
  ABBV: 'Healthcare', MRK: 'Healthcare', TMO: 'Healthcare', ABT: 'Healthcare',
  AMGN: 'Healthcare', GILD: 'Healthcare', REGN: 'Healthcare', VRTX: 'Healthcare',
  ISRG: 'Healthcare', DXCM: 'Healthcare', MRNA: 'Healthcare',

  // Energy
  XOM: 'Energy', CVX: 'Energy', COP: 'Energy', SLB: 'Energy', OXY: 'Energy',
  XLE: 'Energy',

  // Consumer Staples
  KO: 'Consumer Staples', PEP: 'Consumer Staples', WMT: 'Consumer Staples',
  COST: 'Consumer Staples', PG: 'Consumer Staples', CL: 'Consumer Staples',
  MCD: 'Consumer Staples', SBUX: 'Consumer Staples', TGT: 'Consumer Staples',
  CMG: 'Consumer Staples', YUM: 'Consumer Staples',

  // Consumer Discretionary
  NKE: 'Consumer Cyclical', HD: 'Consumer Cyclical', LOW: 'Consumer Cyclical',
  ABNB: 'Consumer Cyclical', DIS: 'Consumer Cyclical', LULU: 'Consumer Cyclical',
  TJX: 'Consumer Cyclical', ROST: 'Consumer Cyclical', EL: 'Consumer Cyclical',
  MGM: 'Consumer Cyclical',

  // Industrials & Defense
  CAT: 'Industrials', DE: 'Industrials', HON: 'Industrials', GE: 'Industrials',
  RTX: 'Aerospace & Defense', LMT: 'Aerospace & Defense', NOC: 'Aerospace & Defense',

  // Telecom / Utilities
  T: 'Telecom', VZ: 'Telecom', TMUS: 'Telecom',
  NEE: 'Utilities', DUK: 'Utilities', SO: 'Utilities',

  // REITs
  AMT: 'Real Estate', PLD: 'Real Estate', CCI: 'Real Estate',
  O: 'Real Estate', SPG: 'Real Estate',

  // Precious Metals / Mining
  GLD: 'Precious Metals', SLV: 'Precious Metals', NEM: 'Precious Metals',
  GOLD: 'Precious Metals', FCX: 'Precious Metals',

  // Crypto
  BTC: 'Crypto', 'BTC-USD': 'Crypto', ETH: 'Crypto', 'ETH-USD': 'Crypto',
  SOL: 'Crypto', 'SOL-USD': 'Crypto', XRP: 'Crypto', 'XRP-USD': 'Crypto',
  DOGE: 'Crypto', 'DOGE-USD': 'Crypto', ADA: 'Crypto', DOT: 'Crypto',
  AVAX: 'Crypto', MATIC: 'Crypto', LINK: 'Crypto',
  MSTR: 'Crypto', MARA: 'Crypto', RIOT: 'Crypto', CLSK: 'Crypto', IREN: 'Crypto',
  IBIT: 'Crypto', BITO: 'Crypto',

  // Fertilizers / Agriculture
  NTR: 'Agriculture', MOS: 'Agriculture', CF: 'Agriculture',

  // Broad ETFs
  SPY: 'Broad Market ETF', QQQ: 'Broad Market ETF', VTI: 'Broad Market ETF',
  VOO: 'Broad Market ETF', IWM: 'Broad Market ETF', DIA: 'Broad Market ETF',
  SCHD: 'Broad Market ETF', VGT: 'Broad Market ETF', ARKK: 'Broad Market ETF',
  XLF: 'Financials', XLK: 'Technology',
};

function classifySector(h: any): string {
  const ticker = (h.ticker || '').toUpperCase();
  // Use backend sector if available
  if (h.sector && h.sector.length > 1) return h.sector;
  // Client-side mapping
  const mapped = TICKER_SECTORS[ticker];
  if (mapped) return mapped;
  // Fallback to security type classification
  return classifySecurityType(h);
}

function classifyMarketCap(h: any): string {
  const price = h.current_price || 0;
  // Rough estimate: if the user holds it and the price is high, assume large/mega cap
  // This is a heuristic since we don't have actual market cap per holding here
  if (price > 500) return 'Mega Cap';
  if (price > 100) return 'Large Cap';
  if (price > 20) return 'Mid Cap';
  if (price > 0) return 'Small Cap';
  return 'Unknown';
}

export default function PortfolioDonut({ holdings }: PortfolioDonutProps) {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [view, setView] = useState<DonutView>('ticker');

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const colors = isDark ? COLORS_DARK : COLORS_LIGHT;

  const totalValue = holdings.reduce((sum, h) => sum + (h.market_value || 0), 0);

  // Build chart data based on the active view
  const { chartData, getColor, isClickable } = useMemo(() => {
    const filtered = holdings.filter((h) => (h.market_value || 0) > 0);

    if (view === 'ticker') {
      const sorted = [...filtered].sort((a, b) => (b.market_value || 0) - (a.market_value || 0));
      const top = sorted.slice(0, 8);
      const rest = sorted.slice(8);
      const restValue = rest.reduce((sum, h) => sum + (h.market_value || 0), 0);

      const data = top.map((h) => ({
        label: h.ticker,
        value: h.market_value || 0,
        pct: h.pct_of_portfolio || (totalValue > 0 ? ((h.market_value || 0) / totalValue) * 100 : 0),
        ticker: h.ticker,
      }));

      if (restValue > 0) {
        data.push({
          label: 'Other',
          value: restValue,
          pct: totalValue > 0 ? (restValue / totalValue) * 100 : 0,
          ticker: '',
        });
      }

      const getColor = (d: any, i: number) => {
        if (d.label === 'Other') return isDark ? '#8A8A8D' : '#6A6A6D';
        return getBrandColor(d.label, colors[i % colors.length]);
      };

      return { chartData: data, getColor, isClickable: (d: any) => d.label !== 'Other' };
    }

    if (view === 'type') {
      const groups: Record<string, number> = {};
      filtered.forEach((h) => {
        const type = classifySecurityType(h);
        groups[type] = (groups[type] || 0) + (h.market_value || 0);
      });
      const data = Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({
          label,
          value,
          pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
          ticker: '',
        }));
      const getColor = (d: any) => (TYPE_COLORS[d.label] || TYPE_COLORS.Other)[isDark ? 'dark' : 'light'];
      return { chartData: data, getColor, isClickable: () => false };
    }

    if (view === 'sector') {
      const groups: Record<string, number> = {};
      filtered.forEach((h) => {
        const sector = classifySector(h);
        groups[sector] = (groups[sector] || 0) + (h.market_value || 0);
      });
      const data = Object.entries(groups)
        .sort((a, b) => b[1] - a[1])
        .map(([label, value]) => ({
          label: label.length > 16 ? label.slice(0, 14) + '...' : label,
          value,
          pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
          ticker: '',
        }));
      const SECTOR_COLORS: Record<string, { dark: string; light: string }> = {
        Technology:          { dark: '#5856D6', light: '#4845B5' },
        Financials:          { dark: '#007AFF', light: '#0066DD' },
        Healthcare:          { dark: '#34C759', light: '#28A745' },
        Energy:              { dark: '#FF9500', light: '#E08A00' },
        'Consumer Cyclical': { dark: '#FF453A', light: '#DC3545' },
        'Consumer Staples':  { dark: '#AF52DE', light: '#9B3FC4' },
        Industrials:         { dark: '#5AC778', light: '#3DB860' },
        Transportation:      { dark: '#30B0C7', light: '#2090A7' },
        'Aerospace & Defense': { dark: '#636366', light: '#48484A' },
        Telecom:             { dark: '#FF6B6B', light: '#D04545' },
        Utilities:           { dark: '#64D2FF', light: '#4BA8CC' },
        'Real Estate':       { dark: '#FFD60A', light: '#BFA000' },
        'Precious Metals':   { dark: '#D4A843', light: '#8B6914' },
        Crypto:              { dark: '#F7931A', light: '#D47B0A' },
        Agriculture:         { dark: '#76B900', light: '#5A8F00' },
        'Broad Market ETF':  { dark: '#8A8A8D', light: '#6A6A6D' },
      };
      const getColor = (d: any, i: number) => {
        const sc = SECTOR_COLORS[d.label];
        if (sc) return isDark ? sc.dark : sc.light;
        return colors[i % colors.length];
      };
      return { chartData: data, getColor, isClickable: () => false };
    }

    // cap
    const groups: Record<string, number> = {};
    filtered.forEach((h) => {
      const cap = classifyMarketCap(h);
      groups[cap] = (groups[cap] || 0) + (h.market_value || 0);
    });
    const data = Object.entries(groups)
      .sort((a, b) => b[1] - a[1])
      .map(([label, value]) => ({
        label,
        value,
        pct: totalValue > 0 ? (value / totalValue) * 100 : 0,
        ticker: '',
      }));
    const getColor = (d: any) => (CAP_COLORS[d.label] || CAP_COLORS.Unknown)[isDark ? 'dark' : 'light'];
    return { chartData: data, getColor, isClickable: () => false };
  }, [holdings, view, isDark, totalValue, colors]);

  if (chartData.length === 0) return null;

  const CustomTooltip = ({ active, payload }: any) => {
    if (!active || !payload?.[0]) return null;
    const d = payload[0].payload;
    return (
      <div className="px-3 py-2 rounded-lg shadow-lg"
        style={{
          background: isDark ? '#151517' : '#FFFFFF',
          border: `0.5px solid ${isDark ? '#2A2A2D' : '#E8E6E1'}`,
        }}>
        <p className="text-xs font-body font-medium">{d.label}</p>
        <p className="text-xs font-numeric" style={{ color: gold }}>
          {formatCompactCurrency(d.value)} ({formatPercent(d.pct)})
        </p>
      </div>
    );
  };

  const views: { value: DonutView; label: string }[] = [
    { value: 'ticker', label: 'By ticker' },
    { value: 'type', label: 'By type' },
    { value: 'sector', label: 'By sector' },
    { value: 'cap', label: 'By cap' },
  ];

  return (
    <div>
      {/* View toggle */}
      <div className="flex gap-1 mb-4">
        {views.map((v) => (
          <button key={v.value} onClick={() => setView(v.value)} aria-pressed={view === v.value}
            className="text-[10px] font-body px-2.5 py-1 rounded-md transition-colors"
            style={{
              background: view === v.value ? `${gold}15` : 'transparent',
              color: view === v.value ? gold : textMuted,
            }}>
            {v.label}
          </button>
        ))}
      </div>

      <div className="flex items-center gap-6">
        {/* Donut chart */}
        <div className="relative" style={{ width: 160, height: 160 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={chartData}
                cx="50%"
                cy="50%"
                innerRadius={50}
                outerRadius={72}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
                animationBegin={0}
                animationDuration={800}
              >
                {chartData.map((d, i) => (
                  <Cell
                    key={i}
                    fill={getColor(d, i)}
                    cursor={isClickable(d) ? 'pointer' : 'default'}
                    onClick={() => {
                      if (isClickable(d) && d.ticker) navigate(`/app/research/${d.ticker}`);
                    }}
                  />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
          {/* Center label */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <p className="font-numeric text-sm font-medium" style={{ color: gold }}>
              {formatCompactCurrency(totalValue)}
            </p>
            <p className="text-[9px] font-body" style={{ color: textMuted }}>Total</p>
          </div>
        </div>

        {/* Legend */}
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-1.5">
          {chartData.map((d, i) => (
            <button
              key={d.label}
              onClick={() => isClickable(d) && d.ticker && navigate(`/app/research/${d.ticker}`)}
              className="flex items-center gap-2 text-left transition-opacity hover:opacity-70"
              style={{ cursor: isClickable(d) ? 'pointer' : 'default' }}
            >
              <span className="w-2.5 h-2.5 rounded-sm shrink-0" aria-hidden="true"
                style={{ background: getColor(d, i) }} />
              <span className="text-[11px] font-body truncate">{d.label}</span>
              <span className="text-[10px] font-numeric ml-auto" style={{ color: textMuted }}>
                {formatPercent(d.pct)}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
