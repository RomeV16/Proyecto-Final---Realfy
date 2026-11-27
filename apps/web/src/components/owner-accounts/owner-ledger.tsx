'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { formatDate } from '@/lib/format';
import { useCan } from '@/lib/permissions';
import { suggestedPayout, type LedgerResponse } from '@/lib/owner-accounts';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { inputStyles } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { PaginationBar } from '@/components/ui/pagination';
import { Skeleton } from '@/components/ui/skeleton';
import { BalanceAmount } from './balance-amount';
import { LedgerTable } from './ledger-table';
import { OpeningBalanceDialog } from './opening-balance-dialog';
import { PayoutDialog } from './payout-dialog';

const LIMIT = 50;

interface Props {
  personId: string;
  initialCurrency?: string;
  /** Dentro del maestro-detalle de locadores: sin el enlace de vuelta y con el título como subtítulo. */
  embedded?: boolean;
}

/**
 * Cuenta corriente de un locador: los movimientos de una moneda en debe y haber
 * con el saldo acumulado, el saldo inicial (gerencia) y el pago al locador.
 */
export function OwnerLedger({ personId, initialCurrency = 'ARS', embedded = false }: Props) {
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

  const Heading = embedded ? 'h2' : 'h1';
  const lastPage = !data || data.page >= Math.max(data.totalPages, 1);

  return (
    <div className="space-y-6">
      {!embedded && (
        <Link href="/locadores" className="text-sm text-[var(--color-brand-600)] hover:underline">
          ← {t('ledger.back')}
        </Link>
      )}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Heading className={cn('font-semibold text-[var(--color-text)]', embedded ? 'text-lg' : 'text-2xl')}>
            {name ? t('ledger.title', { name }) : t('ledger.titleLoading')}
          </Heading>
          <p className="mt-1 max-w-2xl text-sm text-[var(--color-muted)]">{t('ledger.subtitle')}</p>
          {embedded && (
            <Link
              href={`/locadores/${personId}?currency=${currency}`}
              className="mt-1 inline-block text-sm text-[var(--color-brand-600)] hover:underline"
            >
              {t('ledger.fullPage')}
            </Link>
          )}
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
        <dl
          className="grid grid-cols-1 divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)] sm:grid-cols-3 sm:divide-x sm:divide-y-0"
          aria-label={t('ledger.summary', { currency })}
        >
          <div className="p-4">
            <dt className="text-xs text-[var(--color-muted)]">{to ? t('ledger.closingAt', { date: formatDate(to) }) : t('ledger.closing')}</dt>
            <dd className="mt-1 text-lg">
              <BalanceAmount value={data.closing} currency={currency} className="items-start" />
            </dd>
          </div>
          <div className="p-4">
            <dt className="text-xs text-[var(--color-muted)]">{t('ledger.custody')}</dt>
            <dd className="mt-1">
              <MoneyText value={data.custody} currency={currency} decimals={2} className="tabular-nums font-semibold" />
            </dd>
          </div>
          <div className="p-4">
            <dt className="text-xs text-[var(--color-muted)]">{from ? t('ledger.openingAt', { date: formatDate(from) }) : t('ledger.opening')}</dt>
            <dd className="mt-1">
              <MoneyText value={data.opening} currency={currency} decimals={2} className="tabular-nums font-semibold" />
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

      {error != null && <ErrorNotice error={error} />}
      {data === null && error == null && <Skeleton className="h-48 w-full rounded-2xl" />}
      {data && data.items.length === 0 && (
        <EmptyState variant="filtered" iconName="wallet" title={t('ledger.empty.title')} subtitle={t('ledger.empty.subtitle')} />
      )}
      {data && data.items.length > 0 && (
        <div>
          <LedgerTable
            entries={data.items}
            currency={currency}
            opening={from && data.page === 1 ? data.opening : undefined}
            closing={lastPage ? data.closing : undefined}
          />
          {data.totalPages > 1 && (
            <PaginationBar page={data.page} totalPages={data.totalPages} total={data.total} limit={data.limit} onPageChange={setPage} />
          )}
        </div>
      )}

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
