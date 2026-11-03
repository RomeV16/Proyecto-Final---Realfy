'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useBillReviewCount } from '@/lib/bill-documents';
import { useCan } from '@/lib/permissions';
import { Icon } from '@/components/ui/icon';

/** Aviso de que hay boletas recibidas esperando revisión, con enlace a la pantalla donde se resuelven. */
export function BillReviewNotice() {
  const t = useTranslations('billDocuments.reviewNotice');
  const count = useBillReviewCount(useCan('billDocuments.view'));
  if (count === 0) return null;
  return (
    <div
      role="status"
      className="flex flex-wrap items-center gap-3 rounded-lg border border-[color-mix(in_oklab,var(--color-warning)_30%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warning)_12%,var(--color-surface))] px-4 py-3 text-sm text-[var(--color-text)]"
    >
      <Icon name="invoices" size={18} />
      <span className="flex-1">{count === 1 ? t('one') : t('other', { count })}</span>
      <Link href="/boletas/recibidas" className="font-medium text-brand-600 hover:text-brand-700">
        {t('link')}
      </Link>
    </div>
  );
}
