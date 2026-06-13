'use client';

import { useTranslations } from 'next-intl';
import { PersonRole } from '@realfy/shared';

const ROLE_COLORS: Record<string, string> = {
  [PersonRole.Propietario]: 'bg-blue-100 text-blue-700',
  [PersonRole.Inquilino]: 'bg-emerald-100 text-emerald-700',
  [PersonRole.Garante]: 'bg-amber-100 text-amber-700',
  [PersonRole.Lead]: 'bg-purple-100 text-purple-700',
  [PersonRole.Comprador]: 'bg-cyan-100 text-cyan-700',
  [PersonRole.Proveedor]: 'bg-slate-200 text-slate-600',
};

const ROLE_DOT_COLORS: Record<string, string> = {
  [PersonRole.Propietario]: 'bg-blue-500',
  [PersonRole.Inquilino]: 'bg-emerald-500',
  [PersonRole.Garante]: 'bg-amber-500',
  [PersonRole.Lead]: 'bg-purple-500',
  [PersonRole.Comprador]: 'bg-cyan-500',
  [PersonRole.Proveedor]: 'bg-slate-400',
};

interface PersonRoleBadgeProps {
  role: string;
  size?: 'sm' | 'md';
}

export function PersonRoleBadge({ role, size = 'sm' }: PersonRoleBadgeProps) {
  const t = useTranslations('persons.roles');
  const colors = ROLE_COLORS[role] || 'bg-slate-100 text-slate-600';
  const dotColor = ROLE_DOT_COLORS[role] || 'bg-slate-400';
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${colors} ${sizeClasses}`}>
      <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
      {t(role)}
    </span>
  );
}
