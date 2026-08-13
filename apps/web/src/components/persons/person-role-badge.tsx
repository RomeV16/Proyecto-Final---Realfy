'use client';

import { useTranslations } from 'next-intl';
import { PersonRole } from '@realfy/shared';
import { Badge } from '@/components/ui/badge';

/**
 * Maps each person role onto a semantic badge variant, so role colour comes
 * from the `--color-*` status tokens instead of a private palette map.
 */
const ROLE_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'> = {
  [PersonRole.Propietario]: 'info',
  [PersonRole.Inquilino]: 'success',
  [PersonRole.Garante]: 'warning',
  [PersonRole.Lead]: 'brand',
  [PersonRole.Comprador]: 'info',
  [PersonRole.Proveedor]: 'neutral',
};

interface PersonRoleBadgeProps {
  role: string;
  size?: 'sm' | 'md';
  /** Renders the solid variant for sitting on top of a cover image. */
  onCover?: boolean;
}

export function PersonRoleBadge({ role, size = 'sm', onCover }: PersonRoleBadgeProps) {
  const t = useTranslations('persons.roles');

  return (
    <Badge variant={ROLE_VARIANT[role] || 'neutral'} size={size} dot onCover={onCover}>
      {t(role)}
    </Badge>
  );
}
