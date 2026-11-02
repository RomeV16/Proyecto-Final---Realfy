'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { feePlace, paidInstallments, type Fee } from '@/lib/fees';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn, type DataTablePagination } from '@/components/ui/data-table';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { FeeDetailDialog } from './fee-detail-dialog';

interface Props {
  items: Fee[];
  loading: boolean;
  error?: unknown;
  /** Se llama después de cada cambio (cobro, anulación, reparto) para volver a leer la lista. */
  onChanged: () => void;
  pagination?: DataTablePagination;
  emptyAction?: ReactNode;
  /** Oculta la columna de la propiedad (el detalle de un contrato ya la tiene a la vista). */
  hideProperty?: boolean;
}

/** Honorarios con quién paga, el total, el estado y cuántas cuotas se cobraron; cada uno abre su detalle. */
export function FeeTable({ items, loading, error, onChanged, pagination, emptyAction, hideProperty }: Props) {
  const t = useTranslations('fees');
  const [openId, setOpenId] = useState<string | null>(null);

  const columns: DataTableColumn<Fee>[] = [
    {
      key: 'kind',
      header: t('columns.kind'),
      render: (row) => <span className="font-medium text-[var(--color-text)]">{t(`kinds.${row.kind}`)}</span>,
    },
    ...(hideProperty
      ? []
      : [{ key: 'property', header: t('columns.property'), render: (row: Fee) => feePlace(row) }]),
    {
      key: 'payer',
      header: t('columns.payer'),
      render: (row) => (
        <div>
          <p className="text-[var(--color-text)]">{row.payerName}</p>
          <p className="text-xs text-[var(--color-muted)]">{t(`roles.${row.payerRole}`)}</p>
        </div>
      ),
    },
    {
      key: 'total',
      header: t('columns.total'),
      alignRight: true,
      render: (row) => <MoneyText value={row.total} currency={row.currency} />,
    },
    {
      key: 'installments',
      header: t('columns.installments'),
      render: (row) => t('paidOf', { paid: paidInstallments(row), of: row.installments }),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (row) => <StatusBadge domain="honorario" status={row.status} />,
    },
    {
      key: 'actions',
      header: t('columns.actions'),
      render: (row) => (
        <Button type="button" size="sm" variant="secondary" onClick={() => setOpenId(row.id)}>
          {t('actions.view')}
        </Button>
      ),
    },
  ];

  return (
    <>
      <DataTable
        items={items}
        columns={columns}
        keyExtractor={(row) => row.id}
        loading={loading}
        error={error}
        pagination={pagination}
        empty={{ title: t('empty.title'), subtitle: t('empty.subtitle'), iconName: 'percent', action: emptyAction }}
      />
      {openId && <FeeDetailDialog feeId={openId} onClose={() => setOpenId(null)} onChanged={onChanged} />}
    </>
  );
}
