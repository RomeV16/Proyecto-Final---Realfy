'use client';

import Link from 'next/link';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './icon';
import { ValueFlip } from './motion';
import { ProgressRing, Sparkline, TrendDelta } from './micro-viz';
import { Skeleton } from './skeleton';

/**
 * Metric tile for the panel and for list headers.
 *
 * Each tile carries an icon plate, an optional trend or progress mark, and a
 * call to action when the number is worth acting on — a metric that can't be
 * drilled into is just decoration.
 */

type Tone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

const TONE: Record<Tone, { color: string }> = {
  brand: { color: 'var(--color-brand-500)' },
  success: { color: 'var(--color-success)' },
  warning: { color: 'var(--color-warning)' },
  danger: { color: 'var(--color-danger)' },
  info: { color: 'var(--color-info)' },
  neutral: { color: 'var(--color-muted)' },
};

interface StatTileProps {
  label: string;
  value: number | string;
  suffix?: string;
  icon?: IconName;
  tone?: Tone;
  /** Secondary line under the value. */
  hint?: string;
  /** Signed change vs. the previous period. */
  trend?: number;
  /** Inverts trend colouring — for metrics where down is good. */
  trendInvert?: boolean;
  /** 0–100 — renders a progress ring instead of the icon plate. */
  progress?: number;
  /** Series for a trend line along the bottom. */
  spark?: number[];
  /** Makes the whole tile a link. */
  href?: string;
  className?: string;
}

export function StatTile({
  label,
  value,
  suffix,
  icon,
  tone = 'brand',
  hint,
  trend,
  trendInvert,
  progress,
  spark,
  href,
  className,
}: StatTileProps) {
  const { color } = TONE[tone];

  const body = (
    <>
      {/* Tinted wash in the corner — depth without a coloured border. */}
      <div
        className="pointer-events-none absolute -right-8 -top-8 h-24 w-24 rounded-full opacity-[0.16] blur-2xl transition-opacity duration-300 group-hover:opacity-30"
        style={{ backgroundColor: color }}
        aria-hidden="true"
      />

      <div className="relative flex items-start justify-between gap-3">
        <p className="micro">{label}</p>
        {progress !== undefined ? (
          <ProgressRing
            value={progress}
            size={38}
            strokeWidth={3.5}
            tone={tone === 'neutral' ? 'brand' : tone}
          />
        ) : (
          icon && (
            <span
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]"
              style={{
                backgroundColor: `color-mix(in oklab, ${color} 14%, var(--color-surface))`,
                color,
              }}
            >
              <Icon name={icon} className="h-[1.125rem] w-[1.125rem]" strokeWidth={1.9} />
            </span>
          )
        )}
      </div>

      <p className="numeric-xl relative mt-2 !text-3xl">
        <ValueFlip value={value} />
        {suffix && <span className="ml-0.5 text-lg text-[var(--color-muted)]">{suffix}</span>}
      </p>

      {/* La linea de contexto se reserva siempre: si aparece y desaparece segun
          el dato, la tarjeta cambia de alto y la grilla entera se mueve. */}
      <div className="relative mt-1 flex min-h-[1.125rem] items-center gap-2">
        {trend !== undefined && <TrendDelta value={trend} invert={trendInvert} />}
        {hint && <span className="truncate text-xs text-[var(--color-muted)]">{hint}</span>}
      </div>

      {spark && spark.length > 1 && (
        <div className="relative mt-3">
          <Sparkline data={spark} width={140} height={28} tone={tone === 'neutral' ? 'brand' : tone} />
        </div>
      )}

      {/* Drill-in affordance. Absolute so it never reserves height. */}
      {href && (
        <span
          className="absolute bottom-3 right-3 inline-flex h-6 w-6 translate-x-1 items-center justify-center rounded-full text-[var(--color-brand-600)] opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100"
          style={{ backgroundColor: 'color-mix(in oklab, var(--color-brand-500) 12%, transparent)' }}
          aria-hidden="true"
        >
          <Icon name="arrowRight" className="h-3.5 w-3.5" strokeWidth={2.25} />
        </span>
      )}
    </>
  );

  const classes = cn(
    'group relative flex min-h-[8rem] flex-col overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-sm',
    href && 'card-lift block',
    className,
  );

  if (href) {
    return (
      <div className={classes}>
        <Link href={href} className="absolute inset-0 z-[1] rounded-[inherit]" aria-label={label} />
        {body}
      </div>
    );
  }

  return <div className={classes}>{body}</div>;
}

/** Skeleton shaped like a `StatTile`. */
export function StatTileSkeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'min-h-[8rem] rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-5',
        className,
      )}
      aria-hidden="true"
    >
      <div className="flex items-start justify-between">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-9 w-9 rounded-[var(--radius-md)]" />
      </div>
      <Skeleton className="mt-3 h-8 w-16" />
      <Skeleton className="mt-2 h-3 w-24" />
    </div>
  );
}
