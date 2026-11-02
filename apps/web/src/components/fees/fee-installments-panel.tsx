'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { FEE_INSTALLMENT_STATUSES, feePlace, type InstallmentItem } from '@/lib/fees';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { EMPTY_FEE_FILTERS, FeeFilters, listPagination } from './fee-filters';
import { FeePayDialog, type PayTarget } from './fee-pay-dialog';
import { useInstallmentColumns } from './installment-columns';

const LIMIT = 50;
const INITIAL_FILTERS = { ...EMPTY_FEE_FILTERS, status: 'Pendiente' };

/** Cuotas de honorarios para cobrar: qué vence, de quién y cuánto es hoy (ajustada con el alquiler si corresponde). */
export function FeeInstallmentsPanel() {
  const t = useTranslations('fees');
  const list = usePaginatedList<InstallmentItem, typeof INITIAL_FILTERS>({
    key: 'fee-installments',
    path: '/fees/installments',
    limit: LIMIT,
    initialFilters: INITIAL_FILTERS,
  });
  const [paying, setPaying] = useState<PayTarget | null>(null);
  const installmentColumns = useInstallmentColumns<InstallmentItem>((row) => row.fee, setPaying);

  const columns: DataTableColumn<InstallmentItem>[] = [
    installmentColumns[0],
    {
      key: 'fee',
      header: t('columns.fee'),
      render: (row) => (
        <div>
          <p className="font-medium text-[var(--color-text)]">{t(`kinds.${row.fee.kind}`)}</p>
          <p className="text-xs text-[var(--color-muted)]">
            {t('installmentOf', { n: row.n, of: row.fee.installments })}
            {feePlace(row.fee) ? ` · ${feePlace(row.fee)}` : ''}
          </p>
        </div>
      ),
    },
    {
      key: 'payer',
      header: t('columns.payer'),
      render: (row) => (
        <div>
          <p className="text-[var(--color-text)]">{row.fee.payerName}</p>
          <p className="text-xs text-[var(--color-muted)]">{t(`roles.${row.fee.payerRole}`)}</p>
        </div>
      ),
    },
    ...installmentColumns.slice(1),
  ];

  return (
    <div className="space-y-4">
      <FeeFilters
        idPrefix="fee-installments"
        values={list.filters}
        onFilter={list.setFilter}
        statuses={FEE_INSTALLMENT_STATUSES}
        statusLabel={(s) => t(`installmentStatuses.${s}`)}
      />
      <DataTable
        items={list.items}
        columns={columns}
        keyExtractor={(row) => row.id}
        loading={list.isLoading}
        error={list.error}
        pagination={listPagination(list)}
        empty={{ title: t('installmentsEmpty.title'), subtitle: t('installmentsEmpty.subtitle'), iconName: 'percent' }}
      />
      {paying && <FeePayDialog target={paying} onClose={() => setPaying(null)} onDone={() => void list.refetch()} />}
    </div>
  );
}
