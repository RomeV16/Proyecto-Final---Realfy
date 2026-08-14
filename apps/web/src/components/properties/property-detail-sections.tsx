'use client';

import { useState, type ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Icon, type IconName } from '@/components/ui/icon';

/**
 * Building blocks for the property detail.
 *
 * The detail screen is a long page of heterogeneous blocks — a gallery, a
 * price panel, feature tiles, chips, rows of people. Without a shared frame
 * each block invents its own padding and heading size and the page stops
 * reading as one document, which is what these three pieces prevent.
 */

/* ──────────── Section frame ──────────── */

interface DetailSectionProps {
  title?: ReactNode;
  icon?: IconName;
  /** Right-aligned slot in the header — a count, a chip, a link. */
  action?: ReactNode;
  /** Renders the block flush, for content that brings its own padding. */
  bare?: boolean;
  className?: string;
  children: ReactNode;
}

export function DetailSection({
  title,
  icon,
  action,
  bare = false,
  className,
  children,
}: DetailSectionProps) {
  return (
    <section
      className={cn(
        'overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm',
        bare ? '' : 'p-4 sm:p-5',
        className,
      )}
    >
      {(title || action) && (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
          <h2 className="h4 flex min-w-0 items-center gap-2">
            {icon && (
              <Icon
                name={icon}
                className="h-4 w-4 shrink-0 text-[var(--color-brand-600)]"
                strokeWidth={1.9}
              />
            )}
            <span className="min-w-0 break-words">{title}</span>
          </h2>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      {children}
    </section>
  );
}

/* ──────────── Feature tiles ──────────── */

export interface SpecItem {
  icon: IconName;
  label: string;
  value: ReactNode;
}

/**
 * The numeric features — surface, rooms, bathrooms. A grid of icon tiles
 * rather than a paragraph: these are the fields a visitor scans for, and
 * they only read as data when they line up in a rhythm.
 */
export function SpecGrid({ items, className }: { items: SpecItem[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <dl className={cn('grid grid-cols-2 gap-3 sm:grid-cols-3', className)}>
      {items.map((item) => (
        /* Bajo `sm` el ícono se apila arriba: en dos columnas angostas, ponerlo
           al costado deja el rótulo con menos de 70px y lo corta. */
        <div
          key={item.label}
          className="flex min-w-0 flex-col items-start gap-2 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-bg)] p-3 sm:flex-row sm:items-center sm:gap-3"
        >
          <span
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[var(--radius-md)]"
            style={{
              backgroundColor: 'color-mix(in oklab, var(--color-brand-500) 12%, var(--color-surface))',
              color: 'var(--color-brand-600)',
            }}
          >
            <Icon name={item.icon} className="h-[1.05rem] w-[1.05rem]" strokeWidth={1.9} />
          </span>
          <div className="min-w-0 max-w-full">
            <dt className="line-clamp-2 text-[0.65rem] font-semibold uppercase leading-tight tracking-[var(--tracking-wider)] text-[var(--color-muted)]">
              {item.label}
            </dt>
            <dd className="font-display truncate text-base font-medium tabular-nums text-[var(--color-text)]">
              {item.value}
            </dd>
          </div>
        </div>
      ))}
    </dl>
  );
}

/* ──────────── Label / value list ──────────── */

export interface Fact {
  label: string;
  value: ReactNode;
}

/**
 * The hard data of the record. Values break rather than truncate — a long
 * street name is still the answer the reader came for.
 */
export function FactList({ items, className }: { items: Fact[]; className?: string }) {
  if (items.length === 0) return null;

  return (
    <dl className={cn('divide-y divide-[var(--color-border)]', className)}>
      {items.map((fact) => (
        <div
          key={fact.label}
          className="flex items-start justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
        >
          <dt className="shrink-0 text-xs text-[var(--color-muted)]">{fact.label}</dt>
          <dd className="min-w-0 text-right text-sm text-[var(--color-text)] [overflow-wrap:anywhere]">
            {fact.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ──────────── Collapsible copy ──────────── */

interface ExpandableTextProps {
  text: string;
  moreLabel: string;
  lessLabel: string;
  /** Above this many characters the block collapses behind a toggle. */
  limit?: number;
}

/**
 * Descriptions run anywhere from one line to several paragraphs. Clamping the
 * long ones keeps the sections below within reach instead of pushing them off
 * the first screen.
 */
export function ExpandableText({ text, moreLabel, lessLabel, limit = 340 }: ExpandableTextProps) {
  const [open, setOpen] = useState(false);
  const collapsible = text.length > limit;

  return (
    <div className="space-y-2">
      <p
        className={cn(
          'whitespace-pre-wrap text-sm leading-relaxed text-[var(--color-text)] [overflow-wrap:anywhere]',
          collapsible && !open && 'line-clamp-6',
        )}
      >
        {text}
      </p>
      {collapsible && (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          className="inline-flex items-center gap-1 text-xs font-medium text-[var(--color-brand-600)] transition-colors hover:text-[var(--color-brand-700)]"
        >
          {open ? lessLabel : moreLabel}
          <Icon
            name="chevronDown"
            className={cn('h-3.5 w-3.5 transition-transform duration-300', open && 'rotate-180')}
            strokeWidth={2}
          />
        </button>
      )}
    </div>
  );
}
