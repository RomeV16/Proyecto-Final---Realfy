'use client';

import { motion, useReducedMotion } from 'framer-motion';
import { cn } from '@/lib/cn';

/**
 * Small data marks for record cards.
 *
 * Entities without photos still need something to look at. Rather than filling
 * that space with decoration, these render the number the card is already
 * about — contract term elapsed, collection rate, amount vs. total — so the
 * visual weight carries information.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE_COLOR: Record<Tone, string> = {
  brand: 'var(--color-brand-500)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
  neutral: 'var(--color-muted)',
};

/* ──────────── Progress ring ──────────── */

interface ProgressRingProps {
  /** 0–100. Values outside the range are clamped. */
  value: number;
  size?: number;
  strokeWidth?: number;
  tone?: Tone;
  /** Centre label. Pass `null` for a bare ring. */
  label?: React.ReactNode;
  className?: string;
}

/**
 * Circular progress. Used for "8 de 24 meses transcurridos", occupancy,
 * collection rate — anything that is a share of a whole.
 */
export function ProgressRing({
  value,
  size = 44,
  strokeWidth = 4,
  tone = 'brand',
  label,
  className,
}: ProgressRingProps) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (pct / 100) * circumference;

  return (
    <div
      className={cn('relative inline-flex shrink-0 items-center justify-center', className)}
      style={{ width: size, height: size }}
      role="img"
      aria-label={`${Math.round(pct)}%`}
    >
      <svg width={size} height={size} className="-rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--color-border)"
          strokeWidth={strokeWidth}
        />
        <motion.circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={TONE_COLOR[tone]}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeDasharray={circumference}
          initial={reduce ? false : { strokeDashoffset: circumference }}
          animate={{ strokeDashoffset: offset }}
          transition={{ duration: 0.9, ease: EASE, delay: 0.1 }}
        />
      </svg>
      {label !== null && (
        <span className="absolute inset-0 flex items-center justify-center text-[11px] font-semibold tabular-nums text-[var(--color-text)]">
          {label ?? `${Math.round(pct)}`}
        </span>
      )}
    </div>
  );
}

/* ──────────── Sparkline ──────────── */

interface SparklineProps {
  /** Series in chronological order. Fewer than 2 points renders nothing. */
  data: number[];
  width?: number;
  height?: number;
  tone?: Tone;
  /** Fills the area under the line. */
  fill?: boolean;
  className?: string;
}

/** Trend line for a card — payment history, price movement, ticket volume. */
export function Sparkline({
  data,
  width = 72,
  height = 24,
  tone = 'brand',
  fill = true,
  className,
}: SparklineProps) {
  const reduce = useReducedMotion();
  if (!data || data.length < 2) return null;

  const min = Math.min(...data);
  const max = Math.max(...data);
  const span = max - min || 1;
  const stepX = width / (data.length - 1);
  const pad = 2;
  const usable = height - pad * 2;

  const points = data.map((v, i) => {
    const x = i * stepX;
    const y = pad + usable - ((v - min) / span) * usable;
    return [x, y] as const;
  });

  const line = points
    .map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(2)},${y.toFixed(2)}`)
    .join(' ');
  const area = `${line} L${width},${height} L0,${height} Z`;
  const color = TONE_COLOR[tone];
  const gradientId = `spark-${tone}-${data.length}-${Math.round(min)}-${Math.round(max)}`;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('overflow-visible', className)}
      aria-hidden="true"
    >
      {fill && (
        <>
          <defs>
            <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity="0.28" />
              <stop offset="100%" stopColor={color} stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={area} fill={`url(#${gradientId})`} />
        </>
      )}
      <motion.path
        d={line}
        fill="none"
        stroke={color}
        strokeWidth={1.75}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={reduce ? false : { pathLength: 0, opacity: 0 }}
        animate={{ pathLength: 1, opacity: 1 }}
        transition={{ duration: 0.8, ease: EASE, delay: 0.15 }}
      />
      <circle
        cx={points[points.length - 1][0]}
        cy={points[points.length - 1][1]}
        r="2"
        fill={color}
      />
    </svg>
  );
}

/* ──────────── Linear meter ──────────── */

interface MeterProps {
  /** 0–100. */
  value: number;
  tone?: Tone;
  /** Rendered above the bar, split left/right. */
  label?: React.ReactNode;
  hint?: React.ReactNode;
  className?: string;
}

/** Horizontal progress bar — collection progress, term elapsed, quota. */
export function Meter({ value, tone = 'brand', label, hint, className }: MeterProps) {
  const reduce = useReducedMotion();
  const pct = Math.max(0, Math.min(100, value));

  return (
    <div className={cn('space-y-1.5', className)}>
      {(label || hint) && (
        <div className="flex items-baseline justify-between gap-2 text-xs">
          {label && <span className="font-medium text-[var(--color-text)]">{label}</span>}
          {hint && <span className="tabular-nums text-[var(--color-muted)]">{hint}</span>}
        </div>
      )}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-[var(--color-border)]"
        role="progressbar"
        aria-valuenow={Math.round(pct)}
        aria-valuemin={0}
        aria-valuemax={100}
      >
        <motion.div
          className="h-full rounded-full"
          style={{ backgroundColor: TONE_COLOR[tone] }}
          initial={reduce ? false : { width: 0 }}
          animate={{ width: `${pct}%` }}
          transition={{ duration: 0.8, ease: EASE, delay: 0.1 }}
        />
      </div>
    </div>
  );
}

/* ──────────── Trend delta ──────────── */

/** Signed change chip — "+12% vs mes anterior". */
export function TrendDelta({
  value,
  suffix = '%',
  /** Set when a decrease is the good outcome (delinquency, days-to-close). */
  invert = false,
  className,
}: {
  value: number;
  suffix?: string;
  invert?: boolean;
  className?: string;
}) {
  const positive = value >= 0;
  const good = invert ? !positive : positive;

  return (
    <span
      className={cn(
        'inline-flex items-center gap-0.5 text-xs font-semibold tabular-nums',
        good ? 'text-[var(--color-success)]' : 'text-[var(--color-danger)]',
        className,
      )}
    >
      <svg className="h-3 w-3" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path
          d={positive ? 'M6 9.5V2.5M6 2.5L2.5 6M6 2.5L9.5 6' : 'M6 2.5v7M6 9.5L2.5 6M6 9.5L9.5 6'}
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {positive ? '+' : ''}
      {value}
      {suffix}
    </span>
  );
}
