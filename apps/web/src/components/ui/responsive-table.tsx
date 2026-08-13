'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Table, Thead, Tbody, Th, Td } from './table';
import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';
import { RowListSkeleton } from './card-grid';
import {
  ListTransition,
  StaggerItem,
  motion,
  useReducedMotion,
  staggerDelay,
  type ListState,
} from './motion';
import type { IconName } from './icon';

/**
 * Financial-record table (invoices, delinquency): column alignment carries
 * meaning here, so unlike the rest of the card system these screens keep a
 * real `<table>` on desktop. Below `md` it collapses to a card stack built
 * from `cardRenderer` (normally an `EntityRow` per screen).
 *
 * Loading → ready → empty still routes through the shared `ListTransition`
 * so the states crossfade instead of flashing, and rows/cards stagger in
 * the same way every other list in the system does.
 */

const EASE_OUT_EXPO = [0.16, 1, 0.3, 1] as const;

export interface Column<T> {
  key: string;
  header: string;
  render: (item: T) => ReactNode;
  className?: string;
  /** If true, right-align the cell and header */
  alignRight?: boolean;
}

export interface ResponsiveTableProps<T> {
  items: T[];
  columns: Column<T>[];
  /** Custom card renderer for mobile; if absent, synthesized from columns */
  cardRenderer?: (item: T) => ReactNode;
  keyExtractor: (item: T) => string;
  loading?: boolean;
  skeletonRows?: number;
  empty?: {
    title: string;
    subtitle?: string;
    /** Icon shown in the empty-state orb. */
    iconName?: IconName;
    action?: ReactNode;
    secondaryAction?: ReactNode;
  };
  className?: string;
  /** Applied to the table wrapper (md+) only */
  tableClassName?: string;
  /** Applied to the card stack (< md) wrapper only */
  cardClassName?: string;
}

/** Default synthesized card: key-value pairs from columns */
function SynthesizedCard<T>({ item, columns }: { item: T; columns: Column<T>[] }) {
  return (
    <dl className="space-y-2">
      {columns.map((col) => (
        <div key={col.key} className="flex items-start justify-between gap-4 text-sm">
          <dt className="text-[var(--color-muted)] shrink-0 text-xs font-medium uppercase tracking-wider">
            {col.header}
          </dt>
          <dd className={cn('text-[var(--color-text)]', col.alignRight && 'tabular-nums text-right', col.className)}>
            {col.render(item)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/* ──────────── Desktop table ──────────── */

function TableHeader<T>({ columns }: { columns: Column<T>[] }) {
  return (
    <Thead className="sticky top-0 z-[1] border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-surface)_92%,transparent)] backdrop-blur-sm">
      <tr>
        {columns.map((col) => (
          <Th
            key={col.key}
            scope="col"
            className={cn('py-3', col.alignRight && 'text-right')}
          >
            {col.header}
          </Th>
        ))}
      </tr>
    </Thead>
  );
}

/**
 * One animated body row. Uses `motion.tr` rather than `StaggerItem` (which
 * renders a `div`) so the table keeps valid markup — `StaggerItem` is used
 * for the mobile card stack instead.
 */
function StaggerRow<T>({
  index,
  columns,
  item,
}: {
  index: number;
  columns: Column<T>[];
  item: T;
}) {
  const reduce = useReducedMotion();
  const rowClass =
    'group border-b border-[var(--color-border)] last:border-0 transition-colors hover:bg-[color-mix(in_oklab,var(--color-brand-500)_5%,var(--color-surface))]';

  const cells = columns.map((col) => (
    <Td
      key={col.key}
      className={cn('py-3.5', col.alignRight && 'text-right tabular-nums', col.className)}
    >
      {col.render(item)}
    </Td>
  ));

  if (reduce) return <tr className={rowClass}>{cells}</tr>;

  return (
    <motion.tr
      layout
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, ease: EASE_OUT_EXPO, delay: staggerDelay(index) }}
      className={rowClass}
    >
      {cells}
    </motion.tr>
  );
}

const SKELETON_WIDTHS = ['w-3/4', 'w-1/2', 'w-2/3', 'w-2/5', 'w-3/5'];

function DesktopTableSkeleton<T>({
  columns,
  rows,
  className,
}: {
  columns: Column<T>[];
  rows: number;
  className?: string;
}) {
  return (
    <div className={cn('hidden md:block', className)} aria-hidden="true">
      <Table>
        <TableHeader columns={columns} />
        <Tbody>
          {Array.from({ length: rows }).map((_, r) => (
            <tr key={r} className="border-b border-[var(--color-border)] last:border-0">
              {columns.map((col, c) => (
                <Td key={col.key} className={cn('py-3.5', col.alignRight && 'text-right')}>
                  <Skeleton
                    className={cn('h-4', SKELETON_WIDTHS[(r + c) % SKELETON_WIDTHS.length], col.alignRight && 'ml-auto')}
                  />
                </Td>
              ))}
            </tr>
          ))}
        </Tbody>
      </Table>
    </div>
  );
}

export function ResponsiveTable<T>({
  items,
  columns,
  cardRenderer,
  keyExtractor,
  loading = false,
  skeletonRows = 5,
  empty,
  className,
  tableClassName,
  cardClassName,
}: ResponsiveTableProps<T>) {
  const state: ListState = loading ? 'loading' : items.length === 0 ? 'empty' : 'ready';

  const emptyNode = empty ? (
    <EmptyState
      iconName={empty.iconName}
      title={empty.title}
      subtitle={empty.subtitle}
      action={empty.action}
      secondaryAction={empty.secondaryAction}
    />
  ) : (
    <span aria-hidden="true" />
  );

  return (
    <ListTransition
      state={state}
      className={className}
      skeleton={
        <div>
          <DesktopTableSkeleton columns={columns} rows={skeletonRows} className={tableClassName} />
          <div className="md:hidden">
            <RowListSkeleton count={skeletonRows} className={cardClassName} />
          </div>
        </div>
      }
      empty={emptyNode}
    >
      <div>
        {/* Table — md+ */}
        <div className={cn('hidden md:block rounded-[var(--radius-xl)] border border-[var(--color-border)]', tableClassName)}>
          <Table>
            <TableHeader columns={columns} />
            <Tbody>
              {items.map((item, i) => (
                <StaggerRow key={keyExtractor(item)} index={i} columns={columns} item={item} />
              ))}
            </Tbody>
          </Table>
        </div>

        {/* Card stack — < md */}
        <div className={cn('md:hidden space-y-3', cardClassName)}>
          {items.map((item, i) => (
            <StaggerItem key={keyExtractor(item)} index={i}>
              {cardRenderer ? (
                cardRenderer(item)
              ) : (
                <div className="rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4 shadow-sm">
                  <SynthesizedCard item={item} columns={columns} />
                </div>
              )}
            </StaggerItem>
          ))}
        </div>
      </div>
    </ListTransition>
  );
}
