'use client';

import { useTranslations } from 'next-intl';
import { LiquidacionStatus } from '@realfy/shared';
import { useState, useEffect, useCallback, useMemo } from 'react';
import { Spinner } from '@/components/ui/spinner';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { Icon } from '@/components/ui/icon';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { downloadFile } from '@/lib/download';
import { toast } from '@/lib/toast';
import { cn } from '@/lib/cn';
import { useCan } from '@/lib/permissions';
import { LedgerMonth, LedgerSkeleton, attentionOf, groupByPeriod, type LedgerItem } from './liquidacion-ledger';

/* ──────────── Types ──────────── */

interface PaginatedResponse {
  items: LedgerItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

interface ContractParties {
  id: string;
  persons?: { role: string; person?: { firstName?: string; lastName?: string } | null }[];
}

interface Filters {
  status: string;
  month: string;
  year: string;
  page: number;
}

const INITIAL_FILTERS: Filters = { status: '', month: '', year: '', page: 1 };
/* El libro agrupa por mes: se pide el máximo que acepta la API para que los meses lleguen enteros. */
const LIMIT = 100;
/* Los contratos llegan de a 100: tope de páginas para buscar el nombre de los inquilinos. */
const MAX_CONTRACT_PAGES = 5;

const SELECT_CLASS =
  'h-9 rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3 text-sm text-[var(--color-text)] focus:border-[var(--color-brand-500)] focus:outline-none focus:ring-2 focus:ring-[color-mix(in_oklab,var(--color-brand-500)_30%,transparent)]';

function Feedback({ type, children }: { type: 'success' | 'error'; children: React.ReactNode }) {
  const tone = type === 'success' ? 'success' : 'danger';
  return (
    <p
      role={type === 'error' ? 'alert' : 'status'}
      className="rounded-[var(--radius-lg)] border px-4 py-3 text-sm"
      style={{
        borderColor: `color-mix(in oklab, var(--color-${tone}) 28%, var(--color-border))`,
        backgroundColor: `color-mix(in oklab, var(--color-${tone}) 9%, var(--color-surface))`,
        color: `color-mix(in oklab, var(--color-${tone}) 72%, var(--color-text))`,
      }}
    >
      {children}
    </p>
  );
}

/* ──────────── Generate dialog ──────────── */

interface GenerateDialogProps {
  onClose: () => void;
  /** Devuelve el mensaje de error, o null si generó. */
  onGenerate: (month: number, year: number) => Promise<string | null>;
}

function GenerateDialog({ onClose, onGenerate }: GenerateDialogProps) {
  const t = useTranslations('liquidaciones.generate');
  const tMonths = useTranslations('liquidaciones.months');
  const tCommon = useTranslations('common');
  const now = new Date();
  const [month, setMonth] = useState(String(now.getMonth() + 1));
  const [year, setYear] = useState(String(now.getFullYear()));
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      setError(await onGenerate(parseInt(month), parseInt(year)));
    } finally {
      setSubmitting(false);
    }
  }

  const years = Array.from({ length: 5 }, (_, i) => now.getFullYear() - 1 + i);

  return (
    <Dialog open onClose={onClose} size="sm" busy={submitting}>
      <form onSubmit={handleSubmit}>
        <DialogHeader>
          <h3 className="text-base font-semibold text-[var(--color-text)]">{t('title')}</h3>
        </DialogHeader>
        <DialogBody className="space-y-4">
          <p className="text-sm text-[var(--color-muted)]">{t('description')}</p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block text-xs font-medium text-[var(--color-muted)]">
              {t('month')}
              <select value={month} onChange={(e) => setMonth(e.target.value)} className={cn(SELECT_CLASS, 'mt-1 w-full')} required>
                {Array.from({ length: 12 }, (_, i) => (
                  <option key={i + 1} value={String(i + 1)}>{tMonths(String(i + 1))}</option>
                ))}
              </select>
            </label>
            <label className="block text-xs font-medium text-[var(--color-muted)]">
              {t('year')}
              <select value={year} onChange={(e) => setYear(e.target.value)} className={cn(SELECT_CLASS, 'mt-1 w-full')} required>
                {years.map((y) => (
                  <option key={y} value={String(y)}>{y}</option>
                ))}
              </select>
            </label>
          </div>
          {error && <Feedback type="error">{error}</Feedback>}
        </DialogBody>
        <DialogFooter>
          <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={submitting}>
            {tCommon('cancel')}
          </Button>
          <Button type="submit" size="sm" disabled={submitting}>
            {submitting && <Spinner className="h-4 w-4 text-white" />}
            {t('submit')}
          </Button>
        </DialogFooter>
      </form>
    </Dialog>
  );
}

