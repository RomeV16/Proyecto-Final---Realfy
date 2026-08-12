'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';

interface ProviderProfile {
  id: string;
  rubros: string[];
  coverageZones: string[];
  isActive: boolean;
  notes?: string;
}

interface ProviderItem {
  id: string;
  firstName: string;
  lastName: string;
  email?: string;
  phone?: string;
  providerProfile: ProviderProfile | null;
}

interface ListResponse {
  data: ProviderItem[];
  meta: { total: number; page: number; limit: number; totalPages: number };
}

export default function ProviderListPage() {
  const t = useTranslations('providers');
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [items, setItems] = useState<ProviderItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [searchFilter, setSearchFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const limit = 20;

  const loadProviders = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (searchFilter) params.set('search', searchFilter);
      if (activeOnly) params.set('isActive', 'true');

      const res = await apiClient<ListResponse>(`/providers?${params.toString()}`);
      setItems(res.data || []);
      setTotal(res.meta?.total || 0);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [page, searchFilter, activeOnly]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const totalPages = Math.ceil(total / limit);
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const hasFilters = searchFilter || activeOnly;

  function clearFilters() {
    setSearchFilter('');
    setActiveOnly(false);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-1">{t('subtitle')}</p>
        </div>
        <Link
          href={`${localePrefix}/providers/new`}
          className="inline-flex items-center gap-2 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors shrink-0"
        >
          {t('newProvider')}
        </Link>
      </div>

      <div className="flex flex-wrap gap-3">
        <input
          type="text"
          value={searchFilter}
          onChange={(e) => {
            setSearchFilter(e.target.value);
            setPage(1);
          }}
          placeholder={t('filters.searchPlaceholder')}
          className="px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 w-48"
        />
        <label className="flex items-center gap-2 px-3 py-2 rounded-lg border border-slate-200 text-sm cursor-pointer">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked);
              setPage(1);
            }}
            className="rounded border-slate-300"
          />
          {t('filters.activeOnly')}
        </label>
        {hasFilters && (
          <button
            onClick={clearFilters}
            className="px-3 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50 transition-colors"
          >
            {t('filters.clear')}
          </button>
        )}
      </div>

      {loading ? (
        <div className="grid gap-3">
          {Array.from({ length: 5 }, (_, i) => (
            <div key={i} className="bg-white rounded-xl border border-slate-200 p-4 animate-pulse">
              <div className="h-4 bg-slate-100 rounded w-48 mb-2" />
              <div className="flex gap-1.5">
                <div className="h-5 bg-slate-100 rounded-full w-20" />
                <div className="h-5 bg-slate-100 rounded-full w-16" />
              </div>
            </div>
          ))}
        </div>
      ) : items.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-center">
          <h2 className="text-lg font-semibold text-slate-900">
            {t('empty.title')}
          </h2>
          <p className="text-sm text-slate-500 mt-1">{t('empty.subtitle')}</p>
        </div>
      ) : (
        <>
          <div className="grid gap-3">
            {items.map((provider) => {
              const profile = provider.providerProfile;
              const isInactive = profile && !profile.isActive;
              return (
                <Link
                  key={provider.id}
                  href={`${localePrefix}/providers/${provider.id}`}
                  className={`block bg-white rounded-xl border border-slate-200 p-4 hover:border-brand-200 hover:shadow-sm transition-all ${
                    isInactive ? 'opacity-60' : ''
                  }`}
                >
                  <div className="flex flex-col sm:flex-row sm:items-center gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <h3 className="text-sm font-semibold text-slate-900 truncate">
                          {provider.firstName} {provider.lastName}
                        </h3>
                        {isInactive && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">
                            {t('card.inactive')}
                          </span>
                        )}
                      </div>
                      {profile && (
                        <div className="flex flex-wrap gap-1.5 mt-2">
                          {profile.rubros.map((rubro) => (
                            <span
                              key={rubro}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-brand-50 text-brand-700"
                            >
                              {rubro}
                            </span>
                          ))}
                          {profile.coverageZones.map((zone) => (
                            <span
                              key={zone}
                              className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-emerald-50 text-emerald-700"
                            >
                              {zone}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                    <div className="flex flex-col items-start sm:items-end gap-1 shrink-0 text-xs text-slate-500">
                      {provider.email ? (
                        <span>{provider.email}</span>
                      ) : (
                        <span className="text-slate-400">{t('card.noEmail')}</span>
                      )}
                      {provider.phone ? (
                        <span>{provider.phone}</span>
                      ) : (
                        <span className="text-slate-400">{t('card.noPhone')}</span>
                      )}
                    </div>
                  </div>
                </Link>
              );
            })}
          </div>

          {totalPages > 1 && (
            <div className="flex items-center justify-between">
              <span className="text-sm text-slate-500">{t('pagination.showing', { from, to, total })}</span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm disabled:opacity-50 hover:bg-slate-50 transition-colors"
                >
                  {t('pagination.prev')}
                </button>
                <button
                  onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                  disabled={page >= totalPages}
                  className="px-3 py-1.5 rounded-lg border border-slate-200 text-sm disabled:opacity-50 hover:bg-slate-50 transition-colors"
                >
                  {t('pagination.next')}
                </button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
