'use client';

import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/cn';
import { GeneratedCover, SmartImage } from '@/components/ui/entity-cover';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';

/* ──────────── Types ──────────── */

export interface GalleryPhoto {
  id: string;
  url: string;
  thumbnailUrl?: string;
  isPrimary: boolean;
  sortOrder: number;
}

interface PropertyGalleryProps {
  photos: GalleryPhoto[];
  /** Property title — alt text and accessible name for the viewer. */
  title: string;
  /** Stable id: drives the generated art when the property has no photo. */
  seed: string;
  /** Overlaid on the top corners of the viewer — type and state chips. */
  topLeft?: ReactNode;
  topRight?: ReactNode;
  className?: string;
}

/* ──────────── Component ──────────── */

/**
 * Photo preview for the property detail.
 *
 * Two things it has to guarantee. First, the viewer keeps a fixed ratio and
 * every photo is mounted inside it, cross-faded rather than swapped, so moving
 * between photos never reflows the page. Second, a property with no photos
 * still gets the same box, filled with the generated cover art, so the layout
 * is identical whether or not the listing has been photographed yet.
 */
export function PropertyGallery({
  photos,
  title,
  seed,
  topLeft,
  topRight,
  className,
}: PropertyGalleryProps) {
  const t = useTranslations('properties.gallery');

  // Primary first, then the manual order set in the media manager.
  const ordered = useMemo(
    () =>
      [...photos].sort(
        (a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.sortOrder - b.sortOrder,
      ),
    [photos],
  );

  const [index, setIndex] = useState(0);
  const total = ordered.length;
  // Clamped at render time: uploading or deleting changes the list underneath
  // us, and a stale index would leave the viewer blank.
  const active = total > 0 ? Math.min(index, total - 1) : 0;

  function step(delta: number) {
    if (total < 2) return;
    setIndex((prev) => (Math.min(prev, total - 1) + delta + total) % total);
  }

  function handleKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.key === 'ArrowLeft') {
      e.preventDefault();
      step(-1);
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      step(1);
    }
  }

  const art = <GeneratedCover seed={seed} icon="properties" />;
  const arrowClasses =
    'absolute top-1/2 z-[3] flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-white/25 bg-black/45 text-white shadow-sm backdrop-blur-md transition-colors duration-300 [transition-timing-function:var(--ease-luxe)] hover:bg-black/65';

  return (
    <div className={cn('space-y-3', className)}>
      <div
        role="group"
        aria-roledescription="carousel"
        aria-label={title}
        tabIndex={0}
        onKeyDown={handleKeyDown}
        className={cn(
          'relative isolate aspect-[4/3] max-h-[30rem] w-full overflow-hidden sm:aspect-[16/10] xl:aspect-[16/9]',
          'rounded-[var(--radius-2xl)] border border-[var(--color-border)] bg-[var(--color-surface-sunken)] shadow-sm',
          'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand-400)]',
        )}
      >
        {total === 0
          ? art
          : ordered.map((photo, i) => (
              <div
                key={photo.id}
                aria-hidden={i !== active}
                className={cn(
                  'absolute inset-0 transition-opacity duration-500 [transition-timing-function:var(--ease-luxe)]',
                  i === active ? 'opacity-100' : 'pointer-events-none opacity-0',
                )}
              >
                <SmartImage
                  src={photo.url}
                  alt={`${title} — ${i + 1}`}
                  fallback={art}
                  priority={i === 0}
                />
              </div>
            ))}

        {/* Chip shelves. Kept above the photo layers so they never fade out. */}
        {(topLeft || topRight) && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-[3] flex items-start justify-between gap-2 p-3">
            <div className="flex flex-wrap items-center gap-1.5">{topLeft}</div>
            <div className="flex flex-wrap items-center justify-end gap-1.5">{topRight}</div>
          </div>
        )}

        <div className="absolute bottom-3 right-3 z-[3]">
          <Badge onCover>
            <Icon name="image" className="h-3 w-3" strokeWidth={2} />
            {total === 0 ? t('noPhotos') : t('counter', { current: active + 1, total })}
          </Badge>
        </div>

        {total > 1 && (
          <>
            <button
              type="button"
              onClick={() => step(-1)}
              aria-label={t('prev')}
              className={cn(arrowClasses, 'left-3')}
            >
              <Icon name="chevronLeft" className="h-4 w-4" strokeWidth={2.25} />
            </button>
            <button
              type="button"
              onClick={() => step(1)}
              aria-label={t('next')}
              className={cn(arrowClasses, 'right-3')}
            >
              <Icon name="chevronRight" className="h-4 w-4" strokeWidth={2.25} />
            </button>
          </>
        )}
      </div>

      {/* Thumbnails. Fixed height and horizontal scroll: a long strip never
          wraps into a second row, so the page below it stays put. */}
      {total > 1 && (
        <div className="-mx-1 flex snap-x gap-2 overflow-x-auto px-1 pb-1">
          {ordered.map((photo, i) => (
            <button
              key={photo.id}
              type="button"
              onClick={() => setIndex(i)}
              aria-label={t('goTo', { index: i + 1 })}
              aria-current={i === active}
              className={cn(
                'relative h-14 w-20 shrink-0 snap-start overflow-hidden rounded-[var(--radius-lg)] border-2 transition-all duration-300 sm:h-16 sm:w-24',
                '[transition-timing-function:var(--ease-luxe)]',
                i === active
                  ? 'border-[var(--color-brand-500)] opacity-100'
                  : 'border-transparent opacity-70 hover:opacity-100',
              )}
            >
              <SmartImage
                src={photo.thumbnailUrl || photo.url}
                alt=""
                fallback={
                  <span className="flex h-full w-full items-center justify-center bg-[var(--color-bg)] text-[var(--color-muted)]">
                    <Icon name="image" className="h-4 w-4" strokeWidth={1.75} />
                  </span>
                }
              />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
