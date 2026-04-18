import { useState, useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useTheme } from '../hooks/useTheme';
import { api } from '../api/client';
import { ArrowLeft, ThumbsUp, ThumbsDown, Check, Mail, Loader2 } from 'lucide-react';

export default function AlertDetailPage() {
  const { alertId } = useParams();
  const navigate = useNavigate();
  const { isDark } = useTheme();
  const [alert, setAlert] = useState<any>(null);
  const [feedbackGiven, setFeedbackGiven] = useState<'useful' | 'not_useful' | null>(null);
  const [emailSending, setEmailSending] = useState(false);
  const [emailSent, setEmailSent] = useState(false);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#151517' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';

  useEffect(() => {
    if (alertId) {
      api.getAlert(alertId).then((res) => {
        if (res.status === 'ok') setAlert(res.data);
      });
    }
  }, [alertId]);

  const handleFeedback = async (type: 'useful' | 'not_useful') => {
    if (alertId) {
      await api.submitAlertFeedback(alertId, type);
      setFeedbackGiven(type);
    }
  };

  if (!alert) {
    return (
      <div className="flex items-center justify-center py-20">
        <span className="text-sm font-body" style={{ color: textMuted }}>Loading...</span>
      </div>
    );
  }

  const synthesis = alert.body_json || {};
  const holdings = synthesis.per_holding_intelligence || [];
  const insights = synthesis.portfolio_level_insights || [];
  const summary = synthesis.portfolio_summary || {};

  return (
    <div className="space-y-6 max-w-3xl">
      {/* Back button */}
      <button onClick={() => navigate('/app/alerts')}
        className="flex items-center gap-2 text-sm font-body transition-opacity hover:opacity-70"
        style={{ color: textMuted }}>
        <ArrowLeft size={16} /> Back to alerts
      </button>

      {/* Header */}
      <div>
        <p className="text-[10px] tracking-[1px] font-body mb-1" style={{ color: gold }}>
          {alert.alert_type?.replace(/_/g, ' ').toUpperCase()}
        </p>
        <h1 className="font-display text-2xl">{alert.title}</h1>
        <p className="text-xs font-body mt-1" style={{ color: textMuted }}>
          {new Date(alert.created_at).toLocaleString()}
          {alert.signals_used?.length > 0 && (
            <> — {alert.signals_used.length} signal dimensions</>
          )}
        </p>
      </div>

      {/* Signal badges */}
      {alert.signals_used?.length > 0 && (
        <div className="flex gap-1.5 flex-wrap">
          {alert.signals_used.map((s: string) => (
            <span key={s} className="text-[10px] font-body px-2.5 py-1 rounded-md"
              style={{ background: `${gold}12`, color: gold }}>
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </span>
          ))}
        </div>
      )}

      {/* Portfolio-level insights */}
      {insights.length > 0 && (
        <div className="rounded-xl p-5 space-y-2" style={{ background: surface, border: isDark ? 'none' : `0.5px solid ${border}` }}>
          <p className="text-xs font-body font-medium mb-2" style={{ color: gold }}>Portfolio insights</p>
          {insights.map((insight: string, i: number) => (
            <p key={i} className="text-sm font-body leading-relaxed" style={{ color: textMuted }}>
              {insight}
            </p>
          ))}
        </div>
      )}

      {/* Per-holding intelligence */}
      {holdings.map((h: any, i: number) => {
        const signalColor = h.net_signal?.includes('bullish') ? (isDark ? '#34C759' : '#28A745')
          : h.net_signal?.includes('bearish') ? (isDark ? '#FF453A' : '#DC3545')
          : h.net_signal === 'conflicting' ? gold
          : textMuted;

        return (
          <div key={i} className="rounded-xl p-5" style={{
            background: surface,
            borderLeft: `3px solid ${signalColor}`,
            borderRadius: '0 12px 12px 0',
            border: isDark ? undefined : `0.5px solid ${border}`,
            borderLeftWidth: '3px',
            borderLeftColor: signalColor,
            borderLeftStyle: 'solid',
          }}>
            <div className="flex items-center justify-between mb-2">
              <div className="flex items-center gap-3">
                <span className="font-display text-base">{h.ticker}</span>
                {h.position_pct && (
                  <span className="text-[11px] font-body" style={{ color: textMuted }}>
                    {h.position_pct.toFixed(1)}% of portfolio
                  </span>
                )}
              </div>
              <span className={`text-xs font-body px-2 py-0.5 rounded-md`}
                style={{ background: `${signalColor}15`, color: signalColor }}>
                {(h.net_signal || 'neutral').replace(/_/g, ' ')}
              </span>
            </div>

            {/* Narrative */}
            <p className="text-sm font-body leading-relaxed mb-3" style={{ color: isDark ? '#B0AEA6' : '#4A4A4D' }}>
              {h.narrative}
            </p>

            {/* Signal breakdown */}
            {h.signal_breakdown && (
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mb-3">
                {Object.entries(h.signal_breakdown).map(([key, val]) => (
                  <div key={key} className="text-center p-2 rounded-lg"
                    style={{ background: isDark ? '#0C0C0E' : '#F8F7F4' }}>
                    <p className="text-[10px] font-body mb-0.5" style={{ color: textMuted }}>
                      {key.charAt(0).toUpperCase() + key.slice(1)}
                    </p>
                    <p className="text-[11px] font-body font-medium">
                      {String(val) || '—'}
                    </p>
                  </div>
                ))}
              </div>
            )}

            {/* Conflicts */}
            {h.conflicts?.length > 0 && (
              <div className="text-xs font-body p-2 rounded-lg mb-2"
                style={{ background: `${gold}08`, borderLeft: `2px solid ${gold}` }}>
                <p className="font-medium mb-1" style={{ color: gold }}>Conflicting signals:</p>
                {h.conflicts.map((c: string, j: number) => (
                  <p key={j} style={{ color: textMuted }}>{c}</p>
                ))}
              </div>
            )}

            {/* Upcoming catalysts */}
            {h.upcoming_catalysts?.length > 0 && (
              <div className="flex gap-1.5 flex-wrap">
                {h.upcoming_catalysts.map((c: string, j: number) => (
                  <span key={j} className="text-[10px] font-body px-2 py-0.5 rounded"
                    style={{ background: isDark ? '#1A1A1D' : '#F0EEE8', color: textMuted }}>
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* Feedback */}
      {!feedbackGiven ? (
        <div className="flex items-center justify-center gap-4 py-4">
          <p className="text-xs font-body" style={{ color: textMuted }}>Was this intelligence useful?</p>
          <button onClick={() => handleFeedback('useful')}
            className="flex items-center gap-1.5 text-xs font-body px-4 py-2 rounded-lg transition-all hover:scale-105"
            style={{ background: `${isDark ? '#34C759' : '#28A745'}15`, border: `0.5px solid ${isDark ? '#34C759' : '#28A745'}40`, color: isDark ? '#34C759' : '#28A745' }}>
            <ThumbsUp size={13} /> Useful
          </button>
          <button onClick={() => handleFeedback('not_useful')}
            className="flex items-center gap-1.5 text-xs font-body px-4 py-2 rounded-lg transition-all hover:scale-105"
            style={{ background: `${isDark ? '#FF453A' : '#DC3545'}10`, border: `0.5px solid ${isDark ? '#FF453A' : '#DC3545'}30`, color: isDark ? '#FF453A' : '#DC3545' }}>
            <ThumbsDown size={13} /> Not useful
          </button>
        </div>
      ) : (
        <div className="flex items-center justify-center gap-2 py-4 rounded-lg"
          style={{ background: `${gold}08` }}>
          <Check size={14} style={{ color: gold }} />
          <p className="text-xs font-body" style={{ color: gold }}>
            {feedbackGiven === 'useful' ? 'Glad this was helpful!' : 'Thanks — we\'ll improve future reports.'}
          </p>
        </div>
      )}

      {/* Email digest delivery */}
      <div className="flex items-center justify-center">
        <button
          onClick={async () => {
            setEmailSending(true);
            try {
              await api.sendAlertEmail(alertId!);
              setEmailSent(true);
              setTimeout(() => setEmailSent(false), 4000);
            } catch { /* ignore */ }
            setEmailSending(false);
          }}
          disabled={emailSending || emailSent}
          className="flex items-center gap-2 text-xs font-body px-4 py-2 rounded-lg transition-all disabled:opacity-50"
          style={{
            border: `0.5px solid ${isDark ? '#2A2A2D' : '#D0D0D0'}`,
            color: emailSent ? (isDark ? '#34C759' : '#28A745') : textMuted,
          }}
        >
          {emailSending ? (
            <><Loader2 size={13} className="animate-spin" /> Sending...</>
          ) : emailSent ? (
            <><Check size={13} /> Sent to your email</>
          ) : (
            <><Mail size={13} /> Email this report</>
          )}
        </button>
      </div>

      {/* Disclaimer */}
      <p className="text-[11px] font-body text-center" style={{ color: isDark ? '#2A2A2D' : '#D0D0D0' }}>
        {synthesis.disclaimer || 'This is market intelligence for educational purposes, not investment advice.'}
      </p>
    </div>
  );
}
