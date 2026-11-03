'use client';

import { useTranslations } from 'next-intl';
import type { CollectionCaseItem } from '@realfy/shared';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { useAuth } from '@/lib/auth-context';
import { COLLECTION_STAGES, EMPTY_CASE_FILTERS, MIN_DAYS_OPTIONS, totalPayoff, type CaseFilterValues } from '@/lib/collections';
import { useCan } from '@/lib/permissions';
import { listPagination } from '@/components/fees/fee-filters';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { CaseTable } from './case-table';

const LIMIT = 50;

/**
 * Cobranza: los contratos con alquileres vencidos impagos, con la etapa (recordatorio, prejudicial, abogado,
 * judicial), los días de mora, lo que se debe hoy con punitorios y lo que toca después. Filtra por etapa, mora
 * mínima y por los casos asignados a uno mismo.
 */
export function CollectionsCenter() {
  const t = useTranslations('collections');
  const { user } = useAuth();
  const canView = useCan('collections.view');
  const list = usePaginatedList<CollectionCaseItem, CaseFilterValues>({
    key: 'collections',
    path: '/collection-cases',
    limit: LIMIT,
    initialFilters: EMPTY_CASE_FILTERS,
  });

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const { filters } = list;
  const currencies = [...new Set(list.items.map((i) => i.currency))].sort((a, b) => a.localeCompare(b));

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('title')}</h1>
        <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </header>

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

      {list.total > 0 && (
        <p className="text-sm text-[var(--color-muted)]">
          {t('summary', { count: list.total })}
          {currencies.map((c) => (
            <span key={c}>
              {' · '}
              <MoneyText value={totalPayoff(list.items, c)} currency={c} decimals={2} className="font-medium text-[var(--color-text)]" />
            </span>
          ))}
        </p>
      )}

      <CaseTable items={list.items} loading={list.isLoading} error={list.error} pagination={listPagination(list)} />
    </div>
  );
}
