'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import {
  PropertyType,
  PropertyOperationType,
  PropertyState,
} from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { PropertyStateBadge } from './property-state-badge';
import { PropertyTypeBadge } from './property-type-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

/* ──────────── Types ──────────── */

interface PropertyOperation {
  id: string;
  operationType: string;
  state: string;
  price?: string | number;
  currency?: string;
}

interface PropertyMedia {
  id: string;
  url: string;
  thumbnailUrl?: string;
  isPrimary: boolean;
  sortOrder: number;
}

interface PropertyItem {
  id: string;
  title: string;
  type: string;
  street?: string;
  city?: string;
  province?: string;
  totalArea?: number;
  rooms?: number;
  bedrooms?: number;
  operations: PropertyOperation[];
  media: PropertyMedia[];
  isActive: boolean;
  createdAt: string;
}

interface PaginatedResponse {
  items: PropertyItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ──────────── Filters ──────────── */

interface Filters {
  type: string;
  operationType: string;
  state: string;
  city: string;
  page: number;
}

const INITIAL_FILTERS: Filters = {
  type: '',
  operationType: '',
  state: '',
  city: '',
  page: 1,
};

const LIMIT = 12;

/* ──────────── Skeleton ──────────── */

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
      <Skeleton className="aspect-[4/3] w-full rounded-none" />
      <div className="p-4 space-y-3">
        <Skeleton className="h-4 w-3/4" />
        <Skeleton className="h-3 w-1/2" />
        <div className="flex gap-2">
          <Skeleton className="h-5 w-16 rounded-full" />
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>
        <Skeleton className="h-4 w-1/3" />
      </div>
    </div>
  );
}

/* ──────────── Card ──────────── */

function PropertyCard({ property, localePrefix }: { property: PropertyItem; localePrefix: string }) {
  const t = useTranslations('properties');
  const primaryOp = property.operations[0];
  const thumbnail = property.media.find((m) => m.isPrimary)?.thumbnailUrl
    || property.media[0]?.thumbnailUrl
    || null;

  const address = [property.street, property.city, property.province].filter(Boolean).join(', ');
  const price = primaryOp?.price;
  const currency = primaryOp?.currency || 'USD';

  return (
    <Link
      href={`${localePrefix}/properties/${property.id}`}
      className="group block bg-white rounded-xl border border-slate-200 overflow-hidden hover:border-brand-300 hover:shadow-lg hover:shadow-brand-500/5 transition-all duration-200"
    >
      {/* Thumbnail */}
      <div className="aspect-[4/3] bg-slate-50 relative overflow-hidden">
        {thumbnail ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={thumbnail}
            alt={property.title}
            className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-300">
            <svg className="w-12 h-12" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}>
              <path strokeLinecap="round" strokeLinejoin="round" d="m2.25 15.75 5.159-5.159a2.25 2.25 0 0 1 3.182 0l5.159 5.159m-1.5-1.5 1.409-1.409a2.25 2.25 0 0 1 3.182 0l2.909 2.909M3.75 21h16.5A2.25 2.25 0 0 0 22.5 18.75V5.25A2.25 2.25 0 0 0 20.25 3H3.75A2.25 2.25 0 0 0 1.5 5.25v13.5A2.25 2.25 0 0 0 3.75 21Z" />
            </svg>
          </div>
        )}
        {/* Type badge overlay */}
        <div className="absolute top-2 left-2">
          <PropertyTypeBadge type={property.type} />
        </div>
      </div>

      {/* Content */}
      <div className="p-4 space-y-2">
        <h3 className="text-sm font-semibold text-slate-900 line-clamp-1 group-hover:text-brand-600 transition-colors">
          {property.title}
        </h3>
        <p className="text-xs text-slate-500 line-clamp-1">
          {address || t('card.noAddress')}
        </p>

        <div className="flex items-center gap-2 flex-wrap">
          {primaryOp && <PropertyStateBadge state={primaryOp.state} />}
          {primaryOp && (
            <span className="text-xs text-slate-500">
              {t(`operationTypes.${primaryOp.operationType}`)}
            </span>
          )}
        </div>

        <div className="pt-1 border-t border-slate-100">
          {price ? (
            <p className="text-base font-bold text-slate-900 tabular-nums">
              {currency === 'USD' ? 'US$' : '$'}{' '}
              {Number(price).toLocaleString('es-AR')}
            </p>
          ) : (
            <p className="text-sm text-slate-400 italic">{t('card.noPrice')}</p>
          )}
        </div>

        {/* Quick stats */}
        {(property.totalArea || property.rooms || property.bedrooms) && (
          <div className="flex items-center gap-3 text-xs text-slate-500">
            {property.totalArea && <span>{property.totalArea} m²</span>}
            {property.rooms && <span>{property.rooms} amb.</span>}
            {property.bedrooms && <span>{property.bedrooms} dorm.</span>}
          </div>
        )}
      </div>
    </Link>
  );
}

