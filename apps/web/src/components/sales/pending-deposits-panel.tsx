'use client';

import { useTranslations } from 'next-intl';
import { useQuery } from '@tanstack/react-query';
import { Link } from '@/i18n/navigation';
import { apiClient } from '@/lib/api-client';
import { personName, type PendingDeposit, type PendingDepositsResponse } from '@/lib/sales';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { ExpiryBadge } from './expiry-badge';

/** Señas pendientes: lo prometido y no cobrado, el dinero recibido sin resolver y cuánto guarda cada uno, por moneda. */
export function PendingDepositsPanel() {
  const t = useTranslations('sales');
  const query = useQuery({
    queryKey: ['sales', 'pending-deposits'],
    queryFn: () => apiClient<PendingDepositsResponse>('/sales-operations/deposits/pending?limit=100'),
  });
  const data = query.data;

  const columns: DataTableColumn<PendingDeposit>[] = [
    {
      key: 'property',
      header: t('columns.property'),
      render: (d) => (
        <Link href={`/ventas/${d.salesOperation.id}`} className="font-medium text-[var(--color-text)] underline-offset-2 hover:underline">
          {d.salesOperation.property.title}
        </Link>
      ),
    },
    { key: 'kind', header: t('deposits.columns.kind'), render: (d) => t(`deposits.kinds.${d.kind}`) },
    {
      key: 'amount',
      header: t('deposits.columns.amount'),
      alignRight: true,
      render: (d) => <MoneyText value={d.amount} currency={d.currency} decimals={2} />,
    },
    { key: 'holder', header: t('deposits.columns.holder'), render: (d) => t(`deposits.holders.${d.holder}`) },
    { key: 'payer', header: t('deposits.columns.payer'), render: (d) => personName(d.payerPerson) || '—' },
    {
      key: 'status',
      header: t('deposits.columns.status'),
      render: (d) => (
        <div className="flex flex-wrap items-center gap-1.5">
          <StatusBadge domain="sena" status={d.status} />
          <ExpiryBadge {...d} />
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {data && data.held.length > 0 && (
        <ul className="flex flex-wrap gap-3" aria-label={t('pending.held')}>
          {data.held.map((h) => (
            <li key={`${h.currency}-${h.holder}`} className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
              <p className="text-xs text-[var(--color-muted)]">{t('pending.heldBy', { holder: t(`deposits.holders.${h.holder}`) })}</p>
              <p className="text-lg font-semibold text-[var(--color-text)]">
                <MoneyText value={h.amount} currency={h.currency} decimals={2} />
              </p>
            </li>
          ))}
        </ul>
      )}
      <DataTable
        items={data?.items ?? []}
        columns={columns}
        keyExtractor={(d) => d.id}
        loading={query.isPending}
        error={query.error}
        empty={{ title: t('pending.empty'), subtitle: t('pending.emptySubtitle'), iconName: 'wallet' }}
      />
    </div>
  );
}
