'use client';

import { useTranslations } from 'next-intl';
import type { CollectionCaseItem, OperationalDefaults } from '@realfy/shared';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { Link } from '@/i18n/navigation';
import { useAuth } from '@/lib/auth-context';
import { COLLECTION_STAGES, EMPTY_CASE_FILTERS, MIN_DAYS_OPTIONS, totalPayoff, type CaseFilterValues } from '@/lib/collections';
import { useCan } from '@/lib/permissions';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { MoneyText } from '@/components/ui/money-text';
import { PaginationBar } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useApiData } from '@/components/messaging/use-api-data';
import { CaseQueue } from './case-queue';

const LIMIT = 50;
const LINK = 'font-medium text-[var(--color-brand-600)] hover:underline';

/**
 * Cobranza: la cola de contratos con alquileres vencidos impagos, de la mora más vieja a la más nueva, con el
 * paso de la gestión, lo que se debe hoy y qué hacer ahora. Filtra por etapa, mora mínima y por los casos
 * asignados a uno mismo. Si la cobranza automática está apagada lo avisa: sin eso no se abren casos nuevos.
 */
export function CollectionsCenter() {
  const t = useTranslations('collections');
  const { user } = useAuth();
  const canView = useCan('collections.view');
  const canConfigure = useCan('operationalDefaults.manage');
  const canSeeDelinquency = useCan('delinquency.view');
  const list = usePaginatedList<CollectionCaseItem, CaseFilterValues>({
    key: 'collections',
    path: '/collection-cases',
    limit: LIMIT,
    initialFilters: EMPTY_CASE_FILTERS,
    enabled: canView,
  });
  const defaults = useApiData<OperationalDefaults>(canView ? '/tenants/me/operational-defaults' : null);

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const { filters } = list;
  const currencies = [...new Set(list.items.map((i) => i.currency))].sort((a, b) => a.localeCompare(b));
  // Solo se afirma que está apagada cuando la configuración lo dice; si no se pudo leer, no se avisa nada.
  const automationOff = defaults.data?.collections?.enabled === false;
  const empty = !list.isLoading && list.error == null && list.items.length === 0;

  const settingsLink = canConfigure && (
    <Link href="/configuracion/valores-por-defecto" className={LINK}>
      {t('off.settings')}
    </Link>
  );
  const delinquencyLink = canSeeDelinquency && (
    <Link href="/delinquency" className={LINK}>
      {t('off.delinquency')}
    </Link>
  );

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </header>

      {automationOff && (
        <div
          role="status"
          className="rounded-xl border border-[color-mix(in_oklab,var(--color-warning)_35%,var(--color-border))] bg-[color-mix(in_oklab,var(--color-warning)_9%,var(--color-surface))] px-4 py-3"
        >
          <p className="text-sm font-semibold text-[var(--color-text)]">{t('off.title')}</p>
          <p className="mt-0.5 max-w-3xl text-sm text-[var(--color-muted)]">
            {t('off.body')} {canConfigure ? t('off.howManager') : t('off.howOther')}
          </p>
          {(settingsLink || delinquencyLink) && (
            <p className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
              {settingsLink}
              {delinquencyLink}
            </p>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="cases-stage" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.stage')}
          </label>
          <Select id="cases-stage" value={filters.stage} onChange={(e) => list.setFilter('stage', e.target.value)} className="w-44">
            <option value="">{t('filters.open')}</option>
            {COLLECTION_STAGES.map((s) => (
              <option key={s} value={s}>
                {t(`stages.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cases-days" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.minDays')}
          </label>
          <Select id="cases-days" value={filters.minDays} onChange={(e) => list.setFilter('minDays', e.target.value)} className="w-44">
            <option value="">{t('filters.any')}</option>
            {MIN_DAYS_OPTIONS.map((n) => (
              <option key={n} value={n}>
                {t('filters.moreThan', { n })}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cases-assignee" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.assignee')}
          </label>
          <Select
            id="cases-assignee"
            value={filters.assigneeId}
            onChange={(e) => list.setFilter('assigneeId', e.target.value)}
            className="w-44"
          >
            <option value="">{t('filters.everyone')}</option>
            {user?.id && <option value={user.id}>{t('filters.mine')}</option>}
          </Select>
        </div>
      </div>

      {list.error != null && <ErrorNotice error={list.error} />}

      {list.isLoading && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
          <Skeleton className="h-20 w-full rounded-2xl" />
        </div>
      )}

      {empty && list.hasFilters && (
        <EmptyState
          variant="filtered"
          iconName="search"
          title={t('empty.filteredTitle')}
          subtitle={t('empty.filteredSubtitle')}
          action={
            <Button type="button" variant="secondary" size="sm" onClick={list.reset}>
              {t('empty.clear')}
            </Button>
          }
        />
      )}

      {empty && !list.hasFilters && (
        <EmptyState
          iconName={automationOff ? 'clock' : 'check'}
          title={t('empty.title')}
          subtitle={automationOff ? t('empty.subtitleOff') : t('empty.subtitle')}
        />
      )}

      {list.error == null && list.items.length > 0 && (
        <section className="space-y-3" aria-label={t('queue.label')}>
          <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
            <p className="text-sm text-[var(--color-muted)]">
              {t('summary', { count: list.total })}
              {currencies.map((c) => (
                <span key={c}>
                  {' · '}
                  <MoneyText value={totalPayoff(list.items, c)} currency={c} decimals={2} className="font-medium text-[var(--color-text)]" />
                </span>
              ))}
            </p>
            <p className="text-xs text-[var(--color-muted)]">{t('queue.order')}</p>
          </div>
          <CaseQueue items={list.items} firstRank={(list.page - 1) * LIMIT + 1} />
          {list.totalPages > 1 && (
            <PaginationBar page={list.page} totalPages={list.totalPages} total={list.total} limit={list.limit} onPageChange={list.setPage} />
          )}
        </section>
      )}
    </div>
  );
}
