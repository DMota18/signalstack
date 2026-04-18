import { useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';
import { useLocation } from 'react-router-dom';
import { api } from '../api/client';
import AlertCard from '../components/AlertCard';
import PolymarketPanel from '../components/PolymarketPanel';
import {
  Bell, BellPlus, Plus, Trash2, Loader2, TrendingUp, TrendingDown,
  Activity, DollarSign, Users, BarChart3, X,
} from 'lucide-react';

const alertTypes = [
  { value: '', label: 'All', icon: Bell },
  { value: 'daily_digest', label: 'Digests', icon: BarChart3 },
  { value: 'pre_earnings', label: 'Earnings', icon: DollarSign },
  { value: 'price_movement', label: 'Price', icon: Activity },
  { value: 'insider_activity', label: 'Insider', icon: Users },
  { value: 'polymarket', label: 'Polymarket', icon: TrendingUp },
];

export default function AlertsPage() {
  const { isDark } = useTheme();
  const location = useLocation();
  const [alerts, setAlerts] = useState<any[]>([]);
  const [filter, setFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [showPriceAlerts, setShowPriceAlerts] = useState(false);
  const [priceAlerts, setPriceAlerts] = useState<any[]>([]);
  const [priceAlertsLoading, setPriceAlertsLoading] = useState(false);

  // New price alert form
  const [newTicker, setNewTicker] = useState('');
  const [newThreshold, setNewThreshold] = useState('3');
  const [newDirection, setNewDirection] = useState<'above' | 'below'>('above');
  const [creating, setCreating] = useState(false);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const inputBg = isDark ? '#0C0C0E' : '#F8F7F4';
  const inputBorder = isDark ? '#2A2A2D' : '#D0D0D0';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  useEffect(() => {
    const state = location.state as { tab?: string } | null;
    if (state?.tab === 'polymarket') setFilter('polymarket');
  }, [location.state]);

  useEffect(() => { loadAlerts(); }, [filter]);

  const loadAlerts = async () => {
    setLoading(true);
    const alertType = filter === 'polymarket' ? 'polymarket_shift' : (filter || undefined);
    const res = await api.getAlerts({ alert_type: alertType, limit: 50 });
    if (res.status === 'ok') setAlerts(res.data || []);
    setLoading(false);
  };

  const loadPriceAlerts = async () => {
    setPriceAlertsLoading(true);
    const res = await api.getPriceAlerts();
    if (res.status === 'ok') setPriceAlerts(res.data || []);
    setPriceAlertsLoading(false);
  };

  const createPriceAlert = async () => {
    const t = newTicker.trim().toUpperCase();
    const threshold = Number(newThreshold);
    if (!t || !threshold || threshold <= 0) return;
    setCreating(true);
    const res = await api.createPriceAlert(t, threshold, newDirection);
    if (res.status === 'ok') {
      setNewTicker('');
      setNewThreshold('3');
      await loadPriceAlerts();
    }
    setCreating(false);
  };

  const deletePriceAlert = async (id: string) => {
    await api.deletePriceAlert(id);
    setPriceAlerts(priceAlerts.filter(a => a.id !== id));
  };

  useEffect(() => {
    if (showPriceAlerts) loadPriceAlerts();
  }, [showPriceAlerts]);

  const isPolymarketTab = filter === 'polymarket';

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-xl">Notifications</h1>
        <button
          onClick={() => setShowPriceAlerts(!showPriceAlerts)}
          className="flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-lg transition-colors"
          style={{
            background: showPriceAlerts ? `${gold}15` : 'transparent',
            color: showPriceAlerts ? gold : textMuted,
            border: `0.5px solid ${showPriceAlerts ? `${gold}40` : isDark ? '#2A2A2D' : '#D0D0D0'}`,
          }}
        >
          <BellPlus size={13} /> Price alerts
        </button>
      </div>

      {/* Price alert management panel */}
      {showPriceAlerts && (
        <div className="rounded-xl p-5 space-y-4" style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
          <p className="text-xs font-body font-medium" style={{ color: gold }}>Price movement alerts</p>
          <p className="text-[10px] font-body" style={{ color: textMuted }}>
            Get notified when a ticker moves more than your threshold in a day.
          </p>

          {/* Create form */}
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={newTicker}
              onChange={(e) => setNewTicker(e.target.value.toUpperCase())}
              placeholder="TICKER"
              maxLength={8}
              className="text-sm font-body px-3 py-2 rounded-lg outline-none w-24"
              style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }}
            />
            <select
              value={newDirection}
              onChange={(e) => setNewDirection(e.target.value as 'above' | 'below')}
              className="text-sm font-body px-3 py-2 rounded-lg outline-none"
              style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }}
            >
              <option value="above">moves up</option>
              <option value="below">moves down</option>
            </select>
            <div className="flex items-center gap-1">
              <input
                type="number"
                value={newThreshold}
                onChange={(e) => setNewThreshold(e.target.value)}
                min="0.5"
                max="50"
                step="0.5"
                className="text-sm font-body px-2 py-2 rounded-lg outline-none w-16 text-center"
                style={{ background: inputBg, border: `0.5px solid ${inputBorder}`, color: isDark ? '#E8E6E1' : '#1A1A1D' }}
              />
              <span className="text-sm font-body" style={{ color: textMuted }}>%</span>
            </div>
            <button
              onClick={createPriceAlert}
              disabled={creating || !newTicker.trim()}
              className="flex items-center gap-1.5 text-xs font-body px-4 py-2 rounded-lg disabled:opacity-40"
              style={{ background: gold, color: '#0C0C0E' }}
            >
              {creating ? <Loader2 size={12} className="animate-spin" /> : <Plus size={12} />}
              Add
            </button>
          </div>

          {/* Active price alerts */}
          {priceAlertsLoading ? (
            <div className="flex items-center gap-2 py-4">
              <Loader2 size={14} className="animate-spin" style={{ color: gold }} />
              <span className="text-xs font-body" style={{ color: textMuted }}>Loading alerts...</span>
            </div>
          ) : priceAlerts.length > 0 ? (
            <div className="space-y-1.5">
              {priceAlerts.map((a) => (
                <div key={a.id} className="flex items-center justify-between py-2 px-3 rounded-lg"
                  style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                  <div className="flex items-center gap-3">
                    {a.direction === 'above'
                      ? <TrendingUp size={13} style={{ color: greenColor }} />
                      : <TrendingDown size={13} style={{ color: redColor }} />
                    }
                    <span className="text-sm font-body font-medium">{a.ticker}</span>
                    <span className="text-xs font-body" style={{ color: textMuted }}>
                      {a.direction === 'above' ? 'up' : 'down'} {a.threshold_pct}%
                    </span>
                    {a.triggered_at && (
                      <span className="text-[9px] font-body px-1.5 py-0.5 rounded" style={{ background: `${gold}12`, color: gold }}>
                        Triggered
                      </span>
                    )}
                  </div>
                  <button onClick={() => deletePriceAlert(a.id)}
                    className="p-1 rounded hover:opacity-70" style={{ color: textMuted }}>
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs font-body py-2" style={{ color: textMuted }}>
              No price alerts set. Add one above to get notified on big moves.
            </p>
          )}
        </div>
      )}

      {/* Type filter */}
      <div className="flex gap-1 flex-wrap">
        {alertTypes.map((t) => (
          <button key={t.value} onClick={() => setFilter(t.value)}
            className="flex items-center gap-1 text-[11px] font-body px-3 py-1.5 rounded-md transition-colors"
            style={{
              background: filter === t.value ? `${gold}15` : 'transparent',
              color: filter === t.value ? gold : textMuted,
            }}>
            <t.icon size={11} />
            {t.label}
          </button>
        ))}
      </div>

      {/* Polymarket tab */}
      {isPolymarketTab ? (
        <div className="space-y-8">
          <PolymarketPanel />
          {alerts.length > 0 && (
            <div>
              <div className="flex items-center gap-2 mb-3">
                <span className="text-[10px] tracking-[1px] font-body" style={{ color: textMuted }}>
                  PREVIOUS POLYMARKET ALERTS
                </span>
                <div className="flex-1 h-px" style={{ background: border }} />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {alerts.map((alert) => <AlertCard key={alert.id} alert={alert} />)}
              </div>
            </div>
          )}
        </div>
      ) : (
        <>
          {loading ? (
            <div className="flex items-center justify-center py-16">
              <Loader2 size={20} className="animate-spin" style={{ color: gold }} />
            </div>
          ) : alerts.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {alerts.map((alert) => <AlertCard key={alert.id} alert={alert} />)}
            </div>
          ) : (
            <div className="text-center py-16">
              <Bell size={28} style={{ color: `${gold}40` }} className="mx-auto mb-3" />
              <p className="font-display text-lg mb-1">No notifications yet</p>
              <p className="text-sm font-body" style={{ color: textMuted }}>
                {filter ? `No ${alertTypes.find(t => t.value === filter)?.label?.toLowerCase()} alerts.`
                  : 'Intelligence and price alerts will appear here as they\'re generated.'}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
