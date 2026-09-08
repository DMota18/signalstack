import { useState } from 'react';
import { ChevronDown, ChevronUp } from 'lucide-react';

// ─── Section wrapper ─────────────────────────────────────────────────────

interface SectionProps {
  title: string;
  icon: any;
  children: React.ReactNode;
  isDark: boolean;
  gold: string;
  surface: string;
  border: string;
  defaultOpen?: boolean;
}

export default function Section({ title, icon: Icon, children, isDark, gold, surface, border, defaultOpen = true }: SectionProps) {
  const [open, setOpen] = useState(defaultOpen);
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';

  return (
    <div className="rounded-xl overflow-hidden" style={{ background: surface, border: `0.5px solid ${border}` }}>
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="w-full flex items-center justify-between px-5 py-4"
      >
        <div className="flex items-center gap-2.5">
          <Icon size={15} style={{ color: gold }} aria-hidden="true" />
          <span className="text-sm font-body font-medium">{title}</span>
        </div>
        {open ? <ChevronUp size={15} style={{ color: textMuted }} aria-hidden="true" /> : <ChevronDown size={15} style={{ color: textMuted }} aria-hidden="true" />}
      </button>
      {open && (
        <div className="px-5 pb-5" style={{ borderTop: `0.5px solid ${border}` }}>
          <div className="pt-4">{children}</div>
        </div>
      )}
    </div>
  );
}
