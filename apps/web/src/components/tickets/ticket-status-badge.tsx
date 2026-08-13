'use client';

import { useTranslations } from 'next-intl';
import { TicketStatus } from '@realfy/shared';
import { Badge } from '@/components/ui/badge';

const STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'> = {
  [TicketStatus.Abierto]: 'info',
  [TicketStatus.Asignado]: 'info',
  [TicketStatus.EnProgreso]: 'warning',
  [TicketStatus.ProveedorAsignado]: 'brand',
  [TicketStatus.ProveedorEnCamino]: 'brand',
  [TicketStatus.TrabajoRealizado]: 'info',
  [TicketStatus.Resuelto]: 'success',
  [TicketStatus.Cerrado]: 'neutral',
  [TicketStatus.Cancelado]: 'danger',
  [TicketStatus.Reabierto]: 'warning',
};

interface TicketStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  /** Renders the solid variant for sitting on top of a cover image. */
  onCover?: boolean;
}

export function TicketStatusBadge({ status, size = 'sm', onCover }: TicketStatusBadgeProps) {
  const t = useTranslations('tickets.statuses');

  return (
    <Badge variant={STATUS_VARIANT[status] || 'neutral'} size={size} dot onCover={onCover}>
      {t(status)}
    </Badge>
  );
}
