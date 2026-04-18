import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { ArrowRight, Shield, Zap, TrendingUp, BarChart3, Sun, Moon, Search } from 'lucide-react';

export default function LandingPage() {
  const { isDark, toggleTheme } = useTheme();

  const gold = isDark ? '#D4A843' : '#8B6914';
  const bg = isDark ? '#0C0C0E' : '#FAFAF8';
  const surface = isDark ? '#111113' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const textPrimary = isDark ? '#E8E6E1' : '#1A1A1D';
  const textMuted = isDark ? '#6A6A6D' : '#8A8A8D';

  return (
    <div className="min-h-screen" style={{ background: bg, color: textPrimary }}>
      {/* Nav */}
      <nav className="flex items-center justify-between px-6 lg:px-16 py-5" style={{ borderBottom: `0.5px solid ${border}` }}>
        <span className="font-display text-lg tracking-wide" style={{ color: gold }}>Zelador Analytics</span>
        <div className="flex items-center gap-4">
          <button onClick={toggleTheme} className="p-2 rounded-lg opacity-50 hover:opacity-100 transition-opacity">
            {isDark ? <Sun size={16} /> : <Moon size={16} />}
          </button>
          <Link to="/signin" className="text-sm font-body" style={{ color: textMuted }}>Sign in</Link>
          <Link to="/signup" className="btn-gold text-sm">Sign up free</Link>
        </div>
      </nav>

      {/* Hero */}
      <section className="px-6 lg:px-16 pt-20 pb-16 max-w-5xl mx-auto text-center">
        <p className="text-xs tracking-[3px] mb-6 font-body" style={{ color: gold }}>
          RESEARCH TERMINAL
        </p>
        <h1 className="font-display text-4xl lg:text-6xl leading-tight mb-6">
          Every signal on your stock.<br />
          <span style={{ color: gold }}>One page.</span>
        </h1>
        <p className="text-lg lg:text-xl max-w-2xl mx-auto mb-10 font-body leading-relaxed" style={{ color: textMuted }}>
          Prediction market odds, insider filings, institutional flow, fundamentals, and macro context —
          aggregated from real sources, not generated opinions. Research any ticker for free.
        </p>

        {/* CTA */}
        <div className="flex flex-col sm:flex-row gap-3 justify-center max-w-md mx-auto mb-4">
          <Link to="/signup" className="btn-gold whitespace-nowrap flex items-center justify-center gap-2 px-6 py-3">
            Start researching <ArrowRight size={14} />
          </Link>
          <Link to="/research/NVDA"
            className="px-6 py-3 rounded-lg text-sm font-body flex items-center justify-center gap-2 transition-colors"
            style={{ border: `0.5px solid ${border}`, color: textMuted }}>
            <Search size={14} /> Try NVDA
          </Link>
        </div>
        <p className="text-xs font-body" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
          Free tier: unlimited research pages. No credit card required.
        </p>
      </section>

      {/* Demo preview */}
      <section className="px-6 lg:px-16 pb-20 max-w-5xl mx-auto">
        <div className="rounded-2xl overflow-hidden" style={{ background: surface, border: `0.5px solid ${border}` }}>
          <div className="px-6 py-4 flex items-center justify-between" style={{ borderBottom: `0.5px solid ${border}` }}>
            <span className="text-xs font-body" style={{ color: textMuted }}>Live intelligence preview</span>
            <span className="text-xs px-3 py-1 rounded-full font-body" style={{ background: `${gold}15`, color: gold }}>
              Demo data
            </span>
          </div>

          <div className="p-6 space-y-4">
            <div className="rounded-xl p-5" style={{
              background: isDark ? '#151517' : '#F8F7F4',
              borderLeft: `3px solid ${gold}`,
            }}>
              <p className="text-[10px] tracking-[1px] mb-2 font-body" style={{ color: gold }}>PRE-EARNINGS INTELLIGENCE</p>
              <p className="font-display text-lg mb-2">NVDA reports in 4 days</p>
              <p className="text-sm font-body leading-relaxed" style={{ color: textMuted }}>
                Polymarket prices <span style={{ color: gold }}>73% probability</span> of an earnings beat.
                Two insiders purchased <span style={{ color: gold }}>$1.4M</span> in shares this week.
                Institutional holdings increased 15% per latest 13F filing. Your position represents
                22.1% of your portfolio. Net signal:{' '}
                <span className="signal-conflicting">Conflicting</span> — short-term sentiment
                bearish on export restrictions, but forward-looking indicators uniformly bullish.
              </p>
              <div className="flex gap-2 mt-3">
                <span className="text-[10px] px-2 py-0.5 rounded font-body" style={{ background: `${gold}12`, color: gold }}>Polymarket</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-body" style={{ background: `${gold}12`, color: gold }}>Insider</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-body" style={{ background: `${gold}12`, color: gold }}>Institutional</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-body" style={{ background: `${gold}12`, color: gold }}>Sentiment</span>
                <span className="text-[10px] px-2 py-0.5 rounded font-body" style={{ background: `${gold}12`, color: gold }}>Macro</span>
              </div>
            </div>

            <div className="rounded-xl p-5" style={{
              background: isDark ? '#151517' : '#F8F7F4',
              borderLeft: `3px solid #34C759`,
            }}>
              <p className="text-[10px] tracking-[1px] mb-2 font-body" style={{ color: '#34C759' }}>MACRO EVENT</p>
              <p className="font-display text-lg mb-2">Fed holds rates steady</p>
              <p className="text-sm font-body leading-relaxed" style={{ color: textMuted }}>
                Your tech positions (NVDA, PLTR) benefit from stable rates — historically
                tech outperforms by <span className="text-signal-bullish">2.3%</span> in the 30 days following
                a hold decision. Gold allocation (GLD) may see reduced safe-haven demand.
                Net portfolio impact: <span className="text-signal-bullish">slightly positive</span>.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* What makes this different */}
      <section className="px-6 lg:px-16 pb-20 max-w-5xl mx-auto">
        <p className="text-xs tracking-[3px] text-center mb-4 font-body" style={{ color: gold }}>WHAT YOU GET</p>
        <h2 className="font-display text-2xl lg:text-3xl text-center mb-4">
          Five data sources. One research page.
        </h2>
        <p className="text-sm font-body text-center mb-12 max-w-lg mx-auto" style={{ color: textMuted }}>
          We pull from real data sources — not just LLM summaries. Every number has a source. Every probability is market-priced.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-5 gap-4">
          {[
            { icon: TrendingUp, title: 'Prediction markets', desc: 'Polymarket real-money probabilities', badge: 'Unique' },
            { icon: Shield, title: 'Insider activity', desc: 'SEC Form 4 buys and sells' },
            { icon: Zap, title: 'Institutional flow', desc: '13F positions from top funds' },
            { icon: BarChart3, title: 'Market sentiment', desc: 'News volume and direction' },
            { icon: BarChart3, title: 'Macro context', desc: 'Fed, CPI, rates, sector impact' },
          ].map((item, i) => (
            <div key={i} className="text-center p-5 rounded-xl relative" style={{ background: surface, border: `0.5px solid ${border}` }}>
              {(item as any).badge && (
                <span className="absolute top-2 right-2 text-[9px] px-1.5 py-0.5 rounded-full font-body"
                  style={{ background: '#818CF815', color: '#818CF8' }}>
                  {(item as any).badge}
                </span>
              )}
              <div className="w-10 h-10 rounded-lg flex items-center justify-center mx-auto mb-3"
                style={{ background: `${gold}12` }}>
                <item.icon size={18} style={{ color: gold }} strokeWidth={1.5} />
              </div>
              <p className="font-display text-sm mb-1">{item.title}</p>
              <p className="text-xs font-body" style={{ color: textMuted }}>{item.desc}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Pricing — honest, simple */}
      <section className="px-6 lg:px-16 pb-20 max-w-3xl mx-auto">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="rounded-xl p-6" style={{ background: surface, border: `0.5px solid ${border}` }}>
            <p className="font-display text-sm mb-1">Free</p>
            <p className="font-display text-3xl mb-3">$0</p>
            <ul className="space-y-2 text-sm font-body" style={{ color: textMuted }}>
              <li>Research any ticker — unlimited</li>
              <li>Polymarket odds overlay</li>
              <li>Insider + institutional data</li>
              <li>5 portfolio tickers</li>
              <li>Signal radar chart</li>
            </ul>
            <Link to="/signup" className="block text-center mt-5 py-2.5 rounded-lg text-sm font-body"
              style={{ border: `0.5px solid ${border}`, color: textMuted }}>
              Sign up free
            </Link>
          </div>
          <div className="rounded-xl p-6 relative" style={{ background: surface, border: `1px solid ${gold}40` }}>
            <span className="absolute top-3 right-3 text-[10px] px-2 py-0.5 rounded-full font-body"
              style={{ background: `${gold}15`, color: gold }}>Popular</span>
            <p className="font-display text-sm mb-1" style={{ color: gold }}>Pro</p>
            <div className="flex items-baseline gap-1 mb-3">
              <span className="font-display text-3xl" style={{ color: gold }}>$15</span>
              <span className="text-sm font-body" style={{ color: textMuted }}>/month</span>
            </div>
            <ul className="space-y-2 text-sm font-body" style={{ color: textMuted }}>
              <li>Everything in Free, plus:</li>
              <li style={{ color: textPrimary }}>AI intelligence synthesis</li>
              <li style={{ color: textPrimary }}>Stock discovery engine</li>
              <li style={{ color: textPrimary }}>Daily digest emails + push</li>
              <li style={{ color: textPrimary }}>Unlimited portfolio tickers</li>
            </ul>
            <Link to="/signup" className="btn-gold block text-center mt-5 py-2.5 text-sm">
              Upgrade to Pro
            </Link>
          </div>
        </div>
      </section>

      {/* Data sources — transparency builds trust */}
      <section className="px-6 lg:px-16 pb-16 max-w-3xl mx-auto text-center">
        <p className="text-xs font-body mb-3" style={{ color: textMuted }}>Data powered by</p>
        <div className="flex flex-wrap justify-center gap-x-6 gap-y-2">
          {['Polymarket', 'Finnhub', 'SEC EDGAR', 'FRED', 'Yahoo Finance'].map((src) => (
            <span key={src} className="text-xs font-body" style={{ color: isDark ? '#4A4A4D' : '#9A9A9D' }}>{src}</span>
          ))}
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 lg:px-16 py-8 text-center" style={{ borderTop: `0.5px solid ${border}` }}>
        <p className="text-xs font-body" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
          Zelador Analytics provides market intelligence for educational purposes, not investment advice.
        </p>
        <p className="text-xs font-body mt-2" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
          &copy; 2026 Zelador Analytics. All rights reserved.
        </p>
      </footer>
    </div>
  );
}
