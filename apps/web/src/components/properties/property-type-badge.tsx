'use client';

import { useTranslations } from 'next-intl';

interface PropertyTypeBadgeProps {
  type: string;
}

export function PropertyTypeBadge({ type }: PropertyTypeBadgeProps) {
  const t = useTranslations('properties.types');

  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium bg-brand-50 text-brand-700">
      {t(type)}
    </span>
  );
}
