import { formatCurrency, formatCompactCurrency, formatPercent, formatCompactNumber } from '../../lib/format';

// ─── Formatting helpers (null-safe wrappers around lib/format) ───────────

export function fmtPrice(val: number | null | undefined): string {
  if (val == null || val === 0) return '—';
  return formatCurrency(val);
}

export function fmtLargeNum(val: number | null | undefined): string {
  if (val == null) return '—';
  return formatCompactCurrency(val);
}

export function fmtPct(val: number | null | undefined): string {
  if (val == null) return '—';
  return formatPercent(val * 100);
}

export function fmtRatio(val: number | null | undefined): string {
  if (val == null) return '—';
  return `${val.toFixed(2)}x`;
}

export function fmtVol(val: number | null | undefined): string {
  if (val == null) return '—';
  return formatCompactNumber(val);
}

export function timeAgo(dateStr: string): string {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.floor(hrs / 24);
  return `${days}d ago`;
}
