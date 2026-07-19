'use client';

import { useTranslations } from 'next-intl';
import { LiquidacionStatus } from '@realfy/shared';

const STATUS_COLORS: Record<string, string> = {
  [LiquidacionStatus.Borrador]: 'bg-slate-100 text-slate-600',
  [LiquidacionStatus.Revision]: 'bg-blue-100 text-blue-700',
  [LiquidacionStatus.Aprobada]: 'bg-green-100 text-green-700',
  [LiquidacionStatus.Enviada]: 'bg-indigo-100 text-indigo-700',
  [LiquidacionStatus.Pagada]: 'bg-emerald-100 text-emerald-700',
  [LiquidacionStatus.Vencida]: 'bg-red-100 text-red-700',
  [LiquidacionStatus.Anulada]: 'bg-slate-200 text-slate-500',
};

const STATUS_DOT_COLORS: Record<string, string> = {
  [LiquidacionStatus.Borrador]: 'bg-slate-400',
  [LiquidacionStatus.Revision]: 'bg-blue-500',
  [LiquidacionStatus.Aprobada]: 'bg-green-500',
  [LiquidacionStatus.Enviada]: 'bg-indigo-500',
  [LiquidacionStatus.Pagada]: 'bg-emerald-500',
  [LiquidacionStatus.Vencida]: 'bg-red-500',
  [LiquidacionStatus.Anulada]: 'bg-slate-400',
};

interface LiquidacionStatusBadgeProps {
  status: string;
  size?: 'sm' | 'md';
}

export function LiquidacionStatusBadge({ status, size = 'sm' }: LiquidacionStatusBadgeProps) {
  const t = useTranslations('liquidaciones.statuses');
  const colors = STATUS_COLORS[status] || 'bg-slate-100 text-slate-600';
  const dotColor = STATUS_DOT_COLORS[status] || 'bg-slate-400';
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';
  const isAnulada = status === LiquidacionStatus.Anulada;

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full font-medium ${colors} ${sizeClasses} ${isAnulada ? 'line-through' : ''}`}
    >
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {t(status)}
    </span>
  );
}
