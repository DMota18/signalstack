import { useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { Zap, Loader2 } from 'lucide-react';

interface UpgradeCTAProps {
  feature: string;
  compact?: boolean;
}

export default function UpgradeCTA({ feature, compact = false }: UpgradeCTAProps) {
  const { isDark } = useTheme();
  const [loading, setLoading] = useState(false);
  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#6A6A6D' : '#8A8A8D';

  const handleUpgrade = async () => {
    setLoading(true);
    const res = await api.createCheckoutSession();
    if (res.status === 'ok' && res.data?.checkout_url) {
      window.location.href = res.data.checkout_url;
    } else {
      setLoading(false);
    }
  };

  if (compact) {
    return (
      <button
        onClick={handleUpgrade}
        disabled={loading}
        className="flex items-center gap-1.5 text-xs font-body px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
        style={{
          background: `${gold}12`,
          border: `0.5px solid ${gold}30`,
          color: gold,
        }}>
        {loading ? <Loader2 size={12} className="animate-spin" aria-hidden="true" /> : <Zap size={12} aria-hidden="true" />}
        Upgrade to unlock
      </button>
    );
  }

  return (
    <div className="rounded-xl p-5 text-center space-y-3"
      style={{
        background: isDark ? '#151517' : '#FFFFFF',
        border: `0.5px solid ${isDark ? `${gold}20` : `${gold}30`}`,
      }}>
      <div className="w-10 h-10 rounded-full flex items-center justify-center mx-auto"
        style={{ background: `${gold}15` }}>
        <Zap size={20} style={{ color: gold }} />
      </div>
      <div>
        <p className="text-sm font-body font-medium">{feature} requires Pro</p>
        <p className="text-[11px] font-body mt-1" style={{ color: textMuted }}>
          Upgrade to Pro for $15/month to unlock {feature.toLowerCase()}, unlimited tickers, and daily intelligence.
        </p>
      </div>
      <button
        onClick={handleUpgrade}
        disabled={loading}
        className="btn-gold text-sm mx-auto flex items-center gap-2 disabled:opacity-50">
        {loading ? <><Loader2 size={14} className="animate-spin" aria-hidden="true" /> Redirecting...</> : 'Upgrade to Pro'}
      </button>
    </div>
  );
}
