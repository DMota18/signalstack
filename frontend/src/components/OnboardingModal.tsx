import { useState } from 'react';
import { useTheme } from '../hooks/useTheme';
import { useNavigate } from 'react-router-dom';
import AddHoldingForm from './AddHoldingForm';
import { Link2, PenLine, X, ArrowRight, Wallet } from 'lucide-react';
import { api } from '../api/client';

interface OnboardingModalProps {
  onClose: () => void;
  onHoldingsAdded: () => void;
}

export default function OnboardingModal({ onClose, onHoldingsAdded }: OnboardingModalProps) {
  const { isDark } = useTheme();
  const navigate = useNavigate();
  const [step, setStep] = useState<'choose' | 'manual'>('choose');
  const [addCount, setAddCount] = useState(0);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const overlay = isDark ? 'rgba(0,0,0,0.7)' : 'rgba(0,0,0,0.4)';

  const connectBrokerage = async () => {
    const res = await api.registerConnection();
    if (res.status === 'ok' && res.data?.redirect_url) {
      window.open(res.data.redirect_url, '_blank');
    }
    // Close modal — user will complete in the new tab
    onClose();
  };

  const handleHoldingAdded = () => {
    setAddCount((c) => c + 1);
    onHoldingsAdded();
  };

  const handleDone = () => {
    onClose();
    if (addCount > 0) onHoldingsAdded();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: overlay }}>
      <div
        className="w-full max-w-lg rounded-2xl overflow-hidden relative"
        style={{ background: isDark ? '#0C0C0E' : '#FAFAF8', border: `0.5px solid ${border}` }}
      >
        {/* Close button */}
        <button onClick={onClose}
          className="absolute top-4 right-4 p-1 rounded-lg transition-opacity hover:opacity-70"
          style={{ color: textMuted }}>
          <X size={18} />
        </button>

        {/* Gold top bar */}
        <div style={{ height: 3, background: gold }} />

        <div className="p-6 sm:p-8">
          {step === 'choose' ? (
            <>
              {/* Welcome header */}
              <div className="text-center mb-8">
                <div className="w-12 h-12 rounded-xl mx-auto mb-4 flex items-center justify-center"
                  style={{ background: `${gold}15` }}>
                  <Wallet size={22} style={{ color: gold }} />
                </div>
                <h2 className="font-display text-xl mb-2">Welcome to SignalStack</h2>
                <p className="text-sm font-body leading-relaxed" style={{ color: textMuted }}>
                  Add your holdings so we can deliver personalized intelligence
                  across 5 signal dimensions.
                </p>
              </div>

              {/* Two paths */}
              <div className="space-y-3">
                <button
                  onClick={connectBrokerage}
                  className="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all hover:scale-[1.01]"
                  style={{ background: surface, border: `0.5px solid ${border}` }}
                >
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${gold}12` }}>
                    <Link2 size={18} style={{ color: gold }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-body font-medium">Connect a brokerage</p>
                    <p className="text-[11px] font-body mt-0.5" style={{ color: textMuted }}>
                      Auto-sync holdings via SnapTrade. Supports 50+ brokerages.
                    </p>
                  </div>
                  <ArrowRight size={16} style={{ color: textMuted }} />
                </button>

                <button
                  onClick={() => setStep('manual')}
                  className="w-full flex items-center gap-4 p-4 rounded-xl text-left transition-all hover:scale-[1.01]"
                  style={{ background: surface, border: `0.5px solid ${border}` }}
                >
                  <div className="w-10 h-10 rounded-lg flex items-center justify-center shrink-0"
                    style={{ background: `${gold}12` }}>
                    <PenLine size={18} style={{ color: gold }} />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-body font-medium">Add holdings manually</p>
                    <p className="text-[11px] font-body mt-0.5" style={{ color: textMuted }}>
                      Enter your tickers and quantities. Takes 30 seconds.
                    </p>
                  </div>
                  <ArrowRight size={16} style={{ color: textMuted }} />
                </button>
              </div>

              {/* Skip */}
              <button onClick={onClose}
                className="w-full text-center text-xs font-body mt-6 transition-opacity hover:opacity-70"
                style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
                Skip for now — I'll add holdings later
              </button>
            </>
          ) : (
            <>
              {/* Manual add step */}
              <div className="mb-6">
                <button onClick={() => setStep('choose')}
                  className="text-[11px] font-body mb-4 transition-opacity hover:opacity-70"
                  style={{ color: gold }}>
                  ← Back to options
                </button>
                <h2 className="font-display text-lg mb-1">Add your holdings</h2>
                <p className="text-sm font-body" style={{ color: textMuted }}>
                  Enter each position. You can always edit these later.
                  {addCount > 0 && (
                    <span style={{ color: gold }}> — {addCount} added so far</span>
                  )}
                </p>
              </div>

              <AddHoldingForm onSuccess={handleHoldingAdded} />

              {/* Done button */}
              {addCount > 0 && (
                <button
                  onClick={handleDone}
                  className="w-full mt-6 py-2.5 rounded-lg text-sm font-body font-medium transition-all"
                  style={{ background: gold, color: '#0C0C0E' }}
                >
                  Done — view my dashboard ({addCount} holding{addCount !== 1 ? 's' : ''})
                </button>
              )}

              {addCount === 0 && (
                <button onClick={onClose}
                  className="w-full text-center text-xs font-body mt-6 transition-opacity hover:opacity-70"
                  style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
                  Skip for now
                </button>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}
