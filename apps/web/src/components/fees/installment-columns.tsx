'use client';

import { useTranslations } from 'next-intl';
import { formatReceiptNumber } from '@realfy/shared';
import { canPayInstallment, isAdjusted, type Fee, type FeeInstallment } from '@/lib/fees';
import { useCan } from '@/lib/permissions';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import type { DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';
import type { PayTarget } from './fee-pay-dialog';

type FeeOfRow = Pick<Fee, 'id' | 'status' | 'kind' | 'installments' | 'payerRole' | 'payerName' | 'currency'>;

/** La cuota como la pide el diálogo de cobro. */
function payTarget(row: FeeInstallment, fee: FeeOfRow): PayTarget {
  return {
    feeId: fee.id,
    n: row.n,
    of: fee.installments,
    kind: fee.kind,
    payerRole: fee.payerRole,
    payerName: fee.payerName,
    currency: fee.currency,
    dueAmount: row.dueAmount,
  };
}

/**
 * Columnas de una cuota (vencimiento, importe a cobrar, estado y cobro), las mismas en el listado de cuotas y en
 * el detalle de un honorario. `feeOf` da el honorario de la fila.
 */
export function useInstallmentColumns<R extends FeeInstallment>(
  feeOf: (row: R) => FeeOfRow,
  onPay: (target: PayTarget) => void,
): DataTableColumn<R>[] {
  const t = useTranslations('fees');
  const canCollect = useCan('fees.collect');
  return [
    {
      key: 'dueDate',
      header: t('columns.dueDate'),
      render: (row) => <DateText value={row.dueDate} />,
    },
    {
      key: 'amount',
      header: t('columns.toCollect'),
      alignRight: true,
      render: (row) => (
        <div className="flex flex-col items-end gap-0.5">
          <MoneyText value={row.status === 'Pagada' ? (row.paidAmount ?? row.dueAmount) : row.dueAmount} currency={feeOf(row).currency} />
          {isAdjusted(row) && row.status !== 'Anulada' && (
            <Badge variant="info" title={t('adjustedHint', { amount: row.amount })}>
              {t('adjusted')}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (row) => (
        <div className="flex flex-col gap-0.5">
          <StatusBadge domain="cuotaHonorario" status={row.status} />
          {row.settlement && <span className="text-xs text-[var(--color-muted)]">{t(`pay.settlements.${row.settlement}`)}</span>}
          {row.receipt && (
            <span className="text-xs text-[var(--color-muted)]">{t('receipt', { number: row.receipt.label ?? formatReceiptNumber(row.receipt.number) })}</span>
          )}
        </div>
      ),
    },
    ...(canCollect
      ? [
          {
            key: 'actions',
            header: t('columns.actions'),
            render: (row: R) =>
              canPayInstallment(row, feeOf(row)) ? (
                <Button type="button" size="sm" onClick={() => onPay(payTarget(row, feeOf(row)))}>
                  {t('actions.pay')}
                </Button>
              ) : null,
          },
        ]
      : []),
  ];
}