/* ──────────── Main Component ──────────── */

export function LiquidacionList() {
  const t = useTranslations('liquidaciones');
  const tFilters = useTranslations('liquidaciones.filters');
  const tLedger = useTranslations('liquidaciones.ledger');
  const tPagination = useTranslations('liquidaciones.pagination');
  const tBulk = useTranslations('liquidaciones.bulk');
  const tMonths = useTranslations('liquidaciones.months');
  const tErrors = useTranslations('liquidaciones.errors');
  const tCommon = useTranslations('common');

  const [data, setData] = useState<PaginatedResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [filters, setFilters] = useState<Filters>(INITIAL_FILTERS);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [tenantNames, setTenantNames] = useState<Record<string, string>>({});
  const [showGenerate, setShowGenerate] = useState(false);
  const [bulkLoading, setBulkLoading] = useState('');
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);

  const canGenerate = useCan('liquidaciones.generate');
  const canBulkAct = useCan('liquidaciones.bulk');
  const isReadOnly = useCan('liquidaciones.readOnlyNotice');

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
      setLoadFailed(false);
    } catch (err) {
      if (err instanceof ApiRequestError) {
        console.error(`[LiquidacionList] fetch error: ${err.statusCode} ${err.errorCode}`);
      }
      setData(null);
      setLoadFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData(filters);
  }, [filters, fetchData]);

  /* El listado de liquidaciones no trae al inquilino: sale de los contratos. Si falla, la fila muestra solo la propiedad. */
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const names: Record<string, string> = {};
        for (let page = 1; page <= MAX_CONTRACT_PAGES; page++) {
          const res = await apiClient<{ items?: ContractParties[]; totalPages?: number }>(`/contracts?page=${page}&limit=100`);
          if (cancelled) return;
          for (const contract of res.items ?? []) {
            const tenants = (contract.persons ?? [])
              .filter((p) => p.role === 'Inquilino' && p.person)
              .map((p) => `${p.person?.firstName ?? ''} ${p.person?.lastName ?? ''}`.trim())
              .filter(Boolean);
            if (tenants.length > 0) names[contract.id] = tenants.join(', ');
          }
          setTenantNames({ ...names });
          if (page >= (res.totalPages ?? 1)) break;
        }
      } catch {
        /* sin nombres de inquilinos */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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

  function toggleMany(ids: string[], select: boolean) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (select) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  async function handleGenerate(month: number, year: number) {
    setFeedback(null);
    try {
      const res = await apiClient<{
        created: number;
        skipped: number;
        outOfRange?: number;
        adjustmentPending?: number;
        withWarnings?: number;
      }>('/liquidaciones/generate', {
        method: 'POST',
        body: JSON.stringify({ month, year }),
      });
      setShowGenerate(false);
      const parts = [t('generatedCount', { count: res.created ?? 0 })];
      if (res.skipped) parts.push(t('skippedCount', { count: res.skipped }));
      if (res.outOfRange) parts.push(t('outOfRangeCount', { count: res.outOfRange }));
      if (res.adjustmentPending) parts.push(t('adjustmentPendingCount', { count: res.adjustmentPending }));
      if (res.withWarnings) parts.push(t('withWarningsCount', { count: res.withWarnings }));
      setFeedback({ type: 'success', msg: parts.join(' · ') });
      void fetchData(filters);
      return null;
    } catch (err) {
      return err instanceof ApiRequestError ? err.message : tErrors('generateFailed');
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
      void fetchData(filters);
    } catch (err) {
      setFeedback({ type: 'error', msg: err instanceof ApiRequestError ? err.message : tBulk(`${action}Error`) });
    } finally {
      setBulkLoading('');
    }
  }

  function handleDownload(id: string) {
    downloadFile(`/liquidaciones/${id}/pdf`, `liquidacion-${id}.pdf`).catch(() =>
      toast.error(tCommon('downloadFailed')),
    );
  }

  const hasFilters = Boolean(filters.status || filters.month || filters.year);
  const items = useMemo(() => data?.items ?? [], [data]);
  const groups = useMemo(() => groupByPeriod(items), [items]);
  const total = data?.total || 0;
  const totalPages = data?.totalPages || 0;
  const bulkMode = selectedIds.size > 0;
  const currentYear = new Date().getFullYear();
  const years = Array.from({ length: 4 }, (_, i) => currentYear - 2 + i);

  const overdueCount = items.filter((item) => attentionOf(item) === 'overdue').length;
  const approvalItems = items.filter((item) => attentionOf(item) === 'approval');
  const approvalStatus = approvalItems.some((item) => item.status === LiquidacionStatus.Borrador)
    ? LiquidacionStatus.Borrador
    : LiquidacionStatus.Revision;
  const showAttention = !filters.status && (overdueCount > 0 || approvalItems.length > 0);

  const generateButton = canGenerate && !isReadOnly && (
    <Button onClick={() => setShowGenerate(true)} className="w-full sm:w-auto">
      <Icon name="calendar" className="h-4 w-4" strokeWidth={2} />
      {t('generateMonth')}
    </Button>
  );

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-0.5 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        {generateButton}
      </div>

      {feedback && <Feedback type={feedback.type}>{feedback.msg}</Feedback>}

      {/* Filtros y atajos a lo que hay que atender */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label={tFilters('status')}
            value={filters.status}
            onChange={(e) => updateFilter('status', e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{tFilters('statusPlaceholder')}</option>
            {Object.values(LiquidacionStatus).map((s) => (
              <option key={s} value={s}>{t(`statuses.${s}`)}</option>
            ))}
          </select>
          <select
            aria-label={tFilters('month')}
            value={filters.month}
            onChange={(e) => updateFilter('month', e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{tFilters('monthPlaceholder')}</option>
            {Array.from({ length: 12 }, (_, i) => (
              <option key={i + 1} value={String(i + 1)}>{tMonths(String(i + 1))}</option>
            ))}
          </select>
          <select
            aria-label={tFilters('year')}
            value={filters.year}
            onChange={(e) => updateFilter('year', e.target.value)}
            className={SELECT_CLASS}
          >
            <option value="">{tFilters('yearPlaceholder')}</option>
            {years.map((y) => (
              <option key={y} value={String(y)}>{y}</option>
            ))}
          </select>
          {hasFilters && (
            <button
              type="button"
              onClick={clearFilters}
              className="h-9 rounded-[var(--radius-lg)] px-2.5 text-sm text-[var(--color-muted)] underline-offset-2 hover:text-[var(--color-text)] hover:underline"
            >
              {tFilters('clear')}
            </button>
          )}
        </div>

        {showAttention && (
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span className="text-[var(--color-muted)]">{tLedger('attention')}</span>
            {overdueCount > 0 && (
              <button
                type="button"
                onClick={() => updateFilter('status', LiquidacionStatus.Vencida)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors hover:brightness-95"
                style={{
                  borderColor: 'color-mix(in oklab, var(--color-danger) 35%, var(--color-border))',
                  backgroundColor: 'color-mix(in oklab, var(--color-danger) 10%, var(--color-surface))',
                  color: 'color-mix(in oklab, var(--color-danger) 78%, var(--color-text))',
                }}
              >
                <Icon name="alert" className="h-3.5 w-3.5" strokeWidth={2} />
                {tLedger('attentionOverdue', { count: overdueCount })}
              </button>
            )}
            {approvalItems.length > 0 && (
              <button
                type="button"
                onClick={() => updateFilter('status', approvalStatus)}
                className="inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-medium transition-colors hover:brightness-95"
                style={{
                  borderColor: 'color-mix(in oklab, var(--color-warning) 38%, var(--color-border))',
                  backgroundColor: 'color-mix(in oklab, var(--color-warning) 12%, var(--color-surface))',
                  color: 'color-mix(in oklab, var(--color-warning) 72%, var(--color-text))',
                }}
              >
                <Icon name="clock" className="h-3.5 w-3.5" strokeWidth={2} />
                {tLedger('attentionApproval', { count: approvalItems.length })}
              </button>
            )}
          </div>
        )}
      </div>

      {/* Libro por período */}
      {loading && !data && !loadFailed ? (
        <LedgerSkeleton />
      ) : loadFailed ? (
        <EmptyState
          iconName="alert"
          title={tErrors('loadFailed')}
          subtitle={tLedger('loadFailedHint')}
          action={
            <Button variant="secondary" size="sm" onClick={() => void fetchData(filters)} disabled={loading}>
              {loading && <Spinner className="h-4 w-4" />}
              {tLedger('retry')}
            </Button>
          }
        />
      ) : groups.length === 0 ? (
        hasFilters ? (
          <EmptyState
            variant="filtered"
            iconName="search"
            title={tCommon('noResults')}
            subtitle={t('empty.filtered')}
            action={
              <Button variant="secondary" size="sm" onClick={clearFilters}>
                {tFilters('clear')}
              </Button>
            }
          />
        ) : (
          <EmptyState
            iconName="liquidaciones"
            title={t('empty.title')}
            subtitle={t('empty.description')}
            steps={[t('empty.step1'), t('empty.step2'), t('empty.step3')]}
            action={generateButton || undefined}
          />
        )
      ) : (
        <div className={cn('space-y-5 transition-opacity', loading && 'opacity-60')} aria-busy={loading || undefined}>
          {groups.map((group) => (
            <LedgerMonth
              key={group.key}
              group={group}
              tenantNames={tenantNames}
              selectable={canBulkAct}
              selectedIds={selectedIds}
              onToggle={toggleSelected}
              onToggleMany={toggleMany}
              onDownload={handleDownload}
            />
          ))}
        </div>
      )}

      {/* Pagination */}
      {!loading && totalPages > 1 && (
        <div className="space-y-2 pt-1">
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <p className="text-sm text-[var(--color-muted)]">
              {tPagination('showing', {
                from: (filters.page - 1) * LIMIT + 1,
                to: Math.min(filters.page * LIMIT, total),
                total,
              })}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="secondary" size="sm" onClick={() => updateFilter('page', filters.page - 1)} disabled={filters.page <= 1}>
                {tPagination('prev')}
              </Button>
              <span className="px-2 text-sm tabular-nums text-[var(--color-muted)]">
                {tCommon('page')} {filters.page} {tCommon('of')} {totalPages}
              </span>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => updateFilter('page', filters.page + 1)}
                disabled={filters.page >= totalPages}
              >
                {tPagination('next')}
              </Button>
            </div>
          </div>
          <p className="text-xs text-[var(--color-muted)]">{tLedger('pageTotalsHint')}</p>
        </div>
      )}

      {/* Acciones sobre la selección */}
      {bulkMode && canBulkAct && (
        <div className="sticky bottom-4 z-30 rounded-[var(--radius-xl)] border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3 shadow-lg">
          <div className="flex flex-col items-center justify-between gap-3 sm:flex-row">
            <span className="text-sm font-medium text-[var(--color-text)]">
              {tBulk('selected', { count: selectedIds.size })}
            </span>
            <div className="flex w-full flex-wrap gap-2 sm:w-auto">
              <Button variant="ghost" size="sm" className="flex-1 sm:flex-none" onClick={() => setSelectedIds(new Set())}>
                {tBulk('deselectAll')}
              </Button>
              <Button
                variant="accent"
                size="sm"
                className="flex-1 sm:flex-none"
                onClick={() => void handleBulkAction('approve')}
                disabled={!!bulkLoading}
              >
                {bulkLoading === 'approve' && <Spinner className="h-3 w-3 text-white" />}
                {tBulk('approveSelected')}
              </Button>
              <Button
                size="sm"
                className="flex-1 sm:flex-none"
                onClick={() => void handleBulkAction('send')}
                disabled={!!bulkLoading}
              >
                {bulkLoading === 'send' && <Spinner className="h-3 w-3 text-white" />}
                {tBulk('sendSelected')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {showGenerate && <GenerateDialog onClose={() => setShowGenerate(false)} onGenerate={handleGenerate} />}
    </div>
  );
}
