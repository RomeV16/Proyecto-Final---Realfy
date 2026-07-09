'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import {
  ContractStatus,
  ContractType,
  AdjustmentType,
} from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { ContractStatusBadge } from './contract-status-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

/* ──────────── Types ──────────── */

interface ContractPerson {
  id: string;
  role: string;
  person: { id: string; firstName: string; lastName: string };
}

interface ContractItem {
  id: string;
  contractType: string;
  status: string;
  startDate: string;
  endDate?: string;
  rentAmount?: string | number;
  currency?: string;
  adjustmentType?: string;
  adjustmentPeriod?: string;
  property?: { id: string; title: string; street?: string; city?: string };
  persons?: ContractPerson[];
  isActive: boolean;
  createdAt: string;
}

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

/* ──────────── Skeleton ──────────── */

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4 space-y-3">
      <div className="flex items-center gap-2">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <Skeleton className="h-4 w-3/4" />
      <Skeleton className="h-3 w-1/2" />
      <Skeleton className="h-4 w-1/3" />
      <div className="flex gap-2">
        <Skeleton className="h-5 w-24 rounded-full" />
        <Skeleton className="h-5 w-20 rounded-full" />
      </div>
    </div>
  );
}

/* ──────────── Card ──────────── */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatCurrency(amount: string | number | undefined, currency?: string): string {
  if (amount == null) return '—';
  const prefix = currency === 'USD' ? 'US$ ' : '$ ';
  return prefix + Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function ContractCard({ contract, localePrefix }: { contract: ContractItem; localePrefix: string }) {
  const t = useTranslations('contracts');

  const propietario = contract.persons?.find((p) => p.role === 'Propietario');
  const inquilino = contract.persons?.find((p) => p.role === 'Inquilino');

  return (
    <Link
      href={`${localePrefix}/contracts/${contract.id}`}
      className="group block bg-white rounded-xl border border-slate-200 overflow-hidden hover:border-brand-300 hover:shadow-lg hover:shadow-brand-500/5 transition-all duration-200 p-4 space-y-3"
    >
      {/* Header badges */}
      <div className="flex items-center gap-2 flex-wrap">
        <ContractStatusBadge status={contract.status} />
        <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 text-slate-600 font-medium">
          {t(`types.${contract.contractType}`)}
        </span>
        {contract.adjustmentType && (
          <span className="text-xs px-2 py-0.5 rounded-full bg-blue-50 text-blue-600 font-medium">
            {t(`adjustmentTypes.${contract.adjustmentType}`)}
          </span>
        )}
      </div>

      {/* Property */}
      <h3 className="text-sm font-semibold text-slate-900 line-clamp-1 group-hover:text-brand-600 transition-colors">
        {contract.property?.title || t('card.noProperty')}
      </h3>
      {contract.property?.street && (
        <p className="text-xs text-slate-500 line-clamp-1">
          {[contract.property.street, contract.property.city].filter(Boolean).join(', ')}
        </p>
      )}

      {/* Date range */}
      <div className="text-xs text-slate-500">
        {formatDate(contract.startDate)}
        {contract.endDate && ` — ${formatDate(contract.endDate)}`}
      </div>

      {/* Rent */}
      <div className="text-base font-bold text-slate-900 tabular-nums">
        {formatCurrency(contract.rentAmount, contract.currency)}
      </div>

      {/* Persons */}
      {(propietario || inquilino) && (
        <div className="pt-2 border-t border-slate-100 flex flex-col gap-1">
          {propietario && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500" />
              {propietario.person.firstName} {propietario.person.lastName}
            </div>
          )}
          {inquilino && (
            <div className="flex items-center gap-1.5 text-xs text-slate-500">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              {inquilino.person.firstName} {inquilino.person.lastName}
            </div>
          )}
        </div>
      )}
    </Link>
  );
}

/* ──────────── Main Component ──────────── */

