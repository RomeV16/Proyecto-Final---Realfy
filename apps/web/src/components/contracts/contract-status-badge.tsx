'use client';

import { useTranslations } from 'next-intl';
import { ContractStatus } from '@realfy/shared';
import { Badge } from '@/components/ui/badge';

const STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'> = {
  [ContractStatus.Borrador]: 'neutral',
  [ContractStatus.Activo]: 'success',
  [ContractStatus.Vencido]: 'warning',
  [ContractStatus.Rescindido]: 'danger',
  [ContractStatus.Renovado]: 'info',
  [ContractStatus.Archivado]: 'neutral',
};

interface ContractStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
  /** Renders the solid variant for sitting on top of a cover image. */
  onCover?: boolean;
}

export function ContractStatusBadge({ status, size = 'sm', onCover }: ContractStatusBadgeProps) {
  const t = useTranslations('contracts.statuses');

  return (
    <Badge variant={STATUS_VARIANT[status] || 'neutral'} size={size} dot onCover={onCover}>
      {t(status)}
    </Badge>
  );
}