/* ──────────── Main Component ──────────── */

export function PropertyList() {
  const t = useTranslations('properties');
  const tFilters = useTranslations('properties.filters');
  const tPagination = useTranslations('properties.pagination');
  const tCommon = useTranslations('common');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);

  const canCreate = ['Admin', 'Gerente', 'Ventas'].includes(user?.role || '');

  const fetchProperties = useCallback(async (f: Filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(f.page));
      params.set('limit', String(LIMIT));
      if (f.type) params.set('type', f.type);
      if (f.operationType) params.set('operationType', f.operationType);
      if (f.state) params.set('state', f.state);
      if (f.city) params.set('city', f.city);

      const res = await apiClient<PaginatedResponse>(`/properties?${params.toString()}`);
      setData(res);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        console.error(`[PropertyList] fetch error: ${err.statusCode} ${err.errorCode}`);
      }
      setData({ items: [], total: 0, page: 1, limit: LIMIT, totalPages: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchProperties(filters);
  }, [filters, fetchProperties]);

  function updateFilter(key: keyof Filters, value: string | number) {
    setFilters((prev) => ({ ...prev, [key]: value, page: key === 'page' ? (value as number) : 1 }));
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
  }

  const hasFilters = filters.type || filters.operationType || filters.state || filters.city;
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
              href={`${localePrefix}/properties/new`}
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t('newProperty')}
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          <div>
            <label htmlFor="filter-type" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('type')}
            </label>
            <select
              id="filter-type"
              value={filters.type}
              onChange={(e) => updateFilter('type', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tFilters('typePlaceholder')}</option>
              {Object.values(PropertyType).map((pt) => (
                <option key={pt} value={pt}>
                  {t(`types.${pt}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-opType" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('operationType')}
            </label>
            <select
              id="filter-opType"
              value={filters.operationType}
              onChange={(e) => updateFilter('operationType', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tFilters('operationTypePlaceholder')}</option>
              {Object.values(PropertyOperationType).map((ot) => (
                <option key={ot} value={ot}>
                  {t(`operationTypes.${ot}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-state" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('state')}
            </label>
            <select
              id="filter-state"
              value={filters.state}
              onChange={(e) => updateFilter('state', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tFilters('statePlaceholder')}</option>
              {Object.values(PropertyState).map((s) => (
                <option key={s} value={s}>
                  {t(`states.${s}`)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label htmlFor="filter-city" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('city')}
            </label>
            <div className="flex gap-2">
              <input
                id="filter-city"
                type="text"
                value={filters.city}
                onChange={(e) => updateFilter('city', e.target.value)}
                placeholder={tFilters('cityPlaceholder')}
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
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {Array.from({ length: 8 }).map((_, i) => (
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M8.25 21v-4.875c0-.621.504-1.125 1.125-1.125h2.25c.621 0 1.125.504 1.125 1.125V21m0 0h4.5V3.545M12.75 21h7.5V10.75M2.25 21h1.5m18 0h-18M2.25 9l4.5-1.636M18.75 3l-1.5.545m0 6.205 3 1m1.5.5-1.5-.5M6.75 7.364V3h-3v18m3-13.636 10.5-3.819" />
              </svg>
            </div>
            <h2 className="text-lg font-semibold text-slate-900">{t('empty.title')}</h2>
            <p className="text-sm text-slate-500 mt-1">{t('empty.subtitle')}</p>
            <p className="text-sm text-slate-500 mt-3 max-w-md">{t('empty.description')}</p>
            <ol className="mt-4 text-sm text-slate-600 text-left list-decimal list-inside space-y-1 max-w-md">
              <li>{t('empty.step1')}</li>
              <li>{t('empty.step2')}</li>
              <li>{t('empty.step3')}</li>
              <li>{t('empty.step4')}</li>
            </ol>
            <div className="flex items-center gap-3 mt-5">
              {canCreate && (
                <Link
                  href={`${localePrefix}/properties/new`}
                  className="px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors"
                >
                  {t('newProperty')}
                </Link>
              )}
            </div>
          </div>
        )
      )}

      {/* Property grid */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-slide-up">
          {items.map((property) => (
            <PropertyCard key={property.id} property={property} localePrefix={localePrefix} />
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
