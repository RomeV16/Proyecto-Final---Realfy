'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { useCan } from '@/lib/permissions';
import { OWNER_CURRENCIES, periodOf, type OwnerBalance } from '@/lib/owner-accounts';
import { formatPeriod } from '@/lib/format';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { StatusBadge } from '@/components/ui/status-badge';
import { BalanceAmount } from './balance-amount';

/**
 * Locadores con su saldo por moneda: lo que la inmobiliaria les debe (o ellos
 * le deben), cuánto de eso está en custodia y lo que falta pagarles. Cada fila
 * abre la cuenta corriente del locador.
 */
export function OwnerBalances() {
  const t = useTranslations('ownerAccounts');
  const canView = useCan('ownerAccounts.view');
  const [currency, setCurrency] = useState('');
  const [items, setItems] = useState<OwnerBalance[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    void (async () => {
      try {
        const res = await apiClient<{ items: OwnerBalance[] }>(`/owners/balances${currency ? `?currency=${currency}` : ''}`);
        if (!cancelled) setItems(res?.items ?? []);
      } catch (err) {
        if (!cancelled) setError(err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [canView, currency]);

  if (!canView) {
    return <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>;
  }

  const columns: DataTableColumn<OwnerBalance>[] = [
    {
      key: 'name',
      header: t('balances.columns.name'),
      sortable: true,
      sortValue: (b) => b.name,
      render: (b) => (
        <Link href={`/locadores/${b.personId}?currency=${b.currency}`} className="font-medium text-[var(--color-brand-600)] hover:underline">
          {b.name}
        </Link>
      ),
    },
    { key: 'currency', header: t('balances.columns.currency'), render: (b) => b.currency },
    {
      key: 'balance',
      header: t('balances.columns.balance'),
      alignRight: true,
      sortable: true,
      sortValue: (b) => Number(b.balance),
      render: (b) => <BalanceAmount value={b.balance} currency={b.currency} />,
    },
    {
      key: 'custody',
      header: t('balances.columns.custody'),
      alignRight: true,
      render: (b) => <MoneyText value={b.custody} currency={b.currency} decimals={2} className="tabular-nums" />,
    },
    {
      key: 'payoutDue',
      header: t('balances.columns.payoutDue'),
      alignRight: true,
      sortable: true,
      sortValue: (b) => Number(b.payoutDue),
      render: (b) => <MoneyText value={b.payoutDue} currency={b.currency} decimals={2} className="tabular-nums font-medium" />,
    },
    {
      key: 'lastStatement',
      header: t('balances.columns.lastStatement'),
      render: (b) =>
        b.lastStatement ? (
          <Link href={`/estados-de-cuenta/${b.lastStatement.id}`} className="inline-flex items-center gap-2 hover:underline">
            <span>{formatPeriod(`${periodOf(b.lastStatement.period)}-01T00:00:00.000Z`)}</span>
            <StatusBadge domain="estadoCuenta" status={b.lastStatement.status} />
          </Link>
        ) : (
          <span className="text-[var(--color-muted)]">{t('balances.noStatement')}</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{t('balances.title')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('balances.subtitle')}</p>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="owner-balances-currency" className="text-xs font-medium text-[var(--color-muted)]">
            {t('balances.currency')}
          </label>
          <Select id="owner-balances-currency" value={currency} onChange={(e) => setCurrency(e.target.value)} className="w-40">
            <option value="">{t('balances.allCurrencies')}</option>
            {OWNER_CURRENCIES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
      </header>
      <DataTable
        items={items ?? []}
        columns={columns}
        keyExtractor={(b) => `${b.personId}-${b.currency}`}
        loading={items === null && error == null}
        error={error}
        empty={{ title: t('balances.empty.title'), subtitle: t('balances.empty.subtitle'), iconName: 'building' }}
      />
    </div>
  );
}
