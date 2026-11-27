'use client';

import { useTranslations } from 'next-intl';
import { Link } from '@/i18n/navigation';
import { useState, useEffect, useCallback } from 'react';
import { apiClient } from '@/lib/api-client';
import { EntityRow, Badge } from '@/components/ui/entity-card';
import { RowList } from '@/components/ui/card-grid';
import { EmptyState } from '@/components/ui/empty-state';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Icon } from '@/components/ui/icon';
import { ErrorNotice } from '@/components/ui/error-notice';
import { PaginationBar } from '@/components/ui/pagination';
import { inputStyles } from '@/components/ui/input';

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

function ProviderRow({ provider }: { provider: ProviderItem }) {
  const t = useTranslations('providers');
  const fullName = `${provider.firstName} ${provider.lastName}`;
  const href = `/providers/${provider.id}`;
  const profile = provider.providerProfile;
  const isInactive = Boolean(profile && !profile.isActive);
  const rubros = profile?.rubros || [];
  const coverageZones = profile?.coverageZones || [];
  const hasTags = rubros.length > 0 || coverageZones.length > 0;
  const contactLink =
    'relative z-[2] inline-flex max-w-full items-center gap-1.5 rounded text-[var(--color-text)] underline-offset-2 hover:text-[var(--color-brand-600)] hover:underline';

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
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
            {rubros.length > 0 && (
              <span className="flex flex-wrap items-center gap-1.5">
                {rubros.map((rubro) => (
                  <Badge key={rubro} variant="brand">
                    {rubro}
                  </Badge>
                ))}
              </span>
            )}
            {coverageZones.length > 0 && (
              <span className="inline-flex min-w-0 items-center gap-1 text-xs text-[var(--color-muted)]">
                <Icon name="mapPin" className="h-3.5 w-3.5 shrink-0" strokeWidth={1.75} />
                <span className="truncate">{coverageZones.join(', ')}</span>
              </span>
            )}
          </div>
        )
      }
      trailing={
        <div className="flex flex-col items-start gap-0.5 text-xs text-[var(--color-muted)] sm:items-end">
          {provider.phone ? (
            <a href={`tel:${provider.phone.replace(/[^\d+]/g, '')}`} className={contactLink} title={t('card.call')}>
              <Icon name="phone" className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" strokeWidth={1.75} />
              <span className="truncate tabular-nums">{provider.phone}</span>
            </a>
          ) : (
            <span>{t('card.noPhone')}</span>
          )}
          {provider.email && (
            <a href={`mailto:${provider.email}`} className={contactLink} title={t('card.sendEmail')}>
              <Icon name="mail" className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted)]" strokeWidth={1.75} />
              <span className="truncate">{provider.email}</span>
            </a>
          )}
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

  const [items, setItems] = useState<ProviderItem[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [searchFilter, setSearchFilter] = useState('');
  const [activeOnly, setActiveOnly] = useState(false);
  const limit = 20;

  const loadProviders = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      params.set('page', String(page));
      params.set('limit', String(limit));
      if (searchFilter) params.set('search', searchFilter);
      if (activeOnly) params.set('isActive', 'true');

      const res = await apiClient<ListResponse>(`/providers?${params.toString()}`);
      setItems(res.data || []);
      setTotal(res.meta?.total || 0);
    } catch (err) {
      setError(err);
      setItems([]);
      setTotal(0);
    } finally {
      setLoading(false);
      setLoaded(true);
    }
  }, [page, searchFilter, activeOnly]);

  useEffect(() => {
    void loadProviders();
  }, [loadProviders]);

  const totalPages = Math.ceil(total / limit);
  const hasFilters = Boolean(searchFilter || activeOnly);

  function clearFilters() {
    setSearchFilter('');
    setActiveOnly(false);
    setPage(1);
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-[var(--color-text)]">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <Link href={'/providers/new'} className="shrink-0">
          <Button variant="primary">
            <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
            {t('newProvider')}
          </Button>
        </Link>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div className="relative min-w-0 flex-1 sm:max-w-sm">
          <Icon
            name="search"
            className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--color-muted)]"
            strokeWidth={1.75}
          />
          <input
            type="search"
            aria-label={t('filters.search')}
            value={searchFilter}
            onChange={(e) => {
              setSearchFilter(e.target.value);
              setPage(1);
            }}
            placeholder={t('filters.searchPlaceholder')}
            className={inputStyles({ className: 'pl-10' })}
          />
        </div>
        <label className="flex h-11 cursor-pointer items-center gap-2 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 text-sm text-[var(--color-text)]">
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

      {error != null && <ErrorNotice error={error} />}

      {/* Row list — owns the loading → content → empty transition */}
      <div className={error != null ? 'hidden' : undefined}>
        <RowList
          items={items}
          loading={loading && !loaded}
          busy={loading && loaded}
          skeletonCount={5}
          keyOf={(provider) => provider.id}
          renderItem={(provider) => <ProviderRow provider={provider} />}
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
                  <Link href={'/providers/new'}>
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

      </div>

      {!loading && (
        <PaginationBar page={page} totalPages={totalPages} total={total} limit={limit} onPageChange={setPage} />
      )}
    </div>
  );
}
