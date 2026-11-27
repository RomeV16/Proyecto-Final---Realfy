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
import { cn } from '@/lib/cn';
import { toast } from '@/lib/toast';
import { useCan } from '@/lib/permissions';
import { formatDate, formatMoneyFixed, formatNumber, formatPercent } from '@/lib/format';
import { Link } from '@/i18n/navigation';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Icon } from '@/components/ui/icon';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { StatusBadge } from '@/components/ui/status-badge';
import { useConfirm } from '@/components/ui/confirm-dialog';

/** Mes actual de la persona, `YYYY-MM`. */
function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

const KNOWN_ERRORS = ['MISSING_ADJUSTMENT_PCT', 'MISSING_ADJUSTMENT_STEPS', 'UNKNOWN_ADJUSTMENT_TYPE'];
const KNOWN_REASONS = ['MISSING_INDEX_DATA', 'NO_DUE_ADJUSTMENT', 'CONTRACT_NOT_FOUND', 'RENT_DECREASE_REQUIRES_REVIEW'];

const RESULT_VARIANT = { applied: 'success', provisional: 'warning', fixed_initial: 'neutral', skipped: 'danger' } as const;

const MONO = 'font-mono tabular-nums';
const CAPTION = 'text-[11px] font-semibold uppercase tracking-[0.08em] text-[var(--color-muted)]';
/** Columnas de la fila en escritorio: elegir, contrato, antes, índice, después, diferencia y estado. */
const GRID =
  'lg:grid lg:grid-cols-[1.25rem_minmax(0,1.3fr)_minmax(0,1fr)_8.5rem_minmax(0,1fr)_minmax(0,0.9fr)_minmax(0,1.2fr)] lg:items-start lg:gap-x-4';

/** "feb 2026" de un mes `AAAA-MM`; cualquier otro texto queda como vino. */
export function monthLabel(period: string, locale?: string): string {
  return /^\d{4}-\d{2}$/.test(period)
    ? formatDate(`${period}-01`, { month: 'short', year: 'numeric' }, locale).replace('.', '')
    : period;
}

