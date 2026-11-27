'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { FinancialAccountKind } from '@realfy/shared';
import { apiClient } from '@/lib/api-client';
import { CASH_CATEGORIES, type CashMovementRow, type FinancialAccount, type Paged } from '@/lib/cash';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { inputStyles } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { PaginationBar } from '@/components/ui/pagination';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { CashCount, CashLedger } from './cash-ledger';
import { ConversionForm } from './conversion-form';
import { runningBalances, signedCents, toCents } from './ledger';
import { MovementForm } from './movement-form';
import { useContractOptions } from './use-cash-data';

const LIMIT = 50;

interface Props {
  accounts: FinancialAccount[];
  /** Las cuentas ya se leyeron (o fallaron): recién ahí se sabe qué cuenta abrir. */
  ready: boolean;
  canManage: boolean;
  /** Después de cargar un movimiento cambian los saldos de las cuentas. */
  onChanged: () => void;
}

/** La cuenta que abre el libro: la caja de la inmobiliaria o, si no hay, su primera cuenta activa. */
function defaultAccount(accounts: readonly FinancialAccount[]): FinancialAccount | undefined {
  const own = accounts.filter((a) => a.isActive && a.kind !== FinancialAccountKind.Custodia);
  return own.find((a) => a.kind === FinancialAccountKind.Caja) ?? own[0];
}

/**
 * Libro de caja: los movimientos de una cuenta con ingresos, egresos y el saldo después de cada uno, los filtros,
 * el arqueo de la cuenta, y la carga manual y las conversiones de moneda.
 */
