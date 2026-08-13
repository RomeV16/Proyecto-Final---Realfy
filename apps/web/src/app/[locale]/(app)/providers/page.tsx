'use client';

import { useTranslations } from 'next-intl';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { EntityRow, Badge } from '@/components/ui/entity-card';
import { RowList } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';

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

/* ──────────── Row ──────────── */

function ProviderRow({ provider, localePrefix }: { provider: ProviderItem; localePrefix: string }) {
  const t = useTranslations('providers');
  const fullName = `${provider.firstName} ${provider.lastName}`;
  const href = `${localePrefix}/providers/${provider.id}`;
  const profile = provider.providerProfile;
  const isInactive = Boolean(profile && !profile.isActive);
  const rubros = profile?.rubros || [];
  const coverageZones = profile?.coverageZones || [];
  const hasTags = rubros.length > 0 || coverageZones.length > 0;

  return (
    <EntityRow
      href={href}
      label={fullName}
      accent={isInactive ? 'none' : 'success'}
      className={isInactive ? 'opacity-60' : undefined}
      leading={<Avatar name={fullName} seed={provider.id} size="md" />}
      title={
        <span className="inline-flex items-center gap-2">
          <span className="truncate">{fullName}</span>
          {isInactive && <Badge variant="neutral">{t('card.inactive')}</Badge>}
        </span>
      }
      meta={
        hasTags && (
          <div className="flex flex-wrap items-center gap-1.5">
            {rubros.map((rubro) => (
              <Badge key={rubro} variant="brand">
                {rubro}
              </Badge>
            ))}
            {coverageZones.map((zone) => (
              <Badge key={zone} variant="success">
                {zone}
              </Badge>
            ))}
          </div>
        )
      }
      trailing={
        <div className="flex flex-col items-end gap-0.5 text-xs text-[var(--color-muted)]">
          <span className="inline-flex items-center gap-1 truncate">
            <Icon name="mail" className="h-3.5 w-3.5" strokeWidth={1.75} />
            {provider.email || t('card.noEmail')}
          </span>
          <span className="inline-flex items-center gap-1 truncate">
            <Icon name="phone" className="h-3.5 w-3.5" strokeWidth={1.75} />
            {provider.phone || t('card.noPhone')}
          </span>
        </div>
      }
      actions={
        <EntityRow.Action href={href} icon="arrowRight" variant="ghost">
          {t('card.view')}
        </EntityRow.Action>
      }
      alert={
        !profile && (
          <EntityRow.Alert tone="warning" icon="alert">
            {t('card.noProfile')}
          </EntityRow.Alert>
        )
      }
    />
  );
}

/* ──────────── Page ──────────── */

export default function ProviderListPage() {
  const t = useTranslations('providers');
  const tCommon = useTranslations('common');
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [items, setItems] = useState<ProviderItem[]>([]);
  const [loaded, setLoaded] = useState(false);
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
      setLoaded(true);
    }
  }, [page, searchFilter, activeOnly]);

  useEffect(() => {
    loadProviders();
  }, [loadProviders]);

  const totalPages = Math.ceil(total / limit);
  const from = (page - 1) * limit + 1;
  const to = Math.min(page * limit, total);
  const hasFilters = Boolean(searchFilter || activeOnly);

  function clearFilters() {
    setSearchFilter('');
    setActiveOnly(false);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-2 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <Link href={`${localePrefix}/providers/new`} className="shrink-0">
          <Button variant="primary">
            <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
            {t('newProvider')}
          </Button>
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
          className="w-56 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)] placeholder-[var(--color-muted)] focus:border-brand-500 focus:outline-none"
        />
        <label className="flex cursor-pointer items-center gap-2 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text)]">
          <input
            type="checkbox"
            checked={activeOnly}
            onChange={(e) => {
              setActiveOnly(e.target.checked);
              setPage(1);
            }}
            className="rounded border-[var(--color-border)]"
          />
          {t('filters.activeOnly')}
        </label>
        {hasFilters && (
          <Button variant="secondary" size="sm" onClick={clearFilters}>
            {t('filters.clear')}
          </Button>
        )}
      </div>

      {/* Row list — owns the loading → content → empty transition */}
      <RowList
        items={items}
        loading={loading && !loaded}
        busy={loading && loaded}
        skeletonCount={5}
        keyOf={(provider) => provider.id}
        renderItem={(provider) => <ProviderRow provider={provider} localePrefix={localePrefix} />}
        empty={
          hasFilters ? (
            <EmptyState
              variant="filtered"
              iconName="search"
              title={tCommon('noResults')}
              subtitle={t('empty.filtered')}
              action={
                <Button variant="secondary" size="sm" onClick={clearFilters}>
                  {t('filters.clear')}
                </Button>
              }
            />
          ) : (
            <EmptyState
              iconName="providers"
              title={t('empty.title')}
              subtitle={t('empty.subtitle')}
              steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
              action={
                <Link href={`${localePrefix}/providers/new`}>
                  <Button variant="primary">
                    <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
                    {t('newProvider')}
                  </Button>
                </Link>
              }
            />
          )
        }
      />

      {totalPages > 1 && (
        <div className="flex items-center justify-between">
          <span className="text-sm text-[var(--color-muted)]">
            {t('pagination.showing', { from, to, total })}
          </span>
          <div className="flex gap-2">
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
            >
              {t('pagination.prev')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
            >
              {t('pagination.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
