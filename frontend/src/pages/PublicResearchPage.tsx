import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link, Navigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { useAuth } from '../hooks/useAuth';
import { api } from '../api/client';
import { Search, Loader2, ArrowRight, Sun, Moon } from 'lucide-react';
import ResearchPage from './ResearchPage';

/**
 * Public research page wrapper.
 *
 * Provides a lightweight public shell (header with search + sign-in CTA)
 * around the existing ResearchPage component. No auth required.
 *
 * SEO: Sets document.title and meta tags dynamically based on ticker data.
 */
export default function PublicResearchPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const { isDark, toggleTheme } = useTheme();
  const { user } = useAuth();
  const navigate = useNavigate();

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#6A6A6D' : '#8A8A8D';
  const bg = isDark ? '#0C0C0E' : '#F8F7F4';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';

  // SEO meta tags
  useEffect(() => {
    if (ticker) {
      const t = ticker.toUpperCase();
      document.title = `${t} Signal Analysis — Polymarket Odds, Insider Activity, Institutional Flow | Zelador Analytics`;

      // Canonical URL
      setLink('canonical', `https://zeladoranalytics.com/research/${t}`);

      // Open Graph
      setMeta('og:title', `${t} — Signal Analysis | Zelador Analytics`);
      setMeta('og:description', `Research ${t}: prediction market odds, insider filings, institutional flow, fundamentals, and news — all in one page.`);
      setMeta('og:type', 'website');
      setMeta('og:url', `https://zeladoranalytics.com/research/${t}`);
      setMeta('og:image', `/api/v1/research/${t}/og-image`);

      // Twitter Card
      setMeta('twitter:card', 'summary_large_image');
      setMeta('twitter:title', `${t} Signal Analysis | Zelador Analytics`);
      setMeta('twitter:description', `Research ${t}: Polymarket odds, insider trades, institutional flow, macro context.`);
      setMeta('twitter:image', `/api/v1/research/${t}/og-image`);
    }

    return () => {
      document.title = 'Zelador Analytics — Every signal on your stock. One page.';
    };
  }, [ticker]);

  // If user is authenticated, redirect to the in-app version
  if (user && ticker) {
    return <Navigate to={`/app/research/${ticker}`} replace />;
  }

  return (
    <div className="min-h-screen" style={{ background: bg, color: isDark ? '#E8E6E1' : '#1A1A1D' }}>
      {/* Public header */}
      <header className="sticky top-0 z-50 backdrop-blur-md" style={{ background: `${bg}DD`, borderBottom: `0.5px solid ${border}` }}>
        <div className="max-w-5xl mx-auto px-4 py-3 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2">
            <span className="font-display text-base" style={{ color: gold }}>Zelador Analytics</span>
          </Link>

          <div className="flex items-center gap-3">
            <PublicSearch isDark={isDark} gold={gold} textMuted={textMuted} surface={surface} border={border} />

            <button onClick={toggleTheme} className="p-1.5 rounded-lg" style={{ color: textMuted }}>
              {isDark ? <Sun size={16} /> : <Moon size={16} />}
            </button>

            <Link
              to="/signup"
              className="text-xs font-body font-medium px-3 py-1.5 rounded-lg flex items-center gap-1.5 transition-colors"
              style={{ background: `${gold}15`, color: gold, border: `0.5px solid ${gold}30` }}
            >
              Sign up free <ArrowRight size={12} />
            </Link>
          </div>
        </div>
      </header>

      {/* Research content */}
      <main className="max-w-5xl mx-auto px-4 py-6">
        <ResearchPage />
      </main>

      {/* CTA banner */}
      <div className="sticky bottom-0 py-3 px-4 text-center backdrop-blur-md"
        style={{ background: `${bg}EE`, borderTop: `0.5px solid ${border}` }}>
        <p className="text-xs font-body" style={{ color: textMuted }}>
          Track this stock in your portfolio.{' '}
          <Link to="/signup" className="font-medium" style={{ color: gold }}>
            Create a free account
          </Link>
          {' '}to get daily intelligence on your holdings.
        </p>
      </div>

      {/* Disclaimer footer */}
      <footer className="max-w-5xl mx-auto px-4 py-6 text-center">
        <p className="text-[10px] font-body" style={{ color: isDark ? '#3A3A3D' : '#B0B0B0' }}>
          Educational market intelligence only. Not investment advice. All investment decisions are your own responsibility.
        </p>
        <p className="text-[10px] font-body mt-1" style={{ color: isDark ? '#3A3A3D' : '#B0B0B0' }}>
          Data from Finnhub, Polymarket, SEC EDGAR, FRED &middot; Prices may be delayed
        </p>
      </footer>
    </div>
  );
}


