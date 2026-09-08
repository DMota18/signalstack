import { GitBranch } from 'lucide-react';
import Section from './Section';
import type { ResearchTheme } from './types';

interface SimilarStocksProps {
  similar: any;
  onSelectTicker: (ticker: string) => void;
  theme: ResearchTheme;
}

export default function SimilarStocks({ similar, onSelectTicker, theme }: SimilarStocksProps) {
  const { isDark, gold, textMuted, surface, border } = theme;

  return (
    <Section title={`Similar stocks — ${similar.sector || 'Sector'}`} icon={GitBranch} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
      <div className="flex gap-2 flex-wrap">
        {similar.tickers.map((t: string) => (
          <button key={t} onClick={() => onSelectTicker(t)}
            className="text-sm font-body font-medium px-4 py-2.5 rounded-lg transition-all hover:scale-105"
            style={{ background: isDark ? '#0C0C0E' : '#F8F7F4', border: `0.5px solid ${border}`, color: gold }}>
            {t}
          </button>
        ))}
      </div>
      {similar.industry && (
        <p className="text-[10px] font-body mt-3" style={{ color: textMuted }}>
          Industry: {similar.industry}
        </p>
      )}
    </Section>
  );
}
