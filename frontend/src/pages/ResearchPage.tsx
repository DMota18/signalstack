import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { Loader2, BarChart3, Activity, Target, MessageCircle } from 'lucide-react';
import SocialFeed from '../components/SocialFeed';
import SignalRadar from '../components/SignalRadar';
import FairValueGauge from '../components/FairValueGauge';
import PerformanceComparison from '../components/PerformanceComparison';
import Section from './research/Section';
import ResearchHeader from './research/ResearchHeader';
import PriceChartSection from './research/PriceChartSection';
import KeyStatistics from './research/KeyStatistics';
import TechnicalIndicators from './research/TechnicalIndicators';
import PolymarketBets from './research/PolymarketBets';
import AboutSection from './research/AboutSection';
import AnalystOutlook from './research/AnalystOutlook';
import { EarningsHistoryTable, EarningsSurpriseChart } from './research/EarningsHistory';
import ResearchNews from './research/ResearchNews';
import InsiderActivity from './research/InsiderActivity';
import FinancialStatements from './research/FinancialStatements';
import InstitutionalHolders from './research/InstitutionalHolders';
import SimilarStocks from './research/SimilarStocks';
import type { ResearchTheme } from './research/types';

// ─── Main page ──────────────────────────────────────────────────────────

export default function ResearchPage() {
  const { ticker } = useParams<{ ticker: string }>();
  const navigate = useNavigate();
  const { isDark } = useTheme();

  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [chartType, setChartType] = useState<'area' | 'candlestick'>('area');
  const [technicals, setTechnicals] = useState<any>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const textSecondary = isDark ? '#B0AEA6' : '#4A4A4D';
  const surface = isDark ? '#111113' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  const theme: ResearchTheme = { isDark, gold, textMuted, textSecondary, surface, border, greenColor, redColor };

  // Load research data
  useEffect(() => {
    if (!ticker) return;
    setLoading(true);
    setError(null);
    api.getResearch(ticker).then((res) => {
      if (res.status === 'ok' && res.data) {
        setData(res.data);
      } else {
        setError(res.error?.message || `Could not find data for ${ticker}`);
      }
      setLoading(false);
    });
    // Fetch technicals in parallel (non-blocking)
    setTechnicals(null);
    api.getTechnicals(ticker).then((res) => {
      if (res.status === 'ok' && res.data) setTechnicals(res.data);
    });
  }, [ticker]);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-32">
        <Loader2 size={28} className="animate-spin" style={{ color: gold }} />
        <span className="ml-3 text-sm font-body" style={{ color: textMuted }}>Loading {ticker}...</span>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="text-center py-32">
        <p className="font-display text-xl mb-2">Ticker not found</p>
        <p className="text-sm font-body mb-6" style={{ color: textMuted }}>{error || `No data available for ${ticker}`}</p>
        <button onClick={() => navigate('/app')} className="btn-gold">Back to dashboard</button>
      </div>
    );
  }

  const quote = data.quote || {};
  const profile = data.profile || {};
  const fund = data.fundamentals || {};
  const analyst = data.analyst || {};
  const earnings = data.earnings_history || [];
  const news = data.news || [];
  const insider = data.insider || {};
  const polymarket = data.polymarket || {};
  const financials = data.financials || {};
  const institutional = data.institutional || {};
  const similar = data.similar || {};

  const price = quote.price || 0;
  const prevClose = quote.previous_close || 0;
  const dayChange = prevClose > 0 ? price - prevClose : 0;
  const dayChangePct = prevClose > 0 ? (dayChange / prevClose) * 100 : (quote.day_change_pct || 0);
  const isUp = dayChange >= 0;

  return (
    <div className="space-y-5 max-w-5xl">
      {/* ── HEADER ── */}
      <ResearchHeader
        ticker={ticker || ''}
        profile={profile}
        price={price}
        dayChange={dayChange}
        dayChangePct={dayChangePct}
        isUp={isUp}
        theme={theme}
      />

      {/* ── PRICE CHART (TradingView Lightweight Charts) ── */}
      <PriceChartSection ticker={ticker || ''} chartType={chartType} onChartTypeChange={setChartType} theme={theme} />

      {/* ── KEY STATS (two-column grid like Public) ── */}
      <KeyStatistics quote={quote} fund={fund} theme={theme} />

      {/* ── TECHNICAL INDICATORS (Alpha Vantage) ── */}
      {technicals && (technicals.rsi?.value != null || technicals.macd?.value != null) && (
        <TechnicalIndicators technicals={technicals} price={price} theme={theme} />
      )}

      {/* ── FAIR VALUE ESTIMATE ── */}
      {price > 0 && (financials.income_statement?.length > 0 || fund.trailing_pe != null) && (
        <Section title="Fair value estimate" icon={Target} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          <FairValueGauge
            ticker={ticker || ''}
            currentPrice={price}
            financials={financials}
            fundamentals={fund}
          />
        </Section>
      )}

      {/* ── PERFORMANCE COMPARISON ── */}
      {similar.tickers?.length > 0 && (
        <Section title="Performance comparison" icon={BarChart3} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={false}>
          <PerformanceComparison
            baseTicker={ticker || ''}
            similarTickers={similar.tickers?.slice(0, 6) || []}
          />
        </Section>
      )}

      {/* ── SIGNAL RADAR ── */}
      <Section title="Signal strength" icon={Activity} isDark={isDark} gold={gold} surface={surface} border={border}>
        <SignalRadar data={{
          quote,
          fundamentals: fund,
          insider,
          institutional,
          news,
          analyst,
          earnings_history: earnings,
          financials,
        }} />
      </Section>

      {/* ── POLYMARKET — HERO SECTION (always open, visually distinct) ── */}
      {polymarket.markets?.length > 0 && (
        <PolymarketBets ticker={ticker || ''} polymarket={polymarket} theme={theme} />
      )}

      {/* ── ABOUT ── */}
      {profile.description && (
        <AboutSection profile={profile} theme={theme} />
      )}

      {/* ── ANALYST CONSENSUS ── */}
      {(analyst.recommendation || analyst.num_analyst_opinions > 0) && (
        <AnalystOutlook analyst={analyst} price={price} theme={theme} />
      )}

      {/* ── EARNINGS HISTORY ── */}
      {earnings.length > 0 && (
        <EarningsHistoryTable earnings={earnings} theme={theme} />
      )}

      {/* ── NEWS ── */}
      {news.length > 0 && (
        <ResearchNews news={news} theme={theme} />
      )}

      {/* ── SOCIAL SENTIMENT ── */}
      <Section title="Social" icon={MessageCircle} isDark={isDark} gold={gold} surface={surface} border={border} defaultOpen={true}>
        <SocialFeed ticker={ticker || ''} />
      </Section>

      {/* ── INSIDER TRADES ── */}
      {insider.trades?.length > 0 && (
        <InsiderActivity insider={insider} theme={theme} />
      )}

      {/* ── EARNINGS BEAT/MISS CHART ── */}
      {earnings.length > 1 && earnings.some((e: any) => e.reported_eps != null) && (
        <EarningsSurpriseChart earnings={earnings} theme={theme} />
      )}

      {/* ── FINANCIAL STATEMENTS ── */}
      {(financials.income_statement?.length > 0 || financials.balance_sheet?.length > 0 || financials.cash_flow?.length > 0) && (
        <FinancialStatements financials={financials} theme={theme} />
      )}

      {/* ── INSTITUTIONAL OWNERSHIP ── */}
      {institutional.holders?.length > 0 && (
        <InstitutionalHolders institutional={institutional} theme={theme} />
      )}

      {/* ── SIMILAR STOCKS ── */}
      {similar.tickers?.length > 0 && (
        <SimilarStocks similar={similar} onSelectTicker={(t) => navigate(`/app/research/${t}`)} theme={theme} />
      )}

      {/* ── DISCLAIMER ── */}
      <p className="text-[9px] font-body text-center pb-4" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
        Market data from Yahoo Finance & Finnhub. Prediction markets from Polymarket.
        All data is for informational purposes — not investment advice.
      </p>
    </div>
  );
}
