'use client';

import { useTranslations } from 'next-intl';
import { RendicionStatus } from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { Spinner } from '@/components/ui/spinner';
import { RenditionsHistoricalNotice } from './historical-notice';
import { RenditionVoucher, VoucherSkeleton, type RenditionSummary } from './rendition-voucher';

/* ──────────── Types ──────────── */

interface PaginatedResponse {
  items: RenditionSummary[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface Filters {
  status: string;
  month: string;
  year: string;
  page: number;
}

const INITIAL_FILTERS: Filters = { status: '', month: '', year: '', page: 1 };
const LIMIT = 12;

const SELECT_CLASS =
  'h-9 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:border-[var(--color-brand-500)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--color-brand-500)_30%,transparent)]';

/* ──────────── Main Component ──────────── */

export function RenditionList() {
  const t = useTranslations('renditions');
  const tMonths = useTranslations('renditions.months');
  const tCommon = useTranslations('common');

  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(filters.page));
      params.set('limit', String(LIMIT));
      if (filters.status) params.set('status', filters.status);
      if (filters.month) params.set('month', filters.month);
      if (filters.year) params.set('year', filters.year);

      const res = await apiClient<PaginatedResponse>(`/renditions?${params.toString()}`);
      setData(res);
      setLoadFailed(false);
    } catch {
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  function updateFilter(key: keyof Filters, value: string | number) {
    setFilters((prev) => ({ ...prev, [key]: value, page: key === 'page' ? (value as number) : 1 }));
  }

  async function handleDownloadPdf(id: string) {
    try {
      await downloadFile(`/renditions/${id}/pdf`, `rendicion-${id}.pdf`);
    } catch {
      toast.error(tCommon('downloadFailed'));
    }
  }

  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 4 }, (_, i) => currentYear - 2 + i);

  const items = data?.items || [];
  const hasFilters = Boolean(filters.status || filters.month || filters.year);

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">{t('title')}</h1>
        <p className="mt-0.5 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </div>

      <RenditionsHistoricalNotice />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <select
          aria-label={t('filters.status')}
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t('filters.statusPlaceholder')}</option>
          {Object.values(RendicionStatus).map((s) => (
            <option key={s} value={s}>{t(`statuses.${s}`)}</option>
          ))}
        </select>
        <select
          aria-label={t('filters.month')}
          value={filters.month}
          onChange={(e) => updateFilter('month', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t('filters.monthPlaceholder')}</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{tMonths(String(m) as '1')}</option>
          ))}
        </select>
        <select
          aria-label={t('filters.year')}
          value={filters.year}
          onChange={(e) => updateFilter('year', e.target.value)}
          className={SELECT_CLASS}
        >
          <option value="">{t('filters.yearPlaceholder')}</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {hasFilters && (
          <button
            type="button"
            onClick={() => setFilters(INITIAL_FILTERS)}
            className="h-9 rounded-[var(--radius-lg)] px-2.5 text-sm text-[var(--color-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline"
          >
            {t('filters.clear')}
          </button>
        )}
      </div>

      {/* Talones */}
      {loading && !data && !loadFailed ? (
        <VoucherSkeleton />
      ) : loadFailed ? (
        <EmptyState
          iconName="alert"
          title={t('errors.loadFailed')}
          subtitle={t('voucher.loadFailedHint')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void fetchData()} disabled={loading}>
              {loading && <Spinner className="h-4 w-4" />}
              {t('voucher.retry')}
            </Button>
          }
        />
      ) : items.length === 0 ? (
        hasFilters ? (
          <EmptyState
            variant="filtered"
            iconName="search"
            title={tCommon('noResults')}
            subtitle={t('empty.filtered')}
            action={
              <Button variant="secondary" size="sm" onClick={() => setFilters(INITIAL_FILTERS)}>
                {t('filters.clear')}
              </Button>
            }
          />
        ) : (
          <EmptyState iconName="renditions" title={t('empty.title')} subtitle={t('empty.description')} />
        )
      ) : (
        <div className={cn('space-y-4 transition-opacity', loading && 'opacity-60')} aria-busy={loading || undefined}>
          {items.map((item) => (
            <RenditionVoucher key={item.id} rendition={item} onDownloadPdf={(id) => void handleDownloadPdf(id)} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
          <p className="text-sm text-[var(--color-muted)]">
            {t('pagination.showing', {
              from: (data.page - 1) * LIMIT + 1,
              to: Math.min(data.page * LIMIT, data.total),
              total: data.total,
            })}
          </p>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={() => updateFilter('page', filters.page - 1)} disabled={filters.page <= 1}>
              {t('pagination.prev')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => updateFilter('page', filters.page + 1)}
              disabled={filters.page >= data.totalPages}
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
