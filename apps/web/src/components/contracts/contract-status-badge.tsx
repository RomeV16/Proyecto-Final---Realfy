'use client';

import { useTranslations } from 'next-intl';
import { ContractStatus } from '@realfy/shared';

const STATUS_COLORS: Record<string, string> = {
  [ContractStatus.Borrador]: 'bg-slate-100 text-slate-600',
  [ContractStatus.Activo]: 'bg-emerald-100 text-emerald-700',
  [ContractStatus.Vencido]: 'bg-amber-100 text-amber-700',
  [ContractStatus.Rescindido]: 'bg-red-100 text-red-700',
  [ContractStatus.Renovado]: 'bg-blue-100 text-blue-700',
  [ContractStatus.Archivado]: 'bg-slate-200 text-slate-500',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  [ContractStatus.Borrador]: 'bg-slate-400',
  [ContractStatus.Activo]: 'bg-emerald-500',
  [ContractStatus.Vencido]: 'bg-amber-500',
  [ContractStatus.Rescindido]: 'bg-red-500',
  [ContractStatus.Renovado]: 'bg-blue-500',
  [ContractStatus.Archivado]: 'bg-slate-400',
};

interface ContractStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export function ContractStatusBadge({ status, size = 'sm' }: ContractStatusBadgeProps) {
  const t = useTranslations('contracts.statuses');
  const colors = STATUS_COLORS[status] || 'bg-slate-100 text-slate-600';
  const dotColor = STATUS_DOT_COLORS[status] || 'bg-slate-400';
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${colors} ${sizeClasses}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {t(status)}
    </span>
  );
}
