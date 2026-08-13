'use client';

import type { ReactNode } from 'react';
import { cn } from '@/lib/cn';
import { ListTransition, AnimatedList, StaggerItem, type ListState } from './motion';
import { CardGridSkeleton, EntityCardSkeleton, Skeleton } from './skeleton';

/**
 * The container every card list uses.
 *
 * It owns the three-state swap (loading → ready → empty) so no screen has to
 * hand-roll `{loading && …}{!loading && items.length === 0 && …}` again. That
 * pattern is what produced the flash: both branches could render in the same
 * frame, and the skeleton was replaced by content of a different height.
 *
 * Here the states crossfade through `ListTransition`, the skeleton mirrors the
 * real card's shape, and items stagger in with a capped delay.
 *
 * Refetches (filter/page changes) keep showing current content rather than
 * dropping back to skeletons — pass `busy` to dim it slightly instead.
 */

type Columns = 2 | 3 | 4;

const COLUMN_CLASS: Record<Columns, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
};

interface CardGridProps<T> {
  items: T[];
  /** True only on first load; use `busy` for refetches. */
  loading: boolean;
  /** Refetch in flight — content stays, dimmed and non-interactive. */
  busy?: boolean;
  columns?: Columns;
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  /** Shown when there are no items and nothing is loading. */
  empty: ReactNode;
  skeletonCount?: number;
  /** Match the real card — `false` gives the coverless skeleton shape. */
  skeletonMedia?: boolean;
  /** Replaces the default skeleton entirely. */
  skeleton?: ReactNode;
  className?: string;
}

export function CardGrid<T>({
  items,
  loading,
  busy = false,
  columns = 4,
  keyOf,
  renderItem,
  empty,
  skeletonCount = 8,
  skeletonMedia = true,
  skeleton,
  className,
}: CardGridProps<T>) {
  const state: ListState = loading ? 'loading' : items.length === 0 ? 'empty' : 'ready';
  const gridClass = cn('grid gap-4', COLUMN_CLASS[columns], className);

  return (
    <ListTransition
      state={state}
      skeleton={
        skeleton ?? (
          <CardGridSkeleton count={skeletonCount} media={skeletonMedia} columns={columns} />
        )
      }
      empty={empty}
    >
      <AnimatedList
        className={cn(
          gridClass,
          busy && 'pointer-events-none opacity-60 transition-opacity duration-200',
        )}
      >
        {items.map((item, i) => (
          <StaggerItem key={keyOf(item)} index={i} className="h-full">
            {renderItem(item, i)}
          </StaggerItem>
        ))}
      </AnimatedList>
    </ListTransition>
  );
}

/* ──────────── Single-column variant ──────────── */

interface RowListProps<T> {
  items: T[];
  loading: boolean;
  busy?: boolean;
  keyOf: (item: T) => string;
  renderItem: (item: T, index: number) => ReactNode;
  empty: ReactNode;
  skeletonCount?: number;
  skeleton?: ReactNode;
  className?: string;
}

/** Stacked rows — providers, portal screens, anything full-width. */
export function RowList<T>({
  items,
  loading,
  busy = false,
  keyOf,
  renderItem,
  empty,
  skeletonCount = 5,
  skeleton,
  className,
}: RowListProps<T>) {
  const state: ListState = loading ? 'loading' : items.length === 0 ? 'empty' : 'ready';

  return (
    <ListTransition
      state={state}
      skeleton={skeleton ?? <RowListSkeleton count={skeletonCount} className={className} />}
      empty={empty}
    >
      <AnimatedList
        className={cn(
          'space-y-3',
          busy && 'pointer-events-none opacity-60 transition-opacity duration-200',
          className,
        )}
      >
        {items.map((item, i) => (
          <StaggerItem key={keyOf(item)} index={i}>
            {renderItem(item, i)}
          </StaggerItem>
        ))}
      </AnimatedList>
    </ListTransition>
  );
}

/** Skeleton shaped like an `EntityRow`. */
export function RowListSkeleton({ count = 5, className }: { count?: number; className?: string }) {
  return (
    <div className={cn('space-y-3', className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <div
          key={i}
          className="flex items-center gap-4 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] p-4"
        >
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-3 w-1/2" />
          </div>
          <Skeleton className="hidden h-8 w-24 rounded-[var(--radius-lg)] sm:block" />
        </div>
      ))}
    </div>
  );
}

export { EntityCardSkeleton, CardGridSkeleton };
