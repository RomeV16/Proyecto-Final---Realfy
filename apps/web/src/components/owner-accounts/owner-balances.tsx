'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { apiClient } from '@/lib/api-client';
import { Link } from '@/i18n/navigation';
import { cn } from '@/lib/cn';
import { useCan } from '@/lib/permissions';
import { OWNER_CURRENCIES, periodOf, type OwnerBalance } from '@/lib/owner-accounts';
import { formatPeriod } from '@/lib/format';
import { EmptyState } from '@/components/ui/empty-state';
import { ErrorNotice } from '@/components/ui/error-notice';
import { MoneyText } from '@/components/ui/money-text';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { StatusBadge } from '@/components/ui/status-badge';
import { BalanceAmount } from './balance-amount';
import { OwnerLedger } from './owner-ledger';

const keyOf = (b: Pick<OwnerBalance, 'personId' | 'currency'>) => `${b.personId}-${b.currency}`;

/** En pantallas anchas la cuenta se abre al lado de la lista; en las angostas, el enlace lleva a su página. */
function isWide(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 1280px)').matches;
}

/** Lo que falta pagar a los locadores, sumado por moneda. */
function payoutTotals(items: readonly OwnerBalance[]): [string, number][] {
  const totals = new Map<string, number>();
  for (const b of items) totals.set(b.currency, (totals.get(b.currency) ?? 0) + Number(b.payoutDue));
  return [...totals.entries()].filter(([, total]) => total > 0.004).sort(([a], [b]) => a.localeCompare(b));
}

/**
 * Locadores con su saldo por moneda: lo que la inmobiliaria les debe (o ellos
 * le deben) y lo que falta pagarles. Al elegir uno, su cuenta corriente se abre
 * al lado (en pantallas angostas, en su propia página).
 */
export function OwnerBalances() {
  const t = useTranslations('ownerAccounts');
  const canView = useCan('ownerAccounts.view');
  const [currency, setCurrency] = useState('');
  const [items, setItems] = useState<OwnerBalance[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null);

  useEffect(() => {
    if (!canView) return;
    let cancelled = false;
    setItems(null);
    setError(null);
    void (async () => {
      try {
        const res = await apiClient<{ items: OwnerBalance[] }>(`/owners/balances${currency ? `?currency=${currency}` : ''}`);
        if (cancelled) return;
        const next = res?.items ?? [];
        setItems(next);
        // Con lugar para las dos columnas, la primera cuenta queda abierta.
        setSelected((current) => {
          if (current && next.some((b) => keyOf(b) === current)) return current;
          return isWide() && next.length > 0 ? keyOf(next[0]) : null;
        });
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

  const active = items?.find((b) => keyOf(b) === selected) ?? null;
  const totals = payoutTotals(items ?? []);

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

      {error != null && <ErrorNotice error={error} />}
      {items === null && error == null && (
        <div className="space-y-2" aria-busy="true">
          <Skeleton className="h-20 w-full rounded-2xl xl:w-96" />
          <Skeleton className="h-20 w-full rounded-2xl xl:w-96" />
        </div>
      )}
      {items !== null && items.length === 0 && (
        <EmptyState iconName="building" title={t('balances.empty.title')} subtitle={t('balances.empty.subtitle')} />
      )}

      {items !== null && items.length > 0 && (
        <div className="grid items-start gap-6 xl:grid-cols-[22rem_minmax(0,1fr)]">
          <section aria-label={t('balances.listLabel')} className="space-y-3">
            <p className="text-sm text-[var(--color-muted)]">
              {totals.length === 0 ? (
                t('balances.nothingDue')
              ) : (
                <>
                  {t('balances.totalDue')}{' '}
                  {totals.map(([c, total], i) => (
                    <span key={c}>
                      {i > 0 && ' · '}
                      <MoneyText value={total} currency={c} decimals={2} className="font-medium tabular-nums text-[var(--color-text)]" />
                    </span>
                  ))}
                </>
              )}
            </p>
            <ul className="divide-y divide-[var(--color-border)] overflow-hidden rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface)]">
              {items.map((b) => {
                const key = keyOf(b);
                const current = key === selected;
                return (
                  <li
                    key={key}
                    className={cn(
                      'relative px-4 py-3 transition-colors hover:bg-[var(--color-surface-sunken)]',
                      current && 'bg-[var(--color-surface-sunken)]',
                    )}
                  >
                    {current && <span aria-hidden className="absolute inset-y-0 left-0 w-1 bg-[var(--color-brand-500)]" />}
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          href={`/locadores/${b.personId}?currency=${b.currency}`}
                          aria-current={current ? 'true' : undefined}
                          onClick={(e) => {
                            if (!isWide()) return;
                            e.preventDefault();
                            setSelected(key);
                          }}
                          className="block truncate font-medium text-[var(--color-text)] after:absolute after:inset-0 hover:underline"
                        >
                          {b.name}
                        </Link>
                        <p className="mt-0.5 text-xs text-[var(--color-muted)]">
                          {b.currency} · {t('balances.columns.payoutDue')}{' '}
                          <MoneyText value={b.payoutDue} currency={b.currency} decimals={2} className="tabular-nums text-[var(--color-text)]" />
                        </p>
                      </div>
                      <BalanceAmount value={b.balance} currency={b.currency} className="shrink-0" />
                    </div>
                    <p className="mt-1.5 text-xs text-[var(--color-muted)]">
                      {b.lastStatement ? (
                        <Link
                          href={`/estados-de-cuenta/${b.lastStatement.id}`}
                          className="relative z-10 inline-flex items-center gap-2 hover:underline"
                        >
                          <span>
                            {t('balances.columns.lastStatement')}: {formatPeriod(`${periodOf(b.lastStatement.period)}-01T00:00:00.000Z`)}
                          </span>
                          <StatusBadge domain="estadoCuenta" status={b.lastStatement.status} />
                        </Link>
                      ) : (
                        t('balances.noStatement')
                      )}
                    </p>
                  </li>
                );
              })}
            </ul>
          </section>

          {active && (
            <div className="hidden min-w-0 xl:block">
              <OwnerLedger key={keyOf(active)} personId={active.personId} initialCurrency={active.currency} embedded />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