// ─── Compact public search bar ──────────────────────────────────────────

function PublicSearch({ isDark, gold, textMuted, surface, border }: {
  isDark: boolean; gold: string; textMuted: string; surface: string; border: string;
}) {
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const search = useCallback((q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.length < 1) { setResults([]); setOpen(false); return; }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      const res = await api.searchSymbols(q);
      if (res.status === 'ok' && Array.isArray(res.data)) {
        setResults(res.data);
        setOpen(true);
      }
      setLoading(false);
    }, 250);
  }, []);

  const handleSelect = (symbol: string) => {
    setOpen(false);
    setQuery('');
    navigate(`/research/${symbol}`);
  };

  return (
    <div ref={ref} className="relative hidden sm:block">
      <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs"
        style={{ background: isDark ? '#111113' : '#F0EEE8', border: `0.5px solid ${isDark ? '#2A2A2D' : '#D0D0D0'}` }}>
        {loading ? <Loader2 size={13} className="animate-spin" style={{ color: textMuted }} /> : <Search size={13} style={{ color: textMuted }} />}
        <input
          type="text"
          value={query}
          onChange={(e) => { setQuery(e.target.value); search(e.target.value); }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && query.trim()) {
              handleSelect(query.trim().toUpperCase());
            }
          }}
          placeholder="Search any ticker..."
          className="bg-transparent outline-none w-32 font-body"
          style={{ color: isDark ? '#E8E6E1' : '#1A1A1D' }}
        />
      </div>

      {open && results.length > 0 && (
        <div className="absolute top-full mt-1 left-0 right-0 rounded-lg shadow-xl overflow-hidden z-50"
          style={{ background: surface, border: `0.5px solid ${border}`, minWidth: '240px' }}>
          {results.slice(0, 6).map((r: any) => (
            <button
              key={r.symbol}
              onClick={() => handleSelect(r.symbol)}
              className="w-full flex items-center justify-between px-3 py-2 text-left transition-colors"
              style={{ borderBottom: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}
              onMouseEnter={(e) => (e.currentTarget.style.background = isDark ? '#1A1A1D' : '#F0EEE8')}
              onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}
            >
              <span className="text-xs font-body font-medium" style={{ color: gold }}>{r.symbol}</span>
              <span className="text-[10px] font-body truncate ml-2" style={{ color: textMuted, maxWidth: '150px' }}>{r.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}


// ─── SEO helper ─────────────────────────────────────────────────────────

function setMeta(name: string, content: string) {
  const attr = name.startsWith('og:') || name.startsWith('twitter:') ? 'property' : 'name';
  let el = document.querySelector(`meta[${attr}="${name}"]`) as HTMLMetaElement | null;
  if (!el) {
    el = document.createElement('meta');
    el.setAttribute(attr, name);
    document.head.appendChild(el);
  }
  el.content = content;
}

function setLink(rel: string, href: string) {
  let el = document.querySelector(`link[rel="${rel}"]`) as HTMLLinkElement | null;
  if (!el) {
    el = document.createElement('link');
    el.rel = rel;
    document.head.appendChild(el);
  }
  el.href = href;
}
