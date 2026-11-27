'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogHeader } from '@/components/ui/dialog';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { Skeleton } from '@/components/ui/skeleton';
import { SourceInvoicesPanel } from '@/components/invoices/lessor/source-invoices-panel';
import {
  MonthNav,
  PaymentStatement,
  PaymentSummary,
  type ContractLabel,
  type DebtSummary,
} from '@/components/payments/payment-statement';
import {
  availableMonths,
  currentMonthKey,
  defaultMonth,
  neighbourMonth,
  paymentsOfMonth,
  type PaymentRow,
} from '@/components/payments/statement';
import { useCan } from '@/lib/permissions';

/** Cobros que se traen para armar el extracto. */
const LIMIT = 200;

interface PaymentsResponse {
  items?: PaymentRow[];
  total?: number;
}

interface ContractListItem {
  id: string;
  property?: { title?: string | null } | null;
  persons?: { role: string; person?: { firstName: string; lastName: string } | null }[];
}

function contractLabels(items: ContractListItem[]): Record<string, ContractLabel> {
  const labels: Record<string, ContractLabel> = {};
  for (const c of items) {
    const tenant = c.persons?.find((p) => p.role === 'Inquilino')?.person;
    labels[c.id] = {
      property: c.property?.title ?? '',
      tenant: tenant ? `${tenant.firstName} ${tenant.lastName}`.trim() : '',
    };
  }
  return labels;
}

export default function PagosPage() {
  const t = useTranslations('payments');
  const [payments, setPayments] = useState<PaymentRow[] | null>(null);
  const [total, setTotal] = useState(0);
  const [error, setError] = useState<unknown>(null);
  const [debt, setDebt] = useState<DebtSummary | null>(null);
  const [debtLoading, setDebtLoading] = useState(true);
  const [contracts, setContracts] = useState<Record<string, ContractLabel>>({});
  const [chosenMonth, setChosenMonth] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const canInvoice = useCan('lessorInvoicing.view');
  const [invoicing, setInvoicing] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    void apiClient<PaymentsResponse>(`/payments?limit=${LIMIT}`)
      .then((r) => {
        if (cancelled) return;
        setPayments(r?.items ?? []);
        setTotal(r?.total ?? r?.items?.length ?? 0);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err);
      });
    void apiClient<DebtSummary>('/payments/debt')
      .then((d) => {
        if (!cancelled) setDebt(d?.pendiente && d?.vencida ? d : null);
      })
      .catch(() => {
        if (!cancelled) setDebt(null);
      })
      .finally(() => {
        if (!cancelled) setDebtLoading(false);
      });
    // Los nombres de la propiedad y del inquilino son un agregado: sin ellos el extracto muestra el período.
    void apiClient<{ items?: ContractListItem[] }>('/contracts?limit=100')
      .then((r) => {
        if (!cancelled) setContracts(contractLabels(r?.items ?? []));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [version]);

  const months = useMemo(() => availableMonths(payments ?? []), [payments]);
  const month = chosenMonth && months.includes(chosenMonth) ? chosenMonth : defaultMonth(months);
  const monthItems = useMemo(() => paymentsOfMonth(payments ?? [], month), [payments, month]);
  const older = neighbourMonth(months, month, 'older');
  const newer = neighbourMonth(months, month, 'newer');
  const retry = useCallback(() => setVersion((v) => v + 1), []);

  const loading = payments === null && error == null;
  const empty = payments !== null && payments.length === 0;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="h1">{t('title')}</h1>
        <p className="mt-2 text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
      </div>

      {error != null && (
        <div className="space-y-3">
          <ErrorNotice error={error} fallback={t('loadError')} />
          <Button type="button" variant="secondary" size="sm" onClick={retry}>
            {t('retry')}
          </Button>
        </div>
      )}

      {loading && (
        <div className="space-y-4" aria-busy="true" aria-label={t('loading')}>
          <Skeleton className="h-9 w-64" />
          <Skeleton className="h-36 w-full rounded-xl" />
          <Skeleton className="h-72 w-full rounded-xl" />
        </div>
      )}

      {payments !== null && error == null && (
        <>
          {!empty && (
            <MonthNav
              month={month}
              isCurrent={month === currentMonthKey()}
              onOlder={older ? () => setChosenMonth(older) : undefined}
              onNewer={newer ? () => setChosenMonth(newer) : undefined}
            />
          )}

          <PaymentSummary items={monthItems} debt={debt} debtLoading={debtLoading} />

          {empty ? (
            <div className="rounded-xl border border-dashed border-[var(--color-border)]">
              <EmptyState iconName="wallet" title={t('noPayments')} subtitle={t('noPaymentsSubtitle')} />
            </div>
          ) : (
            <section className="space-y-3" aria-label={t('statement.label')}>
              <PaymentStatement
                items={monthItems}
                contracts={contracts}
                renderAction={
                  canInvoice
                    ? (p) => (
                        <button
                          type="button"
                          onClick={() => setInvoicing(p.id)}
                          className="rounded-md px-2 py-1 text-xs font-medium text-[var(--color-brand-600)] hover:bg-[var(--color-surface-sunken)] hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-500"
                        >
                          {t('invoicing')}
                        </button>
                      )
                    : undefined
                }
              />
              {total > payments.length && (
                <p className="text-xs text-[var(--color-muted)]">{t('statement.truncated', { shown: payments.length, total })}</p>
              )}
            </section>
          )}
        </>
      )}

      <Dialog open={invoicing !== null} onClose={() => setInvoicing(null)} size="lg">
        <DialogHeader>
          <h2 className="text-base font-semibold text-[var(--color-text)]">{t('invoicingTitle')}</h2>
        </DialogHeader>
        <DialogBody>{invoicing !== null && <SourceInvoicesPanel sourceType="Payment" sourceId={invoicing} />}</DialogBody>
      </Dialog>
    </div>
  );
}
