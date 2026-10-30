'use client';

import { useCallback, useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { IndexType } from '@realfy/shared';
import { useAuth } from '@/lib/auth-context';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { StatTile, StatTileSkeleton } from '@/components/ui/stat-tile';
import { ResponsiveTable, type Column } from '@/components/ui/responsive-table';
import { Dialog, DialogBody, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { motion, useReducedMotion } from '@/components/ui/motion';
import { cn } from '@/lib/cn';
import {
  INDEX_TYPES,
  formatPeriod,
  formatValue,
  granularityOf,
  isPercent,
  originOf,
  toInputPeriod,
  type IndexDataPage,
  type IndexDataRow,
  type LatestEntry,
  type RowOrigin,
} from '@/lib/index-values';
import { IndexValueDialog, type IndexValueDraft } from './index-value-dialog';
import { BulkPasteDialog } from './bulk-paste-dialog';

const PAGE_SIZE = 24;
const DAY_MS = 86_400_000;

const ORIGIN_VARIANT: Record<RowOrigin, 'brand' | 'info' | 'neutral' | 'success'> = {
  manual: 'brand',
  indec: 'success',
  bcra: 'info',
  system: 'neutral',
};

/**
 * Un índice está atrasado cuando su último valor es más viejo de lo que su
 * publicación justifica: el IPC sale con un mes y medio de rezago, así que un
 * mensual sin el mes de hace dos meses ya está atrasado; un diario, a la
 * semana.
 */
function isStale(row: IndexDataRow, now = new Date()): boolean {
  const period = new Date(row.period);
  if (granularityOf(row.indexType) === 'day') {
    return now.getTime() - period.getTime() > 7 * DAY_MS;
  }
  const expected = Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 2, 1);
  return period.getTime() < expected;
}

/** Pantalla de índices: últimos valores, historial y carga manual. */
export function IndexDataSettings() {
  const t = useTranslations('indexData');
  const tCommon = useTranslations('common');
  const locale = useLocale();
  const reduceMotion = useReducedMotion();
  const { user } = useAuth();

  const isAdmin = user?.role === 'Admin';
  const canView = isAdmin || user?.role === 'Gerente';

  const [latest, setLatest] = useState<LatestEntry[] | null>(null);
  const [latestError, setLatestError] = useState('');
  const [selected, setSelected] = useState<IndexType>(IndexType.IPC);
  const [page, setPage] = useState(1);
  const [history, setHistory] = useState<IndexDataPage | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [draft, setDraft] = useState<IndexValueDraft | null>(null);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [toDelete, setToDelete] = useState<IndexDataRow | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const loadLatest = useCallback(async () => {
    try {
      const data = await apiClient<LatestEntry[]>('/index-data/latest');
      setLatest(data);
      setLatestError('');
    } catch (err) {
      setLatestError(err instanceof ApiRequestError ? err.message : t('loadError'));
      setLatest((prev) => prev ?? []);
    }
  }, [t]);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const params = new URLSearchParams({
        indexType: selected,
        page: String(page),
        limit: String(PAGE_SIZE),
      });
      setHistory(await apiClient<IndexDataPage>(`/index-data?${params.toString()}`));
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('loadError'));
      setHistory({ items: [], total: 0, page, limit: PAGE_SIZE, totalPages: 0 });
    } finally {
      setHistoryLoading(false);
    }
  }, [selected, page, t]);

  useEffect(() => {
    if (canView) loadLatest();
  }, [canView, loadLatest]);

  useEffect(() => {
    if (canView) loadHistory();
  }, [canView, loadHistory]);

  function selectType(type: IndexType) {
    if (type === selected) return;
    setSelected(type);
    setPage(1);
    setHistory(null);
  }

  function afterSave(type: IndexType) {
    setDraft(null);
    setBulkOpen(false);
    loadLatest();
    if (type === selected) loadHistory();
    else selectType(type);
  }

  async function handleRefresh() {
    setRefreshing(true);
    try {
      const res = await apiClient<{ total: number }>('/index-data/refresh', { method: 'POST' });
      toast.success(t('refreshCount', { count: res.total }));
      await Promise.all([loadLatest(), loadHistory()]);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('refreshError'));
    } finally {
      setRefreshing(false);
    }
  }

  async function handleDelete() {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await apiClient(`/index-data/${toDelete.id}`, { method: 'DELETE' });
      toast.success(t('delete.success'));
      setToDelete(null);
      await Promise.all([loadLatest(), loadHistory()]);
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('delete.error'));
    } finally {
      setDeleting(false);
    }
  }

  function openEdit(row: IndexDataRow) {
    setDraft({
      indexType: row.indexType,
      period: toInputPeriod(row.period, row.indexType),
      value: String(Number(row.value)),
      editing: true,
    });
  }

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const latestByType = new Map((latest ?? []).map((entry) => [entry.indexType, entry]));

  const columns: Column<IndexDataRow>[] = [
    {
      key: 'period',
      header: t('period'),
      render: (row) => (
        <span className="capitalize">{formatPeriod(row.period, row.indexType, locale)}</span>
      ),
    },
    {
      key: 'value',
      header: isPercent(selected) ? t('valuePercent') : t('value'),
      alignRight: true,
      render: (row) => (
        <span className="font-medium tabular-nums">
          {formatValue(row.value, row.indexType, locale)}
          {isPercent(row.indexType) && ' %'}
        </span>
      ),
    },
    {
      key: 'origin',
      header: t('source'),
      render: (row) => {
        const origin = originOf(row);
        return (
          <Badge variant={ORIGIN_VARIANT[origin]} dot>
            {t(`origin.${origin}`)}
          </Badge>
        );
      },
    },
  ];

  if (isAdmin) {
    columns.push({
      key: 'actions',
      header: tCommon('actions'),
      alignRight: true,
      render: (row) => (
        <div className="flex justify-end gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => openEdit(row)}
            aria-label={t('editValue')}
            title={t('editValue')}
          >
            <Icon name="edit" className="h-4 w-4" />
          </Button>
          {originOf(row) === 'manual' && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => setToDelete(row)}
              aria-label={t('delete.title')}
              title={t('delete.title')}
            >
              <Icon name="trash" className="h-4 w-4" />
            </Button>
          )}
        </div>
      ),
    });
  }

  const items = history?.items ?? [];
  const totalPages = history?.totalPages ?? 0;

  return (
    <div className="max-w-5xl space-y-8">
      {/* Encabezado */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        {isAdmin && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={handleRefresh} disabled={refreshing}>
              {refreshing ? <Spinner className="h-4 w-4" /> : <Icon name="refresh" className="h-4 w-4" />}
              {refreshing ? t('refreshing') : t('refreshNow')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setBulkOpen(true)}>
              <Icon name="text" className="h-4 w-4" />
              {t('bulkPaste')}
            </Button>
            <Button
              size="sm"
              onClick={() =>
                setDraft({ indexType: selected, period: '', value: '', editing: false })
              }
            >
              <Icon name="plus" className="h-4 w-4" />
              {t('addValue')}
            </Button>
          </div>
        )}
      </div>

      {/* Últimos valores */}
      <section className="space-y-3" aria-labelledby="latest-title">
        <h2 id="latest-title" className="text-base font-semibold text-[var(--color-text)]">
          {t('latestTitle')}
        </h2>
        {latestError && <p className="text-sm text-[var(--color-danger)]">{latestError}</p>}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          {INDEX_TYPES.map((type) => {
            if (latest === null) return <StatTileSkeleton key={type} />;
            const entry = latestByType.get(type);
            if (!entry) {
              return (
                <StatTile
                  key={type}
                  label={`${type} · ${t(`unit.${type}`)}`}
                  value="—"
                  tone="neutral"
                  hint={t('noData')}
                />
              );
            }
            const stale = isStale(entry.latest);
            const origin = originOf(entry.latest);
            return (
              <StatTile
                key={type}
                label={`${type} · ${t(`unit.${type}`)}`}
                value={formatValue(entry.latest.value, type, locale)}
                suffix={isPercent(type) ? '%' : undefined}
                tone={stale ? 'warning' : origin === 'manual' ? 'brand' : 'success'}
                hint={`${formatPeriod(entry.latest.period, type, locale)} · ${
                  stale ? t('stale') : t(`origin.${origin}`)
                }`}
                spark={
                  granularityOf(type) === 'day' && entry.history.length > 1
                    ? entry.history.map((row) => Number(row.value))
                    : undefined
                }
              />
            );
          })}
        </div>
        {!isAdmin && <p className="text-xs text-[var(--color-muted)]">{t('readOnlyHint')}</p>}
      </section>

      {/* Historial por índice */}
      <section className="space-y-4" aria-labelledby="history-title">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="history-title" className="text-base font-semibold text-[var(--color-text)]">
            {t('historyTitle')}
          </h2>
          <div
            className="flex gap-1 overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-1"
            role="tablist"
            aria-label={t('historyTitle')}
          >
            {INDEX_TYPES.map((type) => {
              const active = type === selected;
              return (
                <button
                  key={type}
                  type="button"
                  role="tab"
                  aria-selected={active}
                  onClick={() => selectType(type)}
                  className={cn(
                    'relative rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
                    active
                      ? 'text-[var(--color-text)]'
                      : 'text-[var(--color-muted)] hover:text-[var(--color-text)]',
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="index-type-tab"
                      className="absolute inset-0 rounded-md bg-[var(--color-surface)] shadow-sm"
                      transition={reduceMotion ? { duration: 0 } : { type: 'spring', stiffness: 420, damping: 34 }}
                      aria-hidden="true"
                    />
                  )}
                  <span className="relative">{type}</span>
                </button>
              );
            })}
          </div>
        </div>

        <p className="text-xs text-[var(--color-muted)]">{t(`typeHint.${selected}`)}</p>

        <div className={cn(historyLoading && history !== null && 'pointer-events-none opacity-60 transition-opacity')}>
          <ResponsiveTable
            items={items}
            columns={columns}
            keyExtractor={(row) => row.id}
            loading={historyLoading && history === null}
            skeletonRows={6}
            empty={{
              title: t('emptyTitle'),
              subtitle: isAdmin ? t('emptyAdmin') : t('emptySubtitle'),
              iconName: 'trendingUp',
              action: isAdmin ? (
                <Button
                  size="sm"
                  onClick={() =>
                    setDraft({ indexType: selected, period: '', value: '', editing: false })
                  }
                >
                  <Icon name="plus" className="h-4 w-4" />
                  {t('addValue')}
                </Button>
              ) : undefined,
            }}
          />
        </div>

        {totalPages > 1 && (
          <div className="flex items-center justify-between text-sm text-[var(--color-muted)]">
            <span>
              {tCommon('page')} {page} {tCommon('of')} {totalPages}
            </span>
            <div className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1 || historyLoading}
                onClick={() => setPage((p) => p - 1)}
              >
                {tCommon('previous')}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= totalPages || historyLoading}
                onClick={() => setPage((p) => p + 1)}
              >
                {tCommon('next')}
              </Button>
            </div>
          </div>
        )}
      </section>

      {isAdmin && (
        <>
          <IndexValueDialog draft={draft} onClose={() => setDraft(null)} onSaved={afterSave} />
          <BulkPasteDialog
            open={bulkOpen}
            initialType={selected}
            onClose={() => setBulkOpen(false)}
            onSaved={afterSave}
          />
          <Dialog open={toDelete !== null} onClose={() => setToDelete(null)} busy={deleting}>
            <DialogHeader>
              <h2 className="text-base font-semibold text-[var(--color-text)]">{t('delete.title')}</h2>
            </DialogHeader>
            <DialogBody>
              <p className="text-sm text-[var(--color-text)]">
                {toDelete &&
                  t('delete.confirm', {
                    type: toDelete.indexType,
                    period: formatPeriod(toDelete.period, toDelete.indexType, locale),
                  })}
              </p>
            </DialogBody>
            <DialogFooter>
              <Button variant="ghost" size="sm" onClick={() => setToDelete(null)} disabled={deleting}>
                {tCommon('cancel')}
              </Button>
              <Button variant="danger" size="sm" onClick={handleDelete} disabled={deleting}>
                {deleting && <Spinner className="h-4 w-4 text-white" />}
                {tCommon('delete')}
              </Button>
            </DialogFooter>
          </Dialog>
        </>
      )}
    </div>
  );
}
