import { useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';
import { formatPercent } from '../lib/format';

interface MarketIndex {
  symbol: string;
  label: string;
  price: number;
  change: number;
  changePct: number;
}

export default function MarketTicker() {
  const { isDark } = useTheme();
  const [indices, setIndices] = useState<MarketIndex[]>([]);
  const [loading, setLoading] = useState(true);

  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const borderColor = isDark ? '#1A1A1D' : '#E8E6E1';
  const bg = isDark ? '#08080A' : '#F5F3EE';

  useEffect(() => {
    fetchIndices();
    const interval = setInterval(fetchIndices, 120000);
    return () => clearInterval(interval);
  }, []);

  const fetchIndices = async () => {
    try {
      const resp = await fetch('/api/v1/chart/market-indices');
      if (resp.ok) {
        const data = await resp.json();
        if (data.status === 'ok' && Array.isArray(data.data)) {
          setIndices(data.data);
          setLoading(false);
          return;
        }
      }
      setIndices([
        { symbol: '^DJI', label: 'DOW', price: 42150.20, change: 125.40, changePct: 0.30 },
        { symbol: '^IXIC', label: 'NASDAQ', price: 17845.60, change: -42.30, changePct: -0.24 },
        { symbol: '^GSPC', label: 'S&P 500', price: 5768.40, change: 18.70, changePct: 0.32 },
        { symbol: '^VIX', label: 'VIX', price: 16.82, change: -0.45, changePct: -2.61 },
        { symbol: 'BTC-USD', label: 'BTC', price: 87420.00, change: 1240.00, changePct: 1.44 },
        { symbol: 'GC=F', label: 'Gold', price: 3048.50, change: 12.30, changePct: 0.41 },
        { symbol: '^TNX', label: '10Y', price: 4.31, change: -0.02, changePct: -0.46 },
      ]);
      setLoading(false);
    } catch {
      setLoading(false);
    }
  };

  if (loading && indices.length === 0) {
    return (
      <div className="h-9 rounded animate-pulse" style={{ background: bg }} />
    );
  }

  // Bare index level (points, not dollars) — needs grouping with a fixed
  // two-decimal minimum, which the shared plain-number helper does not expose.
  const fmtPrice = (p: number) => {
    return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  };

  // Double the items for seamless loop
  const items = [...indices, ...indices];

  return (
    <div className="relative overflow-hidden rounded-lg" style={{ background: bg, borderBottom: `1px solid ${borderColor}` }}>
      <div className="flex animate-ticker whitespace-nowrap py-2">
        {items.map((idx, i) => {
          const isUp = idx.changePct >= 0;
          const color = isUp ? greenColor : redColor;
          const arrow = isUp ? '▲' : '▼';

          return (
            <div key={`${idx.label}-${i}`} className="inline-flex items-center gap-2 px-4"
              style={{ borderRight: `1px solid ${borderColor}` }}>
              <span className="text-[11px] font-body font-semibold tracking-wider uppercase" style={{ color: textMuted }}>
                {idx.label}
              </span>
              <span className="text-[12px] font-numeric font-semibold tabular-nums">
                {fmtPrice(idx.price)}
              </span>
              <span className="text-[11px] font-numeric font-medium tabular-nums" style={{ color }}>
                {arrow} {formatPercent(idx.changePct, { signed: true })}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
