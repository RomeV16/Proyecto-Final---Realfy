'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { PersonRole } from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { PersonRoleBadge } from './person-role-badge';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/ui/empty-state';

/* ──────────── Types ──────────── */

interface PersonRoleAssignment {
  id: string;
  role: string;
}

interface PersonItem {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  cuit?: string;
  roles: PersonRoleAssignment[];
  isActive: boolean;
  createdAt: string;
}

interface PaginatedResponse {
  items: PersonItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ──────────── Filters ──────────── */

interface Filters {
  search: string;
  role: string;
  page: number;
}

const INITIAL_FILTERS: Filters = {
  search: '',
  role: '',
  page: 1,
};

const LIMIT = 12;

/* ──────────── Skeleton ──────────── */

function CardSkeleton() {
  return (
    <div className="bg-white rounded-xl border border-slate-200 p-4">
      <div className="flex items-center gap-3 mb-3">
        <Skeleton className="w-10 h-10 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      </div>
      <div className="flex gap-2 mb-3">
        <Skeleton className="h-5 w-20 rounded-full" />
        <Skeleton className="h-5 w-16 rounded-full" />
      </div>
      <div className="space-y-1.5">
        <Skeleton className="h-3 w-2/3" />
        <Skeleton className="h-3 w-1/2" />
      </div>
    </div>
  );
}

/* ──────────── Card ──────────── */

function PersonCard({ person, localePrefix }: { person: PersonItem; localePrefix: string }) {
  const t = useTranslations('persons');

  const initials = `${person.firstName.charAt(0)}${person.lastName.charAt(0)}`.toUpperCase();
  const fullName = `${person.firstName} ${person.lastName}`;

  return (
    <Link
      href={`${localePrefix}/persons/${person.id}`}
      className="group block bg-white rounded-xl border border-slate-200 p-4 hover:border-brand-300 hover:shadow-lg hover:shadow-brand-500/5 transition-all duration-200"
    >
      {/* Avatar + Name */}
      <div className="flex items-center gap-3 mb-3">
        <div className="w-10 h-10 rounded-full bg-brand-100 text-brand-700 flex items-center justify-center text-sm font-semibold shrink-0">
          {initials}
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold text-slate-900 truncate group-hover:text-brand-600 transition-colors">
            {fullName}
          </h3>
          {person.cuit && (
            <p className="text-xs text-slate-500 tabular-nums">{person.cuit}</p>
          )}
        </div>
      </div>

      {/* Role badges */}
      {person.roles.length > 0 && (
        <div className="flex items-center gap-1.5 flex-wrap mb-3">
          {person.roles.map((r) => (
            <PersonRoleBadge key={r.id} role={r.role} />
          ))}
        </div>
      )}

      {/* Contact info */}
      <div className="space-y-1 text-xs text-slate-500">
        <p className="flex items-center gap-1.5 truncate">
          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M21.75 6.75v10.5a2.25 2.25 0 0 1-2.25 2.25h-15a2.25 2.25 0 0 1-2.25-2.25V6.75m19.5 0A2.25 2.25 0 0 0 19.5 4.5h-15a2.25 2.25 0 0 0-2.25 2.25m19.5 0v.243a2.25 2.25 0 0 1-1.07 1.916l-7.5 4.615a2.25 2.25 0 0 1-2.36 0L3.32 8.91a2.25 2.25 0 0 1-1.07-1.916V6.75" />
          </svg>
          {person.email || t('card.noEmail')}
        </p>
        <p className="flex items-center gap-1.5 truncate">
          <svg className="w-3.5 h-3.5 text-slate-400 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 6.75c0 8.284 6.716 15 15 15h2.25a2.25 2.25 0 0 0 2.25-2.25v-1.372c0-.516-.351-.966-.852-1.091l-4.423-1.106c-.44-.11-.902.055-1.173.417l-.97 1.293c-.282.376-.769.542-1.21.38a12.035 12.035 0 0 1-7.143-7.143c-.162-.441.004-.928.38-1.21l1.293-.97c.363-.271.527-.734.417-1.173L6.963 3.102a1.125 1.125 0 0 0-1.091-.852H4.5A2.25 2.25 0 0 0 2.25 4.5v2.25Z" />
          </svg>
          {person.phone || t('card.noPhone')}
        </p>
      </div>
    </Link>
  );
}

/* ──────────── Main Component ──────────── */

export function PersonList() {
  const t = useTranslations('persons');
  const tFilters = useTranslations('persons.filters');
  const tPagination = useTranslations('persons.pagination');
  const tCommon = useTranslations('common');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);

  const canCreate = ['Admin', 'Gerente', 'Ventas'].includes(user?.role || '');

  const fetchPersons = useCallback(async (f: Filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(f.page));
      params.set('limit', String(LIMIT));
      if (f.search) params.set('search', f.search);
      if (f.role) params.set('role', f.role);

      const res = await apiClient<PaginatedResponse>(`/persons?${params.toString()}`);
      setData(res);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        console.error(`[PersonList] fetch error: ${err.statusCode} ${err.errorCode}`);
      }
      setData({ items: [], total: 0, page: 1, limit: LIMIT, totalPages: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchPersons(filters);
  }, [filters, fetchPersons]);

  function updateFilter(key: keyof Filters, value: string | number) {
    setFilters((prev) => ({ ...prev, [key]: value, page: key === 'page' ? (value as number) : 1 }));
  }

  function clearFilters() {
    setFilters(INITIAL_FILTERS);
  }

  const hasFilters = filters.search || filters.role;
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
              href={`${localePrefix}/persons/new`}
              data-tour="persons-create-btn"
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 4.5v15m7.5-7.5h-15" />
              </svg>
              {t('newPerson')}
            </Link>
          )}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4" data-tour="persons-filters">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="filter-search" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('search')}
            </label>
            <div className="flex gap-2">
              <input
                id="filter-search"
                type="text"
                value={filters.search}
                onChange={(e) => updateFilter('search', e.target.value)}
                placeholder={tFilters('searchPlaceholder')}
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

          <div>
            <label htmlFor="filter-role" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('role')}
            </label>
            <select
              id="filter-role"
              value={filters.role}
              onChange={(e) => updateFilter('role', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tFilters('rolePlaceholder')}</option>
              {Object.values(PersonRole).map((r) => (
                <option key={r} value={r}>
                  {t(`roles.${r}`)}
                </option>
              ))}
            </select>
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
                <path strokeLinecap="round" strokeLinejoin="round" d="M15 19.128a9.38 9.38 0 0 0 2.625.372 9.337 9.337 0 0 0 4.121-.952 4.125 4.125 0 0 0-7.533-2.493M15 19.128v-.003c0-1.113-.285-2.16-.786-3.07M15 19.128v.106A12.318 12.318 0 0 1 8.624 21c-2.331 0-4.512-.645-6.374-1.766l-.001-.109a6.375 6.375 0 0 1 11.964-3.07M12 6.375a3.375 3.375 0 1 1-6.75 0 3.375 3.375 0 0 1 6.75 0Zm8.25 2.25a2.625 2.625 0 1 1-5.25 0 2.625 2.625 0 0 1 5.25 0Z" />
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
            {canCreate && (
              <Link
                href={`${localePrefix}/persons/new`}
                className="mt-5 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors inline-block"
              >
                {t('newPerson')}
              </Link>
            )}
          </div>
        )
      )}

      {/* Person grid */}
      {!loading && items.length > 0 && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4 animate-slide-up" data-tour="persons-grid">
          {items.map((person) => (
            <PersonCard key={person.id} person={person} localePrefix={localePrefix} />
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
