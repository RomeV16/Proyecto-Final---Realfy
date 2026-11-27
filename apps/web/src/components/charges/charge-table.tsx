'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { chargeActions, chargeMonth, type ChargeAction, type PendingChargeRow } from '@/lib/charges';
import { cn } from '@/lib/cn';
import { toast } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { useConfirm } from '@/components/ui/confirm-dialog';
import type { DataTablePagination } from '@/components/ui/data-table';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { MoneyText } from '@/components/ui/money-text';
import { PaginationBar } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { AgencyExpenseDialog } from './agency-expense-dialog';

interface Props {
  items: PendingChargeRow[];
  loading: boolean;
  error?: unknown;
  canManage: boolean;
  /** Se llama después de cada acción para volver a leer la lista. */
  onChanged: () => void;
  pagination?: DataTablePagination;
  emptyAction?: ReactNode;
  /** Oculta la columna de la propiedad (el detalle de un contrato ya la tiene a la vista). */
  hideProperty?: boolean;
  /** La lista vacía es por los filtros, no porque no haya cargos. */
  filtered?: boolean;
}

type RequestAction = Exclude<ChargeAction, 'agencyExpense'>;

const REQUESTS: Record<RequestAction, { path: (id: string) => string; method: 'POST' | 'PATCH'; body?: object }> = {
  forceImpute: { path: (id) => `/charges/${id}`, method: 'PATCH', body: { requiresUpfront: false } },
  markPaidUpfront: { path: (id) => `/charges/${id}/mark-paid-upfront`, method: 'POST' },
  cancel: { path: (id) => `/charges/${id}/cancel`, method: 'POST' },
  release: { path: (id) => `/charges/${id}/release`, method: 'POST' },
};

