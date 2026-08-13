import { cn } from '@/lib/cn';
import { HTMLAttributes } from 'react';

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  width?: string;
  height?: string;
}

/**
 * Loading placeholder.
 *
 * Uses a sweeping shimmer (`.skeleton` in globals.css) rather than
 * `animate-pulse`: a grid of pulsing blocks blinks out of phase and reads as
 * broken, whereas a shared sweep reads as one surface still loading.
 * API is unchanged from the pulse version, so existing call sites keep working.
 */
export function Skeleton({ className, width, height, style, ...props }: SkeletonProps) {
  return (
    <div
      className={cn('rounded-md skeleton', className)}
      style={{ width, height, ...style }}
      aria-hidden="true"
      {...props}
    />
  );
}

/**
 * Text-line placeholder. Last line is short so a block of them reads as a
 * paragraph instead of a rectangle.
 */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div className={cn('space-y-2', className)} aria-hidden="true">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton
          key={i}
          className={cn('h-3', i === lines - 1 ? 'w-2/5' : i % 2 ? 'w-4/5' : 'w-full')}
        />
      ))}
    </div>
  );
}

/**
 * Skeleton shaped like an `EntityCard`, so the swap to real content doesn't
 * shift layout. `media` matches the cover variant; without it you get the
 * compact, coverless shape.
 */
export function EntityCardSkeleton({ media = true, className }: { media?: boolean; className?: string }) {
  return (
    <div
      className={cn(
        'overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface)]',
        className,
      )}
      aria-hidden="true"
    >
      {media && <Skeleton className="aspect-[3/2] w-full rounded-none" />}
      <div className="space-y-3 p-4">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-2 pt-1">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <div className="flex items-center justify-between border-t border-[var(--color-border)] pt-3">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-8 w-20 rounded-[var(--radius-lg)]" />
        </div>
      </div>
    </div>
  );
}

const SKELETON_COLUMNS: Record<number, string> = {
  2: 'grid-cols-1 sm:grid-cols-2',
  3: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3',
  4: 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4',
};

/** A full grid of card skeletons, matching `CardGrid`'s column ramp. */
export function CardGridSkeleton({
  count = 8,
  media = true,
  columns = 4,
  className,
}: {
  count?: number;
  media?: boolean;
  columns?: 2 | 3 | 4;
  className?: string;
}) {
  return (
    <div className={cn('grid gap-4', SKELETON_COLUMNS[columns], className)} aria-hidden="true">
      {Array.from({ length: count }).map((_, i) => (
        <EntityCardSkeleton key={i} media={media} />
      ))}
    </div>
  );
}
