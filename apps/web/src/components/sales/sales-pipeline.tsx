'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useQueryClient } from '@tanstack/react-query';
import { Link } from '@/i18n/navigation';
import { usePaginatedList } from '@/hooks/use-paginated-list';
import { useCan } from '@/lib/permissions';
import { SALES_STATUSES, partiesOf, placeOf, type SalesOperation } from '@/lib/sales';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { Tabs } from '@/components/ui/tabs';
import { ExpiryBadge } from './expiry-badge';
import { PendingDepositsPanel } from './pending-deposits-panel';
import { SalesCreateDialog } from './sales-create-dialog';

type Tab = 'operations' | 'deposits';
const LIMIT = 50;
const EMPTY_FILTERS = { status: '', open: '', exclusive: '' };

/** Ventas: el embudo de operaciones (de la captación a la escritura) y las señas pendientes. */
export function SalesPipeline() {
  const t = useTranslations('sales');
  const canView = useCan('sales.view');
  const canManage = useCan('sales.manage');
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>('operations');
  const [creating, setCreating] = useState(false);

  if (!canView) {
    return (
      <div className="flex h-64 items-center justify-center">
        <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('subtitle')}</p>
        </div>
        {canManage && (
          <Button type="button" onClick={() => setCreating(true)}>
            {t('add')}
          </Button>
        )}
      </header>

      <Tabs tabs={['operations', 'deposits'] as const} value={tab} onChange={setTab} label={t('title')} labelOf={(key) => t(`tabs.${key}`)}>
        {tab === 'operations' ? <OperationsPanel /> : <PendingDepositsPanel />}
      </Tabs>

      {creating && (
        <SalesCreateDialog
          onClose={() => setCreating(false)}
          onDone={() => void queryClient.invalidateQueries({ queryKey: ['sales'] })}
        />
      )}
    </div>
  );
}

function OperationsPanel() {
  const t = useTranslations('sales');
  const list = usePaginatedList<SalesOperation, typeof EMPTY_FILTERS>({
    key: 'sales',
    path: '/sales-operations',
    limit: LIMIT,
    initialFilters: EMPTY_FILTERS,
  });

  const columns: DataTableColumn<SalesOperation>[] = [
    {
      key: 'property',
      header: t('columns.property'),
      render: (op) => (
        <Link href={`/ventas/${op.id}`} className="font-medium text-[var(--color-text)] underline-offset-2 hover:underline">
          {placeOf(op.property)}
        </Link>
      ),
    },
    {
      key: 'parties',
      header: t('columns.parties'),
      render: (op) => (
        <div className="text-sm">
          <p className="text-[var(--color-text)]">{partiesOf(op, 'Vendedor') || t('noParty')}</p>
          <p className="text-xs text-[var(--color-muted)]">{partiesOf(op, 'Comprador') || t('noBuyer')}</p>
        </div>
      ),
    },
    {
      key: 'status',
      header: t('columns.status'),
      render: (op) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge domain="venta" status={op.status} />
          {op.exclusive && <span className="text-xs text-[var(--color-muted)]">{t('exclusive')}</span>}
        </div>
      ),
    },
    {
      key: 'price',
      header: t('columns.price'),
      alignRight: true,
      render: (op) => (op.agreedPrice ?? op.price ? <MoneyText value={op.agreedPrice ?? op.price} currency={op.currency} decimals={0} /> : '—'),
    },
    {
      key: 'docs',
      header: t('columns.docs'),
      render: (op) => t('docsProgress', { done: op.docProgress.requiredDone, total: op.docProgress.requiredTotal }),
    },
    {
      key: 'expiry',
      header: t('columns.expiry'),
      render: (op) => {
        const reserva = op.deposits.find((d) => d.kind === 'Reserva' && d.expiresAt && (d.status === 'Pendiente' || d.status === 'Recibida'));
        return reserva ? <ExpiryBadge {...reserva} /> : '—';
      },
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="sales-status" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.status')}
          </label>
          <Select id="sales-status" value={list.filters.status} onChange={(e) => list.setFilter('status', e.target.value)} className="w-48">
            <option value="">{t('filters.all')}</option>
            {SALES_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`statuses.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sales-open" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.open')}
          </label>
          <Select id="sales-open" value={list.filters.open} onChange={(e) => list.setFilter('open', e.target.value)} className="w-44">
            <option value="">{t('filters.all')}</option>
            <option value="true">{t('filters.openOnly')}</option>
            <option value="false">{t('filters.closedOnly')}</option>
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="sales-exclusive" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.exclusive')}
          </label>
          <Select id="sales-exclusive" value={list.filters.exclusive} onChange={(e) => list.setFilter('exclusive', e.target.value)} className="w-44">
            <option value="">{t('filters.all')}</option>
            <option value="true">{t('filters.exclusiveYes')}</option>
            <option value="false">{t('filters.exclusiveNo')}</option>
          </Select>
        </div>
      </div>
      <DataTable
        items={list.items}
        columns={columns}
        keyExtractor={(op) => op.id}
        loading={list.isLoading}
        error={list.error}
        pagination={
          list.totalPages > 1
            ? { page: list.page, totalPages: list.totalPages, total: list.total, limit: list.limit, onPageChange: list.setPage }
            : undefined
        }
        empty={{ title: t('empty.title'), subtitle: t('empty.subtitle'), iconName: 'wallet' }}
      />
    </div>
  );
}
