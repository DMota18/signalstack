// ─── Utils ───────────────────────────────────────────────────────────────────

export const CRYPTO_SET = new Set(['BTC','ETH','SOL','XRP','DOGE','ADA','DOT','AVAX','MATIC','LINK','BTC-USD','ETH-USD','SOL-USD','XRP-USD','DOGE-USD']);
export const ETF_SET = new Set(['SPY','QQQ','VTI','VOO','IWM','GLD','SLV','ARKK','XLF','XLE','XLK','SCHD','VGT','DIA','IBIT','BITO']);

export function classifyHolding(h: any): string {
  const t = (h.ticker || '').toUpperCase();
  if (CRYPTO_SET.has(t)) return 'crypto';
  if (ETF_SET.has(t)) return 'etfs';
  return 'equities';
}

export function labelToBusinessDay(label: string, idx: number, total: number, timestamp?: number): string {
  // Primary path: use timestamp if valid
  if (timestamp && timestamp > 0) {
    const d = new Date(timestamp * 1000);
    if (!isNaN(d.getTime())) {
      return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    }
  }
  // Fallback: parse the label string
  const d = new Date(label);
  if (!isNaN(d.getTime()) && d.getFullYear() > 2000) {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  // Last resort: offset from today
  const base = new Date();
  base.setDate(base.getDate() - (total - 1 - idx));
  return `${base.getFullYear()}-${String(base.getMonth() + 1).padStart(2, '0')}-${String(base.getDate()).padStart(2, '0')}`;
}

export function calcLocalStdDev(values: number[], center: number, windowRadius: number): number {
  const start = Math.max(0, center - windowRadius);
  const end = Math.min(values.length - 1, center + windowRadius);
  const slice = values.slice(start, end + 1);
  if (slice.length < 2) return 0;
  const mean = slice.reduce((s, v) => s + v, 0) / slice.length;
  const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / slice.length;
  return Math.sqrt(variance);
}

// ─── Technical indicator calculations ────────────────────────────────────────

export function calcSMA(data: { value: number }[], period: number): (number | null)[] {
  return data.map((_, i) => {
    if (i < period - 1) return null;
    const sum = data.slice(i - period + 1, i + 1).reduce((s, d) => s + d.value, 0);
    return sum / period;
  });
}

export function calcEMA(data: { value: number }[], period: number): (number | null)[] {
  const k = 2 / (period + 1);
  const result: (number | null)[] = [];
  let ema: number | null = null;
  for (let i = 0; i < data.length; i++) {
    if (i < period - 1) { result.push(null); continue; }
    if (ema === null) {
      ema = data.slice(0, period).reduce((s, d) => s + d.value, 0) / period;
    } else {
      ema = data[i].value * k + ema * (1 - k);
    }
    result.push(ema);
  }
  return result;
}

export function calcBollingerBands(data: { value: number }[], period: number, stdDev: number): { upper: (number | null)[]; lower: (number | null)[]; mid: (number | null)[] } {
  const mid = calcSMA(data, period);
  const upper: (number | null)[] = [];
  const lower: (number | null)[] = [];
  for (let i = 0; i < data.length; i++) {
    if (mid[i] === null) { upper.push(null); lower.push(null); continue; }
    const slice = data.slice(i - period + 1, i + 1).map(d => d.value);
    const mean = mid[i]!;
    const variance = slice.reduce((s, v) => s + (v - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance) * stdDev;
    upper.push(mean + sd);
    lower.push(mean - sd);
  }
  return { upper, lower, mid };
}

export function calcRSI(data: { value: number }[], period: number = 14): (number | null)[] {
  const result: (number | null)[] = [];
  let avgGain = 0, avgLoss = 0;
  for (let i = 0; i < data.length; i++) {
    if (i === 0) { result.push(null); continue; }
    const change = data[i].value - data[i - 1].value;
    const gain = change > 0 ? change : 0;
    const loss = change < 0 ? -change : 0;
    if (i < period) { avgGain += gain; avgLoss += loss; result.push(null); continue; }
    if (i === period) {
      avgGain = (avgGain + gain) / period;
      avgLoss = (avgLoss + loss) / period;
    } else {
      avgGain = (avgGain * (period - 1) + gain) / period;
      avgLoss = (avgLoss * (period - 1) + loss) / period;
    }
    const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    result.push(100 - (100 / (1 + rs)));
  }
  return result;
}

export function toHeikinAshi(candles: any[]): any[] {
  const ha: any[] = [];
  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const haClose = (c.open + c.high + c.low + c.close) / 4;
    const haOpen = i === 0 ? (c.open + c.close) / 2 : (ha[i - 1].open + ha[i - 1].close) / 2;
    ha.push({
      time: c.time,
      open: haOpen,
      close: haClose,
      high: Math.max(c.high, haOpen, haClose),
      low: Math.min(c.low, haOpen, haClose),
    });
  }
  return ha;
}
