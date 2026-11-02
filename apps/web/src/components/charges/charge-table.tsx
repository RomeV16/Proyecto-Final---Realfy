'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient, ApiRequestError } from '@/lib/api-client';
import { chargeActions, chargeMonth, type ChargeAction, type PendingChargeRow } from '@/lib/charges';
import { toast } from '@/lib/toast';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn, type DataTablePagination } from '@/components/ui/data-table';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';

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
}

const REQUESTS: Record<ChargeAction, { path: (id: string) => string; method: 'POST' | 'PATCH'; body?: object }> = {
  forceImpute: { path: (id) => `/charges/${id}`, method: 'PATCH', body: { requiresUpfront: false } },
  markPaidUpfront: { path: (id) => `/charges/${id}/mark-paid-upfront`, method: 'POST' },
  cancel: { path: (id) => `/charges/${id}/cancel`, method: 'POST' },
  release: { path: (id) => `/charges/${id}/release`, method: 'POST' },
};

/** Lista de cargos con su estado, la chapa de anticipo y las acciones que admite cada uno. */
export function ChargeTable({ items, loading, error, canManage, onChanged, pagination, emptyAction, hideProperty }: Props) {
  const t = useTranslations('charges');
  const confirm = useConfirm();
  const [busyId, setBusyId] = useState<string | null>(null);

  async function run(row: PendingChargeRow, action: ChargeAction) {
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

  const columns: DataTableColumn<PendingChargeRow>[] = [
    {
      key: 'month',
      header: t('columns.month'),
      render: (row) => <span className="whitespace-nowrap">{chargeMonth(row)}</span>,
    },
    ...(hideProperty
      ? []
      : [{ key: 'property', header: t('columns.property'), render: (row: PendingChargeRow) => row.property?.title ?? '' }]),
    {
      key: 'concept',
      header: t('columns.concept'),
      render: (row) => (
        <div>
          <p className="font-medium text-[var(--color-text)]">{row.description}</p>
          <p className="text-xs text-[var(--color-muted)]">
            {t(`kinds.${row.kind}`)}
            {row.installmentOf > 1 ? ` · ${t('installment', { no: row.installmentNo, of: row.installmentOf })}` : ''}
          </p>
        </div>
      ),
    },
    { key: 'chargedTo', header: t('columns.chargedTo'), render: (row) => t(`targets.${row.chargedTo}`) },
    {
      key: 'amount',
      header: t('columns.amount'),
      alignRight: true,
      render: (row) => <MoneyText value={row.amount} currency={row.currency} />,
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (row) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge domain="cargo" status={row.status} />
          {row.requiresUpfront && row.status === 'Pendiente' && (
            <Badge variant="warning" title={t('upfront.hint')}>
              {t('upfront.badge')}
            </Badge>
          )}
        </div>
      ),
    },
    ...(canManage
      ? [
          {
            key: 'actions',
            header: t('columns.actions'),
            render: (row: PendingChargeRow) => (
              <div className="flex flex-wrap gap-1.5">
                {chargeActions(row).map((action) => (
                  <Button
                    key={action}
                    type="button"
                    size="sm"
                    variant={action === 'cancel' ? 'secondary' : 'primary'}
                    disabled={busyId === row.id}
                    onClick={() => void run(row, action)}
                  >
                    {t(`actions.${action}`)}
                  </Button>
                ))}
              </div>
            ),
          },
        ]
      : []),
  ];

  return (
    <DataTable
      items={items}
      columns={columns}
      keyExtractor={(row) => row.id}
      loading={loading}
      error={error}
      pagination={pagination}
      empty={{ title: t('empty.title'), subtitle: t('empty.subtitle'), iconName: 'liquidaciones', action: emptyAction }}
    />
  );
}
