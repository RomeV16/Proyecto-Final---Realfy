'use client';

import { useTranslations } from 'next-intl';
import { PropertyState } from '@realfy/shared';
import { Badge } from '@/components/ui/badge';

/**
 * Maps each property state onto a semantic badge variant, so state colour
 * comes from the `--color-*` status tokens instead of a private palette map.
 */
const STATE_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'> = {
  [PropertyState.Borrador]: 'neutral',
  [PropertyState.Disponible]: 'success',
  [PropertyState.Reservado]: 'warning',
  [PropertyState.Alquilado]: 'info',
  [PropertyState.Vendido]: 'brand',
  [PropertyState.Ocupado]: 'info',
  [PropertyState.Suspendido]: 'danger',
  [PropertyState.Archivado]: 'neutral',
};

interface PropertyStateBadgeProps {
  state: string;
  size?: 'sm' | 'md';
  /** Renders the solid variant for sitting on top of a cover image. */
  onCover?: boolean;
}

export function PropertyStateBadge({ state, size = 'sm', onCover }: PropertyStateBadgeProps) {
  const t = useTranslations('properties.states');

  return (
    <Badge variant={STATE_VARIANT[state] || 'neutral'} size={size} dot onCover={onCover}>
      {t(state)}
    </Badge>
  );
}
