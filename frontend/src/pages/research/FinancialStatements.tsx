import { useState } from 'react';
import { FileText } from 'lucide-react';
import Section from './Section';
import { formatCompactCurrency, formatPercent } from '../../lib/format';
import type { ResearchTheme } from './types';

// ─── Financial Statements Tabs ──────────────────────────────────────────

interface FinancialTabsProps {
  financials: any;
  isDark: boolean;
  gold: string;
  textMuted: string;
  border: string;
}

function FinancialTabs({ financials, isDark, gold, textMuted, border: _border }: FinancialTabsProps) {
  const [tab, setTab] = useState<'income' | 'balance' | 'cashflow'>('income');

  const tabs = [
    { key: 'income' as const, label: 'Income', data: financials.income_statement || [] },
    { key: 'balance' as const, label: 'Balance sheet', data: financials.balance_sheet || [] },
    { key: 'cashflow' as const, label: 'Cash flow', data: financials.cash_flow || [] },
  ];

  const activeTab = tabs.find((t) => t.key === tab) || tabs[0];
  const statements = activeTab.data;

  // Get all unique row keys across all periods
  const allKeys = new Set<string>();
  statements.forEach((s: any) => {
    Object.keys(s).forEach((k) => { if (k !== 'period') allKeys.add(k); });
  });

  const formatFinVal = (val: number | null | undefined): string => {
    if (val == null) return '—';
    return formatCompactCurrency(val);
  };

  const formatLabel = (key: string): string => {
    return key.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
  };

  if (statements.length === 0) return <p className="text-xs font-body" style={{ color: textMuted }}>No financial data available</p>;

  return (
    <div>
      <div className="flex gap-1 mb-4">
        {tabs.map((t) => (
          <button key={t.key} onClick={() => setTab(t.key)} aria-pressed={tab === t.key}
            className="text-[11px] font-body px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: tab === t.key ? `${gold}15` : 'transparent',
              color: tab === t.key ? gold : textMuted,
            }}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] font-body" style={{ color: textMuted }}>
              <th className="text-left py-2 font-normal sticky left-0 min-w-[160px]"
                style={{ background: isDark ? '#111113' : '#FFFFFF' }}>Item</th>
              {statements.map((s: any, si: number) => (
                <th key={s.period} className="text-right py-2 font-normal min-w-[90px]">
                  <div>{s.period ? new Date(s.period).getFullYear() : '—'}</div>
                  {si < statements.length - 1 && (
                    <div className="text-[8px]" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>YoY</div>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from(allKeys).slice(0, 20).map((key) => (
              <tr key={key} style={{ borderTop: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
                <td className="py-2 text-[11px] font-body sticky left-0 pr-4"
                  style={{ background: isDark ? '#111113' : '#FFFFFF', color: textMuted }}>
                  {formatLabel(key)}
                </td>
                {statements.map((s: any, si: number) => {
                  const val = s[key];
                  const prevStatement = statements[si + 1];
                  const prevVal = prevStatement ? prevStatement[key] : null;
                  const yoyPct = (val != null && prevVal != null && prevVal !== 0)
                    ? ((val - prevVal) / Math.abs(prevVal)) * 100
                    : null;

                  return (
                    <td key={s.period} className="py-2 text-right">
                      <div className="text-[11px] font-numeric">{formatFinVal(val)}</div>
                      {si < statements.length - 1 && yoyPct !== null && (
                        <div className="text-[9px] font-numeric flex items-center justify-end gap-0.5"
                          style={{ color: yoyPct >= 0 ? (isDark ? '#34C759' : '#28A745') : (isDark ? '#FF453A' : '#DC3545') }}>
                          {yoyPct >= 0 ? '▲' : '▼'} {formatPercent(Math.abs(yoyPct))}
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

interface FinancialStatementsProps {
  financials: any;
  theme: ResearchTheme;
}

export default function FinancialStatements({ financials, theme }: FinancialStatementsProps) {
  const { isDark, gold, textMuted, surface, border } = theme;

  return (
    <Section title="Financial statements" icon={FileText} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
      <FinancialTabs financials={financials} isDark={isDark} gold={gold} textMuted={textMuted} border={border} />
    </Section>
  );
}
