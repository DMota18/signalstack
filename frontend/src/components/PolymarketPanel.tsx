import { useState, useEffect, useCallback } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import {
  TrendingUp, Clock, Search, Loader2,
  ChevronDown, ChevronUp, Globe, AlertCircle,
} from 'lucide-react';
import { formatCompactCurrency } from '../lib/format';

interface PolymarketMarket {
  question: string;
  yes_price: number | null;
  no_price: number | null;
  implied_probability_pct: number | null;
  volume_24h: number;
  liquidity: number;
  end_date: string;
  category?: string;
  market_slug?: string;
  condition_id?: string;
  polymarket_url?: string;
}

interface PolymarketEvent {
  event_title: string;
  outcomes: Array<{
    question: string;
    yes_price: number | null;
    no_price: number | null;
    implied_probability_pct: number | null;
    volume_24h: number;
  }>;
  total_volume: number;
  end_date?: string;
  polymarket_url?: string;
}

interface TickerMatch {
  markets_found: number;
  markets: PolymarketMarket[];
  events?: PolymarketEvent[];
}

// ─── Full Market Row ───────────────────────────────────────────────────────

function FullMarketRow({
  market, gold, textMuted, isDark,
}: {
  market: PolymarketMarket; gold: string; textMuted: string; isDark: boolean;
}) {
  const yesPct = market.yes_price ? Math.round(market.yes_price * 100) : null;
  const vol = market.volume_24h || 0;
  const volStr = formatCompactCurrency(vol);
  const endDate = market.end_date ? new Date(market.end_date) : null;
  const timeframe = endDate ? (endDate.getTime() - Date.now() < 7 * 86400000 ? 'Daily' : endDate.getTime() - Date.now() < 35 * 86400000 ? 'Monthly' : 'Long-term') : '';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  return (
    <a href={market.polymarket_url || '#'} target="_blank" rel="noopener noreferrer"
      className="block rounded-xl p-4 no-underline transition-all hover:scale-[1.005]"
      style={{ background: isDark ? '#0C0C0E' : '#F8F7F4', border: `0.5px solid ${isDark ? '#1A1A1D' : '#E8E6E1'}` }}
      onClick={(e: React.MouseEvent) => { if (!market.polymarket_url) e.preventDefault(); }}>
      <p className="text-xs font-body font-medium leading-snug mb-3">
        {market.question}
      </p>
      {yesPct !== null && (
        <div className="flex items-center justify-between mb-1.5">
          <span className="text-sm font-numeric font-semibold tabular-nums" style={{ color: gold }}>
            {yesPct}%
          </span>
          <div className="flex gap-1.5">
            <span className="text-[10px] font-body font-semibold px-2.5 py-0.5 rounded"
              style={{ background: `${greenColor}25`, color: greenColor }}>
              Yes
            </span>
            <span className="text-[10px] font-body font-semibold px-2.5 py-0.5 rounded"
              style={{ background: `${redColor}25`, color: redColor }}>
              No
            </span>
          </div>
        </div>
      )}
      {yesPct !== null && (
        <div className="w-full h-1.5 rounded-full overflow-hidden mb-3" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }}>
          <div className="h-full rounded-full" style={{ width: `${yesPct}%`, background: greenColor }} />
        </div>
      )}
      <div className="flex items-center gap-3 text-[10px] font-body" style={{ color: textMuted }}>
        {vol > 0 && <span className="font-numeric tabular-nums">{volStr} Vol.</span>}
        {timeframe && <span>{timeframe}</span>}
      </div>
    </a>
  );
}


// ─── Ticker Group (collapsible) ────────────────────────────────────────────