/** Total por moneda de los renglones, en centavos para no arrastrar errores de coma flotante. */
export function chargeTotals(items: readonly Pick<PendingChargeRow, 'amount' | 'currency'>[]): { currency: string; amount: string }[] {
  const byCurrency = new Map<string, number>();
  for (const row of items) {
    const cents = Math.round(Number(row.amount) * 100);
    byCurrency.set(row.currency, (byCurrency.get(row.currency) ?? 0) + (Number.isFinite(cents) ? cents : 0));
  }
  return [...byCurrency.entries()]
    .map(([currency, cents]) => ({ currency, amount: (cents / 100).toFixed(2) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

const TH = 'border-b border-r border-[var(--color-border)] px-2.5 py-2 text-left text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--color-muted)] last:border-r-0';
const TD = 'border-b border-r border-[var(--color-border)] px-2.5 py-1.5 align-middle last:border-r-0';
const ACTION =
  'inline-flex h-7 items-center whitespace-nowrap rounded-md border px-2 text-xs font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand-500 disabled:cursor-not-allowed disabled:opacity-50';

/**
 * Planilla de cargos: un renglón numerado por cargo, con columnas angostas y cuadrícula para repasar muchos de
 * una vez, las acciones que admite cada uno en la misma fila y el total por moneda al pie.
 */
export function ChargeTable({ items, loading, error, canManage, onChanged, pagination, emptyAction, hideProperty, filtered }: Props) {
  const t = useTranslations('charges');
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expense, setExpense] = useState<PendingChargeRow | null>(null);

  async function run(row: PendingChargeRow, action: ChargeAction) {
    if (action === 'agencyExpense') {
      setExpense(row);
      return;
    }
    if (action === 'cancel' || action === 'markPaidUpfront') {
      const ok = await confirm({
        title: t(`confirm.${action}.title`),
        body: t(`confirm.${action}.body`, { description: row.description }),
        confirmLabel: t(`actions.${action}`),
        tone: action === 'cancel' ? 'danger' : 'default',
      });
      if (!ok) return;
    }
    const request = REQUESTS[action];
    setBusyId(row.id);
    try {
      await apiClient(request.path(row.id), {
        method: request.method,
        ...(request.body ? { body: JSON.stringify(request.body) } : {}),
      });
      toast.success(t(`done.${action}`));
      onChanged();
    } catch (err) {
      toast.error(err instanceof ApiRequestError ? err.message : t('actionError'));
    } finally {
      setBusyId(null);
    }
  }

  if (error != null) return <ErrorNotice error={error} />;

  if (loading) {
    return (
      <div className="space-y-1.5" aria-busy="true">
        {[0, 1, 2, 3, 4].map((i) => (
          <Skeleton key={i} className="h-9 w-full" />
        ))}
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-[var(--color-border)]">
        <EmptyState
          iconName="liquidaciones"
          variant={filtered ? 'filtered' : 'default'}
          title={filtered ? t('empty.filteredTitle') : t('empty.title')}
          subtitle={filtered ? t('empty.filteredSubtitle') : t('empty.subtitle')}
          action={emptyAction}
        />
      </div>
    );
  }

  const totals = chargeTotals(items);
  const leadingColumns = hideProperty ? 5 : 6;

  return (
    <>
      <div className="overflow-x-auto rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)]">
        <table className="w-full min-w-[900px] border-collapse text-[13px] text-[var(--color-text)]">
          <thead className="bg-[var(--color-surface-sunken)]">
            <tr>
              <th scope="col" className={cn(TH, 'w-10 text-center')}>
                <span aria-hidden="true">#</span>
                <span className="sr-only">{t('columns.row')}</span>
              </th>
              <th scope="col" className={cn(TH, 'w-[84px]')}>
                {t('columns.month')}
              </th>
              {!hideProperty && (
                <th scope="col" className={TH}>
                  {t('columns.property')}
                </th>
              )}
              <th scope="col" className={TH}>
                {t('columns.concept')}
              </th>
              <th scope="col" className={TH}>
                {t('columns.chargedTo')}
              </th>
              <th scope="col" className={TH}>
                {t('columns.status')}
              </th>
              <th scope="col" className={cn(TH, 'text-right')}>
                {t('columns.amount')}
              </th>
              {canManage && (
                <th scope="col" className={TH}>
                  {t('columns.actions')}
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((row, index) => {
              const offset = pagination ? (pagination.page - 1) * pagination.limit : 0;
              return (
                <tr key={row.id} className="transition-colors hover:bg-[color-mix(in_oklab,var(--color-brand-500)_5%,var(--color-surface))]">
                  <td className={cn(TD, 'bg-[var(--color-surface-sunken)] text-center font-mono text-[11px] text-[var(--color-muted)] tabular-nums')}>
                    {offset + index + 1}
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap font-mono text-xs tabular-nums')}>{chargeMonth(row)}</td>
                  {!hideProperty && (
                    <td className={cn(TD, 'max-w-[180px] truncate')} title={row.property?.title ?? undefined}>
                      {row.property?.title ?? ''}
                    </td>
                  )}
                  <td className={cn(TD, 'max-w-[280px]')}>
                    <p className="truncate font-medium" title={row.description}>
                      {row.description}
                    </p>
                    <p className="truncate text-[11.5px] leading-tight text-[var(--color-muted)]">
                      {t(`kinds.${row.kind}`)}
                      {row.installmentOf > 1 ? ` · ${t('installment', { no: row.installmentNo, of: row.installmentOf })}` : ''}
                    </p>
                  </td>
                  <td className={cn(TD, 'whitespace-nowrap')}>{t(`targets.${row.chargedTo}`)}</td>
                  <td className={TD}>
                    <div className="flex items-center gap-1.5">
                      <StatusBadge domain="cargo" status={row.status} />
                      {row.requiresUpfront && row.status === 'Pendiente' && (
                        <Badge variant="warning" title={t('upfront.hint')}>
                          {t('upfront.badge')}
                        </Badge>
                      )}
                    </div>
                  </td>
                  <td
                    className={cn(
                      TD,
                      'whitespace-nowrap text-right font-mono tabular-nums',
                      Number(row.amount) < 0 && 'text-[var(--color-success)]',
                    )}
                  >
                    <MoneyText value={row.amount} currency={row.currency} />
                  </td>
                  {canManage && (
                    <td className={TD}>
                      <div className="flex gap-1">
                        {chargeActions(row).map((action) => (
                          <button
                            key={action}
                            type="button"
                            disabled={busyId === row.id}
                            aria-label={t(`actions.${action}`)}
                            title={t(`actions.${action}`)}
                            onClick={() => void run(row, action)}
                            className={cn(
                              ACTION,
                              action === 'cancel'
                                ? 'border-transparent text-[var(--color-danger)] hover:bg-[color-mix(in_oklab,var(--color-danger)_8%,var(--color-surface))]'
                                : 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] hover:border-[var(--color-slate-400)] hover:bg-[var(--color-surface-sunken)]',
                            )}
                          >
                            {t(`actionsShort.${action}`)}
                          </button>
                        ))}
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          <tfoot className="bg-[var(--color-surface-sunken)]">
            {totals.map((total, i) => (
              <tr key={total.currency}>
                <td colSpan={leadingColumns} className="px-2.5 py-2 text-right text-xs font-medium text-[var(--color-muted)]">
                  {i === 0 ? t('totals.rows', { count: items.length }) : ''} {t('totals.label', { currency: total.currency })}
                </td>
                <td className="whitespace-nowrap border-l border-[var(--color-border)] px-2.5 py-2 text-right font-mono text-[13px] font-semibold tabular-nums">
                  <MoneyText value={total.amount} currency={total.currency} />
                </td>
                {canManage && <td />}
              </tr>
            ))}
          </tfoot>
        </table>
      </div>
      {pagination && <PaginationBar {...pagination} />}
      {expense && <AgencyExpenseDialog charge={expense} onClose={() => setExpense(null)} onDone={onChanged} />}
    </>
  );
}