export function MovementsPanel({ accounts, ready, canManage, onChanged }: Props) {
  const t = useTranslations('cash');
  const contracts = useContractOptions(true);
  const [chosenAccount, setChosenAccount] = useState<string | null>(null);
  const [category, setCategory] = useState('');
  const [contractId, setContractId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<(Paged<CashMovementRow> & { query: string }) | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [version, setVersion] = useState(0);
  const [form, setForm] = useState<'movement' | 'conversion' | null>(null);
  // Saldo con el que arranca cada página ya recorrida de la cuenta, para seguir el saldo fila por fila.
  const [carried, setCarried] = useState<Record<string, number>>({});

  const accountId = chosenAccount ?? defaultAccount(accounts)?.id ?? '';
  const account = accounts.find((a) => a.id === accountId);

  const query = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), limit: String(LIMIT) });
    if (accountId) params.set('accountId', accountId);
    if (category) params.set('category', category);
    if (contractId) params.set('contractId', contractId);
    if (from) params.set('from', from);
    if (to) params.set('to', to);
    return params.toString();
  }, [accountId, category, contractId, from, to, page]);

  // La última consulta pedida: una respuesta vieja que llega tarde no pisa a la que está en pantalla.
  const latestQuery = useRef(query);
  useEffect(() => {
    latestQuery.current = query;
  }, [query]);

  const load = useCallback(async () => {
    setError(null);
    try {
      const res = await apiClient<Paged<CashMovementRow>>(`/cash-movements?${query}`);
      if (latestQuery.current !== query) return;
      setData({ ...res, items: res?.items ?? [], query });
    } catch (err) {
      if (latestQuery.current !== query) return;
      setError(err);
      setData(null);
    }
  }, [query]);

  useEffect(() => {
    if (ready) void load();
  }, [ready, load, version]);

  const filter = (apply: () => void) => {
    apply();
    setPage(1);
  };
  const saved = () => {
    setCarried({});
    setPage(1);
    setVersion((v) => v + 1);
    onChanged();
  };

  const rows = data?.items ?? [];
  const fresh = data?.query === query;
  // El saldo fila por fila sale del saldo actual de la cuenta: solo vale si la lista no saltea movimientos.
  const chainKey = (p: number) => `${accountId}|${from}|${account?.balance ?? ''}|${p}`;
  const closing =
    account && fresh && !category && !contractId && !to
      ? page === 1
        ? toCents(account.balance)
        : carried[chainKey(page)]
      : undefined;
  const balances = closing === undefined ? null : runningBalances(rows, closing);

  useEffect(() => {
    if (closing === undefined) return;
    const next = chainKey(page + 1);
    const opening = closing - rows.reduce((sum, row) => sum + signedCents(row), 0);
    setCarried((prev) => (prev[next] === opening ? prev : { ...prev, [next]: opening }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [closing, data, page]);

  const loading = (data === null && error == null) || (!fresh && error == null);

  return (
    <section className="space-y-5" aria-labelledby="cash-movements-title">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="cash-movements-title" className="text-base font-semibold text-[var(--color-text)]">
            {account ? t('ledger.titleOf', { name: account.name }) : t('ledger.titleAll')}
          </h2>
          {account && (
            <p className="mt-0.5 text-sm text-[var(--color-muted)]">
              {t('ledger.currentBalance')}{' '}
              <MoneyText
                value={account.balance}
                currency={account.currency}
                decimals={2}
                className="font-mono text-[15px] font-medium text-[var(--color-text)] tabular-nums"
              />
            </p>
          )}
        </div>
        {canManage && (
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="secondary" onClick={() => setForm('conversion')}>
              {t('conversion.open')}
            </Button>
            <Button type="button" onClick={() => setForm('movement')}>
              {t('movements.add')}
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 md:flex md:flex-wrap md:items-end md:gap-4">
        <div className="col-span-2 flex flex-col gap-1">
          <label htmlFor="cash-filter-account" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.account')}
          </label>
          <Select
            id="cash-filter-account"
            value={accountId}
            onChange={(e) => filter(() => setChosenAccount(e.target.value))}
            className="md:w-56"
          >
            <option value="">{t('filters.allAccounts')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name} ({a.currency})
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-filter-category" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.category')}
          </label>
          <Select id="cash-filter-category" value={category} onChange={(e) => filter(() => setCategory(e.target.value))} className="md:w-48">
            <option value="">{t('filters.allCategories')}</option>
            {CASH_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`categories.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-filter-contract" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.contract')}
          </label>
          <Select id="cash-filter-contract" value={contractId} onChange={(e) => filter(() => setContractId(e.target.value))} className="md:w-56">
            <option value="">{t('filters.allContracts')}</option>
            {contracts.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-filter-from" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.from')}
          </label>
          <input
            id="cash-filter-from"
            type="date"
            value={from}
            onChange={(e) => filter(() => setFrom(e.target.value))}
            className={inputStyles({ className: 'md:w-40' })}
          />
        </div>
        <div className="flex flex-col gap-1">
          <label htmlFor="cash-filter-to" className="text-xs font-medium text-[var(--color-muted)]">
            {t('filters.to')}
          </label>
          <input
            id="cash-filter-to"
            type="date"
            value={to}
            onChange={(e) => filter(() => setTo(e.target.value))}
            className={inputStyles({ className: 'md:w-40' })}
          />
        </div>
      </div>

      {error != null && <ErrorNotice error={error} />}

      {error == null && loading && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      )}

      {error == null && !loading && rows.length === 0 && (
        <div className="rounded-xl border border-dashed border-[var(--color-border)]">
          <EmptyState
            iconName="wallet"
            variant={category || contractId || from || to ? 'filtered' : 'default'}
            title={t('movements.empty.title')}
            subtitle={category || contractId || from || to ? t('ledger.emptyFiltered') : t('movements.empty.subtitle')}
          />
        </div>
      )}

      {error == null && !loading && rows.length > 0 && data && (
        <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_300px]">
          <div className="space-y-2">
            <CashLedger rows={rows} singleAccount={!!account} balances={balances} />
            {!balances && <p className="text-xs text-[var(--color-muted)]">{account ? t('ledger.balanceHidden') : t('ledger.balanceNeedsAccount')}</p>}
            {data.totalPages > 1 && (
              <PaginationBar page={data.page} totalPages={data.totalPages} total={data.total} limit={data.limit} onPageChange={setPage} />
            )}
          </div>
          {account && <CashCount key={account.id} account={account} />}
        </div>
      )}

      {form === 'movement' && (
        <MovementForm accounts={accounts} contracts={contracts} onClose={() => setForm(null)} onSaved={saved} />
      )}
      {form === 'conversion' && <ConversionForm accounts={accounts} onClose={() => setForm(null)} onSaved={saved} />}
    </section>
  );
}
