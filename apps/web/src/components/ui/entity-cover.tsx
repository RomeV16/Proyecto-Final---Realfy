'use client';

import { useState } from 'react';
import { cn } from '@/lib/cn';
import { coverPalette } from '@/lib/entity-visuals';
import { Icon, type IconName } from './icon';

/**
 * Cover surfaces for record cards.
 *
 * `SmartImage` deliberately stays on a plain <img> rather than next/image:
 * media URLs are presigned links generated per-request by the API, so the host
 * isn't known at build time and `images.remotePatterns` can't cover them. We
 * get the parts that actually matter for perceived quality — lazy loading,
 * async decode, a shimmer underneath, and a fade-in instead of a pop — without
 * the optimiser.
 */

interface SmartImageProps {
  src: string;
  alt: string;
  className?: string;
  /** Rendered in place of the image if it fails to load. */
  fallback?: React.ReactNode;
  /** First-screen images should not lazy-load. */
  priority?: boolean;
}

export function SmartImage({ src, alt, className, fallback, priority }: SmartImageProps) {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);

  if (failed && fallback) return <>{fallback}</>;

  return (
    <>
      {/* Shimmer sits behind the image and is covered as it fades in, so the
          card never shows an empty rectangle mid-load. */}
      {!loaded && <div className="absolute inset-0 skeleton" aria-hidden="true" />}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={src}
        alt={alt}
        loading={priority ? 'eager' : 'lazy'}
        decoding="async"
        onLoad={() => setLoaded(true)}
        onError={() => setFailed(true)}
        className={cn(
          'h-full w-full object-cover transition-opacity duration-500',
          '[transition-timing-function:var(--ease-luxe)]',
          loaded ? 'opacity-100' : 'opacity-0',
          className,
        )}
      />
    </>
  );
}

/* ──────────── Generated cover art ──────────── */

interface GeneratedCoverProps {
  /** Stable per record — normally the id. Drives palette + texture. */
  seed: string;
  /** Ghosted mark identifying the entity type. */
  icon?: IconName;
  /** Scales the ghosted mark down for short band covers. */
  compact?: boolean;
  className?: string;
}

/**
 * The visual anchor for records that have no photo.
 *
 * Three layers: an identity gradient, a texture, and an oversized ghosted icon
 * bleeding off the corner. That's what keeps a contract or a liquidación card
 * from reading as a text box.
 */
export function GeneratedCover({ seed, icon, compact, className }: GeneratedCoverProps) {
  const palette = coverPalette(seed);

  return (
    <div
      className={cn('absolute inset-0 overflow-hidden', className)}
      style={{ backgroundImage: palette.gradient }}
      aria-hidden="true"
    >
      <div className={cn('absolute inset-0', palette.texture)} />
      {icon && (
        <Icon
          name={icon}
          className={cn(
            'absolute text-white/20',
            compact ? '-bottom-3 -right-2 h-16 w-16' : '-bottom-5 -right-4 h-32 w-32',
          )}
          strokeWidth={1.25}
        />
      )}
      {/* Soft vignette anchors the bottom so overlaid text stays readable. */}
      <div className="absolute inset-0 bg-gradient-to-t from-black/25 via-transparent to-white/10" />
    </div>
  );
}

/* ──────────── Unified cover ──────────── */

interface EntityCoverProps {
  /** Photo URL, when the entity has one. Falls back to generated art. */
  src?: string | null;
  alt: string;
  seed: string;
  icon?: IconName;
  /** Tailwind aspect ratio (or height) class for the cover box. */
  aspect?: string;
  /**
   * Short banner instead of a full cover.
   *
   * A 3:2 cover is right when there's a real photo to show. For entities that
   * have no image, that same ratio is 300+px of empty gradient — decoration
   * where information should be. `band` keeps the identity colour and the
   * badge shelf but gives the height back to the content.
   */
  band?: boolean;
  /** Overlaid content — badges, title, counts. */
  children?: React.ReactNode;
  /** Darkening scrim under `children`. Turn off for covers with no overlay. */
  scrim?: boolean;
  priority?: boolean;
  className?: string;
}

/**
 * One cover component for both cases. Photo when there is one, generated art
 * when there isn't — same dimensions and same overlay slots either way, so
 * mixed grids stay on a single rhythm.
 */
export function EntityCover({
  src,
  alt,
  seed,
  icon,
  aspect,
  band = false,
  children,
  scrim = true,
  priority,
  className,
}: EntityCoverProps) {
  // A photo always earns the full ratio; band only applies to generated art.
  const useBand = band && !src;
  const box = aspect ?? (useBand ? 'h-20 sm:h-24' : 'aspect-[3/2]');
  const art = <GeneratedCover seed={seed} icon={icon} compact={useBand} />;

  return (
    <div className={cn('relative overflow-hidden', box, className)}>
      <div className="media-zoom absolute inset-0">
        {src ? <SmartImage src={src} alt={alt} fallback={art} priority={priority} /> : art}
      </div>

      <div className="cover-sheen absolute inset-0" aria-hidden="true" />

      {children && (
        <>
          {scrim && (
            <div className="cover-scrim absolute inset-x-0 bottom-0 h-3/5" aria-hidden="true" />
          )}
          <div
            className={cn(
              'absolute inset-0 flex flex-col justify-between',
              useBand ? 'p-2.5' : 'p-3',
            )}
          >
            {children}
          </div>
        </>
      )}
    </div>
  );
}
