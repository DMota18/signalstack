import { Building2, Globe, ExternalLink } from 'lucide-react';
import Section from './Section';
import { formatNumber } from '../../lib/format';
import type { ResearchTheme } from './types';

interface AboutSectionProps {
  profile: any;
  theme: ResearchTheme;
}

export default function AboutSection({ profile, theme }: AboutSectionProps) {
  const { isDark, gold, textMuted, textSecondary, surface, border } = theme;

  return (
    <Section title="About" icon={Building2} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
      <p className="text-sm font-body leading-relaxed" style={{ color: textSecondary }}>
        {profile.description}
      </p>
      <div className="flex gap-4 mt-3 flex-wrap">
        {profile.industry && (
          <span className="text-[10px] font-body px-2 py-0.5 rounded" style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
            {profile.industry}
          </span>
        )}
        {profile.country && (
          <span className="text-[10px] font-body px-2 py-0.5 rounded" style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
            {profile.country}
          </span>
        )}
        {profile.employees && (
          <span className="text-[10px] font-body" style={{ color: textMuted }}>
            {formatNumber(profile.employees)} employees
          </span>
        )}
        {profile.website && (
          <a href={profile.website} target="_blank" rel="noopener noreferrer"
            className="text-[10px] font-body flex items-center gap-1" style={{ color: gold }}>
            <Globe size={10} /> Website <ExternalLink size={8} />
          </a>
        )}
      </div>
    </Section>
  );
}
