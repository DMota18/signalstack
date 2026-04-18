import { useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import HoldingsTable from '../components/HoldingsTable';
import PortfolioDonut from '../components/PortfolioDonut';
import AddHoldingForm from '../components/AddHoldingForm';
import {
  Plus, Loader2, ChevronDown, ChevronUp, Eye, TrendingUp, TrendingDown,
  Trash2, BellPlus, X,
} from 'lucide-react';

export default function HoldingsPage() {
  const { isDark } = useTheme();
  const [holdings, setHoldings] = useState<any[]>([]);
  const [watchlist, setWatchlist] = useState<any[]>([]);
  const [priceAlerts, setPriceAlerts] = useState<any[]>([]);
  const [newTicker, setNewTicker] = useState('');
  const [tab, setTab] = useState<'holdings' | 'watchlist' | 'alerts'>('holdings');
  const [loading, setLoading] = useState(true);
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

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    setLoading(true);
    const [hRes, wRes, paRes] = await Promise.all([
      api.getAllHoldings(),
      api.getWatchlist(),
      api.getPriceAlerts(),
    ]);
    if (hRes.status === 'ok') setHoldings(hRes.data || []);
    if (wRes.status === 'ok') setWatchlist(wRes.data || []);
    if (paRes.status === 'ok') setPriceAlerts(paRes.data || []);
    setLoading(false);
  };

  const addToWatchlist = async () => {
    if (!newTicker.trim()) return;
    await api.addToWatchlist(newTicker.trim().toUpperCase());
    setNewTicker('');
    const wRes = await api.getWatchlist();
    if (wRes.status === 'ok') setWatchlist(wRes.data || []);
  };

  const removeFromWatchlist = async (ticker: string) => {
    await api.removeFromWatchlist(ticker);
    const wRes = await api.getWatchlist();
    if (wRes.status === 'ok') setWatchlist(wRes.data || []);
  };

  const removeHolding = async (ticker: string) => {
    if (!confirm(`Remove ${ticker} from your portfolio?`)) return;
    await api.removeManualHolding(ticker);
    await loadData();
  };

  const createPriceAlert = async () => {
    const t = alertTicker.trim().toUpperCase();
    if (!t) return;
    await api.createPriceAlert(t, Number(alertThreshold) || 3, alertDirection);
    setAlertTicker('');
    const r = await api.getPriceAlerts();
    if (r.status === 'ok') setPriceAlerts(r.data || []);
  };

  const deletePriceAlert = async (id: string) => {
    await api.deletePriceAlert(id);
    setPriceAlerts(priceAlerts.filter(a => a.id !== id));
  };

  if (loading) {
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
              ${totalValue.toLocaleString(undefined, { maximumFractionDigits: 0 })} across {holdings.length} position{holdings.length !== 1 ? 's' : ''}
            </p>
          )}
        </div>
        {tab === 'holdings' && (
          <button onClick={() => setShowAddForm(!showAddForm)}
            className="flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-lg transition-all"
            style={{ background: showAddForm ? `${gold}15` : 'transparent', color: gold, border: `0.5px solid ${gold}40` }}>
            {showAddForm ? <ChevronUp size={12} /> : <Plus size={12} />}
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
          <button key={t.value} onClick={() => setTab(t.value)}
            className="flex items-center gap-1.5 text-sm font-body px-4 py-2 rounded-lg transition-colors"
            style={{ background: tab === t.value ? `${gold}15` : 'transparent', color: tab === t.value ? gold : textMuted }}>
            {t.icon && <t.icon size={13} />}
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
              <AddHoldingForm onSuccess={loadData} />
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
              placeholder="Add ticker (e.g. TSLA)" maxLength={10}
              onKeyDown={(e) => e.key === 'Enter' && addToWatchlist()}
              className="px-3 py-2 rounded-lg text-sm font-body outline-none flex-1 max-w-xs"
              style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }} />
            <button onClick={addToWatchlist} className="btn-gold flex items-center gap-1 text-sm">
              <Plus size={14} /> Add
            </button>
          </div>

          {watchlist.map((w) => (
            <div key={w.ticker} className="flex items-center justify-between py-3"
              style={{ borderBottom: `0.5px solid ${isDark ? '#1A1A1D' : '#F0EEE8'}` }}>
              <span className="text-sm font-body font-medium">{w.ticker}</span>
              <button onClick={() => removeFromWatchlist(w.ticker)}
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
              placeholder="TICKER" maxLength={8}
              className="text-sm font-body px-3 py-2 rounded-lg outline-none w-24"
              style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }} />
            <select value={alertDirection} onChange={(e) => setAlertDirection(e.target.value as any)}
              className="text-sm font-body px-3 py-2 rounded-lg outline-none"
              style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }}>
              <option value="above">moves up</option>
              <option value="below">moves down</option>
            </select>
            <div className="flex items-center gap-1">
              <input type="number" value={alertThreshold} onChange={(e) => setAlertThreshold(e.target.value)}
                min="0.5" max="50" step="0.5"
                className="text-sm font-body px-2 py-2 rounded-lg outline-none w-16 text-center"
                style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }} />
              <span className="text-sm font-body" style={{ color: textMuted }}>%</span>
            </div>
            <button onClick={createPriceAlert} disabled={!alertTicker.trim()}
              className="flex items-center gap-1.5 text-xs font-body px-4 py-2 rounded-lg disabled:opacity-40"
              style={{ background: gold, color: '#0C0C0E' }}>
              <Plus size={12} /> Add alert
            </button>
          </div>

          {priceAlerts.length > 0 ? (
            <div className="space-y-1.5">
              {priceAlerts.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2.5 px-3 rounded-lg"
                  style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                  <div className="flex items-center gap-3">
                    {a.direction === 'above'
                      ? <TrendingUp size={13} style={{ color: greenColor }} />
                      : <TrendingDown size={13} style={{ color: redColor }} />}
                    <span className="text-sm font-body font-medium">{a.ticker}</span>
                    <span className="text-xs font-body" style={{ color: textMuted }}>
                      {a.direction === 'above' ? 'up' : 'down'} {a.threshold_pct}%
                    </span>
                  </div>
                  <button onClick={() => deletePriceAlert(a.id)} className="p-1 rounded hover:opacity-70" style={{ color: textMuted }}>
                    <Trash2 size={12} />
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
