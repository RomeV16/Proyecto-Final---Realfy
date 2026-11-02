'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { suggestedPayout, type LedgerEntry, type LedgerResponse } from '@/lib/owner-accounts';
import { Button } from '@/components/ui/button';
import { DataTable, type DataTableColumn } from '@/components/ui/data-table';
import { DateText } from '@/components/ui/date-text';
import { inputStyles } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { StatusBadge } from '@/components/ui/status-badge';
import { BalanceAmount, SignedAmount } from './balance-amount';
import { OpeningBalanceDialog } from './opening-balance-dialog';
import { PayoutDialog } from './payout-dialog';

const LIMIT = 50;

interface Props {
  personId: string;
  initialCurrency?: string;
}

/**
 * Cuenta corriente de un locador: los movimientos de una moneda con el saldo
 * después de cada uno, el saldo inicial (gerencia) y el pago al locador.
 */
export function OwnerLedger({ personId, initialCurrency = 'ARS' }: Props) {
  const t = useTranslations('ownerAccounts');
  const canView = useCan('ownerAccounts.view');
  const canManage = useCan('ownerAccounts.manage');
  const canAdminister = useCan('ownerAccounts.administer');
  const [currency, setCurrency] = useState(initialCurrency);
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<LedgerResponse | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [dialog, setDialog] = useState<'opening' | 'payout' | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ currency, page: String(page), limit: String(LIMIT) });
      if (from) params.set('from', from);
      if (to) params.set('to', to);
      setData(await apiClient<LedgerResponse>(`/owners/${personId}/ledger?${params.toString()}`));
    } catch (err) {
      setError(err);
      setData(null);
    }
  }, [personId, currency, from, to, page]);

  useEffect(() => {
    if (canView) void load();
  }, [canView, load, version]);

  if (!canView) {
    return <p className="text-sm text-[var(--color-muted)]">{t('forbidden')}</p>;
  }

  const refresh = () => setVersion((v) => v + 1);
  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };
  const name = data?.person.name ?? '';
  const currencies = [...new Set([...(data?.currencies ?? []), currency])].sort((a, b) => a.localeCompare(b));

  const columns: DataTableColumn<LedgerEntry>[] = [
    { key: 'date', header: t('ledger.columns.date'), render: (e) => <DateText value={e.date} className="whitespace-nowrap" /> },
    { key: 'type', header: t('ledger.columns.type'), render: (e) => t(`types.${e.type}`) },
    { key: 'description', header: t('ledger.columns.description'), render: (e) => e.description },
    { key: 'property', header: t('ledger.columns.property'), render: (e) => e.property ?? '—' },
    {
      key: 'amount',
      header: t('ledger.columns.amount'),
      alignRight: true,
      render: (e) => <SignedAmount value={e.amount} currency={currency} />,
    },
    {
      key: 'balance',
      header: t('ledger.columns.balance'),
      alignRight: true,
      render: (e) => <MoneyText value={e.balance} currency={currency} decimals={2} className="tabular-nums" />,
    },
    {
      key: 'statement',
      header: t('ledger.columns.statement'),
      render: (e) =>
        e.statement ? (
          <Link href={`/estados-de-cuenta/${e.statement.id}`} className="hover:underline">
            <StatusBadge domain="estadoCuenta" status={e.statement.status} />
          </Link>
        ) : (
          <span className="text-xs text-[var(--color-muted)]">{t('ledger.unlocked')}</span>
        ),
    },
  ];

  return (
    <div className="space-y-6">
      <Link href="/locadores" className="text-sm text-[var(--color-brand-600)] hover:underline">
        ← {t('ledger.back')}
      </Link>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-[var(--color-text)]">{name ? t('ledger.title', { name }) : t('ledger.titleLoading')}</h1>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('ledger.subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canAdminister && (
            <Button type="button" variant="secondary" disabled={!data} onClick={() => setDialog('opening')}>
              {t('ledger.openingBalance')}
            </Button>
          )}
          {canManage && (
            <Button type="button" disabled={!data} onClick={() => setDialog('payout')}>
              {t('ledger.payout')}
            </Button>
          )}
        </div>
      </header>

      <div
        role="tablist"
        aria-label={t('ledger.currencies')}
        className="flex w-fit gap-1 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-sunken)] p-1"
      >
        {currencies.map((c) => (
          <button
            key={c}
            type="button"
            role="tab"
            aria-selected={c === currency}
            onClick={() => filter(() => setCurrency(c))}
            className={cn(
              'rounded-md px-3.5 py-1.5 text-sm font-medium transition-colors',
              c === currency
                ? 'bg-[var(--color-surface)] text-[var(--color-text)] shadow-sm'
                : 'text-[var(--color-muted)] hover:text-[var(--color-text)]',
            )}
          >
            {c}
          </button>
        ))}
      </div>

      {data && (
        <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3" aria-label={t('ledger.summary', { currency })}>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <dt className="text-xs text-[var(--color-muted)]">{from ? t('ledger.openingAt', { date: formatDate(from) }) : t('ledger.opening')}</dt>
            <dd className="mt-1">
              <MoneyText value={data.opening} currency={currency} decimals={2} className="tabular-nums font-semibold" />
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <dt className="text-xs text-[var(--color-muted)]">{t('ledger.closing')}</dt>
            <dd className="mt-1">
              <BalanceAmount value={data.closing} currency={currency} className="items-start" />
            </dd>
          </div>
          <div className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
            <dt className="text-xs text-[var(--color-muted)]">{t('ledger.custody')}</dt>
            <dd className="mt-1">
              <MoneyText value={data.custody} currency={currency} decimals={2} className="tabular-nums font-semibold" />
            </dd>
          </div>
        </dl>
      )}

      <div className="flex flex-wrap items-end gap-4">
        <div className="flex flex-col gap-1">
          <label htmlFor="ledger-from" className="text-xs font-medium text-[var(--color-muted)]">
            {t('ledger.from')}
          </label>
          <input id="ledger-from" type="date" value={from} onChange={(e) => filter(() => setFrom(e.target.value))} className={inputStyles({ className: 'w-40' })} />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="ledger-to" className="text-xs font-medium text-[var(--color-muted)]">
            {t('ledger.to')}
          </label>
          <input id="ledger-to" type="date" value={to} onChange={(e) => filter(() => setTo(e.target.value))} className={inputStyles({ className: 'w-40' })} />
        </div>
      </div>

      <DataTable
        items={data?.items ?? []}
        columns={columns}
        keyExtractor={(e) => e.id}
        loading={data === null && error == null}
        error={error}
        pagination={
          data && data.totalPages > 1
            ? { page: data.page, totalPages: data.totalPages, total: data.total, limit: data.limit, onPageChange: setPage }
            : undefined
        }
        empty={{ title: t('ledger.empty.title'), subtitle: t('ledger.empty.subtitle'), iconName: 'wallet' }}
      />

      {dialog === 'opening' && (
        <OpeningBalanceDialog personId={personId} personName={name} currency={currency} onClose={() => setDialog(null)} onDone={refresh} />
      )}
      {dialog === 'payout' && data && (
        <PayoutDialog
          personId={personId}
          personName={name}
          currency={currency}
          suggested={suggestedPayout(data.closing, data.custody)}
          onClose={() => setDialog(null)}
          onDone={refresh}
        />
      )}
    </div>
  );
}
