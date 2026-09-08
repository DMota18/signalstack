import { useState, useEffect } from 'react';
import { useAuth } from '../hooks/useAuth';
import { useTheme } from '../hooks/useTheme';
import { useNavigate } from 'react-router-dom';
import { api } from '../api/client';
import {
  Sparkles, TrendingUp, TrendingDown, Shield, Zap, Target, Loader2,
  ChevronRight, Lock, Search, RefreshCw, GitBranch, DollarSign,
  Cpu, RotateCcw, ArrowLeft, X, Crown,
} from 'lucide-react';
import { formatCurrency, formatCompactCurrency, formatPercent } from '../lib/format';

const ICON_MAP: Record<string, any> = {
  'sparkles': Sparkles, 'git-branch': GitBranch, 'rotate-ccw': RotateCcw,
  'trending-up': TrendingUp, 'search': Search, 'dollar-sign': DollarSign,
  'refresh-cw': RefreshCw, 'shield': Shield, 'cpu': Cpu, 'bitcoin': Zap,
};

const riskColors: Record<string, string> = {
  Conservative: '#34C759', Moderate: '#D4A843', Growth: '#FF9500', Aggressive: '#FF453A',
  conservative: '#34C759', moderate: '#D4A843', growth: '#FF9500', aggressive: '#FF453A',
};

const typeIcons: Record<string, any> = {
  'Adjacent to holdings': GitBranch, 'Sector overlap': Shield,
  'Hedge/diversification': Target, 'Thematic': Zap, 'Contrarian': RotateCcw,
  'Momentum': TrendingUp, 'Under the radar': Search, 'Income': DollarSign,
};

import type {
  ExploreCategory as Category,
  ExploreDeepDive as DeepDive,
  ExploreIdea as Idea,
} from '../api/types';