/**
 * Ajustes del mes: por contrato, el alquiler de hoy, el índice que se aplica y el alquiler que queda, lado a lado. Se
 * eligen los que se quieren aplicar y se aplican todos juntos.
 */
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
  // Un ajuste que baja el alquiler no entra en "Elegir todos": se elige a mano y se confirma al aplicar (DEF-176).
  const chosenDecreases = chosen.filter((r) => r.rentDecrease);
  const byDefault = useMemo(() => selectable.filter((r) => !r.rentDecrease), [selectable]);
  const allSelected = byDefault.length > 0 && byDefault.every((r) => selected.has(r.contractId));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(byDefault.map((r) => r.contractId)));
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
          {chosenDecreases.length > 0 && (
            <p className="font-medium text-[var(--color-warning,var(--color-danger))]">
              {t('apply.confirmRentDecrease', { count: chosenDecreases.length })}
            </p>
          )}
        </div>
      ),
    });
    if (!ok) return;

    setApplying(true);
    try {
      const res = await apiClient<AdjustmentApplyBatch>('/adjustments/apply-batch', {
        method: 'POST',
        body: JSON.stringify({
          period,
          contractIds: chosen.map((r) => r.contractId),
          confirmRentDecrease: chosenDecreases.map((r) => r.contractId),
        }),
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
  const money = (value: string | number, currency: string) => formatMoneyFixed(value, currency, locale);
  const signed = (value: number, text: string) => (value > 0 ? `+${text}` : text);

  const list = rows ?? [];
  const blocked = list.filter((r) => !r.selectable).length;
  const sameCurrency = chosen.every((r) => r.currency === chosen[0]?.currency);
  const chosenBefore = chosen.reduce((sum, r) => sum + Number(r.currentRent), 0);
  const chosenAfter = chosen.reduce((sum, r) => sum + Number(r.newRent ?? r.currentRent), 0);

  function renderResult(row: AdjustmentPreviewRow) {
    const result = results.get(row.contractId);
    if (!result) return null;
    const key = result.result === 'applied' ? (result.status ?? 'applied') : 'skipped';
    return (
      <>
        <Badge variant={RESULT_VARIANT[key as keyof typeof RESULT_VARIANT] ?? 'neutral'} dot>
          {t(`result.${key}` as never)}
        </Badge>
        {result.reason && (
          <span className="basis-full text-xs text-[var(--color-muted)]">
            {t(
              KNOWN_REASONS.includes(result.reason)
                ? (`result.reasons.${result.reason}` as 'result.reasons.generic')
                : 'result.reasons.generic',
            )}
          </span>
        )}
      </>
    );
  }

  function renderRow(row: AdjustmentPreviewRow) {
    const title = rowTitle(row);
    const isChosen = selected.has(row.contractId);
    const newRent = row.newRent;
    const diff = newRent === null ? 0 : Number(newRent) - Number(row.currentRent);
    const factor = row.factor !== null && Number.isFinite(Number(row.factor)) ? Number(row.factor) : null;
    const diffTone = row.rentDecrease
      ? 'text-[var(--color-warning,var(--color-danger))]'
      : diff > 0
        ? 'text-[var(--color-text)]'
        : 'text-[var(--color-muted)]';

    return (
      <li
        key={row.contractId}
        className={cn(
          'px-4 py-4 transition-colors',
          GRID,
          isChosen && 'bg-[color-mix(in_oklab,var(--color-brand-500)_6%,var(--color-surface))]',
        )}
      >
        <div className="flex items-start gap-3 lg:contents">
          <input
            type="checkbox"
            className="mt-1 h-4 w-4 shrink-0 accent-[var(--color-brand-500)]"
            checked={isChosen}
            disabled={!row.selectable}
            onChange={() => toggle(row.contractId)}
            aria-label={t('selectRow', { title })}
          />
          <div className="min-w-0">
            <Link href={`/contracts/${row.contractId}`} className="font-medium text-[var(--color-text)] hover:underline">
              {title}
            </Link>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-[var(--color-muted)]">
              <span>{t('dueOn', { date: formatDate(row.adjustmentDate, undefined, locale) })}</span>
              {row.overdue && <Badge variant="warning">{t('overdue')}</Badge>}
            </p>
          </div>
        </div>

        {/* Antes, índice y después: en móvil van en un renglón propio */}
        <div className="mt-3 grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-start gap-x-3 lg:contents">
          <div>
            <p className={cn(CAPTION, 'lg:hidden')}>{t('columns.current')}</p>
            <p
              className={cn(
                MONO,
                'text-sm text-[var(--color-muted)]',
                newRent !== null && diff !== 0 && 'line-through decoration-[var(--color-slate-300)]',
              )}
            >
              {money(row.currentRent, row.currency)}
            </p>
          </div>

          <div className="flex flex-col items-center text-center">
            <span className="inline-flex items-center gap-1 rounded-full border border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-2 py-0.5 text-xs font-semibold text-[var(--color-text)]">
              {row.adjustmentType}
              <Icon name="arrowRight" className="h-3.5 w-3.5 text-[var(--color-muted)]" aria-hidden="true" />
            </span>
            {factor !== null && (
              <span className={cn(MONO, 'mt-0.5 text-xs text-[var(--color-text)]')}>
                × {formatNumber(factor, { decimals: 4, locale })}
              </span>
            )}
            {row.percentage !== null && (
              <span className="text-[11px] text-[var(--color-muted)]">
                {t('indexChange', { pct: formatPercent(row.percentage, { decimals: 2, locale }) })}
              </span>
            )}
          </div>

          <div>
            <p className={cn(CAPTION, 'lg:hidden')}>{t('columns.new')}</p>
            {newRent !== null ? (
              <p className={cn(MONO, 'text-base font-semibold text-[var(--color-text)]')}>{money(newRent, row.currency)}</p>
            ) : (
              <p className="text-sm text-[var(--color-muted)]">{t('noNewRent')}</p>
            )}
          </div>
        </div>

        <div className="mt-2 flex items-baseline gap-2 lg:mt-0 lg:block">
          {newRent !== null && (
            <>
              <p className={cn(CAPTION, 'lg:hidden')}>{t('columns.difference')}</p>
              <p className={cn(MONO, 'text-sm font-medium', diffTone)}>{signed(diff, money(diff, row.currency))}</p>
              {row.rentChangePct != null && (
                <p className={cn(MONO, 'text-xs', diffTone)}>
                  {signed(Number(row.rentChangePct), formatPercent(row.rentChangePct, { decimals: 2, locale }))}
                </p>
              )}
            </>
          )}
        </div>

        <div className="mt-2 space-y-1 lg:mt-0">
          <div className="flex flex-wrap items-center gap-2">
            <StatusBadge domain="ajuste" status={row.status} />
            {renderResult(row)}
          </div>
          {row.rentDecrease && (
            <p role="alert" className="text-xs font-medium text-[var(--color-warning,var(--color-danger))]">
              {t('rentDecreaseHint', {
                pct: formatPercent(Math.abs(Number(row.rentChangePct)), { decimals: 2, locale }),
              })}
            </p>
          )}
          {row.isProvisional && <p className="text-xs text-[var(--color-muted)]">{t('provisionalHint')}</p>}
          {row.indexValues.length > 0 && (
            <p className="text-xs text-[var(--color-muted)]">
              {t('indexMonths', {
                months: row.indexValues
                  .map((v) => {
                    const month = monthLabel(v.period, locale);
                    return v.isEstimate ? t('estimatedMonth', { period: month }) : month;
                  })
                  .join(', '),
              })}
            </p>
          )}
          {row.missing && (
            <p className="text-xs text-[var(--color-danger)]">
              {t('missing.months', {
                indexes: row.missing.indexTypes.join(', '),
                periods:
                  row.missing.missingPeriods.map((p) => monthLabel(p, locale)).join(', ') || t('missing.noPeriods'),
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
      </li>
    );
  }

  return (
    <div className="max-w-7xl space-y-5">
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
              className="h-9 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 text-[var(--color-text)]"
            />
          </label>
          <Button variant="secondary" size="sm" onClick={() => void load()} disabled={rows === null}>
            <Icon name="refresh" className="h-4 w-4" />
            {t('refresh')}
          </Button>
        </div>
      </div>

      {rows === null && <Skeleton className="h-64 w-full" />}
      {rows !== null && error != null && <ErrorNotice error={error} fallback={t('loadError')} />}
      {rows !== null && error == null && list.length === 0 && (
        <EmptyState iconName="percent" title={t('empty.title')} subtitle={t('empty.subtitle')} />
      )}

      {list.length > 0 && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 text-sm">
            <label htmlFor="adjustments-select-all" className="flex items-center gap-2">
              <input
                id="adjustments-select-all"
                type="checkbox"
                className="h-4 w-4 accent-[var(--color-brand-500)]"
                checked={allSelected}
                disabled={selectable.length === 0}
                onChange={toggleAll}
              />
              {t('selectAll')}
            </label>
            <p className="text-[var(--color-muted)]">
              {t('overview.total', { count: list.length })}
              {' · '}
              {t('overview.ready', { count: selectable.length })}
              {blocked > 0 && (
                <>
                  {' · '}
                  {t('overview.blocked', { count: blocked })}
                </>
              )}
            </p>
          </div>

          <div className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]">
            <div
              aria-hidden="true"
              className={cn(
                'hidden border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] px-4 py-2.5',
                CAPTION,
                GRID,
              )}
            >
              <span />
              <span>{t('columns.contract')}</span>
              <span>{t('columns.current')}</span>
              <span className="text-center">{t('columns.type')}</span>
              <span>{t('columns.new')}</span>
              <span>{t('columns.difference')}</span>
              <span>{t('columns.status')}</span>
            </div>
            <ul className="divide-y divide-[var(--color-border)]">{list.map(renderRow)}</ul>
          </div>
        </>
      )}

      <div className="sticky bottom-0 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
        <div className="text-sm" aria-live="polite">
          <p>
            {t('summary.selected', { count: chosen.length })}
            {chosenProvisional > 0 && <> · {t('summary.provisional', { count: chosenProvisional })}</>}
            {chosenDecreases.length > 0 && <> · {t('summary.decreases', { count: chosenDecreases.length })}</>}
          </p>
          {chosen.length > 0 && sameCurrency && (
            <p className={cn(MONO, 'mt-0.5 text-xs text-[var(--color-muted)]')}>
              {t('summary.totals', {
                before: money(chosenBefore, chosen[0].currency),
                after: money(chosenAfter, chosen[0].currency),
                diff: signed(chosenAfter - chosenBefore, money(chosenAfter - chosenBefore, chosen[0].currency)),
              })}
            </p>
          )}
        </div>
        <Button onClick={() => void apply()} disabled={chosen.length === 0 || applying}>
          {applying ? <Spinner className="h-4 w-4" /> : <Icon name="check" className="h-4 w-4" />}
          {applying ? t('apply.applying') : t('apply.button', { count: chosen.length })}
        </Button>
      </div>
    </div>
  );
}
