'use client';

import { useTranslations } from 'next-intl';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { useCan } from '@/lib/permissions';
import { rankDebtors, summarizeAging, type DelinquentTenant } from '@/components/delinquency/aging';
import { AgingSummary } from '@/components/delinquency/aging-summary';
import { DebtorRanking } from '@/components/delinquency/debtor-ranking';

/**
 * Morosidad: la deuda vencida repartida por antigüedad del atraso y, debajo, los deudores ordenados del más
 * atrasado al menos.
 */
export default function DelinquencyPage() {
  const t = useTranslations('delinquency');

  const [items, setItems] = useState<DelinquentTenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);

  const canAccess = useCan('delinquency.view');
  const canCollect = useCan('collections.view');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiClient<DelinquentTenant[]>('/penalties/delinquent-tenants');
      setItems(data);
    } catch (err) {
      setError(err);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (canAccess) void load();
    else setLoading(false);
  }, [canAccess, load]);

  if (!canAccess) {
    return <EmptyState iconName="delinquency" title={t('forbidden')} subtitle={t('forbiddenHint')} />;
  }

  const ranked = rankDebtors(items);

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('description')}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {canCollect && (
            <Link
              href="/cobranza"
              className="inline-flex items-center gap-1.5 px-2 text-sm font-medium text-[var(--color-brand-600)] hover:underline"
            >
              {t('goToCollections')}
              <Icon name="arrowRight" className="h-4 w-4" strokeWidth={2} />
            </Link>
          )}
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={loading}>
            <Icon name="refresh" className="h-4 w-4" strokeWidth={2} />
            {t('refresh')}
          </Button>
        </div>
      </div>

      {loading && (
        <div className="space-y-4" aria-busy="true">
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      )}

      {!loading && error != null && (
        <div className="space-y-3">
          <ErrorNotice error={error} fallback={t('loadError')} />
          <Button variant="secondary" size="sm" onClick={() => void load()}>
            {t('retry')}
          </Button>
        </div>
      )}

      {!loading && error == null && ranked.length === 0 && (
        <EmptyState iconName="check" title={t('emptyTitle')} subtitle={t('emptyDescription')} />
      )}

      {!loading && error == null && ranked.length > 0 && (
        <>
          <AgingSummary summary={summarizeAging(ranked)} debtors={ranked.length} />
          <DebtorRanking items={ranked} />
        </>
      )}
    </div>
  );
}
