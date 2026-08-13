'use client';

import Link from 'next/link';
import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from './icon';
import { EntityCover } from './entity-cover';
import { Badge } from './badge';

/**
 * The record card used across every list screen.
 *
 * Composition, not configuration — each screen assembles the slots it needs:
 *
 *   <EntityCard href={...}>
 *     <EntityCard.Cover seed={id} icon="contracts" src={photo}
 *       topRight={<Badge onCover>Activo</Badge>} />
 *     <EntityCard.Body>
 *       <EntityCard.Title>Av. Corrientes 1234</EntityCard.Title>
 *       <EntityCard.Subtitle>Palermo · 2 amb</EntityCard.Subtitle>
 *       <EntityCard.Meta items={[{ icon: 'mapPin', label: 'Palermo' }]} />
 *     </EntityCard.Body>
 *     <EntityCard.Footer>
 *       <EntityCard.Amount value="$450.000" hint="por mes" />
 *       <EntityCard.Actions>…</EntityCard.Actions>
 *     </EntityCard.Footer>
 *   </EntityCard>
 *
 * Clickability: passing `href` overlays a stretched link across the whole card
 * so the entire surface is one target. Anything interactive inside must sit
 * above it — `Actions`, `Cover` overlays and `Alert` already handle that, so
 * only hand-rolled buttons need `relative z-[2]`.
 */

interface EntityCardProps {
  /** Makes the whole card a single link target. */
  href?: string;
  /** Accessible name for the stretched link. Defaults to the card's title text. */
  label?: string;
  /**
   * Left accent bar. Use for the record's *state* — the cover carries identity,
   * this carries status, so the two never fight.
   */
  accent?: 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'none';
  /** Larger editorial radius, for the hero grid (properties). */
  featured?: boolean;
  className?: string;
  children: ReactNode;
}

const ACCENT: Record<string, string> = {
  brand: 'var(--color-brand-500)',
  success: 'var(--color-success)',
  warning: 'var(--color-warning)',
  danger: 'var(--color-danger)',
  info: 'var(--color-info)',
};

export function EntityCard({
  href,
  label,
  accent = 'none',
  featured = false,
  className,
  children,
}: EntityCardProps) {
  return (
    <article
      className={cn(
        'card-lift group relative isolate flex h-full flex-col overflow-hidden',
        'border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm',
        featured ? 'rounded-[var(--radius-3xl)]' : 'rounded-[var(--radius-2xl)]',
        className,
      )}
    >
      {accent !== 'none' && (
        <span
          className="absolute inset-y-0 left-0 z-[3] w-1"
          style={{ backgroundColor: ACCENT[accent] }}
          aria-hidden="true"
        />
      )}

      {children}

      {/* Stretched link. Named via aria-label only — an sr-only text node here
          would duplicate the card's visible title in the accessibility tree. */}
      {href && (
        <Link
          href={href}
          className="absolute inset-0 z-[1] rounded-[inherit]"
          aria-label={label || 'Ver detalle'}
        />
      )}
    </article>
  );
}

/* ──────────── Cover ──────────── */

interface CoverProps {
  src?: string | null;
  alt?: string;
  /** Stable id — drives the generated palette when there's no photo. */
  seed: string;
  icon?: IconName;
  aspect?: string;
  /** Short gradient banner instead of a full cover — for records with no photo. */
  band?: boolean;
  topLeft?: ReactNode;
  topRight?: ReactNode;
  bottomLeft?: ReactNode;
  bottomRight?: ReactNode;
  priority?: boolean;
  className?: string;
}

function Cover({
  src,
  alt = '',
  seed,
  icon,
  aspect,
  band,
  topLeft,
  topRight,
  bottomLeft,
  bottomRight,
  priority,
  className,
}: CoverProps) {
  const hasOverlay = Boolean(topLeft || topRight || bottomLeft || bottomRight);

  return (
    <EntityCover
      src={src}
      alt={alt}
      seed={seed}
      icon={icon}
      aspect={aspect}
      band={band}
      priority={priority}
      scrim={Boolean(bottomLeft || bottomRight)}
      className={className}
    >
      {hasOverlay && (
        <>
          <div className="relative z-[2] flex items-start justify-between gap-2">
            <div className="flex flex-wrap items-center gap-1.5">{topLeft}</div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">{topRight}</div>
          </div>
          <div className="relative z-[2] flex items-end justify-between gap-2">
            <div className="min-w-0">{bottomLeft}</div>
            <div className="shrink-0">{bottomRight}</div>
          </div>
        </>
      )}
    </EntityCover>
  );
}

