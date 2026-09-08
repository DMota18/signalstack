import { useState, useEffect, useRef } from 'react';
import { useTheme } from '../hooks/useTheme';
import { Loader2, Check, AlertCircle, X } from 'lucide-react';
import type { AgentProgress } from '../hooks/useIntelligenceStream';

interface IntelligenceProgressProps {
  active: boolean;
  holdingsCount: number;
  /** Real-time agent progress from SSE stream (optional — falls back to timer) */
  agents?: Record<string, AgentProgress>;
  /** Current status message from SSE stream */
  statusMessage?: string;
  /** Current agent index from SSE (1-based) */
  currentIndex?: number;
  /** Total agent count from SSE */
  totalAgents?: number;
  /** Error from SSE stream */
  error?: string | null;
  /** Called when user clicks dismiss on error */
  onDismiss?: () => void;
}

const AGENT_STEPS = [
  { key: 'sentiment', label: 'Analyzing news sentiment', duration: 15000 },
  { key: 'polymarket', label: 'Checking prediction markets', duration: 12000 },
  { key: 'insider', label: 'Scanning insider activity', duration: 12000 },
  { key: 'institutional', label: 'Reviewing institutional flow', duration: 12000 },
  { key: 'macro', label: 'Evaluating macro context', duration: 10000 },
  { key: 'profile', label: 'Running profile analysis', duration: 8000 },
  { key: 'synthesis', label: 'Synthesizing intelligence', duration: 20000 },
];

