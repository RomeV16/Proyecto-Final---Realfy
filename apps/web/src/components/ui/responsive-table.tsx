'use client';

import { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { Table, Thead, Tbody, Tr, Th, Td } from './table';
import { Card, CardContent } from './card';
import { Skeleton } from './skeleton';
import { EmptyState } from './empty-state';

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
  empty?: { title: string; subtitle?: string };
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

/** Skeleton row for table view (md+) */
function TableSkeletonRow({ colCount }: { colCount: number }) {
  return (
    <Tr>
      {Array.from({ length: colCount }).map((_, i) => (
        <Td key={i}>
          <Skeleton height="1rem" className="w-3/4" />
        </Td>
      ))}
    </Tr>
  );
}

/** Skeleton card for mobile view (< md) */
function CardSkeletonItem({ colCount }: { colCount: number }) {
  return (
    <Card>
      <CardContent className="space-y-3">
        {Array.from({ length: colCount }).map((_, i) => (
          <div key={i} className="flex justify-between gap-4">
            <Skeleton height="0.75rem" width="5rem" />
            <Skeleton height="0.75rem" className="flex-1 max-w-[60%]" />
          </div>
        ))}
      </CardContent>
    </Card>
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
  const colCount = columns.length;

  /* ── Loading state ── */
  if (loading) {
    return (
      <div className={className}>
        {/* Table skeleton — md+ */}
        <div className={cn('hidden md:block', tableClassName)}>
          <Table>
            <Thead>
              <Tr>
                {columns.map((col) => (
                  <Th key={col.key} scope="col" className={col.alignRight ? 'text-right' : undefined}>
                    {col.header}
                  </Th>
                ))}
              </Tr>
            </Thead>
            <Tbody>
              {Array.from({ length: skeletonRows }).map((_, i) => (
                <TableSkeletonRow key={i} colCount={colCount} />
              ))}
            </Tbody>
          </Table>
        </div>

        {/* Card skeleton — < md */}
        <div className={cn('md:hidden space-y-3', cardClassName)}>
          {Array.from({ length: skeletonRows }).map((_, i) => (
            <CardSkeletonItem key={i} colCount={colCount} />
          ))}
        </div>
      </div>
    );
  }

  /* ── Empty state ── */
  if (items.length === 0) {
    if (!empty) return null;
    return (
      <div className={className}>
        <EmptyState title={empty.title} subtitle={empty.subtitle} />
      </div>
    );
  }

  /* ── Data ── */
  return (
    <div className={className}>
      {/* Table — md+ */}
      <div className={cn('hidden md:block', tableClassName)}>
        <Table>
          <Thead>
            <Tr>
              {columns.map((col) => (
                <Th key={col.key} scope="col" className={col.alignRight ? 'text-right' : undefined}>
                  {col.header}
                </Th>
              ))}
            </Tr>
          </Thead>
          <Tbody>
            {items.map((item) => (
              <Tr key={keyExtractor(item)}>
                {columns.map((col) => (
                  <Td
                    key={col.key}
                    className={cn(col.alignRight && 'text-right tabular-nums', col.className)}
                  >
                    {col.render(item)}
                  </Td>
                ))}
              </Tr>
            ))}
          </Tbody>
        </Table>
      </div>

      {/* Card stack — < md */}
      <div className={cn('md:hidden space-y-3', cardClassName)}>
        {items.map((item) => (
          <Card key={keyExtractor(item)}>
            <CardContent>
              {cardRenderer ? (
                cardRenderer(item)
              ) : (
                <SynthesizedCard item={item} columns={columns} />
              )}
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
