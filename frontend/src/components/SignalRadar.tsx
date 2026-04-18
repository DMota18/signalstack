import { useMemo, useState } from 'react';
import { RadarChart, Radar, PolarGrid, PolarAngleAxis, ResponsiveContainer } from 'recharts';
import { useTheme } from '../hooks/useTheme';

interface SignalRadarProps {
  data: {
    quote?: any;
    fundamentals?: any;
    insider?: any;
    institutional?: any;
    news?: any[];
    analyst?: any;
    earnings_history?: any[];
    financials?: any;
  };
}

/** Clamp a number between 0 and 100. */
const clamp = (v: number) => Math.min(100, Math.max(0, Math.round(v)));

/** Weighted average of sub-scores: [{ value, weight }] */
const weightedAvg = (items: { value: number; weight: number }[]): number => {
  const valid = items.filter((i) => i.value >= 0);
  if (valid.length === 0) return 50;
  const totalWeight = valid.reduce((s, i) => s + i.weight, 0);
  return clamp(valid.reduce((s, i) => s + i.value * i.weight, 0) / totalWeight);
};

interface SubScore {
  label: string;
  value: number; // 0-100, or -1 if not available
  weight: number;
}

interface DimensionResult {
  dimension: string;
  score: number;
  fullMark: number;
  subScores: SubScore[];
}

/**
 * SignalRadar — 8-dimension spider chart for the research page.
 *
 * Dimensions: Technical, Fundamental, Sentiment, Insider, Institutional,
 *             Momentum, Valuation, Earnings Quality
 *
 * Each scored 0-100 from weighted sub-scores derived from available data.
 */