export default function IntelligenceProgress({
  active,
  holdingsCount,
  agents,
  statusMessage,
  currentIndex: _currentIndex,
  totalAgents,
  error,
  onDismiss,
}: IntelligenceProgressProps) {
  const { isDark } = useTheme();
  const [timerStep, setTimerStep] = useState(0);
  const [, setStartTime] = useState<number | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const clockRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const textMuted = isDark ? '#9A9A9D' : '#5A5A5D';
  const surface = isDark ? '#111113' : '#FFFFFF';
  const border = isDark ? '#1A1A1D' : '#E8E6E1';
  const greenColor = isDark ? '#34C759' : '#28A745';
  const redColor = isDark ? '#FF453A' : '#DC3545';

  // Determine if we have real SSE data or are using the timer fallback
  const hasSSE = agents && Object.keys(agents).length > 0;

  useEffect(() => {
    if (active) {
      setTimerStep(0);
      setStartTime(Date.now());
      setElapsed(0);

      // Elapsed clock
      clockRef.current = setInterval(() => {
        setElapsed((prev) => prev + 1);
      }, 1000);
    } else {
      setTimerStep(0);
      setStartTime(null);
      if (timerRef.current) clearTimeout(timerRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (clockRef.current) clearInterval(clockRef.current);
    };
  }, [active]);

  // Timer-based fallback progression (only when no SSE data)
  useEffect(() => {
    if (!active || hasSSE || timerStep >= AGENT_STEPS.length) return;

    const step = AGENT_STEPS[timerStep];
    const scaleFactor = Math.max(1, holdingsCount / 8);
    const adjustedDuration = step.duration * Math.min(scaleFactor, 2);

    timerRef.current = setTimeout(() => {
      setTimerStep((prev) => Math.min(prev + 1, AGENT_STEPS.length));
    }, adjustedDuration);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [active, hasSSE, timerStep, holdingsCount]);

  if (!active && !error) return null;

  // Error state
  if (error) {
    return (
      <div className="rounded-xl overflow-hidden" role="alert"
        style={{ background: surface, border: `0.5px solid ${redColor}40` }}>
        <div className="h-1 w-full" style={{ background: redColor }} />
        <div className="p-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <AlertCircle size={16} style={{ color: redColor }} />
              <p className="text-sm font-body font-medium" style={{ color: redColor }}>
                Intelligence generation failed
              </p>
            </div>
            {onDismiss && (
              <button onClick={onDismiss} aria-label="Dismiss error" className="p-1 rounded hover:opacity-70">
                <X size={14} style={{ color: textMuted }} aria-hidden="true" />
              </button>
            )}
          </div>
          <p className="text-xs font-body mt-2" style={{ color: textMuted }}>
            {error}
          </p>
        </div>
      </div>
    );
  }

  // Compute progress
  const getStepStatus = (step: typeof AGENT_STEPS[0], index: number) => {
    if (hasSSE) {
      const agentData = agents![step.key];
      if (!agentData) return 'pending';
      return agentData.status === 'running' ? 'current' : agentData.status === 'completed' ? 'completed' : agentData.status === 'failed' ? 'failed' : 'pending';
    }
    // Timer fallback
    if (index < timerStep) return 'completed';
    if (index === timerStep) return 'current';
    return 'pending';
  };

  const completedCount = hasSSE
    ? Object.values(agents!).filter((a) => a.status === 'completed').length
    : timerStep;
  const total = totalAgents || AGENT_STEPS.length;
  const progressPct = Math.min((completedCount / total) * 100, 95);

  return (
    <div className="rounded-xl overflow-hidden"
      style={{ background: surface, border: `0.5px solid ${border}` }}>
      {/* Progress bar */}
      <div className="h-1 w-full" style={{ background: isDark ? '#1A1A1D' : '#E8E6E1' }}>
        <div
          className="h-full transition-all duration-1000 ease-out"
          style={{ width: `${progressPct}%`, background: gold }}
        />
      </div>

      <div className="p-5">
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2" role="status" aria-live="polite">
            <Loader2 size={16} className="animate-spin" style={{ color: gold }} aria-hidden="true" />
            <p className="text-sm font-body font-medium" style={{ color: gold }}>
              {statusMessage || 'Generating intelligence'}
            </p>
          </div>
          <span className="text-[10px] font-numeric" style={{ color: textMuted }}>
            {Math.floor(elapsed / 60)}:{String(elapsed % 60).padStart(2, '0')} elapsed
          </span>
        </div>

        {/* Steps */}
        <div className="space-y-2">
          {AGENT_STEPS.map((step, i) => {
            const stepStatus = getStepStatus(step, i);
            const agentData = hasSSE ? agents![step.key] : undefined;

            return (
              <div key={step.key} className="flex items-center gap-3">
                {/* Status icon */}
                <div className="w-5 h-5 flex items-center justify-center shrink-0">
                  {stepStatus === 'completed' ? (
                    <Check size={13} style={{ color: greenColor }} />
                  ) : stepStatus === 'failed' ? (
                    <AlertCircle size={13} style={{ color: redColor }} />
                  ) : stepStatus === 'current' ? (
                    <Loader2 size={13} className="animate-spin" style={{ color: gold }} />
                  ) : (
                    <div className="w-1.5 h-1.5 rounded-full"
                      style={{ background: isDark ? '#2A2A2D' : '#D0D0D0' }} />
                  )}
                </div>

                {/* Label */}
                <span className="text-xs font-body flex-1" style={{
                  color: stepStatus === 'completed' ? greenColor
                    : stepStatus === 'failed' ? redColor
                    : stepStatus === 'current' ? (isDark ? '#E8E6E1' : '#1A1A1D')
                    : (isDark ? '#3A3A3D' : '#AAACB0'),
                }}>
                  {step.label}
                </span>

                {/* Duration (SSE only) */}
                {agentData?.durationMs != null && stepStatus !== 'pending' && (
                  <span className="text-[10px] font-numeric" style={{ color: textMuted }}>
                    {(agentData.durationMs / 1000).toFixed(1)}s
                  </span>
                )}
              </div>
            );
          })}
        </div>

        {/* Footer */}
        <p className="text-[10px] font-body mt-4" style={{ color: isDark ? '#3A3A3D' : '#AAACB0' }}>
          Analyzing {holdingsCount} holding{holdingsCount !== 1 ? 's' : ''} across {hasSSE ? '6' : '5'} signal dimensions.
          {!hasSSE && ' This typically takes 2-4 minutes.'}
        </p>
      </div>
    </div>
  );
}
