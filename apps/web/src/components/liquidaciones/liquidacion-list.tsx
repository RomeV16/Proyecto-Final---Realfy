'use client';

import { useTranslations } from 'next-intl';
import { Spinner } from '@/components/ui/spinner';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { LiquidacionStatus } from '@realfy/shared';
import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { EmptyState } from '@/components/ui/empty-state';
import { EntityCard } from '@/components/ui/entity-card';
import { CardGrid } from '@/components/ui/card-grid';
import { Badge } from '@/components/ui/badge';
import { Icon, type IconName } from '@/components/ui/icon';
import { cn } from '@/lib/cn';

/* ──────────── Types ──────────── */

interface LiquidacionItem {
  id: string;
  status: string;
  period?: string;
  month?: number;
  year?: number;
  dueDate?: string;
  totalAmount?: string | number;
  total?: string | number;
  subtotal?: string | number;
  currency?: string;
  pdfUrl?: string | null;
  contract?: {
    id: string;
    property?: { id: string; title: string; street?: string; city?: string };
  };
  payments?: { amount: string | number }[];
  _count?: { payments: number };
}

interface PaginatedResponse {
  items: LiquidacionItem[];
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

/* ──────────── Status → card language ──────────── */

const STATUS_VARIANT: Record<string, 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'brand'> = {
  [LiquidacionStatus.Borrador]: 'neutral',
  [LiquidacionStatus.Revision]: 'info',
  [LiquidacionStatus.Aprobada]: 'brand',
  [LiquidacionStatus.Enviada]: 'info',
  [LiquidacionStatus.Pagada]: 'success',
  [LiquidacionStatus.Vencida]: 'danger',
  [LiquidacionStatus.Anulada]: 'neutral',
};

const STATUS_ACCENT: Record<string, 'brand' | 'success' | 'warning' | 'danger' | 'info' | 'none'> = {
  [LiquidacionStatus.Borrador]: 'none',
  [LiquidacionStatus.Revision]: 'info',
  [LiquidacionStatus.Aprobada]: 'brand',
  [LiquidacionStatus.Enviada]: 'info',
  [LiquidacionStatus.Pagada]: 'success',
  [LiquidacionStatus.Vencida]: 'danger',
  [LiquidacionStatus.Anulada]: 'none',
};

/* ──────────── Helpers ──────────── */

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('es-AR', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

function formatCurrency(amount: string | number | undefined): string {
  if (amount == null) return '—';
  return '$ ' + Number(amount).toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/* ──────────── Card ──────────── */

interface CardProps {
  item: LiquidacionItem;
  localePrefix: string;
  selected: boolean;
  onToggle: () => void;
  bulkMode: boolean;
}

function LiquidacionCard({ item, localePrefix, selected, onToggle, bulkMode }: CardProps) {
  const t = useTranslations('liquidaciones');
  const tCard = useTranslations('liquidaciones.card');
  const tMonths = useTranslations('liquidaciones.months');

  // Derive month/year from period date (API returns period as ISO date, not separate month/year)
  const periodDate = item.period ? new Date(item.period) : null;
  const month = item.month ?? (periodDate ? periodDate.getUTCMonth() + 1 : undefined);
  const year = item.year ?? (periodDate ? periodDate.getUTCFullYear() : undefined);
  const periodLabel = `${month ? tMonths(String(month)) : '—'} ${year || ''}`.trim();

  const total = Number(item.totalAmount || item.total || item.subtotal || 0);
  const isPaid = item.status === LiquidacionStatus.Pagada;
  const isVoided = item.status === LiquidacionStatus.Anulada;
  const isOverdue = item.status === LiquidacionStatus.Vencida;
  const isPending = item.status === LiquidacionStatus.Borrador || item.status === LiquidacionStatus.Revision;
  const paymentsCount = item._count?.payments ?? 0;

  const propertyText = item.contract?.property
    ? [item.contract.property.title, item.contract.property.street, item.contract.property.city].filter(Boolean).join(' — ')
    : tCard('noProperty');

  const href = `${localePrefix}/liquidaciones/${item.id}`;

  const metaItems: Array<{ icon?: IconName; label: string }> = [{ icon: 'mapPin', label: propertyText }];
  if (item.dueDate) {
    metaItems.push({ icon: 'calendarClock', label: t('card.dueDate', { date: formatDate(item.dueDate) }) });
  }

  /* One blocker at a time, so the grid doubles as a worklist. */
  const alert = isOverdue
    ? {
        tone: 'danger' as const,
        icon: 'alert' as const,
        text: item.dueDate ? tCard('overdueAlert', { date: formatDate(item.dueDate) }) : t('statuses.Vencida'),
      }
    : isPending
      ? { tone: 'warning' as const, icon: 'clock' as const, text: tCard('pendingApproval') }
      : !item.pdfUrl && !isVoided
        ? { tone: 'warning' as const, icon: 'alert' as const, text: tCard('missingPdf') }
        : null;

  return (
    <EntityCard
      href={href}
      label={periodLabel}
      accent={STATUS_ACCENT[item.status] || 'none'}
      className={cn(selected && 'ring-2 ring-[var(--color-brand-500)]')}
    >
      <EntityCard.Cover
        seed={item.id}
        icon="liquidaciones"
        band
        alt={periodLabel}
        topLeft={
          bulkMode && (
            <label className="relative z-[2] flex h-6 w-6 items-center justify-center rounded-md bg-black/45 backdrop-blur-md">
              <input
                type="checkbox"
                checked={selected}
                onChange={onToggle}
                aria-label={tCard('selectOne')}
                className="h-4 w-4 rounded border-white/60 text-brand-500 focus:ring-2 focus:ring-brand-400/50"
              />
            </label>
          )
        }
        topRight={
          <Badge variant={STATUS_VARIANT[item.status] || 'neutral'} dot onCover className={isVoided ? 'line-through' : undefined}>
            {t(`statuses.${item.status}`)}
          </Badge>
        }
        bottomLeft={
          <h3 className={cn('text-sm font-semibold leading-snug text-white drop-shadow-sm', isVoided && 'line-through')}>
            {periodLabel}
          </h3>
        }
        bottomRight={
          paymentsCount > 0 && (
            <Badge onCover>
              <Icon name="check" className="h-3 w-3" strokeWidth={2} />
              {paymentsCount}
            </Badge>
          )
        }
      />

      <EntityCard.Body>
        <EntityCard.Amount
          value={formatCurrency(total)}
          hint={tCard('totalAmount')}
          tone={isVoided ? 'muted' : isPaid ? 'success' : 'default'}
        />

        <EntityCard.Meta items={metaItems} />

        {alert && (
          <EntityCard.Alert tone={alert.tone} icon={alert.icon}>
            {alert.text}
          </EntityCard.Alert>
        )}
      </EntityCard.Body>

      <EntityCard.Footer className="justify-end">
        <EntityCard.Actions>
          <EntityCard.Action href={href} icon="arrowRight" variant="ghost">
            {tCard('view')}
          </EntityCard.Action>
        </EntityCard.Actions>
      </EntityCard.Footer>
    </EntityCard>
  );
}

/* ──────────── Generate Modal ──────────── */

interface GenerateModalProps {
  onClose: () => void;
  onGenerate: (month: number, year: number) => Promise<void>;
}

function GenerateModal({ onClose, onGenerate }: GenerateModalProps) {
  const t = useTranslations('liquidaciones.generate');
  const tMonths = useTranslations('liquidaciones.months');
  const tCommon = useTranslations('common');
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      await onGenerate(parseInt(month), parseInt(year));
    } finally {
      setSubmitting(false);
    }
  }

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={onClose} />
      <div className="relative bg-white rounded-2xl shadow-xl w-full max-w-sm p-6 animate-zoom-in">
        <h3 className="text-lg font-semibold text-slate-900 mb-1">{t('title')}</h3>
        <p className="text-sm text-slate-500 mb-4">{t('description')}</p>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('month')}</label>
            <select
              value={month}
              onChange={(e) => setMonth(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              required
            >
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>{tMonths(String(i + 1))}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">{t('year')}</label>
            <select
              value={year}
              onChange={(e) => setYear(e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
              required
            >
              {years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>
          <div className="flex gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-medium text-slate-700 hover:bg-slate-50 transition-colors"
            >
              {tCommon('cancel')}
            </button>
            <button
              type="submit"
              disabled={submitting}
              className="flex-1 px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 transition-colors disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {submitting && <Spinner className="w-4 h-4 text-white" />}
              {t('submit')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ──────────── Main Component ──────────── */

export function LiquidacionList() {
  const t = useTranslations('liquidaciones');
  const tFilters = useTranslations('liquidaciones.filters');
  const tPagination = useTranslations('liquidaciones.pagination');
  const tBulk = useTranslations('liquidaciones.bulk');
  const tMonths = useTranslations('liquidaciones.months');
  const tErrors = useTranslations('liquidaciones.errors');
  const tCommon = useTranslations('common');
  const { user } = useAuth();
  const pathname = usePathname();
  const localePrefix = pathname.match(/^\/(?:[a-z]{2}-[A-Z]{2}|[a-z]{2})/)?.[0] || '/es';

  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [showGenerate, setShowGenerate] = useState(false);
  const [bulkLoading, setBulkLoading] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const canGenerate = ['Admin', 'Gerente'].includes(user?.role || '');
  const canBulkAct = ['Admin', 'Gerente'].includes(user?.role || '');
  const isReadOnly = user?.role === 'Lectura';

  const fetchData = useCallback(async (f: Filters) => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      params.set('page', String(f.page));
      params.set('limit', String(LIMIT));
      if (f.status) params.set('status', f.status);
      if (f.month) params.set('month', f.month);
      if (f.year) params.set('year', f.year);

      const res = await apiClient<PaginatedResponse>(`/liquidaciones?${params.toString()}`);
      setData(res);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        console.error(`[LiquidacionList] fetch error: ${err.statusCode} ${err.errorCode}`);
      }
      setData({ items: [], total: 0, page: 1, limit: LIMIT, totalPages: 0 });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData(filters);
  }, [filters, fetchData]);

  function updateFilter(key: keyof Filters, value: string | number) {
    setSelectedIds(new Set());
    setFilters((prev) => ({ ...prev, [key]: value, page: key === 'page' ? (value as number) : 1 }));
  }

  function clearFilters() {
    setSelectedIds(new Set());
    setFilters(INITIAL_FILTERS);
  }

  function toggleSelected(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleSelectAll() {
    if (!data) return;
    if (selectedIds.size === data.items.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(data.items.map((i) => i.id)));
    }
  }

  async function handleGenerate(month: number, year: number) {
    setFeedback(null);
    try {
      const res = await apiClient<{ created: number; skipped: number }>('/liquidaciones/generate', {
        method: 'POST',
        body: JSON.stringify({ month, year }),
      });
      setShowGenerate(false);
      setFeedback({ type: 'success', msg: t('generatedCount', { count: res.created ?? 0 }) });
      fetchData(filters);
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof ApiRequestError ? err.message : tErrors('generateFailed') });
    }
  }

  async function handleBulkAction(action: 'approve' | 'send') {
    if (selectedIds.size === 0) return;
    const ids = Array.from(selectedIds);
    setBulkLoading(action);
    setFeedback(null);
    try {
      const endpoint = action === 'approve' ? '/liquidaciones/bulk-approve' : '/liquidaciones/bulk-send';
      await apiClient(endpoint, {
        method: 'POST',
        body: JSON.stringify({ ids }),
      });
      setFeedback({ type: 'success', msg: action === 'approve' ? tBulk('approveSuccess') : tBulk('sendSuccess') });
      setSelectedIds(new Set());
      fetchData(filters);
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof ApiRequestError ? err.message : tBulk(`${action}Error`) });
    } finally {
      setBulkLoading('');
    }
  }

  const hasFilters = filters.status || filters.month || filters.year;
  const items = data?.items || [];
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 0;
  const bulkMode = selectedIds.size > 0;
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 5 }, (_, i) => currentYear - 1 + i);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-slate-900 tracking-tight">{t('title')}</h1>
          <p className="text-sm text-slate-500 mt-0.5">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          {canGenerate && !isReadOnly && (
            <button
              onClick={() => setShowGenerate(true)}
              className="w-full sm:w-auto px-4 py-2.5 rounded-lg bg-brand-500 text-white text-sm font-medium hover:bg-brand-600 active:bg-brand-700 transition-colors shadow-sm flex items-center justify-center gap-2"
            >
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M6.75 3v2.25M17.25 3v2.25M3 18.75V7.5a2.25 2.25 0 0 1 2.25-2.25h13.5A2.25 2.25 0 0 1 21 7.5v11.25m-18 0A2.25 2.25 0 0 0 5.25 21h13.5A2.25 2.25 0 0 0 21 18.75m-18 0v-7.5A2.25 2.25 0 0 1 5.25 9h13.5A2.25 2.25 0 0 1 21 11.25v7.5" />
              </svg>
              {t('generateMonth')}
            </button>
          )}
        </div>
      </div>

      {/* Feedback */}
      {feedback && (
        <div className={`rounded-lg px-4 py-3 border ${feedback.type === 'success' ? 'bg-emerald-50 border-emerald-200' : 'bg-red-50 border-red-200'}`}>
          <p className={`text-sm ${feedback.type === 'success' ? 'text-emerald-700' : 'text-red-700'}`}>{feedback.msg}</p>
        </div>
      )}

      {/* Filters */}
      <div className="bg-white rounded-xl border border-slate-200 p-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
          {/* Status */}
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
              {Object.values(LiquidacionStatus).map((s) => (
                <option key={s} value={s}>{t(`statuses.${s}`)}</option>
              ))}
            </select>
          </div>

          {/* Month */}
          <div>
            <label htmlFor="filter-month" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('month')}
            </label>
            <select
              id="filter-month"
              value={filters.month}
              onChange={(e) => updateFilter('month', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tFilters('monthPlaceholder')}</option>
              {Array.from({ length: 12 }, (_, i) => (
                <option key={i + 1} value={String(i + 1)}>{tMonths(String(i + 1))}</option>
              ))}
            </select>
          </div>

          {/* Year */}
          <div>
            <label htmlFor="filter-year" className="block text-xs font-medium text-slate-500 mb-1">
              {tFilters('year')}
            </label>
            <select
              id="filter-year"
              value={filters.year}
              onChange={(e) => updateFilter('year', e.target.value)}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-brand-500/30 focus:border-brand-500"
            >
              <option value="">{tFilters('yearPlaceholder')}</option>
              {years.map((y) => (
                <option key={y} value={String(y)}>{y}</option>
              ))}
            </select>
          </div>

          {/* Clear */}
          <div className="flex items-end">
            {hasFilters && (
              <button
                onClick={clearFilters}
                className="px-3 py-2 rounded-lg border border-slate-200 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-50 transition-colors whitespace-nowrap"
              >
                {tFilters('clear')}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Bulk select all toggle */}
      {!loading && items.length > 0 && canBulkAct && (
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
            <input
              type="checkbox"
              checked={items.length > 0 && selectedIds.size === items.length}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-slate-300 text-brand-500 focus:ring-brand-500/30"
            />
            {tBulk('selectAll')}
          </label>
          {selectedIds.size > 0 && (
            <span className="text-xs text-brand-600 font-medium">{tBulk('selected', { count: selectedIds.size })}</span>
          )}
        </div>
      )}

      {/* Grid — owns the loading → content → empty transition */}
      <div>
        <CardGrid
          items={items}
          loading={loading && !data}
          busy={loading && !!data}
          columns={3}
          skeletonCount={6}
          keyOf={(item) => item.id}
          renderItem={(item) => (
            <LiquidacionCard
              item={item}
              localePrefix={localePrefix}
              selected={selectedIds.has(item.id)}
              onToggle={() => toggleSelected(item.id)}
              bulkMode={bulkMode}
            />
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
                iconName="liquidaciones"
                title={t('empty.title')}
                subtitle={t('empty.description')}
                steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
                action={
                  canGenerate && (
                    <button
                      onClick={() => setShowGenerate(true)}
                      className="inline-flex items-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-4 py-2.5 text-sm font-medium text-white shadow-sm transition-colors hover:bg-[var(--color-brand-600)]"
                    >
                      <Icon name="plus" className="h-4 w-4" strokeWidth={2.25} />
                      {t('generateMonth')}
                    </button>
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

      {/* Bulk action sticky bar */}
      {bulkMode && canBulkAct && (
        <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-lg sm:px-6">
          <div className="mx-auto flex max-w-7xl flex-col items-center justify-between gap-3 sm:flex-row">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {tBulk('selected', { count: selectedIds.size })}
            </span>
            <div className="flex w-full gap-2 sm:w-auto">
              <button
                onClick={() => setSelectedIds(new Set())}
                className="flex-1 rounded-[var(--radius-lg)] border border-[var(--color-border)] px-4 py-2 text-sm font-medium text-[var(--color-muted)] transition-colors hover:bg-[var(--color-bg)] sm:flex-none"
              >
                {tBulk('deselectAll')}
              </button>
              <button
                onClick={() => handleBulkAction('approve')}
                disabled={!!bulkLoading}
                className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-success)] px-4 py-2 text-sm font-medium text-white transition-colors hover:opacity-90 disabled:opacity-50 sm:flex-none"
              >
                {bulkLoading === 'approve' && <Spinner className="w-3 h-3 text-white" />}
                {tBulk('approveSelected')}
              </button>
              <button
                onClick={() => handleBulkAction('send')}
                disabled={!!bulkLoading}
                className="flex flex-1 items-center justify-center gap-2 rounded-[var(--radius-lg)] bg-[var(--color-brand-500)] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[var(--color-brand-600)] disabled:opacity-50 sm:flex-none"
              >
                {bulkLoading === 'send' && <Spinner className="w-3 h-3 text-white" />}
                {tBulk('sendSelected')}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Spacing for sticky bar */}
      {bulkMode && canBulkAct && <div className="h-20" />}

      {/* Generate modal */}
      {showGenerate && (
        <GenerateModal onClose={() => setShowGenerate(false)} onGenerate={handleGenerate} />
      )}
    </div>
  );
}