function TickerGroup({
  ticker, match, gold, textMuted, isDark, surface, border,
}: {
  ticker: string; match: TickerMatch;
  gold: string; textMuted: string; isDark: boolean; surface: string; border: string;
}) {
  const [expanded, setExpanded] = useState(true);

  const events = match.events || [];
  const hasContent = events.length > 0 || (match.markets && match.markets.length > 0);
  if (!hasContent) return null;

  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: surface, border: `0.5px solid ${border}` }}>
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 transition-colors"
        style={{ borderBottom: expanded ? `0.5px solid ${border}` : 'none' }}
      >
        <div className="flex items-center gap-2">
          <span className="text-xs font-body font-medium px-2 py-0.5 rounded"
            style={{ background: `${gold}12`, color: gold }}>
            {ticker}
          </span>
          <span className="text-[10px] font-body" style={{ color: textMuted }}>
            {events.length > 0 ? `${events.length} event${events.length !== 1 ? 's' : ''}` : `${match.markets_found} market${match.markets_found !== 1 ? 's' : ''}`}
          </span>
        </div>
        {expanded ? <ChevronUp size={14} style={{ color: textMuted }} />
          : <ChevronDown size={14} style={{ color: textMuted }} />}
      </button>
      {expanded && (
        <div className="p-3 grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* Render grouped events first */}
          {events.map((evt, i) => {
            const vol = evt.total_volume || 0;
            const volStr = formatCompactCurrency(vol);
            const endDate = evt.end_date ? new Date(evt.end_date) : null;
            const timeframe = endDate ? (endDate.getTime() - Date.now() < 7 * 86400000 ? 'Daily' : endDate.getTime() - Date.now() < 35 * 86400000 ? 'Monthly' : 'Long-term') : '';

            return (
              <a key={`evt-${i}`} href={evt.polymarket_url || '#'} target="_blank" rel="noopener noreferrer"
                className="block rounded-xl p-4 no-underline transition-all hover:scale-[1.005]"
                style={{ background: isDark ? '#0C0C0E' : '#F8F7F4', border: `0.5px solid ${isDark ? '#1A1A1D' : '#E8E6E1'}` }}>
                <p className="text-xs font-body font-semibold leading-snug mb-3">
                  {evt.event_title}
                </p>
                <div className="space-y-2 mb-3">
                  {evt.outcomes.map((o, j) => {
                    const pct = o.implied_probability_pct ?? (o.yes_price ? Math.round(o.yes_price * 100) : 0);
                    return (
                      <div key={j} className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-body truncate flex-1" style={{ color: textMuted }}>
                          {o.question}
                        </span>
                        <span className="text-xs font-numeric font-semibold tabular-nums shrink-0" style={{ color: gold }}>
                          {pct}%
                        </span>
                        <div className="flex gap-1 shrink-0">
                          <span className="text-[9px] font-body font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: `${greenColor}15`, color: greenColor }}>Yes</span>
                          <span className="text-[9px] font-body font-semibold px-1.5 py-0.5 rounded"
                            style={{ background: `${redColor}15`, color: redColor }}>No</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3 text-[10px] font-body" style={{ color: textMuted }}>
                  {vol > 0 && <span className="font-numeric tabular-nums">{volStr} Vol.</span>}
                  {timeframe && <span>{timeframe}</span>}
                </div>
              </a>
            );
          })}
          {/* Fallback: render flat markets if no events */}
          {events.length === 0 && match.markets.map((market, i) => (
            <FullMarketRow key={`mkt-${i}`} market={market}
              gold={gold} textMuted={textMuted} isDark={isDark} />
          ))}
        </div>
      )}
    </div>
  );
}


// ─── Search Results ────────────────────────────────────────────────────────

function SearchResults({
  results, loading, query, gold, textMuted, isDark,
}: {
  results: PolymarketMarket[]; loading: boolean; query: string;
  gold: string; textMuted: string; isDark: boolean;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center py-8">
        <Loader2 size={18} className="animate-spin" style={{ color: gold }} />
        <span className="ml-2 text-sm font-body" style={{ color: textMuted }}>
          Searching Polymarket...
        </span>
      </div>
    );
  }

  if (query && results.length === 0) {
    return (
      <p className="text-sm font-body text-center py-8" style={{ color: textMuted }}>
        No active markets found for "{query}"
      </p>
    );
  }

  if (results.length === 0) return null;

  return (
    <div>
      <p className="text-[10px] tracking-[1px] font-body mb-3" style={{ color: textMuted }}>
        SEARCH RESULTS — {results.length} MARKET{results.length !== 1 ? 'S' : ''}
      </p>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {results.map((market, i) => (
          <FullMarketRow key={i} market={market}
            gold={gold} textMuted={textMuted} isDark={isDark} />
        ))}
      </div>
    </div>
  );
}


// ─── Main Panel ────────────────────────────────────────────────────────────

export default function PolymarketPanel() {
  const { isDark } = useTheme();
  const [holdingsData, setHoldingsData] = useState<{
    per_ticker: Record<string, TickerMatch>;
    macro_markets: PolymarketMarket[];
    total_markets_found: number;
    tickers_searched: number;
  } | null>(null);
  const [holdingsLoading, setHoldingsLoading] = useState(true);
  const [holdingsError, setHoldingsError] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<PolymarketMarket[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [lastSearched, setLastSearched] = useState('');

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#111113' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';

  // Load holdings-matched markets on mount
  useEffect(() => {
    console.log('[PolymarketPanel] Fetching holdings-match...');
    api.getPolymarketMatches(true)
      .then((res) => {
        console.log('[PolymarketPanel] API response:', JSON.stringify(res).slice(0, 800));
        if (res.status === 'ok' && res.data) {
          setHoldingsData(res.data);
        } else {
          console.warn('[PolymarketPanel] Non-ok response:', res);
          setHoldingsError(res.error?.message || 'Failed to load Polymarket data');
        }
        setHoldingsLoading(false);
      })
      .catch((err) => {
        console.error('[PolymarketPanel] Fetch error:', err);
        setHoldingsError('Network error loading prediction markets');
        setHoldingsLoading(false);
      });
  }, []);

  // Search handler
  const handleSearch = useCallback(async () => {
    const q = searchQuery.trim();
    if (!q || q === lastSearched) return;

    setSearchLoading(true);
    setLastSearched(q);

    try {
      const res = await api.searchPolymarketMarkets(q, 500);
      console.log('[PolymarketPanel] Search response:', JSON.stringify(res).slice(0, 500));
      if (res.status === 'ok' && res.data?.markets) {
        setSearchResults(res.data.markets);
      } else {
        setSearchResults([]);
      }
    } catch (err) {
      console.error('[PolymarketPanel] Search error:', err);
      setSearchResults([]);
    }
    setSearchLoading(false);
  }, [searchQuery, lastSearched]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSearch();
  };

  // Filter out extreme probabilities — not useful signal
  const isUseful = (m: PolymarketMarket) => {
    const pct = m.implied_probability_pct ?? (m.yes_price ? m.yes_price * 100 : 50);
    return pct >= 5 && pct <= 95;
  };

  // Sorted tickers: those with useful markets first
  const tickerEntries = Object.entries(holdingsData?.per_ticker || {})
    .map(([ticker, match]) => [ticker, {
      ...match,
      markets: (match.markets || []).filter(isUseful),
      markets_found: (match.markets || []).filter(isUseful).length,
    }] as [string, TickerMatch])
    .filter(([, match]) => match.markets.length > 0)
    .sort((a, b) => b[1].markets_found - a[1].markets_found);

  const macroMarkets = (holdingsData?.macro_markets || []).filter(isUseful);

  return (
    <div className="space-y-5">
      {/* Search bar */}
      <div className="flex gap-2">
        <div className="flex-1 flex items-center gap-2 px-4 py-2.5 rounded-lg"
          style={{
            background: isDark ? '#151517' : '#FFFFFF',
            border: `0.5px solid ${isDark ? '#2A2A2D' : '#D0D0D0'}`,
          }}>
          <Search size={14} style={{ color: textMuted }} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Search markets — e.g. 'Fed rate cut', 'Bitcoin 200k', 'recession'"
            className="flex-1 text-sm font-body outline-none bg-transparent"
            style={{ color: isDark ? '#E8E6E1' : '#1A1A1D' }}
          />
        </div>
        <button
          onClick={handleSearch}
          disabled={searchLoading || !searchQuery.trim()}
          className="px-4 py-2.5 rounded-lg text-xs font-body font-medium transition-all disabled:opacity-40"
          style={{ background: gold, color: '#0C0C0E' }}
        >
          {searchLoading ? <Loader2 size={14} className="animate-spin" /> : 'Search'}
        </button>
      </div>

      {/* Search results (above holdings when active) */}
      <SearchResults
        results={searchResults}
        loading={searchLoading}
        query={lastSearched}
        gold={gold} textMuted={textMuted} isDark={isDark}
      />

      {/* Holdings-matched section */}
      {holdingsLoading ? (
        <div className="flex items-center justify-center py-12">
          <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
          <span className="ml-3 text-sm font-body" style={{ color: textMuted }}>
            Loading prediction markets for your holdings...
          </span>
        </div>
      ) : holdingsError ? (
        <div className="rounded-xl p-5" style={{ background: surface, border: `0.5px solid ${border}` }}>
          <div className="flex items-center gap-2 mb-2">
            <AlertCircle size={14} style={{ color: textMuted }} />
            <p className="text-xs font-body font-medium" style={{ color: textMuted }}>
              Could not load prediction markets
            </p>
          </div>
          <p className="text-xs font-body" style={{ color: textMuted }}>{holdingsError}</p>
        </div>
      ) : (
        <>
          {/* Header */}
          {tickerEntries.length > 0 && (
            <div className="flex items-center gap-2">
              <TrendingUp size={14} style={{ color: gold }} />
              <span className="text-[10px] tracking-[1px] font-body" style={{ color: textMuted }}>
                YOUR HOLDINGS — {holdingsData?.total_markets_found || 0} MARKETS MATCHED
              </span>
            </div>
          )}

          {/* Per-ticker groups */}
          {tickerEntries.map(([ticker, match]) => (
            <TickerGroup key={ticker} ticker={ticker} match={match}
              gold={gold} textMuted={textMuted} isDark={isDark}
              surface={surface} border={border} />
          ))}

          {/* Macro markets */}
          {macroMarkets.length > 0 && (
            <div className="rounded-xl overflow-hidden"
              style={{ background: surface, border: `0.5px solid ${border}` }}>
              <div className="flex items-center gap-2 px-4 py-3"
                style={{ borderBottom: `0.5px solid ${border}` }}>
                <Globe size={13} style={{ color: gold }} />
                <span className="text-xs font-body font-medium">Macro & economic</span>
                <span className="text-[10px] font-body" style={{ color: textMuted }}>
                  {macroMarkets.length} market{macroMarkets.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="p-3 space-y-2">
                {macroMarkets.map((market, i) => (
                  <FullMarketRow key={i} market={market}
                    gold={gold} textMuted={textMuted} isDark={isDark} />
                ))}
              </div>
            </div>
          )}

          {/* Empty state */}
          {tickerEntries.length === 0 && macroMarkets.length === 0 && !lastSearched && (
            <div className="text-center py-12">
              <TrendingUp size={28} style={{ color: `${gold}40` }} className="mx-auto mb-3" />
              <p className="text-sm font-body mb-1" style={{ color: textMuted }}>
                No active prediction markets match your holdings
              </p>
              <p className="text-xs font-body" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
                Try searching for a topic, event, or ticker above
              </p>
            </div>
          )}
        </>
      )}

      {/* Timestamp + disclaimer */}
      <div className="pt-2 space-y-1">
        <p className="text-[9px] font-body flex items-center gap-1"
          style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
          <Clock size={8} /> As of {new Date().toLocaleTimeString()} — Polymarket Gamma API
        </p>
        <p className="text-[9px] font-body" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
          Prediction market data is for informational purposes only, not investment advice.
          Implied probabilities reflect crowd consensus, not guaranteed outcomes.
        </p>
      </div>
    </div>
  );
}
