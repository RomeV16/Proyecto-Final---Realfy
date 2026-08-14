'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/ui/icon';

/** Shared tone vocabulary — same status tokens the card system uses. */
export type PortalTone = 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'neutral';

export const TONE_COLOR: Record<PortalTone, string> = {
  brand: 'var(--color-brand-500)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
  neutral: 'var(--color-muted)',
};

/**
 * Tinted icon plate. Carries the state colour of whatever it leads — an
 * invoice period, a claim, the account status — without a coloured border.
 */
export function Plate({
  icon,
  tone = 'brand',
  size = 'md',
  children,
  className,
}: {
  icon?: IconName;
  tone?: PortalTone;
  size?: 'sm' | 'md' | 'lg';
  /** Replaces the icon — used for the month chip on invoice rows. */
  children?: ReactNode;
  className?: string;
}) {
  const color = TONE_COLOR[tone];
  const box = {
    sm: 'h-9 w-9 rounded-[var(--radius-lg)]',
    md: 'h-11 w-11 rounded-[var(--radius-xl)]',
    lg: 'h-12 w-12 rounded-[var(--radius-2xl)]',
  }[size];

  return (
    <span
      className={cn('flex shrink-0 flex-col items-center justify-center leading-none', box, className)}
      style={{ backgroundColor: `color-mix(in oklab, ${color} 14%, var(--color-surface))`, color }}
      aria-hidden="true"
    >
      {children ?? (icon && <Icon name={icon} className="h-5 w-5" strokeWidth={1.9} />)}
    </span>
  );
}

/**
 * Section header. The optional link is the block's single way out — lists in
 * the portal never repeat a button per row.
 */
export function SectionHead({
  title,
  href,
  linkLabel,
  className,
}: {
  title: string;
  href?: string;
  linkLabel?: string;
  className?: string;
}) {
  return (
    <div className={cn('mb-3 flex items-baseline justify-between gap-3', className)}>
      <h2 className="h4">{title}</h2>
      {href && linkLabel && (
        <Link
          href={href}
          className="link-underline inline-flex shrink-0 items-center gap-1 text-sm font-medium text-[var(--color-text)]"
        >
          {linkLabel}
          <Icon name="arrowRight" className="h-3.5 w-3.5" strokeWidth={2} />
        </Link>
      )}
    </div>
  );
}
