import { Newspaper, Clock, ExternalLink } from 'lucide-react';
import Section from './Section';
import { timeAgo } from './format';
import type { ResearchTheme } from './types';

interface ResearchNewsProps {
  news: any[];
  theme: ResearchTheme;
}

export default function ResearchNews({ news, theme }: ResearchNewsProps) {
  const { isDark, gold, textMuted, surface, border } = theme;

  return (
    <Section title={`News (${news.length})`} icon={Newspaper} isDark={isDark} gold={gold} surface={surface} border={border}>
      <div className="space-y-3">
        {news.slice(0, 8).map((article: any, i: number) => (
          <a key={i} href={article.url} target="_blank" rel="noopener noreferrer"
            className="block rounded-lg p-3 transition-opacity hover:opacity-80"
            style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
            <p className="text-sm font-body leading-snug mb-1">{article.headline}</p>
            <div className="flex items-center gap-3">
              <span className="text-[10px] font-body" style={{ color: textMuted }}>{article.source}</span>
              <span className="text-[10px] font-body flex items-center gap-1" style={{ color: textMuted }}>
                <Clock size={9} /> {timeAgo(article.published_at)}
              </span>
              <ExternalLink size={10} style={{ color: textMuted }} />
            </div>
          </a>
        ))}
      </div>
    </Section>
  );
}
