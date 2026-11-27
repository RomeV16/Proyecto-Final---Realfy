'use client';

import { useTranslations } from 'next-intl';
import { PersonRole } from '@realfy/shared';
import { Badge } from '@/components/ui/badge';

/**
 * Un rol es una categoría, no un estado: sus colores quedan fuera de la gama
 * de estados (rojo, ámbar, verde) para que ninguna etiqueta se lea como
 * alerta o como aprobación.
 */
const ROLE_HUE: Record<string, string> = {
  [PersonRole.Propietario]: '#46588f',
  [PersonRole.Inquilino]: '#2c7378',
  [PersonRole.Garante]: '#6d5593',
  [PersonRole.Lead]: '#3a78a6',
  [PersonRole.Comprador]: '#875074',
  [PersonRole.Apoderado]: '#6a6844',
};

interface PersonRoleBadgeProps {
  role: string;
  size?: 'sm' | 'md';
  /** Renders the solid variant for sitting on top of a cover image. */
  onCover?: boolean;
}

export function PersonRoleBadge({ role, size = 'sm', onCover }: PersonRoleBadgeProps) {
  const t = useTranslations('persons.roles');

  const hue = ROLE_HUE[role];

  if (!hue || onCover) {
    return (
      <Badge variant="neutral" size={size} dot onCover={onCover}>
        {t(role)}
      </Badge>
    );
  }

  return (
    <Badge
      variant="neutral"
      size={size}
      style={{
        backgroundColor: `color-mix(in oklab, ${hue} 12%, var(--color-surface))`,
        color: `color-mix(in oklab, ${hue} 76%, var(--color-text))`,
        borderColor: `color-mix(in oklab, ${hue} 28%, var(--color-border))`,
      }}
    >
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: hue }} aria-hidden="true" />
      {t(role)}
    </Badge>
  );
}
