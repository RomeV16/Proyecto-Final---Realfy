'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type {
  AdjustmentApplyBatch,
  AdjustmentApplyResult,
  AdjustmentPreviewBatch,
  AdjustmentPreviewRow,
} from '@realfy/shared';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/permissions';
import { formatDate, formatMoneyFixed, formatPercent } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { Icon } from '@/components/ui/icon';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/ui/status-badge';
import { useConfirm } from '@/components/ui/confirm-dialog';

/** Mes actual de la persona, `YYYY-MM`. */
function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const KNOWN_ERRORS = ['MISSING_ADJUSTMENT_PCT', 'MISSING_ADJUSTMENT_STEPS', 'UNKNOWN_ADJUSTMENT_TYPE'];
const KNOWN_REASONS = ['MISSING_INDEX_DATA', 'NO_DUE_ADJUSTMENT', 'CONTRACT_NOT_FOUND'];

const RESULT_VARIANT = { applied: 'success', provisional: 'warning', fixed_initial: 'neutral', skipped: 'danger' } as const;

/** Ajustes del mes: previsualizar, elegir y aplicar los ajustes de alquiler de todos los contratos juntos. */
export function MonthlyAdjustments() {
  const t = useTranslations('adjustments');
  const locale = useLocale();
  const confirm = useConfirm();
  const canManage = useCan('adjustments.manage');

  const [period, setPeriod] = useState(currentMonth);
  const [rows, setRows] = useState<AdjustmentPreviewRow[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applying, setApplying] = useState(false);
  const [results, setResults] = useState<Map<string, AdjustmentApplyResult>>(new Map());

  const load = useCallback(async () => {
    setRows(null);
    setError(null);
    try {
      const data = await apiClient<AdjustmentPreviewBatch>('/adjustments/preview-batch', {
        method: 'POST',
        body: JSON.stringify({ period }),
      });
      setRows(data.rows);
      setSelected(new Set());
    } catch (err) {
      setError(err);
      setRows([]);
    }
  }, [period]);

  useEffect(() => {
    if (canManage && /^\d{4}-\d{2}$/.test(period)) {
      setResults(new Map());
      void load();
    }
  }, [canManage, period, load]);

  const selectable = useMemo(() => (rows ?? []).filter((r) => r.selectable), [rows]);
  const chosen = useMemo(() => selectable.filter((r) => selected.has(r.contractId)), [selectable, selected]);
  const chosenProvisional = chosen.filter((r) => r.isProvisional).length;
  const allSelected = selectable.length > 0 && chosen.length === selectable.length;

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(selectable.map((r) => r.contractId)));
  }

  async function apply() {
    if (chosen.length === 0) return;
    const ok = await confirm({
      title: t('apply.confirmTitle'),
      confirmLabel: t('apply.confirmLabel'),
      body: (
        <div className="space-y-2">
          <p>{t('apply.confirmBody', { count: chosen.length })}</p>
          {chosenProvisional > 0 && <p>{t('apply.confirmProvisional', { count: chosenProvisional })}</p>}
        </div>
      ),
    });
    if (!ok) return;

    setApplying(true);
    try {
      const res = await apiClient<AdjustmentApplyBatch>('/adjustments/apply-batch', {
        method: 'POST',
        body: JSON.stringify({ period, contractIds: chosen.map((r) => r.contractId) }),
      });
      setResults(new Map(res.results.map((r) => [r.contractId, r])));
      const applied = res.results.filter((r) => r.result === 'applied').length;
      const skipped = res.results.length - applied;
      toast.success(
        `${t('apply.done', { applied })}${skipped > 0 ? ` ${t('apply.doneSkipped', { skipped })}` : ''}`,
      );
      // La previsualización se vuelve a pedir: lo aplicado ya no vence y el estado de cada fila cambió.
      const data = await apiClient<AdjustmentPreviewBatch>('/adjustments/preview-batch', {
        method: 'POST',
        body: JSON.stringify({ period }),
      });
      setRows(data.rows);
      setSelected(new Set());
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('applyError'));
    } finally {
      setApplying(false);
    }
  }

  if (!canManage) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  const rowTitle = (row: AdjustmentPreviewRow) => row.propertyTitle ?? t('noTitle', { id: row.contractId.slice(0, 8) });

  const columns: DataTableColumn<AdjustmentPreviewRow>[] = [
    {
      key: 'select',
      header: t('columns.select'),
      className: 'w-10',
      render: (row) => (
        <input
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-brand-500)]"
          checked={selected.has(row.contractId)}
          disabled={!row.selectable}
          onChange={() => toggle(row.contractId)}
          aria-label={t('selectRow', { title: rowTitle(row) })}
        />
      ),
    },
    {
      key: 'contract',
      header: t('columns.contract'),
      sortable: true,
      sortValue: (row) => rowTitle(row),
      render: (row) => (
        <Link href={`/contracts/${row.contractId}`} className="font-medium hover:underline">
          {rowTitle(row)}
        </Link>
      ),
    },
    {
      key: 'date',
      header: t('columns.date'),
      sortable: true,
      sortValue: (row) => row.adjustmentDate,
      render: (row) => (
        <span className="inline-flex flex-wrap items-center gap-2">
          {formatDate(row.adjustmentDate, undefined, locale)}
          {row.overdue && <Badge variant="warning">{t('overdue')}</Badge>}
        </span>
      ),
    },
    { key: 'type', header: t('columns.type'), render: (row) => row.adjustmentType },
    {
      key: 'current',
      header: t('columns.current'),
      alignRight: true,
      render: (row) => formatMoneyFixed(row.currentRent, row.currency, locale),
    },
    {
      key: 'new',
      header: t('columns.new'),
      alignRight: true,
      render: (row) =>
        row.newRent === null ? '—' : <strong>{formatMoneyFixed(row.newRent, row.currency, locale)}</strong>,
    },
    {
      key: 'percentage',
      header: t('columns.percentage'),
      alignRight: true,
      render: (row) => (row.percentage === null ? '—' : formatPercent(row.percentage, { decimals: 2, locale })),
    },
    {
      key: 'months',
      header: t('columns.months'),
      render: (row) =>
        row.indexValues.length === 0 ? (
          t('noIndexMonths')
        ) : (
          <span className="text-xs">
            {row.indexValues
              .map((v) => (v.isEstimate ? t('estimatedMonth', { period: v.period }) : v.period))
              .join(', ')}
          </span>
        ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (row) => (
        <div className="space-y-1">
          <StatusBadge domain="ajuste" status={row.status} />
          {row.isProvisional && <p className="text-xs text-[var(--color-muted)]">{t('provisionalHint')}</p>}
          {row.missing && (
            <p className="text-xs text-[var(--color-danger)]">
              {t('missing.months', {
                indexes: row.missing.indexTypes.join(', '),
                periods: row.missing.missingPeriods.join(', ') || '—',
              })}
              {row.missing.estimatesOnly && <> {t('missing.estimatesOnly')}</>}{' '}
              <Link href="/configuracion/indices" className="font-medium underline">
                {t('missing.loadIndex')}
              </Link>
            </p>
          )}
          {row.error && (
            <p className="text-xs text-[var(--color-danger)]">
              {t(KNOWN_ERRORS.includes(row.error) ? (`errors.${row.error}` as 'errors.generic') : 'errors.generic')}
            </p>
          )}
        </div>
      ),
    },
  ];

  if (results.size > 0) {
    columns.push({
      key: 'result',
      header: t('columns.result'),
      render: (row) => {
        const result = results.get(row.contractId);
        if (!result) return '—';
        const key = result.result === 'applied' ? (result.status ?? 'applied') : 'skipped';
        return (
          <span className="space-y-1">
            <Badge variant={RESULT_VARIANT[key as keyof typeof RESULT_VARIANT] ?? 'neutral'} dot>
              {t(`result.${key}` as never)}
            </Badge>
            {result.reason && (
              <span className="block text-xs text-[var(--color-muted)]">
                {t(
                  KNOWN_REASONS.includes(result.reason)
                    ? (`result.reasons.${result.reason}` as 'result.reasons.generic')
                    : 'result.reasons.generic',
                )}
              </span>
            )}
          </span>
        );
      },
    });
  }

  return (
    <div className="max-w-7xl space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="h1">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        <div className="flex shrink-0 items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-[var(--color-muted)]">{t('month')}</span>
            <input
              type="month"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
              className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2"
            />
          </label>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={rows === null}>
            <Icon name="refresh" className="h-4 w-4" />
            {t('refresh')}
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-2 text-sm">
        <input
          id="adjustments-select-all"
          type="checkbox"
          className="h-4 w-4 accent-[var(--color-brand-500)]"
          checked={allSelected}
          disabled={selectable.length === 0}
          onChange={toggleAll}
        />
        <label htmlFor="adjustments-select-all">{t('selectAll')}</label>
      </div>

      <DataTable
        items={rows ?? []}
        columns={columns}
        keyExtractor={(row) => row.contractId}
        loading={rows === null}
        error={error}
        empty={{ iconName: 'percent', title: t('empty.title'), subtitle: t('empty.subtitle') }}
      />

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <p className="text-sm" aria-live="polite">
          {t('summary.selected', { count: chosen.length })}
          {chosenProvisional > 0 && <> · {t('summary.provisional', { count: chosenProvisional })}</>}
        </p>
        <Button onClick={() => void apply()} disabled={chosen.length === 0 || applying}>
          {applying ? <Spinner className="h-4 w-4" /> : <Icon name="check" className="h-4 w-4" />}
          {applying ? t('apply.applying') : t('apply.button', { count: chosen.length })}
        </Button>
      </div>
    </div>
  );
}
