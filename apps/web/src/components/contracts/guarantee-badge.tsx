'use client';

import { useTranslations } from 'next-intl';

interface GuaranteeBadgeProps {
  type: string;
  endDate?: string | null;
  size?: 'sm' | 'md';
}

function getDaysUntilExpiry(endDate: string): number {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(0, 0, 0, 0);
  return Math.ceil((end.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}

function getExpiryColors(days: number): { bg: string; dot: string } {
  if (days < 0) return { bg: 'bg-slate-200 text-slate-500', dot: 'bg-slate-400' };
  if (days < 30) return { bg: 'bg-red-100 text-red-700', dot: 'bg-red-500' };
  if (days < 90) return { bg: 'bg-amber-100 text-amber-700', dot: 'bg-amber-500' };
  return { bg: 'bg-emerald-100 text-emerald-700', dot: 'bg-emerald-500' };
}

export function GuaranteeBadge({ type, endDate, size = 'sm' }: GuaranteeBadgeProps) {
  const t = useTranslations('contracts.guaranteeTypes');
  const tExpiry = useTranslations('contracts.guarantee');
  const sizeClasses = size === 'sm' ? 'px-2 py-0.5 text-xs' : 'px-2.5 py-1 text-sm';

  if (!endDate) {
    return (
      <span className={`inline-flex items-center gap-1.5 rounded-full font-medium bg-slate-100 text-slate-600 ${sizeClasses}`}>
        <span className="w-1.5 h-1.5 rounded-full bg-slate-400" />
        {t(type)}
      </span>
    );
  }

  const days = getDaysUntilExpiry(endDate);
  const { bg, dot } = getExpiryColors(days);

  let expiryText: string;
  if (days === 0) {
    expiryText = tExpiry('expirestoday');
  } else if (days > 0) {
    expiryText = tExpiry('expiresIn', { days });
  } else {
    expiryText = tExpiry('expiredAgo', { days: Math.abs(days) });
  }

  return (
    <div className="inline-flex flex-col gap-0.5">
      <span className={`inline-flex items-center gap-1.5 rounded-full font-medium ${bg} ${sizeClasses}`}>
        <span className={`w-1.5 h-1.5 rounded-full ${dot}`} />
        {t(type)}
      </span>
      <span className={`text-xs ${days < 0 ? 'text-slate-400' : days < 30 ? 'text-red-600' : days < 90 ? 'text-amber-600' : 'text-emerald-600'}`}>
        {expiryText}
      </span>
    </div>
  );
}
