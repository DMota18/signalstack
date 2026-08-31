import { useState } from 'react';
import { Share2, Check } from 'lucide-react';
import { formatCurrency, formatPercent } from '../../lib/format';

// ─── Share button ────────────────────────────────────────────────────────

interface ShareButtonProps {
  ticker: string;
  price: number;
  dayChangePct: number;
  isDark: boolean;
  gold: string;
  textMuted: string;
}

export default function ShareButton({ ticker, price, dayChangePct, isDark, gold: _gold, textMuted }: ShareButtonProps) {
  const [copied, setCopied] = useState(false);

  const shareUrl = `${window.location.origin}/research/${ticker}`;

  const shareText = `${ticker} Signal Analysis — ${price > 0 ? formatCurrency(price) : ''}${dayChangePct ? ` (${formatPercent(dayChangePct, { signed: true })})` : ''} — Polymarket odds, insider activity, institutional flow\n${shareUrl}`;

  const handleShare = async () => {
    // Try native share first (mobile)
    if (navigator.share) {
      try {
        await navigator.share({
          title: `${ticker} — Signal Analysis | SignalStack`,
          text: shareText,
          url: shareUrl,
        });
        return;
      } catch {
        // User cancelled or not supported — fall through to clipboard
      }
    }

    // Fallback: copy to clipboard
    try {
      await navigator.clipboard.writeText(shareUrl);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Last resort: select the URL
      window.prompt('Copy this link:', shareUrl);
    }
  };

  return (
    <button
      onClick={handleShare}
      className="flex items-center gap-1.5 text-[11px] font-body px-2.5 py-1 rounded-lg transition-colors"
      style={{
        border: `0.5px solid ${isDark ? '#2A2A2D' : '#D0D0D0'}`,
        color: copied ? (isDark ? '#34C759' : '#28A745') : textMuted,
      }}
    >
      {copied ? <Check size={12} aria-hidden="true" /> : <Share2 size={12} aria-hidden="true" />}
      {copied ? 'Copied' : 'Share'}
    </button>
  );
}
