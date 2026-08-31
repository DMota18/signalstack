/**
 * Shared number formatting — Intl.NumberFormat everywhere, cached per
 * configuration. Replaces the hand-rolled `'$' + n.toLocaleString(...)`
 * and `$${(v / 1e9).toFixed(1)}B` variants that were duplicated across
 * components with slightly different precision each time.
 */

const cache = new Map<string, Intl.NumberFormat>();

function formatter(options: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = JSON.stringify(options);
  let f = cache.get(key);
  if (!f) {
    f = new Intl.NumberFormat(undefined, options);
    cache.set(key, f);
  }
  return f;
}

/** $1,234.56 — full-precision currency for position values and prices. */
export function formatCurrency(value: number, maxFractionDigits = 2): string {
  return formatter({
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: Math.min(2, maxFractionDigits),
    maximumFractionDigits: maxFractionDigits,
  }).format(value);
}

/** $1.2K / $3.4M / $2.21T — compact currency for volumes and market caps. */
export function formatCompactCurrency(value: number): string {
  return formatter({
    style: 'currency',
    currency: 'USD',
    notation: 'compact',
    maximumFractionDigits: 1,
  }).format(value);
}

/** 11.24% — percentages always show 2 decimals (frontend display rule). */
export function formatPercent(value: number, opts: { signed?: boolean } = {}): string {
  const formatted = formatter({
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
    signDisplay: opts.signed ? 'exceptZero' : 'auto',
  }).format(value);
  return `${formatted}%`;
}

/** 1,234,567 — plain grouped number. */
export function formatNumber(value: number, maxFractionDigits = 2): string {
  return formatter({ maximumFractionDigits: maxFractionDigits }).format(value);
}

/** 1.2M / 3.4B — compact plain number for share volumes. */
export function formatCompactNumber(value: number): string {
  return formatter({ notation: 'compact', maximumFractionDigits: 1 }).format(value);
}
