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
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCard } from '@/components/ui/entity-card';
import { CardGrid } from '@/components/ui/card-grid';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { ExportButtons } from '../import/export-buttons';

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
  /** Superficie en m². La API la expone como `area`. */
  area?: number;
  rooms?: number;
  bedrooms?: number;
  /** Precio de referencia de la ficha, usado cuando la operación no fija uno. */
  price?: string | number;
  currency?: string;
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

/* ──────────── Card ──────────── */

function PropertyCard({ property, localePrefix }: { property: PropertyItem; localePrefix: string }) {
  const t = useTranslations('properties');
  const primaryOp = property.operations[0];
  const photos = property.media || [];
  const cover =
    photos.find((m) => m.isPrimary)?.thumbnailUrl || photos[0]?.thumbnailUrl || null;

  const address = [property.street, property.city, property.province].filter(Boolean).join(', ');
  /* La operación puede fijar su propio precio (p. ej. venta y alquiler con
     valores distintos); si no lo hace, vale el precio de referencia de la ficha. */
  const price = primaryOp?.price ?? property.price;
  const currency = primaryOp?.currency || property.currency || 'ARS';
  const href = `${localePrefix}/properties/${property.id}`;

  const specs: Array<{ icon?: 'mapPin'; label: string }> = [];
  if (property.rooms) specs.push({ label: `${property.rooms} amb.` });
  if (property.bedrooms) specs.push({ label: `${property.bedrooms} dorm.` });
  if (property.area) specs.push({ label: `${property.area} m²` });
  if (property.city) specs.push({ icon: 'mapPin', label: property.city });

  /* The card states what's blocking this listing, so the grid doubles as a
     worklist instead of just a catalogue. */
  const blocker = !cover
    ? { tone: 'warning' as const, icon: 'image' as const, text: t('card.needsPhotos') }
    : !price
      ? { tone: 'warning' as const, icon: 'alert' as const, text: t('card.needsPrice') }
      : null;

  return (
    <EntityCard href={href} label={property.title} featured>
      <EntityCard.Cover
        src={cover}
        alt={property.title}
        seed={property.id}
        icon="properties"
        aspect="aspect-[3/2]"
        topLeft={<PropertyTypeBadge type={property.type} onCover />}
        topRight={primaryOp && <PropertyStateBadge state={primaryOp.state} onCover />}
        bottomLeft={
          <h3 className="line-clamp-2 text-sm font-semibold leading-snug text-white drop-shadow-sm">
            {property.title}
          </h3>
        }
        bottomRight={
          photos.length > 0 && (
            <Badge onCover>
              <Icon name="image" className="h-3 w-3" strokeWidth={2} />
              {photos.length}
            </Badge>
          )
        }
      />

      <EntityCard.Body>
        <div className="flex items-start justify-between gap-2">
          {price ? (
            <EntityCard.Amount
              value={`${currency === 'USD' ? 'US$' : '$'} ${Number(price).toLocaleString('es-AR')}`}
              hint={primaryOp && t(`operationTypes.${primaryOp.operationType}`)}
            />
          ) : (
            <EntityCard.Amount value={t('card.noPrice')} tone="muted" />
          )}
        </div>

        <EntityCard.Meta items={specs.length ? specs : [{ icon: 'mapPin', label: address || t('card.noAddress') }]} />

        {blocker && (
          <EntityCard.Alert tone={blocker.tone} icon={blocker.icon}>
            {blocker.text}
          </EntityCard.Alert>
        )}
      </EntityCard.Body>

      <EntityCard.Footer>
        <p className="min-w-0 truncate text-[11px] text-[var(--color-muted)]">
          {address || t('card.noAddress')}
        </p>
        <EntityCard.Actions>
          <EntityCard.Action href={href} icon="arrowRight" variant="ghost">
            {t('card.view')}
          </EntityCard.Action>
        </EntityCard.Actions>
      </EntityCard.Footer>
    </EntityCard>
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
          <ExportButtons entityPath="properties" />
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

      {/* Grid — owns the loading → content → empty transition */}
      <div>
        <CardGrid
          items={items}
          loading={loading && !data}
          busy={loading && !!data}
          columns={4}
          skeletonCount={8}
          keyOf={(p) => p.id}
          renderItem={(property) => (
            <PropertyCard property={property} localePrefix={localePrefix} />
          )}
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
                iconName="properties"
                title={t('empty.title')}
                subtitle={t('empty.description')}
                steps={[t('empty.step1'), t('empty.step2'), t('empty.step3'), t('empty.step4')]}
                action={
                  canCreate && (
                    <Link
                      href={`${localePrefix}/properties/new`}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-brand-600)]"
                    >
                      <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
                      {t('newProperty')}
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
