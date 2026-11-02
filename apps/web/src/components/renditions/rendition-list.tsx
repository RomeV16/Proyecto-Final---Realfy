'use client';

import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { toast } from '@/lib/toast';
import { RendicionStatus } from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCard } from '@/components/ui/entity-card';
import { CardGrid } from '@/components/ui/card-grid';
import { StatusBadge } from '@/components/ui/status-badge';
import { statusAccent } from '@/lib/status-registry';
import type { IconName } from '@/components/ui/icon';
import { Avatar } from '@/components/ui/avatar';
import { Meter } from '@/components/ui/micro-viz';
import { formatMoneyFixed } from '@/lib/format';
import { RenditionsHistoricalNotice } from './historical-notice';

/* ──────────── Types ──────────── */

interface RenditionItem {
  id: string;
  status: RendicionStatus;
  month: number;
  year: number;
  rentCollected: string | number;
  netDeposit: string | number;
  pdfUrl?: string | null;
  sentAt?: string | null;
  depositedAt?: string | null;
  contract?: {
    id: string;
    property?: { id: string; title: string; street?: string; city?: string };
  };
  ownerId?: string;
  owner?: { firstName: string; lastName: string } | null;
  ownerName?: string;
}

interface PaginatedResponse {
  items: RenditionItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/* ──────────── Filters ──────────── */

interface Filters {
  status: string;
  month: string;
  year: string;
  page: number;
}

const INITIAL_FILTERS: Filters = { status: '', month: '', year: '', page: 1 };
const LIMIT = 12;

/* ──────────── Helpers ──────────── */


/* ──────────── Card ──────────── */

interface CardProps {
  item: RenditionItem;
  onDownloadPdf: (id: string) => void;
}

function RenditionCard({ item, onDownloadPdf }: CardProps) {
  const t = useTranslations('renditions');
  const tCard = useTranslations('renditions.card');
  const tMonths = useTranslations('renditions.months');

  const periodLabel = `${tMonths(String(item.month) as '1')} ${item.year}`;
  const ownerName = item.owner
    ? `${item.owner.firstName} ${item.owner.lastName}`.trim()
    : item.ownerName || null;
  const propertyText = item.contract?.property?.title || tCard('noProperty');
  const href = `/renditions/${item.id}`;

  const rentCollected = Number(item.rentCollected || 0);
  const netDeposit = Number(item.netDeposit || 0);
  const retainedPct = rentCollected > 0 ? Math.round((netDeposit / rentCollected) * 100) : 0;

  const isSent = item.status === RendicionStatus.Enviada || item.status === RendicionStatus.Depositada;

  const metaItems: Array<{ icon?: IconName; label: string }> = [{ icon: 'mapPin', label: propertyText }];

  /* One blocker at a time, so the grid doubles as a worklist. */
  const alert = !item.pdfUrl
    ? { tone: 'warning' as const, icon: 'alert' as const, text: tCard('missingPdf') }
    : !isSent
      ? { tone: 'info' as const, icon: 'clock' as const, text: tCard('notSent') }
      : null;

  return (
    <EntityCard href={href} label={`${periodLabel} — ${propertyText}`} accent={statusAccent('rendicion', item.status)}>
      <EntityCard.Cover
        seed={item.id}
        icon="renditions"
        aspect="aspect-[3/1]"
        alt={periodLabel}
        topRight={<StatusBadge domain="rendicion" status={item.status} onCover />}
        bottomLeft={
          <h3 className="text-sm font-semibold leading-snug text-white drop-shadow-sm">{periodLabel}</h3>
        }
      />

      <EntityCard.Body>
        <div className="flex items-center gap-2">
          <Avatar name={ownerName} seed={item.ownerId || ownerName || item.id} size="xs" />
          <span className="truncate text-xs font-medium text-[var(--color-text)]">
            {ownerName || tCard('noOwner')}
          </span>
        </div>

        <EntityCard.Amount value={formatMoneyFixed(netDeposit)} hint={t('summary.netDeposit')} />

        <Meter value={retainedPct} tone="brand" label={t('table.rentCollected')} hint={formatMoneyFixed(rentCollected)} />

        <EntityCard.Meta items={metaItems} />

        {alert && (
          <EntityCard.Alert tone={alert.tone} icon={alert.icon}>
            {alert.text}
          </EntityCard.Alert>
        )}
      </EntityCard.Body>

      <EntityCard.Footer>
        <p className="min-w-0 truncate text-[11px] text-[var(--color-muted)]">{propertyText}</p>
        <EntityCard.Actions>
          <EntityCard.Action
            onClick={(e) => {
              e.preventDefault();
              onDownloadPdf(item.id);
            }}
            icon="download"
            variant="quiet"
          >
            {t('pdf.download')}
          </EntityCard.Action>
          <EntityCard.Action href={href} icon="arrowRight" variant="ghost">
            {tCard('view')}
          </EntityCard.Action>
        </EntityCard.Actions>
      </EntityCard.Footer>
    </EntityCard>
  );
}

/* ──────────── Main Component ──────────── */

export function RenditionList() {
  const t = useTranslations('renditions');
  const tMonths = useTranslations('renditions.months');
  const tCommon = useTranslations('common');

  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
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
    } catch {
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    fetchData();
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
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 2 + i);

