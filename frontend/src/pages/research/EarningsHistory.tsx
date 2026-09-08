import { CalendarDays, BarChart3 } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip as ReTooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts';
import Section from './Section';
import { formatCurrency, formatPercent } from '../../lib/format';
import type { ResearchTheme } from './types';

interface EarningsProps {
  earnings: any[];
  theme: ResearchTheme;
}

export function EarningsHistoryTable({ earnings, theme }: EarningsProps) {
  const { isDark, gold, textMuted, surface, border, greenColor, redColor } = theme;

  return (
    <Section title="Earnings history" icon={CalendarDays} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
      <div className="overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-[10px] font-body" style={{ color: textMuted }}>
              <th className="text-left py-2 font-normal">Date</th>
              <th className="text-right py-2 font-normal">Est. EPS</th>
              <th className="text-right py-2 font-normal">Actual EPS</th>
              <th className="text-right py-2 font-normal">Surprise</th>
            </tr>
          </thead>
          <tbody>
            {earnings.map((e: any, i: number) => {
              const surprise = e.surprise_pct;
              return (
                <tr key={i} style={{ borderTop: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
                  <td className="py-2.5 text-xs font-body">{e.date}</td>
                  <td className="py-2.5 text-xs font-numeric text-right">
                    {e.eps_estimate != null ? formatCurrency(e.eps_estimate) : '—'}
                  </td>
                  <td className="py-2.5 text-xs font-numeric text-right">
                    {e.reported_eps != null ? formatCurrency(e.reported_eps) : '—'}
                  </td>
                  <td className="py-2.5 text-xs font-numeric text-right" style={{
                    color: surprise == null ? textMuted : surprise >= 0 ? greenColor : redColor,
                  }}>
                    {surprise != null ? formatPercent(surprise, { signed: true }) : '—'}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </Section>
  );
}

export function EarningsSurpriseChart({ earnings, theme }: EarningsProps) {
  const { isDark, gold, textMuted, surface, border, greenColor, redColor } = theme;

  return (
    <Section title="Earnings vs estimates" icon={BarChart3} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={[...earnings].reverse().filter((e: any) => e.eps_estimate != null || e.reported_eps != null)}>
          <XAxis dataKey="date" axisLine={false} tickLine={false}
            tick={{ fontSize: 10, fill: textMuted }}
            tickFormatter={(d: string) => {
              try { return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', year: '2-digit' }); }
              catch { return d; }
            }} />
          <YAxis axisLine={false} tickLine={false}
            tick={{ fontSize: 10, fill: textMuted }}
            tickFormatter={(v: number) => formatCurrency(v)}
            width={50} />
          <ReTooltip
            contentStyle={{
              background: isDark ? '#151517' : '#FFFFFF',
              border: `0.5px solid ${border}`,
              borderRadius: 8, fontSize: 12,
            }}
            formatter={(val: number, name: string) => [formatCurrency(val), name === 'eps_estimate' ? 'Estimate' : 'Actual']}
          />
          <ReferenceLine y={0} stroke={isDark ? '#2A2A2D' : '#D0D0D0'} />
          <Bar dataKey="eps_estimate" fill={isDark ? '#2A2A2D' : '#D0D0D0'} radius={[3, 3, 0, 0]} barSize={16} name="eps_estimate" />
          <Bar dataKey="reported_eps" radius={[3, 3, 0, 0]} barSize={16} name="reported_eps">
            {[...earnings].reverse().filter((e: any) => e.eps_estimate != null || e.reported_eps != null).map((e: any, i: number) => (
              <Cell key={i} fill={
                e.reported_eps != null && e.eps_estimate != null
                  ? e.reported_eps >= e.eps_estimate ? greenColor : redColor
                  : gold
              } />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 justify-center">
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: isDark ? '#2A2A2D' : '#D0D0D0' }} />
          <span className="text-[10px] font-body" style={{ color: textMuted }}>Estimate</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: greenColor }} />
          <span className="text-[10px] font-body" style={{ color: textMuted }}>Beat</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: redColor }} />
          <span className="text-[10px] font-body" style={{ color: textMuted }}>Miss</span>
        </div>
      </div>
    </Section>
  );
}
