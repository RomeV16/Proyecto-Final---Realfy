'use client';

import { useTranslations } from 'next-intl';
import { TicketPriority } from '@realfy/shared';
import { Badge } from '@/components/ui/badge';

const PRIORITY_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info'> = {
  [TicketPriority.Urgente]: 'danger',
  [TicketPriority.Alta]: 'warning',
  [TicketPriority.Media]: 'info',
  [TicketPriority.Baja]: 'neutral',
};

interface TicketPriorityBadgeProps {
  priority: string;
  size?: 'sm' | 'md';
  /** Renders the solid variant for sitting on top of a cover image. */
  onCover?: boolean;
}

export function TicketPriorityBadge({ priority, size = 'sm', onCover }: TicketPriorityBadgeProps) {
  const t = useTranslations('tickets.priorities');

  return (
    <Badge variant={PRIORITY_VARIANT[priority] || 'neutral'} size={size} onCover={onCover}>
      {t(priority)}
    </Badge>
  );
}