  const items = data?.items || [];
  const totalPages = data?.totalPages || 0;
  const hasFilters = Boolean(filters.status || filters.month || filters.year);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
        </div>
      </div>

      <RenditionsHistoricalNotice />

      {/* Filters */}
      <div className="flex flex-wrap gap-3">
        <select
          value={filters.status}
          onChange={(e) => updateFilter('status', e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        >
          <option value="">{t('filters.statusPlaceholder')}</option>
          {Object.values(RendicionStatus).map((s) => (
            <option key={s} value={s}>{t(`statuses.${s}`)}</option>
          ))}
        </select>
        <select
          value={filters.month}
          onChange={(e) => updateFilter('month', e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        >
          <option value="">{t('filters.monthPlaceholder')}</option>
          {Array.from({ length: 12 }, (_, i) => i + 1).map((m) => (
            <option key={m} value={m}>{tMonths(String(m) as '1')}</option>
          ))}
        </select>
        <select
          value={filters.year}
          onChange={(e) => updateFilter('year', e.target.value)}
          className="rounded-lg border border-slate-300 px-3 py-2 text-sm focus:ring-2 focus:ring-brand-500 focus:border-brand-500"
        >
          <option value="">{t('filters.yearPlaceholder')}</option>
          {years.map((y) => (
            <option key={y} value={y}>{y}</option>
          ))}
        </select>
        {hasFilters && (
          <button
            onClick={() => setFilters(INITIAL_FILTERS)}
            className="text-sm text-slate-500 hover:text-slate-700"
          >
            {t('filters.clear')}
          </button>
        )}
      </div>

      {/* Grid — owns the loading → content → empty transition */}
      <CardGrid
        items={items}
        loading={loading && !data}
        busy={loading && !!data}
        columns={3}
        skeletonCount={6}
        keyOf={(item) => item.id}
        renderItem={(item) => (
          <RenditionCard item={item} onDownloadPdf={handleDownloadPdf} />
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
                  onClick={() => setFilters(INITIAL_FILTERS)}
                  className="rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm text-[var(--color-text)] transition-colors hover:bg-[var(--color-bg)]"
                >
                  {t('filters.clear')}
                </button>
              }
            />
          ) : (
            <EmptyState
              iconName="renditions"
              title={t('empty.title')}
              subtitle={t('empty.description')}
            />
          )
        }
      />

      {/* Pagination */}
      {data && data.totalPages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 bg-white rounded-xl border border-slate-200 sm:rounded-none sm:border-x-0 sm:border-b-0 sm:border-t sm:border-slate-100">
          <p className="text-xs text-slate-500">
            {t('pagination.showing', {
              from: (data.page - 1) * LIMIT + 1,
              to: Math.min(data.page * LIMIT, data.total),
              total: data.total,
            })}
          </p>
          <div className="flex gap-2">
            <button
              onClick={() => updateFilter('page', filters.page - 1)}
              disabled={filters.page <= 1}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {t('pagination.prev')}
            </button>
            <button
              onClick={() => updateFilter('page', filters.page + 1)}
              disabled={filters.page >= data.totalPages}
              className="px-3 py-1.5 rounded-lg border border-slate-300 text-sm text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              {t('pagination.next')}
            </button>
          </div>
        </div>
      )}

    </div>
  );
}
