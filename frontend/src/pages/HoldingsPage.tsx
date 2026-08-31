import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import type { Holding, PriceAlert, WatchlistItem } from '../api/types';
import HoldingsTable from '../components/HoldingsTable';
import PortfolioDonut from '../components/PortfolioDonut';
import AddHoldingForm from '../components/AddHoldingForm';
import {
  Plus, Loader2, ChevronUp, Eye, TrendingUp, TrendingDown,
  Trash2, BellPlus,
} from 'lucide-react';
import { formatCurrency } from '../lib/format';

export default function HoldingsPage() {
  const { isDark } = useTheme();
  const queryClient = useQueryClient();
  const [newTicker, setNewTicker] = useState('');
  const [tab, setTab] = useState<'holdings' | 'watchlist' | 'alerts'>('holdings');
  const [showAddForm, setShowAddForm] = useState(false);

  // Price alert form
  const [alertTicker, setAlertTicker] = useState('');
  const [alertThreshold, setAlertThreshold] = useState('3');
  const [alertDirection, setAlertDirection] = useState<'above' | 'below'>('above');

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const inputBg = isDark ? '#0C0C0E' : '#F8F7F4';
  const inputBorder = isDark ? '#2A2A2D' : '#D0D0D0';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  // ── Server state (React Query) ────────────────────────────────────────────

  const holdingsQuery = useQuery({
    queryKey: ['holdings'],
    queryFn: async (): Promise<Holding[]> => {
      const res = await api.getAllHoldings();
      if (res.status !== 'ok') throw new Error(res.error?.message || 'Failed to load holdings');
      return res.data ?? [];
    },
  });

  const watchlistQuery = useQuery({
    queryKey: ['watchlist'],
    queryFn: async (): Promise<WatchlistItem[]> => {
      const res = await api.getWatchlist();
      return res.status === 'ok' ? res.data ?? [] : [];
    },
  });

  const priceAlertsQuery = useQuery({
    queryKey: ['priceAlerts'],
    queryFn: async (): Promise<PriceAlert[]> => {
      const res = await api.getPriceAlerts();
      return res.status === 'ok' ? res.data ?? [] : [];
    },
  });

  const holdings = holdingsQuery.data ?? [];
  const watchlist = watchlistQuery.data ?? [];
  const priceAlerts = priceAlertsQuery.data ?? [];

  const refreshHoldings = () => queryClient.invalidateQueries({ queryKey: ['holdings'] });

  const addWatchlistMutation = useMutation({
    mutationFn: (ticker: string) => api.addToWatchlist(ticker),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlist'] }),
  });

  const removeWatchlistMutation = useMutation({
    mutationFn: (ticker: string) => api.removeFromWatchlist(ticker),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['watchlist'] }),
  });

  const createAlertMutation = useMutation({
    mutationFn: (input: { ticker: string; threshold: number; direction: 'above' | 'below' }) =>
      api.createPriceAlert(input.ticker, input.threshold, input.direction),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['priceAlerts'] }),
  });

  const deleteAlertMutation = useMutation({
    mutationFn: (id: string) => api.deletePriceAlert(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['priceAlerts'] }),
  });

  const addToWatchlist = () => {
    if (!newTicker.trim()) return;
    addWatchlistMutation.mutate(newTicker.trim().toUpperCase());
    setNewTicker('');
  };

  const removeFromWatchlist = (ticker: string) => removeWatchlistMutation.mutate(ticker);

  const removeHolding = async (ticker: string) => {
    if (!confirm(`Remove ${ticker} from your portfolio?`)) return;
    await api.removeManualHolding(ticker);
    refreshHoldings();
  };

  const createPriceAlert = () => {
    const t = alertTicker.trim().toUpperCase();
    if (!t) return;
    createAlertMutation.mutate({ ticker: t, threshold: Number(alertThreshold) || 3, direction: alertDirection });
    setAlertTicker('');
  };

  const deletePriceAlert = (id: string) => deleteAlertMutation.mutate(id);

  if (holdingsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <h1 className="font-display text-xl">Holdings</h1>
        <div className="flex items-center justify-center py-20">
          <Loader2 size={24} className="animate-spin" style={{ color: gold }} />
        </div>
      </div>
    );
  }

  const totalValue = holdings.reduce((s, h) => s + (h.market_value || 0), 0);

  return (
    <div className="space-y-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl">Holdings</h1>
          {totalValue > 0 && (
            <p className="text-sm font-numeric mt-0.5" style={{ color: textMuted }}>
              {formatCurrency(totalValue, 0)} across {holdings.length} position{holdings.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        {tab === 'holdings' && (
          <button onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-lg transition-all"
            style={{ background: showAddForm ? `${gold}15` : 'transparent', color: gold, border: `0.5px solid ${gold}40` }}>
            {showAddForm ? <ChevronUp size={12} aria-hidden="true" /> : <Plus size={12} aria-hidden="true" />}
            {showAddForm ? 'Close' : 'Add holding'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-1">
        {([
          { value: 'holdings' as const, label: `Positions (${holdings.length})`, icon: null },
          { value: 'watchlist' as const, label: `Watchlist (${watchlist.length})`, icon: Eye },
          { value: 'alerts' as const, label: `Price alerts (${priceAlerts.length})`, icon: BellPlus },
        ]).map((t) => (
          <button key={t.value} onClick={() => setTab(t.value)} aria-pressed={tab === t.value}
            className="flex items-center gap-1.5 text-sm font-body px-4 py-2 rounded-lg transition-colors"
            style={{ background: tab === t.value ? `${gold}15` : 'transparent', color: tab === t.value ? gold : textMuted }}>
            {t.icon && <t.icon size={13} aria-hidden="true" />}
            {t.label}
          </button>
        ))}
      </div>

      {/* ── HOLDINGS TAB ── */}
      {tab === 'holdings' && (
        <>
          {showAddForm && (
            <div className="rounded-xl p-5" style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
              <p className="text-xs font-body font-medium mb-3" style={{ color: gold }}>Add a holding</p>
              <AddHoldingForm onSuccess={refreshHoldings} />
            </div>
          )}

          {/* Allocation chart */}
          {holdings.length > 0 && (
            <div className="rounded-xl p-5" style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
              <p className="text-xs font-body font-medium mb-4" style={{ color: gold }}>Allocation</p>
              <PortfolioDonut holdings={holdings} />
            </div>
          )}

          {holdings.length === 0 && !showAddForm ? (
            <div className="text-center py-16">
              <p className="font-display text-lg mb-2">No holdings yet</p>
              <p className="text-sm font-body mb-6" style={{ color: textMuted }}>
                Add your positions manually or connect a brokerage in Settings.
              </p>
              <button onClick={() => setShowAddForm(true)} className="btn-gold">Add your first holding</button>
            </div>
          ) : (
            <HoldingsTable holdings={holdings} onRemove={removeHolding} />
          )}
        </>
      )}

      {/* ── WATCHLIST TAB ── */}
      {tab === 'watchlist' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            <input type="text" value={newTicker} onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
              placeholder="Add ticker (e.g. TSLA)" maxLength={10} aria-label="Ticker to add to watchlist"
              onKeyDown={(e) => e.key === 'Enter' && addToWatchlist()}
              className="px-3 py-2 rounded-lg text-sm font-body outline-none flex-1 max-w-xs"
              style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }} />
            <button onClick={addToWatchlist} className="btn-gold flex items-center gap-1 text-sm">
              <Plus size={14} aria-hidden="true" /> Add
            </button>
          </div>

          {watchlist.map((w) => (
            <div key={w.ticker} className="flex items-center justify-between py-3"
              style={{ borderBottom: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
              <span className="text-sm font-body font-medium">{w.ticker}</span>
              <button onClick={() => removeFromWatchlist(w.ticker)} aria-label={`Remove ${w.ticker} from watchlist`}
                className="text-xs font-body px-2 py-1 rounded" style={{ color: redColor }}>Remove</button>
            </div>
          ))}

          {watchlist.length === 0 && (
            <p className="text-sm font-body text-center py-8" style={{ color: textMuted }}>
              No watchlist items yet. Add tickers above to track them.
            </p>
          )}
        </div>
      )}

      {/* ── PRICE ALERTS TAB ── */}
      {tab === 'alerts' && (
        <div className="space-y-4">
          <p className="text-xs font-body" style={{ color: textMuted }}>
            Get notified when a ticker moves more than your threshold in a single day.
          </p>

          <div className="flex items-center gap-2 flex-wrap">
            <input type="text" value={alertTicker} onChange={(e) => setAlertTicker(e.target.value.toUpperCase())}
              placeholder="TICKER" maxLength={8} aria-label="Ticker for price alert"
              className="text-sm font-body px-3 py-2 rounded-lg outline-none w-24"
              style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }} />
            <select value={alertDirection} onChange={(e) => setAlertDirection(e.target.value as any)}
              aria-label="Price alert direction"
              className="text-sm font-body px-3 py-2 rounded-lg outline-none"
              style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }}>
              <option value="above">moves up</option>
              <option value="below">moves down</option>
            </select>
            <div className="flex items-center gap-1">
              <input type="number" value={alertThreshold} onChange={(e) => setAlertThreshold(e.target.value)}
                min="0.5" max="50" step="0.5" aria-label="Price alert threshold percent"
                className="text-sm font-body px-2 py-2 rounded-lg outline-none w-16 text-center"
                style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }} />
              <span className="text-sm font-body" style={{ color: textMuted }}>%</span>
            </div>
            <button onClick={createPriceAlert} disabled={!alertTicker.trim()}
              className="flex items-center gap-1.5 text-xs font-body px-4 py-2 rounded-lg disabled:opacity-40"
              style={{ background: gold, color: '#0C0C0E' }}>
              <Plus size={12} aria-hidden="true" /> Add alert
            </button>
          </div>

          {priceAlerts.length > 0 ? (
            <div className="space-y-1.5">
              {priceAlerts.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg"
                  style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                  <div className="flex items-center gap-3">
                    {a.direction === 'above'
                      ? <TrendingUp size={13} style={{ color: greenColor }} aria-hidden="true" />
                      : <TrendingDown size={13} style={{ color: redColor }} aria-hidden="true" />}
                    <span className="text-sm font-body font-medium">{a.ticker}</span>
                    <span className="text-xs font-body" style={{ color: textMuted }}>
                      {a.direction === 'above' ? 'up' : 'down'} {a.threshold_pct}%
                    </span>
                  </div>
                  <button onClick={() => deletePriceAlert(a.id)} aria-label={`Delete price alert for ${a.ticker}`} className="p-1 rounded hover:opacity-70" style={{ color: textMuted }}>
                    <Trash2 size={12} aria-hidden="true" />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm font-body text-center py-8" style={{ color: textMuted }}>
              No price alerts set. Add one above to get notified on big moves.
            </p>
          )}
        </div>
      )}
    </div>
  );
}
