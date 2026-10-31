'use client';

import { useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/cn';
import { statusEntry, type StatusDomain } from '@/lib/status-registry';

interface StatusBadgeProps {
  domain: StatusDomain;
  status: string;
  size?: 'sm' | 'md';
  /** Variante sólida para apoyarla sobre la portada de una tarjeta. */
  onCover?: boolean;
  /** El punto inicial hace que el estado no dependa solo del color. */
  dot?: boolean;
  className?: string;
}

/** Chapa de estado: tono y etiqueta salen del registro (`lib/status-registry.ts`). */
export function StatusBadge({ domain, status, size = 'sm', onCover, dot = true, className }: StatusBadgeProps) {
  const t = useTranslations();
  const entry = statusEntry(domain, status);
  return (
    <Badge
      variant={entry?.tone ?? 'neutral'}
      size={size}
      dot={dot}
      onCover={onCover}
      className={cn(entry?.strike && 'line-through', className)}
    >
      {entry ? t(entry.labelKey) : status}
    </Badge>
  );
}