export default function SignalRadar({ data }: SignalRadarProps) {
  const { isDark } = useTheme();
  const [expandedDim, setExpandedDim] = useState<string | null>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const gridStroke = isDark ? '#2A2A2D' : '#D0D0D0';
  const bgSurface = isDark ? '#1A1A1D' : '#E8E6E1';
  const bgCard = isDark ? '#121214' : '#F5F3EE';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  const radarData: DimensionResult[] = useMemo(() => {
    const quote = data.quote || {};
    const fund = data.fundamentals || {};
    const analyst = data.analyst || {};
    const ins = data.insider || {};
    const inst = data.institutional || {};
    const newsArr = data.news || [];
    const earnings = data.earnings_history || [];

    // ── 1. TECHNICAL ──
    // Sub-scores: price vs 50 DMA, price vs 200 DMA, RSI proxy, volume ratio
    const techSubs: SubScore[] = [];
    if (quote.price && fund.fifty_day_avg) {
      const ratio50 = quote.price / fund.fifty_day_avg;
      // 1.0 = at average (50), above = bullish, below = bearish. Cap at +/-20%
      techSubs.push({ label: 'Price vs 50 DMA', value: clamp(50 + (ratio50 - 1) * 250), weight: 3 });
    }
    if (quote.price && fund.two_hundred_day_avg) {
      const ratio200 = quote.price / fund.two_hundred_day_avg;
      techSubs.push({ label: 'Price vs 200 DMA', value: clamp(50 + (ratio200 - 1) * 200), weight: 3 });
    }
    if (fund.fifty_two_week_high != null && fund.fifty_two_week_low != null && quote.price) {
      // RSI proxy: where price sits in the 52-week range (0 = at low, 100 = at high)
      const range = fund.fifty_two_week_high - fund.fifty_two_week_low;
      const rsiProxy = range > 0 ? ((quote.price - fund.fifty_two_week_low) / range) * 100 : 50;
      techSubs.push({ label: 'RSI Proxy (52w range)', value: clamp(rsiProxy), weight: 2 });
    }
    if (quote.volume && quote.avg_volume && quote.avg_volume > 0) {
      // Volume ratio: >1.5x avg = bullish interest, <0.5x = low interest
      const volRatio = quote.volume / quote.avg_volume;
      techSubs.push({ label: 'Volume vs Avg', value: clamp(30 + volRatio * 25), weight: 2 });
    }
    const technical: DimensionResult = {
      dimension: 'Technical',
      score: weightedAvg(techSubs),
      fullMark: 100,
      subScores: techSubs,
    };

    // ── 2. FUNDAMENTAL ──
    // Sub-scores: P/E quality, profit margin, ROE, current ratio, debt-to-equity
    const fundSubs: SubScore[] = [];
    if (fund.trailing_pe != null) {
      // P/E: <15 great (85), <25 good (70), <40 fair (50), >40 poor (25), negative = loss-making (15)
      const pe = fund.trailing_pe;
      const peScore = pe < 0 ? 15 : pe < 15 ? 85 : pe < 25 ? 70 : pe < 40 ? 50 : 25;
      fundSubs.push({ label: 'P/E Ratio', value: peScore, weight: 3 });
    }
    if (fund.profit_margin != null) {
      // 0% = 30, 20%+ = 80+
      fundSubs.push({ label: 'Profit Margin', value: clamp(30 + fund.profit_margin * 250), weight: 2 });
    }
    if (fund.return_on_equity != null) {
      // 0% = 30, 20%+ = 80+
      fundSubs.push({ label: 'ROE', value: clamp(30 + fund.return_on_equity * 250), weight: 2 });
    }
    if (fund.current_ratio != null) {
      // 1.0 = decent (50), 2.0+ = great (80+), <0.5 = risky (20)
      fundSubs.push({ label: 'Current Ratio', value: clamp(fund.current_ratio * 35 + 15), weight: 1.5 });
    }
    if (fund.debt_to_equity != null) {
      // Low debt = good: 0 = 90, 100 = 50, 200+ = 20
      fundSubs.push({ label: 'Debt/Equity', value: clamp(90 - fund.debt_to_equity * 0.35), weight: 1.5 });
    }
    const fundamental: DimensionResult = {
      dimension: 'Fundamental',
      score: weightedAvg(fundSubs),
      fullMark: 100,
      subScores: fundSubs,
    };

    // ── 3. SENTIMENT ──
    // Sub-scores: news sentiment avg, news volume, analyst recommendation
    const sentSubs: SubScore[] = [];
    if (newsArr.length > 0) {
      // Average sentiment from news items (range -1 to 1 mapped to 0-100)
      const withSentiment = newsArr.filter((n: any) => n.sentiment != null);
      if (withSentiment.length > 0) {
        const avgSent = withSentiment.reduce((s: number, n: any) => s + n.sentiment, 0) / withSentiment.length;
        sentSubs.push({ label: 'News Sentiment', value: clamp((avgSent + 1) * 50), weight: 4 });
      }
      // Article count: more coverage = more interest. 1-3 low, 5+ good, 10+ great
      sentSubs.push({ label: 'News Volume', value: clamp(20 + newsArr.length * 6), weight: 1.5 });
    }
    if (analyst.recommendation_mean != null) {
      // Scale is typically 1 (strong buy) to 5 (strong sell)
      // 1 = 95, 2 = 75, 3 = 50, 4 = 25, 5 = 5
      sentSubs.push({ label: 'Analyst Rating', value: clamp(117.5 - analyst.recommendation_mean * 22.5), weight: 3 });
    } else if (analyst.recommendation) {
      const rec = analyst.recommendation.toLowerCase();
      let recScore = 50;
      if (rec.includes('strong_buy') || rec.includes('strong buy')) recScore = 90;
      else if (rec.includes('buy')) recScore = 75;
      else if (rec.includes('hold')) recScore = 50;
      else if (rec.includes('strong_sell') || rec.includes('strong sell')) recScore = 10;
      else if (rec.includes('sell')) recScore = 25;
      sentSubs.push({ label: 'Analyst Rating', value: recScore, weight: 3 });
    }
    const sentiment: DimensionResult = {
      dimension: 'Sentiment',
      score: weightedAvg(sentSubs),
      fullMark: 100,
      subScores: sentSubs,
    };

    // ── 4. INSIDER ──
    // Sub-scores: net buy ratio (by value), trade volume significance, recency
    const insSubs: SubScore[] = [];
    if (ins.summary) {
      const buys = ins.summary.open_market_buys || 0;
      const sells = ins.summary.open_market_sells || 0;
      const net = ins.summary.net_buy_value || 0;
      const total = ins.summary.total_transactions || (buys + sells);

      if (total > 0) {
        // Net buy ratio by count
        const buyRatio = buys / Math.max(1, buys + sells);
        insSubs.push({ label: 'Buy/Sell Ratio', value: clamp(buyRatio * 100), weight: 2 });

        // Net value: >$1M net buy = very bullish, >$5M = extremely bullish
        const netScore = net > 5_000_000 ? 95 : net > 1_000_000 ? 80 : net > 100_000 ? 65
          : net > 0 ? 55 : net > -100_000 ? 45 : net > -1_000_000 ? 30 : 15;
        insSubs.push({ label: 'Net Buy Value', value: netScore, weight: 3 });
      }
    }
    if (ins.trades?.length > 0) {
      // Recency: check if most recent trade is within 30 days
      const now = Date.now();
      const recentTrades = ins.trades.filter((t: any) => {
        const tradeDate = new Date(t.date || t.filing_date || 0).getTime();
        return (now - tradeDate) < 30 * 24 * 60 * 60 * 1000;
      });
      const recencyScore = recentTrades.length >= 3 ? 80 : recentTrades.length >= 1 ? 60 : 35;
      insSubs.push({ label: 'Recent Activity', value: recencyScore, weight: 2 });
    }
    const insider: DimensionResult = {
      dimension: 'Insider',
      score: weightedAvg(insSubs),
      fullMark: 100,
      subScores: insSubs,
    };

    // ── 5. INSTITUTIONAL ──
    // Sub-scores: % institutions, holder count, major fund presence
    const instSubs: SubScore[] = [];
    if (inst.major_holders) {
      const pctKey = Object.keys(inst.major_holders).find((k) => k.toLowerCase().includes('institution'));
      const pctInst = pctKey ? parseFloat(String(inst.major_holders[pctKey] || '0')) : NaN;
      if (!isNaN(pctInst)) {
        // 70%+ = great, 50-70 = good, 30-50 = fair, <30 = low
        instSubs.push({ label: '% Institutional', value: clamp(pctInst * 1.1 + 10), weight: 3 });
      }
    }
    if (inst.holders?.length > 0) {
      // More holders = more institutional interest. 5 = moderate, 10+ = strong
      instSubs.push({ label: 'Holder Count', value: clamp(30 + inst.holders.length * 5), weight: 2 });

      // Check for known major funds (simple heuristic)
      const majorFunds = ['vanguard', 'blackrock', 'fidelity', 'state street', 'berkshire', 'renaissance', 'bridgewater', 'citadel'];
      const hasMajor = inst.holders.some((h: any) => {
        const name = (h.holder || h.name || '').toLowerCase();
        return majorFunds.some((f) => name.includes(f));
      });
      instSubs.push({ label: 'Major Fund Presence', value: hasMajor ? 85 : 40, weight: 2 });
    }
    const institutional: DimensionResult = {
      dimension: 'Institutional',
      score: weightedAvg(instSubs),
      fullMark: 100,
      subScores: instSubs,
    };

    // ── 6. MOMENTUM (NEW) ──
    // Sub-scores: day change, distance from 52w high, price vs 50 DMA, beta-adjusted
    const momSubs: SubScore[] = [];
    if (quote.day_change_pct != null) {
      // +3% = 80, 0% = 50, -3% = 20
      momSubs.push({ label: 'Day Change', value: clamp(50 + quote.day_change_pct * 10), weight: 2 });
    }
    if (quote.price && fund.fifty_two_week_high) {
      // Distance from 52w high: at high = 90, 10% off = 65, 20%+ off = 40
      const distPct = (fund.fifty_two_week_high - quote.price) / fund.fifty_two_week_high;
      momSubs.push({ label: 'Dist. from 52w High', value: clamp(90 - distPct * 250), weight: 3 });
    }
    if (quote.price && fund.fifty_day_avg) {
      const r = quote.price / fund.fifty_day_avg;
      // >1.05 = strong momentum, 1.0 = neutral, <0.95 = weak
      momSubs.push({ label: 'Price/50 DMA', value: clamp(50 + (r - 1) * 300), weight: 2 });
    }
    if (fund.beta != null && quote.day_change_pct != null) {
      // Beta-adjusted: if beta is 1.5 and day change is +2%, expected move was +3%, so underperforming
      // Simplification: lower beta with positive returns = better risk-adjusted performance
      const betaAdj = fund.beta > 0 ? (quote.day_change_pct / fund.beta) : quote.day_change_pct;
      momSubs.push({ label: 'Beta-Adjusted Perf.', value: clamp(50 + betaAdj * 8), weight: 1.5 });
    }
    const momentum: DimensionResult = {
      dimension: 'Momentum',
      score: weightedAvg(momSubs),
      fullMark: 100,
      subScores: momSubs,
    };

    // ── 7. VALUATION (NEW) ──
    // Sub-scores: forward vs trailing P/E, price-to-book, analyst target upside, PEG proxy
    const valSubs: SubScore[] = [];
    if (fund.forward_pe != null && fund.trailing_pe != null && fund.trailing_pe > 0) {
      // Forward P/E < trailing P/E = earnings expected to improve
      const peImprovement = (fund.trailing_pe - fund.forward_pe) / fund.trailing_pe;
      // 20% improvement = very good (80), 0% = neutral (50), worsening = bad
      valSubs.push({ label: 'P/E Improvement', value: clamp(50 + peImprovement * 150), weight: 2 });
    }
    if (fund.price_to_book != null) {
      // <1 = undervalued (85), 1-3 = fair (60-70), 3-5 = expensive (40), >5 = very expensive (25)
      const pb = fund.price_to_book;
      const pbScore = pb < 1 ? 85 : pb < 3 ? 70 - (pb - 1) * 5 : pb < 5 ? 45 - (pb - 3) * 5 : 20;
      valSubs.push({ label: 'Price/Book', value: clamp(pbScore), weight: 2 });
    }
    if (analyst.target_mean_price && quote.price && quote.price > 0) {
      // Analyst upside: +20% target = bullish (80), 0% = neutral (50), -10% = bearish (30)
      const upside = (analyst.target_mean_price - quote.price) / quote.price;
      valSubs.push({ label: 'Analyst Target Upside', value: clamp(50 + upside * 150), weight: 3 });
    }
    if (fund.trailing_pe != null && fund.trailing_pe > 0 && fund.revenue_growth != null && fund.revenue_growth > 0) {
      // PEG proxy: P/E divided by growth rate (as %). PEG < 1 = undervalued, > 2 = overvalued
      const growthPct = fund.revenue_growth * 100;
      const peg = growthPct > 0 ? fund.trailing_pe / growthPct : 3;
      const pegScore = peg < 0.5 ? 90 : peg < 1 ? 75 : peg < 1.5 ? 60 : peg < 2 ? 45 : 25;
      valSubs.push({ label: 'PEG Ratio Proxy', value: pegScore, weight: 2 });
    }
    const valuation: DimensionResult = {
      dimension: 'Valuation',
      score: weightedAvg(valSubs),
      fullMark: 100,
      subScores: valSubs,
    };

    // ── 8. EARNINGS QUALITY (NEW) ──
    // Sub-scores: beat rate, EPS growth, revenue growth, beat consistency
    const eqSubs: SubScore[] = [];
    if (earnings.length > 0) {
      // Beat rate: % of quarters where surprise_pct > 0
      const beats = earnings.filter((e: any) => e.surprise_pct != null && e.surprise_pct > 0).length;
      const total = earnings.filter((e: any) => e.surprise_pct != null).length;
      if (total > 0) {
        eqSubs.push({ label: 'Beat Rate', value: clamp((beats / total) * 100), weight: 3 });
      }

      // Consistency: low std dev of surprise_pct = more predictable
      const surprises = earnings.filter((e: any) => e.surprise_pct != null).map((e: any) => e.surprise_pct);
      if (surprises.length >= 2) {
        const mean = surprises.reduce((a: number, b: number) => a + b, 0) / surprises.length;
        const variance = surprises.reduce((s: number, v: number) => s + (v - mean) ** 2, 0) / surprises.length;
        const stdDev = Math.sqrt(variance);
        // Low std dev (<5%) = consistent (80), high (>20%) = unpredictable (30)
        eqSubs.push({ label: 'Beat Consistency', value: clamp(85 - stdDev * 2.5), weight: 2 });
      }
    }
    if (fund.forward_eps != null && fund.trailing_eps != null && fund.trailing_eps > 0) {
      // EPS growth: forward vs trailing
      const epsGrowth = (fund.forward_eps - fund.trailing_eps) / Math.abs(fund.trailing_eps);
      eqSubs.push({ label: 'EPS Growth', value: clamp(50 + epsGrowth * 150), weight: 2.5 });
    }
    if (fund.revenue_growth != null) {
      // Revenue growth: 0% = 40, 10% = 60, 25%+ = 85
      eqSubs.push({ label: 'Revenue Growth', value: clamp(40 + fund.revenue_growth * 180), weight: 2 });
    }
    const earningsQuality: DimensionResult = {
      dimension: 'Earnings',
      score: weightedAvg(eqSubs),
      fullMark: 100,
      subScores: eqSubs,
    };

    return [technical, fundamental, sentiment, insider, institutional, momentum, valuation, earningsQuality];
  }, [data]);

  const avgScore = Math.round(radarData.reduce((s, d) => s + d.score, 0) / radarData.length);
  const overallLabel = avgScore >= 75 ? 'Strong' : avgScore >= 50 ? 'Moderate' : avgScore >= 25 ? 'Weak' : 'Poor';
  const overallColor = avgScore >= 70 ? greenColor : avgScore >= 40 ? gold : redColor;

  const scoreColor = (score: number) =>
    score >= 70 ? greenColor : score >= 40 ? gold : redColor;

  return (
    <div className="flex flex-col gap-3">
      {/* Radar chart + center score */}
      <div className="relative mx-auto" style={{ width: 280, height: 260 }}>
        <ResponsiveContainer width="100%" height="100%">
          <RadarChart data={radarData} cx="50%" cy="50%" outerRadius="68%">
            <PolarGrid stroke={gridStroke} strokeDasharray="3 3" />
            <PolarAngleAxis
              dataKey="dimension"
              tick={({ payload, x, y, textAnchor }: any) => {
                const dim = radarData.find((d) => d.dimension === payload.value);
                const sc = dim?.score ?? 0;
                return (
                  <g>
                    <text
                      x={x}
                      y={y}
                      textAnchor={textAnchor}
                      fontSize={9}
                      fontFamily="DM Sans"
                      fill={textMuted}
                    >
                      {payload.value}
                    </text>
                    <text
                      x={x}
                      y={y + 11}
                      textAnchor={textAnchor}
                      fontSize={9}
                      fontFamily="DM Mono, monospace"
                      fontWeight={600}
                      fill={scoreColor(sc)}
                    >
                      {sc}
                    </text>
                  </g>
                );
              }}
            />
            <Radar
              dataKey="score"
              stroke={gold}
              fill={gold}
              fillOpacity={0.15}
              strokeWidth={2}
              dot={{ r: 3, fill: gold, strokeWidth: 0 }}
              animationDuration={800}
            />
          </RadarChart>
        </ResponsiveContainer>
        {/* Center score */}
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="text-center">
            <p className="font-numeric text-2xl font-semibold" style={{ color: overallColor }}>{avgScore}</p>
            <p className="text-[9px] font-body font-medium" style={{ color: overallColor }}>{overallLabel}</p>
            <p className="text-[7px] font-body" style={{ color: textMuted }}>/ 100</p>
          </div>
        </div>
      </div>

      {/* Legend with expandable sub-scores */}
      <div className="space-y-1">
        {radarData.map((d) => {
          const barColor = scoreColor(d.score);
          const isExpanded = expandedDim === d.dimension;
          return (
            <div key={d.dimension}>
              <button
                type="button"
                className="w-full flex items-center gap-2 py-0.5 rounded transition-colors hover:opacity-80"
                style={{ background: 'transparent' }}
                onClick={() => setExpandedDim(isExpanded ? null : d.dimension)}
                aria-expanded={isExpanded}
                aria-label={`${d.dimension}: ${d.score}/100. Click to ${isExpanded ? 'collapse' : 'expand'} details.`}
              >
                <span className="text-[10px] font-body w-[72px] text-right shrink-0" style={{ color: textMuted }}>
                  {d.dimension}
                </span>
                <div className="flex-1 h-1.5 rounded-full overflow-hidden" style={{ background: bgSurface }}>
                  <div
                    className="h-full rounded-full transition-all duration-700"
                    style={{ width: `${d.score}%`, background: barColor }}
                  />
                </div>
                <span className="text-[10px] font-numeric w-7 text-right shrink-0" style={{ color: barColor }}>
                  {d.score}
                </span>
                <span
                  className="text-[9px] shrink-0 transition-transform duration-200"
                  style={{ color: textMuted, transform: isExpanded ? 'rotate(90deg)' : 'rotate(0deg)' }}
                >
                  ▸
                </span>
              </button>

              {/* Sub-score breakdown */}
              {isExpanded && d.subScores.length > 0 && (
                <div
                  className="ml-[80px] mr-6 mt-0.5 mb-1 rounded-md px-2 py-1.5 space-y-1"
                  style={{ background: bgCard }}
                >
                  {d.subScores.map((sub) => {
                    const subColor = sub.value < 0 ? textMuted : scoreColor(sub.value);
                    return (
                      <div key={sub.label} className="flex items-center gap-1.5">
                        <span className="text-[9px] font-body w-[110px] text-right shrink-0" style={{ color: textMuted }}>
                          {sub.label}
                        </span>
                        <div className="flex-1 h-1 rounded-full overflow-hidden" style={{ background: bgSurface }}>
                          <div
                            className="h-full rounded-full"
                            style={{
                              width: sub.value >= 0 ? `${sub.value}%` : '0%',
                              background: subColor,
                            }}
                          />
                        </div>
                        <span className="text-[9px] font-numeric w-5 text-right shrink-0" style={{ color: subColor }}>
                          {sub.value >= 0 ? sub.value : '—'}
                        </span>
                      </div>
                    );
                  })}
                  {d.subScores.length === 0 && (
                    <p className="text-[9px] font-body" style={{ color: textMuted }}>No data available</p>
                  )}
                </div>
              )}
              {isExpanded && d.subScores.length === 0 && (
                <div className="ml-[80px] mr-6 mt-0.5 mb-1 rounded-md px-2 py-1.5" style={{ background: bgCard }}>
                  <p className="text-[9px] font-body" style={{ color: textMuted }}>No data available for scoring</p>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
