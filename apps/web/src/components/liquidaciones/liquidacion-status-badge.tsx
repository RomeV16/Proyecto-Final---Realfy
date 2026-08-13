'use client';

import { useTranslations } from 'next-intl';
import { LiquidacionStatus } from '@realfy/shared';
import { Badge } from '@/components/ui/badge';

const STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'> = {
  [LiquidacionStatus.Borrador]: 'neutral',
  [LiquidacionStatus.Revision]: 'info',
  [LiquidacionStatus.Aprobada]: 'success',
  [LiquidacionStatus.Enviada]: 'brand',
  [LiquidacionStatus.Pagada]: 'success',
  [LiquidacionStatus.Vencida]: 'danger',
  [LiquidacionStatus.Anulada]: 'neutral',
};

interface LiquidacionStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  /** Renders the solid variant for sitting on top of a cover image. */
  onCover?: boolean;
}

export function LiquidacionStatusBadge({ status, size = 'sm', onCover }: LiquidacionStatusBadgeProps) {
  const t = useTranslations('liquidaciones.statuses');
  const isAnulada = status === LiquidacionStatus.Anulada;

  return (
    <Badge
      variant={STATUS_VARIANT[status] || 'neutral'}
      size={size}
      dot
      onCover={onCover}
      className={isAnulada ? 'line-through' : undefined}
    >
      {t(status)}
    </Badge>
  );
}