/* ──────────── Body ──────────── */

function Body({ className, children }: { className?: string; children: ReactNode }) {
  return <div className={cn('flex flex-1 flex-col gap-2 p-4', className)}>{children}</div>;
}

function Title({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <h3
      className={cn(
        'font-display line-clamp-2 text-[1.0625rem] font-medium leading-snug tracking-[var(--tracking-tight)] text-[var(--color-text)]',
        'transition-colors group-hover:text-[var(--color-brand-600)]',
        className,
      )}
    >
      {children}
    </h3>
  );
}

function Subtitle({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <p className={cn('line-clamp-1 text-xs text-[var(--color-muted)]', className)}>{children}</p>
  );
}

/** Compact icon+label pairs — address, dates, counts. */
function Meta({
  items,
  className,
}: {
  items: Array<{ icon?: IconName; label: ReactNode; title?: string }>;
  className?: string;
}) {
  if (!items.length) return null;

  return (
    <dl className={cn('flex flex-wrap items-center gap-x-3 gap-y-1', className)}>
      {items.map((item, i) => (
        <div
          key={i}
          className="flex items-center gap-1 text-xs text-[var(--color-muted)]"
          title={item.title}
        >
          {item.icon && (
            <Icon name={item.icon} className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
          )}
          <dd className="truncate">{item.label}</dd>
        </div>
      ))}
    </dl>
  );
}

/**
 * Inline callout for records that need attention — overdue, expiring,
 * unassigned. This is the "what should I do" signal inside the card.
 */
function Alert({
  tone = 'warning',
  icon = 'alert',
  children,
  className,
}: {
  tone?: 'warning' | 'danger' | 'info' | 'success';
  icon?: IconName;
  children: ReactNode;
  className?: string;
}) {
  const TONE = {
    warning:
      'bg-[color-mix(in_oklab,var(--color-warning)_14%,var(--color-surface))] text-[color-mix(in_oklab,var(--color-warning)_70%,var(--color-text))]',
    danger:
      'bg-[color-mix(in_oklab,var(--color-danger)_12%,var(--color-surface))] text-[color-mix(in_oklab,var(--color-danger)_72%,var(--color-text))]',
    info: 'bg-[color-mix(in_oklab,var(--color-info)_12%,var(--color-surface))] text-[color-mix(in_oklab,var(--color-info)_74%,var(--color-text))]',
    success:
      'bg-[color-mix(in_oklab,var(--color-success)_12%,var(--color-surface))] text-[color-mix(in_oklab,var(--color-success)_72%,var(--color-text))]',
  }[tone];

  return (
    <p
      className={cn(
        'relative z-[2] flex items-center gap-1.5 rounded-[var(--radius-sm)] px-2 py-1.5 text-xs font-medium',
        TONE,
        className,
      )}
    >
      <Icon name={icon} className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
      <span className="min-w-0 truncate">{children}</span>
    </p>
  );
}

/* ──────────── Footer ──────────── */