export default function ExplorePage() {
  const { user } = useAuth();
  const { isDark } = useTheme();
  const navigate = useNavigate();

  const [categories, setCategories] = useState<Category[]>([]);
  const [activeCategory, setActiveCategory] = useState<string | null>(null);
  const [ideas, setIdeas] = useState<Idea[]>([]);
  const [categoryInsight, setCategoryInsight] = useState('');
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);
  const [prices, setPrices] = useState<Record<string, { price: number; change_pct: number; market_cap: number | null }>>({});

  // Deep dive state
  const [deepDiveOpen, setDeepDiveOpen] = useState(false);
  const [deepDiveTicker, setDeepDiveTicker] = useState('');
  const [deepDiveData, setDeepDiveData] = useState<DeepDive | null>(null);
  const [deepDiveLoading, setDeepDiveLoading] = useState(false);
  const [deepDiveError, setDeepDiveError] = useState<string | null>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  useEffect(() => { loadInitial(); }, []);

  const loadInitial = async () => {
    setLoading(true);
    const [catRes, profileRes] = await Promise.all([
      api.getExploreCategories(),
      api.getInvestorProfile(),
    ]);
    if (catRes.status === 'ok') setCategories(catRes.data || []);
    if (profileRes.status === 'ok') setProfile(profileRes.data);
    setLoading(false);
  };

  const selectCategory = async (key: string) => {
    setActiveCategory(key);
    setIdeas([]);
    setCategoryInsight('');
    setGeneratedAt(null);
    setPrices({});

    // Load cached ideas for this category
    const res = await api.getExploreIdeas(key);
    if (res.status === 'ok' && res.data) {
      const ideas = res.data.ideas || [];
      setIdeas(ideas);
      setCategoryInsight(res.data.category_insight || '');
      setGeneratedAt(res.data.generated_at ?? null);
      if (ideas.length > 0) fetchPrices(ideas);
    }
  };

  const handleGenerate = async () => {
    if (!activeCategory) return;
    setGenerating(true);
    const res = await api.generateExploreIdeas(activeCategory);
    if (res.status === 'ok' && res.data) {
      setIdeas(res.data.ideas || []);
      setCategoryInsight(res.data.category_insight || '');
      setGeneratedAt(res.data.generated_at ?? null);
      fetchPrices(res.data.ideas || []);
    } else if (res.error?.code === 'tier_required') {
      // Show tier gate message — handled in UI
    }
    setGenerating(false);
  };

  const fetchPrices = async (ideasList: Idea[]) => {
    const priceMap: Record<string, { price: number; change_pct: number; market_cap: number | null }> = {};
    await Promise.all(
      ideasList.slice(0, 8).map(async (idea) => {
        try {
          const res = await api.getResearch(idea.ticker);
          if (res.status === 'ok' && res.data?.quote) {
            const q = res.data.quote;
            const prev = q.previous_close || 0;
            const cur = q.price || 0;
            priceMap[idea.ticker] = {
              price: cur,
              change_pct: prev > 0 ? ((cur - prev) / prev) * 100 : (q.day_change_pct || 0),
              market_cap: res.data.fundamentals?.market_cap || null,
            };
          }
        } catch {
          /* non-fatal: price lookup failed for this idea — leave it out of the price map */
        }
      })
    );
    setPrices(priceMap);
  };

  const openDeepDive = async (ticker: string) => {
    setDeepDiveTicker(ticker);
    setDeepDiveOpen(true);
    setDeepDiveData(null);
    setDeepDiveError(null);
    setDeepDiveLoading(true);

    const res = await api.getExploreDeepDive(ticker);
    if (res.status === 'ok' && res.data) {
      setDeepDiveData(res.data);
    } else {
      setDeepDiveError(res.error?.message || 'Deep-dive generation failed');
    }
    setDeepDiveLoading(false);
  };

  const isPremium = user?.tier === 'premium';
  const isPro = user?.tier === 'pro' || isPremium;

  // Category grid view
  if (!activeCategory) {
    return (
      <div className="space-y-6">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <h1 className="font-display text-xl">Explore</h1>
            <span className="text-[9px] font-body px-2 py-0.5 rounded-full"
              style={{ background: `${gold}15`, color: gold }}>
              {isPremium ? 'Premium' : isPro ? 'Pro' : 'Free'}
            </span>
          </div>
          <p className="text-sm font-body" style={{ color: textMuted }}>
            AI-powered research ideas tailored to your portfolio and preferences.
          </p>
        </div>

        {/* Profile badges */}
        {profile && !profile.is_default && (
          <div className="flex gap-2 flex-wrap">
            {profile.risk_appetite && (
              <span className="text-[10px] font-body px-2.5 py-1 rounded-full"
                style={{ background: `${riskColors[profile.risk_appetite] || gold}12`, color: riskColors[profile.risk_appetite] || gold }}>
                {profile.risk_appetite}
              </span>
            )}
            {(profile.sector_interests || []).map((s: string) => (
              <span key={s} className="text-[10px] font-body px-2.5 py-1 rounded-full"
                style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
                {s.replace(/_/g, ' ')}
              </span>
            ))}
          </div>
        )}

        {loading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 size={24} className="animate-spin" style={{ color: gold }} />
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {categories.map((cat) => {
              const Icon = ICON_MAP[cat.icon] || Sparkles;
              return (
                <button
                  key={cat.key}
                  onClick={() => !cat.locked && selectCategory(cat.key)}
                  disabled={cat.locked}
                  className="text-left rounded-xl p-5 transition-all hover:scale-[1.01] disabled:opacity-60 disabled:cursor-not-allowed relative overflow-hidden group"
                  style={{
                    background: surface,
                    border: isDark ? 'none' : `0.5px solid ${border}`,
                  }}
                >
                  <div className="flex items-start justify-between mb-3">
                    <div className="w-9 h-9 rounded-lg flex items-center justify-center"
                      style={{ background: `${gold}10` }}>
                      <Icon size={18} style={{ color: gold }} />
                    </div>
                    {cat.locked ? (
                      <div className="flex items-center gap-1 text-[9px] font-body px-2 py-0.5 rounded-full"
                        style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
                        <Lock size={8} /> {cat.tier}
                      </div>
                    ) : (
                      <ChevronRight size={14} style={{ color: textMuted }} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                  <p className="text-sm font-body font-medium mb-1">{cat.label}</p>
                  <p className="text-[11px] font-body leading-relaxed" style={{ color: textMuted }}>
                    {cat.description}
                  </p>
                </button>
              );
            })}
          </div>
        )}

        {/* Upgrade CTA for free users */}
        {!isPro && (
          <div className="rounded-xl p-6 text-center"
            style={{ background: `${gold}08`, border: `0.5px solid ${gold}20` }}>
            <Crown size={24} style={{ color: gold }} className="mx-auto mb-2" />
            <p className="text-sm font-body font-medium mb-1">Unlock all research categories</p>
            <p className="text-xs font-body mb-4" style={{ color: textMuted }}>
              Upgrade to Pro for AI-powered ideas across 10 categories, or Premium for deep-dive analysis and under-the-radar picks.
            </p>
            <button className="btn-gold text-sm" onClick={() => navigate('/app/settings')}>
              Upgrade
            </button>
          </div>
        )}

        <p className="text-[10px] font-body text-center" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
          Educational content, not investment advice. Ideas based on your stated preferences and market data.
        </p>
      </div>
    );
  }

  // Category detail view
  const activeCat = categories.find(c => c.key === activeCategory);
  const ActiveIcon = activeCat ? (ICON_MAP[activeCat.icon] || Sparkles) : Sparkles;

  return (
    <div className="space-y-5">
      {/* Deep dive modal */}
      {deepDiveOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDeepDiveOpen(false)} />
          <div className="relative w-full max-w-2xl max-h-[85vh] overflow-y-auto rounded-2xl p-6"
            style={{ background: isDark ? '#111113' : '#FFFFFF', border: `0.5px solid ${border}` }}>
            <button onClick={() => setDeepDiveOpen(false)} aria-label="Close deep dive"
              className="absolute top-4 right-4 p-1.5 rounded-lg hover:opacity-70"
              style={{ color: textMuted }}>
              <X size={18} aria-hidden="true" />
            </button>

            <div className="flex items-center gap-2 mb-1">
              <span className="text-[9px] font-body px-2 py-0.5 rounded-full"
                style={{ background: `${gold}12`, color: gold }}>Deep dive</span>
              <span className="text-[9px] font-body px-2 py-0.5 rounded-full"
                style={{ background: isDark ? '#5856D615' : '#4845B510', color: isDark ? '#5856D6' : '#4845B5' }}>Premium</span>
            </div>
            <h2 className="font-display text-2xl mb-4">{deepDiveTicker}</h2>

            {deepDiveLoading ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3">
                <Loader2 size={24} className="animate-spin" style={{ color: gold }} />
                <p className="text-sm font-body" style={{ color: textMuted }}>Running deep analysis on {deepDiveTicker}...</p>
              </div>
            ) : deepDiveError ? (
              <div className="text-center py-12">
                <p className="text-sm font-body mb-2" style={{ color: redColor }}>{deepDiveError}</p>
                {deepDiveError.includes('premium') && (
                  <button className="btn-gold text-sm mt-4" onClick={() => navigate('/app/settings')}>Upgrade to Premium</button>
                )}
              </div>
            ) : deepDiveData ? (
              <div className="space-y-5">
                {/* Conviction + horizon */}
                <div className="flex gap-3">
                  <div className="px-3 py-2 rounded-lg" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                    <p className="text-[9px] font-body uppercase tracking-wider mb-0.5" style={{ color: textMuted }}>Conviction</p>
                    <p className="text-sm font-body font-medium" style={{
                      color: deepDiveData.conviction_level === 'high' ? greenColor : deepDiveData.conviction_level === 'low' ? redColor : gold
                    }}>{deepDiveData.conviction_level}</p>
                  </div>
                  <div className="px-3 py-2 rounded-lg" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                    <p className="text-[9px] font-body uppercase tracking-wider mb-0.5" style={{ color: textMuted }}>Horizon</p>
                    <p className="text-sm font-body font-medium">{deepDiveData.time_horizon}</p>
                  </div>
                </div>

                {/* Bull / Bear */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="rounded-lg p-4" style={{ background: `${greenColor}08`, borderLeft: `3px solid ${greenColor}` }}>
                    <p className="text-[10px] font-body font-medium mb-2" style={{ color: greenColor }}>Bull case</p>
                    <p className="text-sm font-body leading-relaxed" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>{deepDiveData.bull_case}</p>
                  </div>
                  <div className="rounded-lg p-4" style={{ background: `${redColor}08`, borderLeft: `3px solid ${redColor}` }}>
                    <p className="text-[10px] font-body font-medium mb-2" style={{ color: redColor }}>Bear case</p>
                    <p className="text-sm font-body leading-relaxed" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>{deepDiveData.bear_case}</p>
                  </div>
                </div>

                {/* Catalysts + Risks */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <p className="text-[10px] font-body font-medium mb-2" style={{ color: gold }}>Key catalysts</p>
                    <div className="space-y-1.5">
                      {deepDiveData.key_catalysts.map((c, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm font-body" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>
                          <TrendingUp size={12} className="shrink-0 mt-0.5" style={{ color: greenColor }} />
                          {c}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] font-body font-medium mb-2" style={{ color: textMuted }}>Key risks</p>
                    <div className="space-y-1.5">
                      {deepDiveData.key_risks.map((r, i) => (
                        <div key={i} className="flex items-start gap-2 text-sm font-body" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>
                          <TrendingDown size={12} className="shrink-0 mt-0.5" style={{ color: redColor }} />
                          {r}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Valuation + portfolio fit */}
                <div className="rounded-lg p-4" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                  <p className="text-[10px] font-body font-medium mb-1" style={{ color: gold }}>Valuation context</p>
                  <p className="text-sm font-body leading-relaxed" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>{deepDiveData.valuation_context}</p>
                </div>
                <div className="rounded-lg p-4" style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                  <p className="text-[10px] font-body font-medium mb-1" style={{ color: gold }}>Portfolio fit</p>
                  <p className="text-sm font-body leading-relaxed" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>{deepDiveData.portfolio_fit}</p>
                </div>

                <button onClick={() => navigate(`/app/research/${deepDiveTicker}`)} className="btn-gold w-full text-sm">
                  Open full research for {deepDiveTicker}
                </button>
              </div>
            ) : null}

            <p className="text-[9px] font-body text-center mt-4" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
              Educational research, not investment advice.
            </p>
          </div>
        </div>
      )}

      {/* Back + header */}
      <div>
        <button onClick={() => setActiveCategory(null)}
          className="flex items-center gap-1.5 text-xs font-body mb-3 transition-opacity hover:opacity-70"
          style={{ color: textMuted }}>
          <ArrowLeft size={14} aria-hidden="true" /> All categories
        </button>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-lg flex items-center justify-center"
              style={{ background: `${gold}10` }}>
              <ActiveIcon size={20} style={{ color: gold }} />
            </div>
            <div>
              <h1 className="font-display text-xl">{activeCat?.label || activeCategory}</h1>
              <p className="text-xs font-body" style={{ color: textMuted }}>{activeCat?.description}</p>
            </div>
          </div>
          <button
            onClick={handleGenerate}
            disabled={generating}
            className="flex items-center gap-2 text-xs font-body px-4 py-2 rounded-lg transition-all disabled:opacity-40"
            style={{ background: gold, color: '#0C0C0E' }}
          >
            {generating ? (
              <><Loader2 size={12} className="animate-spin" aria-hidden="true" /> Generating...</>
            ) : (
              <><Sparkles size={12} aria-hidden="true" /> {ideas.length > 0 ? 'Regenerate' : 'Generate ideas'}</>
            )}
          </button>
        </div>
      </div>

      {/* Category insight */}
      {categoryInsight && (
        <div className="rounded-lg px-4 py-3" style={{ background: `${gold}08`, border: `0.5px solid ${gold}20` }}>
          <p className="text-sm font-body" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>
            <span style={{ color: gold }}>Insight:</span> {categoryInsight}
          </p>
        </div>
      )}

      {/* Generating state */}
      {generating && (
        <div className="rounded-xl px-5 py-6 flex flex-col items-center gap-3"
          style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
          <Loader2 size={24} className="animate-spin" style={{ color: gold }} />
          <p className="text-sm font-body font-medium" style={{ color: gold }}>Researching ideas...</p>
          <p className="text-xs font-body text-center" style={{ color: textMuted }}>
            Analyzing your {activeCategory?.replace(/_/g, ' ')} opportunities with Claude. This takes 10-20 seconds.
          </p>
        </div>
      )}

      {/* Idea cards */}
      {ideas.length > 0 && !generating ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {ideas.map((idea) => {
            const IconComp = typeIcons[idea.type] || TrendingUp;
            const riskColor = riskColors[idea.risk_level] || textMuted;
            const priceData = prices[idea.ticker];
            const isUp = priceData ? priceData.change_pct >= 0 : true;

            return (
              <div key={idea.ticker}
                className="rounded-xl overflow-hidden transition-all hover:scale-[1.003]"
                style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
                {/* Color accent bar based on risk */}
                <div style={{ height: 2, background: riskColor }} />

                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <div>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-display text-base cursor-pointer hover:underline"
                          onClick={() => navigate(`/app/research/${idea.ticker}`)}>{idea.ticker}</span>
                        <span className="text-xs font-body" style={{ color: textMuted }}>{idea.name}</span>
                      </div>
                      <div className="flex items-center gap-2">
                        <span className="text-[9px] font-body px-2 py-0.5 rounded"
                          style={{ background: `${gold}12`, color: gold }}>
                          {idea.type}
                        </span>
                        {idea.sector && (
                          <span className="text-[9px] font-body" style={{ color: textMuted }}>
                            {idea.sector}
                          </span>
                        )}
                      </div>
                    </div>
                    <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0"
                      style={{ background: `${gold}10` }}>
                      <IconComp size={14} style={{ color: gold }} />
                    </div>
                  </div>

                  {/* Price row */}
                  {priceData ? (
                    <div className="flex items-center gap-3 mb-3 py-2 px-3 rounded-lg"
                      style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                      <span className="text-sm font-numeric font-medium">
                        {formatCurrency(priceData.price)}
                      </span>
                      <span className="text-xs font-numeric" style={{ color: isUp ? greenColor : redColor }}>
                        {formatPercent(priceData.change_pct, { signed: true })}
                      </span>
                      {priceData.market_cap && (
                        <span className="text-[10px] font-body ml-auto" style={{ color: textMuted }}>
                          {formatCompactCurrency(priceData.market_cap)}
                        </span>
                      )}
                    </div>
                  ) : (
                    <div className="h-10 rounded-lg animate-pulse mb-3"
                      style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }} />
                  )}

                  {/* Data points chips */}
                  {idea.data_points && (
                    <div className="flex gap-1.5 flex-wrap mb-3">
                      {idea.data_points.pe_ratio && (
                        <span className="text-[9px] font-numeric px-2 py-0.5 rounded"
                          style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
                          P/E {idea.data_points.pe_ratio}
                        </span>
                      )}
                      {idea.data_points.revenue_growth && (
                        <span className="text-[9px] font-numeric px-2 py-0.5 rounded"
                          style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
                          Rev {idea.data_points.revenue_growth}
                        </span>
                      )}
                      {idea.data_points.dividend_yield && (
                        <span className="text-[9px] font-numeric px-2 py-0.5 rounded"
                          style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
                          Yield {idea.data_points.dividend_yield}
                        </span>
                      )}
                      {idea.data_points.correlation_to_portfolio != null && (
                        <span className="text-[9px] font-numeric px-2 py-0.5 rounded"
                          style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
                          Corr {idea.data_points.correlation_to_portfolio.toFixed(2)}
                        </span>
                      )}
                    </div>
                  )}

                  {/* Reason */}
                  <p className="text-sm font-body leading-relaxed mb-3" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>
                    {idea.reason}
                  </p>

                  {/* Catalyst */}
                  {idea.catalyst && (
                    <p className="text-[10px] font-body mb-3 flex items-center gap-1.5" style={{ color: gold }}>
                      <Zap size={10} /> {idea.catalyst}
                    </p>
                  )}

                  {/* Bottom row */}
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-body flex items-center gap-1.5">
                      <span className="w-1.5 h-1.5 rounded-full" aria-hidden="true" style={{ background: riskColor }} />
                      <span style={{ color: textMuted }}>{idea.risk_level}</span>
                    </span>
                    <div className="flex items-center gap-2">
                      {isPremium && (
                        <button onClick={(e) => { e.stopPropagation(); openDeepDive(idea.ticker); }}
                          className="text-[10px] font-body flex items-center gap-1 px-2 py-0.5 rounded transition-colors hover:opacity-70"
                          style={{ background: isDark ? '#5856D610' : '#4845B508', color: isDark ? '#5856D6' : '#4845B5', border: `0.5px solid ${isDark ? '#5856D620' : '#4845B515'}` }}>
                          <Sparkles size={9} aria-hidden="true" /> Deep dive
                        </button>
                      )}
                      <button onClick={() => navigate(`/app/research/${idea.ticker}`)}
                        className="text-[10px] font-body flex items-center gap-1" style={{ color: gold }}>
                        Research <ChevronRight size={10} aria-hidden="true" />
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      ) : !generating && ideas.length === 0 ? (
        <div className="text-center py-16">
          <ActiveIcon size={32} style={{ color: `${gold}40` }} className="mx-auto mb-4" />
          <p className="font-display text-lg mb-2">No {activeCat?.label?.toLowerCase()} ideas yet</p>
          <p className="text-sm font-body mb-6" style={{ color: textMuted }}>
            Generate AI-powered ideas for this category based on your portfolio.
          </p>
          <button onClick={handleGenerate} disabled={generating} className="btn-gold">
            Generate ideas
          </button>
        </div>
      ) : null}

      {/* Timestamp + disclaimer */}
      {generatedAt && (
        <p className="text-[10px] font-body" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
          Generated {new Date(generatedAt).toLocaleString()}
        </p>
      )}
      <p className="text-[10px] font-body text-center" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
        Educational content, not investment advice. Ideas based on your stated preferences and market data.
      </p>
    </div>
  );
}
