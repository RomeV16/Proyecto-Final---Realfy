'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';

interface PropertyTypeBadgeProps {
  type: string;
  /** Renders the solid variant for sitting on top of a cover image. */
  onCover?: boolean;
}

export function PropertyTypeBadge({ type, onCover }: PropertyTypeBadgeProps) {
  const t = useTranslations('properties.types');

  return (
    <Badge variant="brand" onCover={onCover}>
      {t(type)}
    </Badge>
  );
}
