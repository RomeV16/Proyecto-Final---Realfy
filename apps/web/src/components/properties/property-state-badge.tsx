'use client';

import { useTranslations } from 'next-intl';
import { PropertyState } from '@realfy/shared';

const STATE_COLORS: Record<string, string> = {
  [PropertyState.Borrador]: 'bg-slate-100 text-slate-600',
  [PropertyState.Disponible]: 'bg-emerald-100 text-emerald-700',
  [PropertyState.Reservado]: 'bg-amber-100 text-amber-700',
  [PropertyState.Alquilado]: 'bg-blue-100 text-blue-700',
  [PropertyState.Vendido]: 'bg-teal-100 text-teal-700',
  [PropertyState.Ocupado]: 'bg-sky-100 text-sky-700',
  [PropertyState.Suspendido]: 'bg-red-100 text-red-700',
  [PropertyState.Archivado]: 'bg-slate-200 text-slate-500',
};

const STATE_DOT_COLORS: Record<string, string> = {
  [PropertyState.Borrador]: 'bg-slate-400',
  [PropertyState.Disponible]: 'bg-emerald-500',
  [PropertyState.Reservado]: 'bg-amber-500',
  [PropertyState.Alquilado]: 'bg-blue-500',
  [PropertyState.Vendido]: 'bg-teal-500',
  [PropertyState.Ocupado]: 'bg-sky-500',
  [PropertyState.Suspendido]: 'bg-red-500',
  [PropertyState.Archivado]: 'bg-slate-400',
};

interface PropertyStateBadgeProps {
  state: string;
  size?: 'sm' | 'md';
}

export function PropertyStateBadge({ state, size = 'sm' }: PropertyStateBadgeProps) {
  const t = useTranslations('properties.states');
  const colors = STATE_COLORS[state] || 'bg-slate-100 text-slate-600';
  const dotColor = STATE_DOT_COLORS[state] || 'bg-slate-400';
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${colors} ${sizeClasses}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {t(state)}
    </span>
  );
}
