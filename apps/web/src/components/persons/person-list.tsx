'use client';

import { useTranslations } from 'next-intl';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { PersonRole } from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { PersonRoleBadge } from './person-role-badge';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCard } from '@/components/ui/entity-card';
import { CardGrid } from '@/components/ui/card-grid';
import { Avatar } from '@/components/ui/avatar';
import { Icon } from '@/components/ui/icon';

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

/* ──────────── Card ──────────── */

function PersonCard({ person, localePrefix }: { person: PersonItem; localePrefix: string }) {
  const t = useTranslations('persons');
  const fullName = `${person.firstName} ${person.lastName}`;
  const href = `${localePrefix}/persons/${person.id}`;

  return (
    <EntityCard href={href} label={fullName}>
      <EntityCard.Body>
        <div className="flex items-center gap-3">
          <Avatar name={fullName} seed={person.id} size="lg" />
          <div className="min-w-0 flex-1">
            <EntityCard.Title>{fullName}</EntityCard.Title>
            <EntityCard.Subtitle>{person.cuit || t('card.noCuit')}</EntityCard.Subtitle>
          </div>
        </div>

        {person.roles.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            {person.roles.map((r) => (
              <PersonRoleBadge key={r.id} role={r.role} />
            ))}
          </div>
        )}

        <EntityCard.Meta
          items={[
            { label: person.email || t('card.noEmail') },
            { label: person.phone || t('card.noPhone') },
          ]}
        />
      </EntityCard.Body>

      <EntityCard.Footer>
        <span className="min-w-0 truncate text-[11px] text-[var(--color-muted)]">
          {person.roles.length === 0 ? t('roles.noRoles') : ''}
        </span>
        <EntityCard.Actions className="ml-auto">
          <EntityCard.Action href={href} icon="arrowRight" variant="ghost">
            {t('card.view')}
          </EntityCard.Action>
        </EntityCard.Actions>
      </EntityCard.Footer>
    </EntityCard>
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
      <div className="bg-white rounded-xl border border-slate-200 p-4">
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

      {/* Grid — owns the loading → content → empty transition */}
      <div>
        <CardGrid
          items={items}
          loading={loading && !data}
          busy={loading && !!data}
          columns={4}
          skeletonCount={8}
          skeletonMedia={false}
          keyOf={(p) => p.id}
          renderItem={(person) => <PersonCard person={person} localePrefix={localePrefix} />}
          empty={
            hasFilters ? (
              <EmptyState
                variant="filtered"
                iconName="search"
                title={tCommon('noResults')}
                subtitle={t('empty.filtered')}
                action={
                  <button
                    onClick={clearFilters}
                    className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
                  >
                    {tFilters('clear')}
                  </button>
                }
              />
            ) : (
              <EmptyState
                iconName="persons"
                title={t('empty.title')}
                subtitle={t('empty.description')}
                steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
                action={
                  canCreate && (
                    <Link
                      href={`${localePrefix}/persons/new`}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-brand-600)]"
                    >
                      <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
                      {t('newPerson')}
                    </Link>
                  )
                }
              />
            )
          }
        />
      </div>

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
