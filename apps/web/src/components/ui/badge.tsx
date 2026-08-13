import { cn } from '@/lib/cn';
import { HTMLAttributes } from 'react';

type BadgeVariant = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand';
type BadgeSize = 'sm' | 'md';

interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
  variant?: BadgeVariant;
  size?: BadgeSize;
  /** Leading status dot. Makes state readable without relying on colour alone. */
  dot?: boolean;
  /**
   * Renders as a solid, high-contrast pill for placing on top of cover images,
   * where a tinted-on-paper badge would disappear.
   */
  onCover?: boolean;
}

/**
 * Status pill.
 *
 * Colours derive from the `--color-*` status tokens via `color-mix` rather
 * than hardcoded palette classes, so badges follow dark mode and any future
 * palette change instead of drifting from the rest of the system.
 */
const VARIANT: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--color-surface-sunken)] text-[var(--color-muted)] border-[var(--color-border)]',
  success:
    'bg-[color-mix(in_oklab,var(--color-success)_12%,var(--color-surface))] text-[color-mix(in_oklab,var(--color-success)_72%,var(--color-text))] border-[color-mix(in_oklab,var(--color-success)_28%,var(--color-border))]',
  warning:
    'bg-[color-mix(in_oklab,var(--color-warning)_14%,var(--color-surface))] text-[color-mix(in_oklab,var(--color-warning)_72%,var(--color-text))] border-[color-mix(in_oklab,var(--color-warning)_30%,var(--color-border))]',
  danger:
    'bg-[color-mix(in_oklab,var(--color-danger)_12%,var(--color-surface))] text-[color-mix(in_oklab,var(--color-danger)_72%,var(--color-text))] border-[color-mix(in_oklab,var(--color-danger)_28%,var(--color-border))]',
  info: 'bg-[color-mix(in_oklab,var(--color-info)_12%,var(--color-surface))] text-[color-mix(in_oklab,var(--color-info)_74%,var(--color-text))] border-[color-mix(in_oklab,var(--color-info)_28%,var(--color-border))]',
  brand:
    'bg-[color-mix(in_oklab,var(--color-brand-500)_12%,var(--color-surface))] text-[color-mix(in_oklab,var(--color-brand-500)_78%,var(--color-text))] border-[color-mix(in_oklab,var(--color-brand-500)_28%,var(--color-border))]',
};

const DOT: Record<BadgeVariant, string> = {
  neutral: 'bg-[var(--color-muted)]',
  success: 'bg-[var(--color-success)]',
  warning: 'bg-[var(--color-warning)]',
  danger: 'bg-[var(--color-danger)]',
  info: 'bg-[var(--color-info)]',
  brand: 'bg-[var(--color-brand-500)]',
};

const SIZE: Record<BadgeSize, string> = {
  sm: 'px-2 py-0.5 text-[11px] gap-1',
  md: 'px-2.5 py-1 text-xs gap-1.5',
};

export function Badge({
  variant = 'neutral',
  size = 'sm',
  dot = false,
  onCover = false,
  className,
  children,
  ...props
}: BadgeProps) {
  return (
    <span
      className={cn(
        'inline-flex items-center whitespace-nowrap rounded-full border font-medium',
        SIZE[size],
        onCover
          ? 'border-white/25 bg-black/45 text-white shadow-sm backdrop-blur-md'
          : VARIANT[variant],
        className,
      )}
      {...props}
    >
      {dot && <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', DOT[variant])} aria-hidden="true" />}
      {children}
    </span>
  );
}