function Footer({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div
      className={cn(
        'mt-auto flex items-center justify-between gap-3 border-t border-[var(--color-border)] px-4 py-3',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** The card's headline number — rent, total, balance. */
function Amount({
  value,
  hint,
  tone = 'default',
  className,
}: {
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'default' | 'muted' | 'danger' | 'success';
  className?: string;
}) {
  const TONE = {
    default: 'text-[var(--color-text)]',
    muted: 'text-[var(--color-muted)]',
    danger: 'text-[var(--color-danger)]',
    success: 'text-[var(--color-success)]',
  }[tone];

  return (
    <div className={cn('min-w-0', className)}>
      <p
        className={cn(
          'font-display truncate text-lg font-medium tabular-nums tracking-[var(--tracking-tight)]',
          TONE,
        )}
      >
        {value}
      </p>
      {hint && <p className="truncate text-[11px] text-[var(--color-muted)]">{hint}</p>}
    </div>
  );
}

/**
 * Action slot. Sits above the stretched link so buttons stay clickable,
 * and holds the card's explicit call to action.
 */
function Actions({ className, children }: { className?: string; children: ReactNode }) {
  return (
    <div className={cn('relative z-[2] flex shrink-0 items-center gap-1.5', className)}>
      {children}
    </div>
  );
}

/**
 * The card's primary call to action.
 * Renders as a link when given `href`, otherwise a button.
 */
function Action({
  href,
  target,
  rel,
  onClick,
  icon,
  variant = 'ghost',
  children,
  className,
  ...rest
}: {
  href?: string;
  /** Solo para enlaces — por ejemplo abrir un PDF en otra pestaña. */
  target?: string;
  rel?: string;
  onClick?: (e: React.MouseEvent) => void;
  icon?: IconName;
  variant?: 'primary' | 'ghost' | 'quiet';
  children: ReactNode;
  className?: string;
} & Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, 'onClick' | 'children'>) {
  const VARIANT = {
    primary: 'bg-[var(--color-brand-500)] text-white hover:bg-[var(--color-brand-600)] shadow-sm',
    ghost:
      'border border-[var(--color-border)] text-[var(--color-text)] hover:border-[var(--color-brand-300)] hover:bg-[var(--color-brand-50)] hover:text-[var(--color-brand-700)]',
    quiet: 'text-[var(--color-muted)] hover:bg-[var(--color-surface-sunken)] hover:text-[var(--color-text)]',
  }[variant];

  const classes = cn(
    'inline-flex items-center gap-1.5 rounded-[var(--radius-lg)] px-2.5 py-1.5 text-xs font-medium',
    'transition-colors duration-300 [transition-timing-function:var(--ease-luxe)]',
    VARIANT,
    className,
  );

  const content = (
    <>
      {icon && <Icon name={icon} className="h-3.5 w-3.5" strokeWidth={2} />}
      {children}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={classes} onClick={onClick} target={target} rel={rel}>
        {content}
      </Link>
    );
  }

  return (
    <button type="button" className={classes} onClick={onClick} {...rest}>
      {content}
    </button>
  );
}

EntityCard.Cover = Cover;
EntityCard.Body = Body;
EntityCard.Title = Title;
EntityCard.Subtitle = Subtitle;
EntityCard.Meta = Meta;
EntityCard.Alert = Alert;
EntityCard.Footer = Footer;
EntityCard.Amount = Amount;
EntityCard.Actions = Actions;
EntityCard.Action = Action;

/* ══════════════════════════════════════════════════════════════
   Row variant — single-column lists (providers, portal, mobile)
   ══════════════════════════════════════════════════════════════ */

interface EntityRowProps {
  href?: string;
  label?: string;
  accent?: EntityCardProps['accent'];
  /** Left visual — an `Avatar`, `ProgressRing`, icon tile, or thumbnail. */
  leading?: ReactNode;
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  /** Right-aligned value block, above the actions. */
  trailing?: ReactNode;
  actions?: ReactNode;
  alert?: ReactNode;
  className?: string;
}

/**
 * Horizontal record row. Same visual language as `EntityCard` — lift on hover,
 * accent for state, explicit action slot — but laid out for full-width lists
 * where a cover image would waste vertical space.
 */
export function EntityRow({
  href,
  label,
  accent = 'none',
  leading,
  title,
  subtitle,
  meta,
  trailing,
  actions,
  alert,
  className,
}: EntityRowProps) {
  return (
    <article
      className={cn(
        'card-lift group relative isolate flex flex-col overflow-hidden',
        'rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm',
        className,
      )}
    >
      {accent !== 'none' && (
        <span
          className="absolute inset-y-0 left-0 z-[3] w-1"
          style={{ backgroundColor: ACCENT[accent] }}
          aria-hidden="true"
        />
      )}

      <div className="flex items-center gap-3 p-3 sm:gap-4 sm:p-4">
        {leading && <div className="relative z-[2] shrink-0">{leading}</div>}

        <div className="min-w-0 flex-1">
          <h3 className="truncate text-sm font-semibold text-[var(--color-text)] transition-colors group-hover:text-[var(--color-brand-600)]">
            {title}
          </h3>
          {subtitle && <p className="truncate text-xs text-[var(--color-muted)]">{subtitle}</p>}
          {meta && <div className="mt-1.5">{meta}</div>}
        </div>

        {trailing && <div className="hidden shrink-0 text-right sm:block">{trailing}</div>}

        {actions && (
          <div className="relative z-[2] flex shrink-0 items-center gap-1.5">{actions}</div>
        )}
      </div>

      {alert && <div className="px-3 pb-3 sm:px-4 sm:pb-4">{alert}</div>}

      {href && (
        <Link
          href={href}
          className="absolute inset-0 z-[1] rounded-[inherit]"
          aria-label={label || 'Ver detalle'}
        />
      )}
    </article>
  );
}

EntityRow.Alert = Alert;
EntityRow.Action = Action;
EntityRow.Meta = Meta;
EntityRow.Amount = Amount;

export { Badge };
