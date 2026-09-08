import { Landmark } from 'lucide-react';
import Section from './Section';
import { fmtLargeNum } from './format';
import { formatNumber, formatPercent } from '../../lib/format';
import type { ResearchTheme } from './types';

interface InstitutionalHoldersProps {
  institutional: any;
  theme: ResearchTheme;
}

export default function InstitutionalHolders({ institutional, theme }: InstitutionalHoldersProps) {
  const { isDark, gold, textMuted, surface, border } = theme;

  return (
    <Section title="Institutional ownership" icon={Landmark} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
      {/* Major holders summary */}
      {Object.keys(institutional.major_holders || {}).length > 0 && (
        <div className="flex gap-3 mb-4 flex-wrap">
          {Object.entries(institutional.major_holders).map(([label, val]) => (
            <div key={label} className="text-center px-3 py-2 rounded-lg"
              style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
              <p className="text-sm font-numeric font-medium">{val as string}</p>
              <p className="text-[9px] font-body mt-0.5" style={{ color: textMuted }}>{label}</p>
            </div>
          ))}
        </div>
      )}
      {/* Top holders table */}
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] font-body" style={{ color: textMuted }}>
              <th className="text-left py-2 font-normal">Holder</th>
              <th className="text-right py-2 font-normal">Shares</th>
              <th className="text-right py-2 font-normal">Value</th>
              <th className="text-right py-2 font-normal">% Held</th>
            </tr>
          </thead>
          <tbody>
            {institutional.holders.map((h: any, i: number) => (
              <tr key={i} style={{ borderTop: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
                <td className="py-2.5 text-xs font-body">{h.holder}</td>
                <td className="py-2.5 text-xs font-numeric text-right">
                  {h.shares ? formatNumber(h.shares) : '—'}
                </td>
                <td className="py-2.5 text-xs font-numeric text-right">
                  {h.value ? fmtLargeNum(h.value) : '—'}
                </td>
                <td className="py-2.5 text-xs font-numeric text-right">
                  {h.pct_held != null ? formatPercent(h.pct_held * 100) : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Section>
  );
}
