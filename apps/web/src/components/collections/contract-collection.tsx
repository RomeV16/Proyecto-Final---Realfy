'use client';

import { useTranslations } from 'next-intl';
import type { CollectionCasePage } from '@realfy/shared';
import { Link } from '@/i18n/navigation';
import { caseHref, contractCasesPath } from '@/lib/collections';
import { useCan } from '@/lib/permissions';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { useApiData } from '@/components/messaging/use-api-data';
import { NextActionText } from './case-table';

/**
 * Cobranza de un contrato, en su detalle: el caso abierto por mora (etapa, lo que se debe hoy y lo que toca
 * después) con el enlace a su línea de tiempo. Sin mora, no ocupa lugar.
 */
export function ContractCollection({ contractId }: { contractId: string }) {
  const t = useTranslations('collections');
  const canView = useCan('collections.view');
  const { data } = useApiData<CollectionCasePage>(canView ? contractCasesPath(contractId) : null);

  if (!canView || !data || data.items.length === 0) return null;

  return (
    <section className="space-y-3 rounded-xl border border-slate-200 bg-white p-6" aria-label={t('contract.title')}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-slate-900">{t('contract.title')}</h2>
        <Link href="/cobranza" className="text-sm text-[var(--color-brand-600)] hover:underline">
          {t('contract.viewAll')}
        </Link>
      </div>
      <ul className="space-y-3">
        {data.items.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div className="flex flex-wrap items-center gap-3">
              <StatusBadge domain="cobranza" status={c.stage} />
              <span>{t('days', { n: c.daysOverdue })}</span>
              <span>
                {t('contract.payoff')}: <MoneyText value={c.payoffToday} currency={c.currency} decimals={2} className="font-semibold" />
              </span>
              <NextActionText item={c} />
            </div>
            <Link href={caseHref(c.id)} className="text-[var(--color-brand-600)] hover:underline">
              {t('contract.view')}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