export function ContractList() {
  const t = useTranslations('contracts');
  const tFilters = useTranslations('contracts.filters');
  const tPagination = useTranslations('contracts.pagination');
  const tCommon = useTranslations('common');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);

  const canCreate = ['Admin', 'Gerente', 'Ventas'].includes(user?.role || '');

  const fetchContracts = useCallback(async (f: Filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(f.page));
      params.set('limit', String(LIMIT));
      if (f.status) params.set('status', f.status);
      if (f.adjustmentType) params.set('adjustmentType', f.adjustmentType);

      const res = await apiClient<PaginatedResponse>(`/contracts?${params.toString()}`);
      setData(res);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        console.error(`[ContractList] fetch error: ${err.statusCode} ${err.errorCode}`);
      }
      setData({ items: [], total: 0, page: 1, limit: LIMIT, totalPages: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchContracts(filters);
  }, [filters, fetchContracts]);

  function updateFilter(key: keyof Filters, value: string | number) {
    setFilters((prev) => ({ ...prev, [key]: value, page: key === 'page' ? (value as number) : 1 }));
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
  }

  const hasFilters = filters.status || filters.adjustmentType || filters.search;
  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canCreate && (
            <Link
              href={`${localePrefix}/contracts/new`}
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t('newContract')}
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          <div>
            <label htmlFor="filter-status" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('status')}
            </label>
            <select
              id="filter-status"
              value={filters.status}
              onChange={(e) => updateFilter('status', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tFilters('statusPlaceholder')}</option>
              {Object.values(ContractStatus).map((s) => (
                <option key={s} value={s}>{t(`statuses.${s}`)}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-adjType" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('adjustmentType')}
            </label>
            <select
              id="filter-adjType"
              value={filters.adjustmentType}
              onChange={(e) => updateFilter('adjustmentType', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tFilters('adjustmentTypePlaceholder')}</option>
              {Object.values(AdjustmentType).map((at) => (
                <option key={at} value={at}>{t(`adjustmentTypes.${at}`)}</option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-search" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('property')}
            </label>
            <div className="flex gap-2">
              <input
                id="filter-search"
                type="text"
                value={filters.search}
                onChange={(e) => updateFilter('search', e.target.value)}
                placeholder={tFilters('propertyPlaceholder')}
                className="flex-1 rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              />
              {hasFilters && (
                <button
                  onClick={clearFilters}
                  className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
                  title={tFilters('clear')}
                >
                  ✕
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Loading skeleton */}
      {loading && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {Array.from({ length: 6 }).map((_, i) => (
            <CardSkeleton key={i} />
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && items.length === 0 && (
        hasFilters ? (
          <EmptyState
            title={tCommon('noResults')}
            subtitle={t('empty.filtered')}
            action={
              <button
                onClick={clearFilters}
                className="mt-4 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors"
              >
                {tFilters('clear')}
              </button>
            }
          />
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-16 h-16 rounded-2xl bg-slate-100 flex items-center justify-center mb-4">
              <svg className="w-8 h-8 text-slate-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900">{t('empty.title')}</h2>
            <p className="text-sm text-slate-500 mt-1">{t('empty.subtitle')}</p>
            <p className="text-sm text-slate-500 mt-3 max-w-md">{t('empty.description')}</p>
            <ol className="mt-4 text-sm text-slate-600 text-left list-decimal list-inside space-y-1 max-w-md">
              <li>{t('empty.step1')}</li>
              <li>{t('empty.step2')}</li>
              <li>{t('empty.step3')}</li>
            </ol>
            <div className="flex items-center gap-3 mt-5">
              {canCreate && (
                <Link
                  href={`${localePrefix}/contracts/new`}
                  className="px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
                >
                  {t('newContract')}
                </Link>
              )}
            </div>
          </div>
        )
      )}

      {/* Contract grid */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 animate-slide-up">
          {items.map((contract) => (
            <ContractCard key={contract.id} contract={contract} localePrefix={localePrefix} />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
          <p className="text-sm text-slate-500">
            {tPagination('showing', {
              from: (filters.page - 1) * LIMIT + 1,
              to: Math.min(filters.page * LIMIT, total),
              total,
            })}
          </p>
          <div className="flex items-center gap-2">
            <button
              onClick={() => updateFilter('page', filters.page - 1)}
              disabled={filters.page <= 1}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tPagination('prev')}
            </button>
            <span className="text-sm text-slate-600 tabular-nums px-2">
              {tCommon('page')} {filters.page} {tCommon('of')} {totalPages}
            </span>
            <button
              onClick={() => updateFilter('page', filters.page + 1)}
              disabled={filters.page >= totalPages}
              className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-700 hover:bg-slate-50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {tPagination('next')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
