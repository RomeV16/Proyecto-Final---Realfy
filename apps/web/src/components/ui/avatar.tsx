import { cn } from '@/lib/cn';
import { avatarPalette, initialsOf } from '@/lib/entity-visuals';

type AvatarSize = 'xs' | 'sm' | 'md' | 'lg' | 'xl';

const SIZES: Record<AvatarSize, string> = {
  xs: 'h-6 w-6 text-[10px]',
  sm: 'h-8 w-8 text-xs',
  md: 'h-10 w-10 text-sm',
  lg: 'h-12 w-12 text-base',
  xl: 'h-16 w-16 text-xl',
};

interface AvatarProps {
  /** Display name — drives both the initials and the palette. */
  name: string | null | undefined;
  /**
   * Palette seed. Pass the record id so the same person keeps the same colour
   * even if their name is edited; defaults to the name.
   */
  seed?: string;
  size?: AvatarSize;
  className?: string;
  /** Adds a ring — use on avatars sitting on top of a cover image. */
  ring?: boolean;
}

/**
 * Initials avatar on a deterministic gradient.
 *
 * Persons and providers have no photo field in the schema, so this is their
 * visual identity. Colour is derived from the seed rather than from status, so
 * a list of people reads as a set of individuals.
 */
export function Avatar({ name, seed, size = 'md', className, ring }: AvatarProps) {
  const palette = avatarPalette(seed || name || '');

  return (
    <span
      className={cn(
        'inline-flex shrink-0 select-none items-center justify-center rounded-full font-semibold uppercase tracking-tight text-white',
        SIZES[size],
        ring && 'shadow-sm ring-2 ring-[var(--color-surface)]',
        className,
      )}
      style={{ backgroundImage: palette.gradient }}
      aria-hidden="true"
    >
      {initialsOf(name)}
    </span>
  );
}

/**
 * Overlapping avatar cluster for "who's involved" on a card.
 * Shows up to `max` faces then a +N chip.
 */
export function AvatarStack({
  people,
  max = 3,
  size = 'sm',
  className,
}: {
  people: Array<{ id?: string; name: string | null | undefined }>;
  max?: number;
  size?: AvatarSize;
  className?: string;
}) {
  const shown = people.slice(0, max);
  const rest = people.length - shown.length;

  return (
    <div className={cn('flex items-center -space-x-2', className)}>
      {shown.map((p, i) => (
        <Avatar key={p.id || `${p.name}-${i}`} name={p.name} seed={p.id || p.name || ''} size={size} ring />
      ))}
      {rest > 0 && (
        <span
          className={cn(
            'inline-flex shrink-0 items-center justify-center rounded-full bg-[var(--color-surface-sunken)] font-semibold text-[var(--color-muted)] ring-2 ring-[var(--color-surface)]',
            SIZES[size],
          )}
        >
          +{rest}
        </span>
      )}
    </div>
  );
}
