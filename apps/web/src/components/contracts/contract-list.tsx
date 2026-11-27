'use client';

import { useTranslations } from 'next-intl';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { ContractStatus, AdjustmentType } from '@realfy/shared';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from '@/i18n/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Icon } from '@/components/ui/icon';
import { Select } from '@/components/ui/select';
import { inputStyles } from '@/components/ui/input';
import { PaginationBar } from '@/components/ui/pagination';
import { cn } from '@/lib/cn';
import { useCan } from '@/lib/permissions';
import { ContractListHeader, ContractRow, ContractRowsSkeleton, type ContractItem } from './contract-row';

interface PaginatedResponse {
  items: ContractItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ──────────── Filters ──────────── */

interface Filters {
  status: string;
  adjustmentType: string;
  search: string;
  page: number;
}

const INITIAL_FILTERS: Filters = {
  status: '',
  adjustmentType: '',
  search: '',
  page: 1,
};

const LIMIT = 12;
/** La API no busca por texto: al buscar se trae el máximo que admite y se filtra acá. */
const SEARCH_LIMIT = 100;

function normalize(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase();
}

/** Texto por el que se busca un contrato: sus partes, la propiedad y la dirección. */
function searchText(contract: ContractItem): string {
  const people = (contract.persons ?? []).map((p) => `${p.person.firstName} ${p.person.lastName}`);
  const property = contract.property;
  return normalize(
    [...people, property?.title, property?.street, property?.number, property?.city].filter(Boolean).join(' '),
  );
}

/* ──────────── Main Component ──────────── */

export function ContractList() {
  const t = useTranslations('contracts');
  const tFilters = useTranslations('contracts.filters');
  const tCommon = useTranslations('common');

  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);

  const canCreate = useCan('contracts.manage');

  const searching = filters.search.trim().length > 0;
  const { status, adjustmentType, page } = filters;

  const fetchContracts = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(searching ? 1 : page));
      params.set('limit', String(searching ? SEARCH_LIMIT : LIMIT));
      if (status) params.set('status', status);
      if (adjustmentType) params.set('adjustmentType', adjustmentType);

      const res = await apiClient<PaginatedResponse>(`/contracts?${params.toString()}`);
      setData(res);
    } catch (err) {
      setError(err);
      if (err instanceof ApiRequestError) {
        console.error(`[ContractList] fetch error: ${err.statusCode} ${err.errorCode}`);
      }
      setData({ items: [], total: 0, page: 1, limit: LIMIT, totalPages: 0 });
    } finally {
      setLoading(false);
    }
  }, [status, adjustmentType, page, searching]);

  useEffect(() => {
    void fetchContracts();
  }, [fetchContracts]);

  function updateFilter(key: keyof Filters, value: string | number) {
    setFilters((prev) => ({ ...prev, [key]: value, page: key === 'page' ? (value as number) : 1 }));
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
  }

  const hasFilters = Boolean(filters.status || filters.adjustmentType || filters.search);
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 0;

  const items = useMemo(() => {
    const all = data?.items || [];
    if (!searching) return all;
    const words = normalize(filters.search).split(/\s+/).filter(Boolean);
    return all.filter((contract) => {
      const text = searchText(contract);
      return words.every((word) => text.includes(word));
    });
  }, [data, filters.search, searching]);

  const firstLoad = loading && !data;
  const shown = searching ? items.length : total;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        {canCreate && (
          <Link
            href={'/contracts/new'}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand-500 px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-brand-600 active:bg-brand-700 sm:w-auto"
          >
            <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
            {t('newContract')}
          </Link>
        )}
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative min-w-0 flex-1">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]"
            strokeWidth={1.75}
          />
          <input
            id="filter-search"
            type="search"
            value={filters.search}
            onChange={(e) => updateFilter('search', e.target.value)}
            placeholder={t('list.searchPlaceholder')}
            aria-label={t('list.searchLabel')}
            className={inputStyles({ className: 'pl-10' })}
          />
        </div>
        <Select
          id="filter-status"
          aria-label={tFilters('status')}
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className="sm:w-48"
        >
          <option value="">{tFilters('statusPlaceholder')}</option>
          {Object.values(ContractStatus).map((s) => (
            <option key={s} value={s}>
              {t(`statuses.${s}`)}
            </option>
          ))}
        </Select>
        <Select
          id="filter-adjType"
          aria-label={tFilters('adjustmentType')}
          value={filters.adjustmentType}
          onChange={(e) => updateFilter('adjustmentType', e.target.value)}
          className="sm:w-48"
        >
          <option value="">{tFilters('adjustmentTypePlaceholder')}</option>
          {Object.values(AdjustmentType).map((at) => (
            <option key={at} value={at}>
              {t(`adjustmentTypes.${at}`)}
            </option>
          ))}
        </Select>
        {hasFilters && (
          <button
            type="button"
            onClick={clearFilters}
            title={tFilters('clear')}
            className="shrink-0 rounded-lg px-3 py-2 text-sm text-[var(--color-muted)] underline-offset-2 transition-colors hover:text-[var(--color-text)] hover:underline"
          >
            {t('list.clear')}
          </button>
        )}
      </div>

      {error != null && <ErrorNotice error={error} />}

      {error == null && firstLoad && (
        <div
          role="status"
          aria-label={tCommon('loading')}
          className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
        >
          <ContractListHeader />
          <ContractRowsSkeleton />
        </div>
      )}

      {error == null &&
        !firstLoad &&
        items.length === 0 &&
        (hasFilters ? (
          <EmptyState
            variant="filtered"
            iconName="search"
            title={tCommon('noResults')}
            subtitle={t('empty.filtered')}
            action={
              <button
                type="button"
                onClick={clearFilters}
                className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
              >
                {tFilters('clear')}
              </button>
            }
          />
        ) : (
          <EmptyState
            iconName="contracts"
            title={t('empty.title')}
            subtitle={t('empty.description')}
            steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
            action={
              canCreate && (
                <Link
                  href={'/contracts/new'}
                  className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-brand-600)]"
                >
                  {t('newContract')}
                </Link>
              )
            }
          />
        ))}

      {error == null && !firstLoad && items.length > 0 && (
        <section
          aria-label={t('title')}
          className="overflow-hidden rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-sm"
        >
          <ContractListHeader />
          <ul
            className={cn(
              'divide-y divide-[var(--color-border)]',
              loading && 'pointer-events-none opacity-60 transition-opacity duration-200',
            )}
          >
            {items.map((contract) => (
              <ContractRow key={contract.id} contract={contract} />
            ))}
          </ul>
          <p className="border-t border-[var(--color-border)] px-5 py-2.5 text-xs text-[var(--color-muted)]">
            {t('list.count', { count: shown })}
          </p>
        </section>
      )}

      {!loading && !searching && (
        <PaginationBar
          page={filters.page}
          totalPages={totalPages}
          total={total}
          limit={LIMIT}
          onPageChange={(next) => updateFilter('page', next)}
        />
      )}
    </div>
  );
}
