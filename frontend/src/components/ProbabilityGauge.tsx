import { useState, useEffect } from 'react';
import { useTheme } from '../hooks/useTheme';

interface ProbabilityGaugeProps {
  pct: number;
  size?: number;
  strokeWidth?: number;
  label?: boolean;
}

/**
 * ProbabilityGauge — Animated arc gauge for Polymarket probabilities.
 * Replaces flat probability bars with a sleek semi-circular gauge.
 */
export default function ProbabilityGauge({
  pct,
  size = 56,
  strokeWidth = 5,
  label = true,
}: ProbabilityGaugeProps) {
  const { isDark } = useTheme();
  const [animatedPct, setAnimatedPct] = useState(0);

  const gold = isDark ? '#D4A843' : '#8B6914';
  const trackColor = isDark ? '#1A1A1D' : '#E8E6E1';

  // Animate on mount
  useEffect(() => {
    const timer = setTimeout(() => setAnimatedPct(pct), 50);
    return () => clearTimeout(timer);
  }, [pct]);

  const center = size / 2;
  const radius = (size - strokeWidth) / 2;
  // Arc spans 240 degrees (from -210 to 30, centered at bottom)
  const arcDeg = 240;
  const startAngle = 150; // degrees (SVG coordinate system)
  const endAngle = startAngle + arcDeg;

  const clampedPct = Math.min(100, Math.max(0, animatedPct));
  const fillAngle = startAngle + (clampedPct / 100) * arcDeg;

  const toRad = (deg: number) => (deg * Math.PI) / 180;

  const arcPath = (start: number, end: number) => {
    const s = toRad(start);
    const e = toRad(end);
    const x1 = center + radius * Math.cos(s);
    const y1 = center + radius * Math.sin(s);
    const x2 = center + radius * Math.cos(e);
    const y2 = center + radius * Math.sin(e);
    const large = end - start > 180 ? 1 : 0;
    return `M ${x1} ${y1} A ${radius} ${radius} 0 ${large} 1 ${x2} ${y2}`;
  };

  // Color interpolation based on pct
  const gaugeColor = pct >= 70
    ? (isDark ? '#34C759' : '#28A745')
    : pct >= 40
    ? gold
    : (isDark ? '#FF453A' : '#DC3545');

  return (
    <div className="relative flex flex-col items-center" style={{ width: size, height: size * 0.75 }}>
      <svg width={size} height={size * 0.75} viewBox={`0 0 ${size} ${size * 0.85}`}>
        {/* Track */}
        <path
          d={arcPath(startAngle, endAngle)}
          fill="none"
          stroke={trackColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
        />
        {/* Fill */}
        {clampedPct > 0 && (
          <path
            d={arcPath(startAngle, fillAngle)}
            fill="none"
            stroke={gaugeColor}
            strokeWidth={strokeWidth}
            strokeLinecap="round"
            style={{
              transition: 'all 0.8s cubic-bezier(0.4, 0, 0.2, 1)',
            }}
          />
        )}
        {/* Needle dot */}
        {clampedPct > 0 && (
          <circle
            cx={center + radius * Math.cos(toRad(fillAngle))}
            cy={center + radius * Math.sin(toRad(fillAngle))}
            r={strokeWidth * 0.6}
            fill={gaugeColor}
            style={{ transition: 'all 0.8s cubic-bezier(0.4, 0, 0.2, 1)' }}
          />
        )}
      </svg>
      {/* Label */}
      {label && (
        <div className="absolute flex flex-col items-center"
          style={{ bottom: 0, left: '50%', transform: 'translateX(-50%)' }}>
          <span className="font-numeric text-sm font-medium leading-none" style={{ color: gaugeColor }}>
            {pct.toFixed(0)}%
          </span>
        </div>
      )}
    </div>
  );
}
