'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { CashDirection } from '@realfy/shared';
import { personLabel, type CashMovementRow, type FinancialAccount } from '@/lib/cash';
import { cn } from '@/lib/cn';
import { DateText } from '@/components/ui/date-text';
import { inputStyles } from '@/components/ui/input';
import { MoneyText } from '@/components/ui/money-text';
import { compareCount, ledgerTotals, type LedgerBalances } from './ledger';

interface LedgerProps {
  rows: CashMovementRow[];
  /** Con una sola cuenta elegida se oculta la columna de la cuenta. */
  singleAccount: boolean;
  /** Saldo después de cada fila; sin él no hay columna de saldo. */
  balances: LedgerBalances | null;
}

const GRID = {
  all: 'md:grid-cols-[96px_minmax(0,1fr)_160px_132px_132px]',
  single: 'md:grid-cols-[96px_minmax(0,1fr)_132px_132px]',
  balance: 'md:grid-cols-[96px_minmax(0,1fr)_132px_132px_148px]',
};

const ROW = 'grid grid-cols-[minmax(0,1fr)_auto] gap-x-4 px-4 md:items-baseline md:px-5';
const HEAD = 'text-[11px] font-medium uppercase tracking-[0.1em] text-[var(--color-muted)]';
const NUM = 'font-mono text-[13px] tabular-nums';

/**
 * Libro de caja: una fila por movimiento con los ingresos y los egresos en columnas separadas y, cuando se mira
 * una sola cuenta, el saldo que quedó después de cada uno. Al pie, los totales de la página y el saldo anterior.
 */
export function CashLedger({ rows, singleAccount, balances }: LedgerProps) {
  const t = useTranslations('cash');
  const grid = balances ? GRID.balance : singleAccount ? GRID.single : GRID.all;
  const totals = ledgerTotals(rows);

  return (
    <div
      role="table"
      aria-label={t('ledger.label')}
      className="overflow-hidden rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)]"
    >
      <div role="row" className={cn(ROW, grid, 'hidden border-b border-[var(--color-border)] bg-[var(--color-surface-sunken)] py-2.5 md:grid')}>
        <span role="columnheader" className={HEAD}>
          {t('ledger.columns.date')}
        </span>
        <span role="columnheader" className={HEAD}>
          {t('ledger.columns.concept')}
        </span>
        {!singleAccount && (
          <span role="columnheader" className={HEAD}>
            {t('ledger.columns.account')}
          </span>
        )}
        <span role="columnheader" className={cn(HEAD, 'text-right')}>
          {t('ledger.columns.in')}
        </span>
        <span role="columnheader" className={cn(HEAD, 'text-right')}>
          {t('ledger.columns.out')}
        </span>
        {balances && (
          <span role="columnheader" className={cn(HEAD, 'text-right')}>
            {t('ledger.columns.balance')}
          </span>
        )}
      </div>

      {rows.map((m, i) => {
        const isIn = m.direction !== CashDirection.Out;
        const person = personLabel(m.counterparty);
        const source =
          m.sourceType && m.sourceType !== 'Manual'
            ? `${t.has(`sources.${m.sourceType}`) ? t(`sources.${m.sourceType}`) : m.sourceType}${m.rate ? ` · ${t('movements.rate', { rate: m.rate })}` : ''}`
            : null;
        return (
          <div
            key={m.id}
            role="row"
            className={cn(
              ROW,
              grid,
              'border-b border-[var(--color-border)] py-2.5 transition-colors hover:bg-[color-mix(in_oklab,var(--color-brand-500)_4%,var(--color-surface))]',
            )}
          >
            <span role="cell" className="col-start-1 row-start-1 md:col-start-auto md:row-start-auto">
              <DateText value={m.date} className="whitespace-nowrap font-mono text-xs text-[var(--color-muted)] tabular-nums md:text-[13px]" />
            </span>
            <div role="cell" className="col-start-1 row-start-2 min-w-0 md:col-start-auto md:row-start-auto">
              <p className="text-sm font-medium text-[var(--color-text)]">{t(`categories.${m.category}`)}</p>
              {(person || m.note || source) && (
                <p className="flex flex-wrap gap-x-1.5 text-xs text-[var(--color-muted)] [&>span+span]:before:mr-1.5 [&>span+span]:before:text-[var(--color-muted)] [&>span+span]:before:content-['·']">
                  {person && <span>{person}</span>}
                  {m.note && <span className="text-[var(--color-text)]">{m.note}</span>}
                  {source && <span>{source}</span>}
                </p>
              )}
            </div>
            {!singleAccount && (
              <span role="cell" className="col-start-1 row-start-3 truncate text-xs text-[var(--color-muted)] md:col-start-auto md:row-start-auto md:text-sm md:text-[var(--color-text)]">
                {m.account.name}
              </span>
            )}
            <span
              role="cell"
              className={cn(NUM, 'col-start-2 row-start-1 text-right font-medium text-[var(--color-success)] md:col-start-auto md:row-start-auto', !isIn && 'hidden md:block')}
            >
              {isIn && <MoneyText value={m.amount} currency={m.currency} decimals={2} />}
            </span>
            <span
              role="cell"
              className={cn(NUM, 'col-start-2 row-start-1 text-right font-medium text-[var(--color-danger)] md:col-start-auto md:row-start-auto', isIn && 'hidden md:block')}
            >
              {!isIn && <MoneyText value={`-${m.amount}`} currency={m.currency} decimals={2} />}
            </span>
            {balances && (
              <span role="cell" className={cn(NUM, 'col-start-2 row-start-2 text-right text-[var(--color-text)] md:col-start-auto md:row-start-auto')}>
                <span className="mr-1.5 font-sans text-[11px] text-[var(--color-muted)] md:hidden">{t('ledger.columns.balance')}</span>
                <MoneyText value={balances.after[i]} currency={m.currency} decimals={2} />
              </span>
            )}
          </div>
        );
      })}

      {totals.map((total) => (
        <div
          key={total.currency}
          role="row"
          className={cn(ROW, grid, 'border-b border-[var(--color-border)] bg-[color-mix(in_oklab,var(--color-surface-sunken)_60%,var(--color-surface))] py-2.5 last:border-b-0')}
        >
          <span role="cell" className="col-span-2 text-xs font-medium text-[var(--color-text)] md:col-span-1 md:col-start-2">
            {totals.length > 1 ? t('ledger.pageTotalsIn', { currency: total.currency }) : t('ledger.pageTotals')}
          </span>
          {!singleAccount && <span role="cell" className="hidden md:block" />}
          <span role="cell" className={cn(NUM, 'font-semibold text-[var(--color-success)] md:text-right')}>
            <span className="mr-1.5 font-sans text-[11px] font-normal text-[var(--color-muted)] md:hidden">{t('ledger.columns.in')}</span>
            <MoneyText value={total.in} currency={total.currency} decimals={2} />
          </span>
          <span role="cell" className={cn(NUM, 'text-right font-semibold text-[var(--color-danger)]')}>
            <span className="mr-1.5 font-sans text-[11px] font-normal text-[var(--color-muted)] md:hidden">{t('ledger.columns.out')}</span>
            <MoneyText value={Number(total.out) === 0 ? total.out : `-${total.out}`} currency={total.currency} decimals={2} />
          </span>
          {balances && <span role="cell" className="hidden md:block" />}
        </div>
      ))}

      {balances && rows.length > 0 && (
        <div role="row" className={cn(ROW, 'py-2.5')}>
          <span role="cell" className="text-xs text-[var(--color-muted)]">
            {t('ledger.openingRow')}
          </span>
          <span role="cell" className={cn(NUM, 'text-right text-[var(--color-text)]')}>
            <MoneyText value={balances.opening} currency={rows[0].currency} decimals={2} />
          </span>
        </div>
      )}
    </div>
  );
}

/* ──────────── Arqueo ──────────── */

/**
 * Arqueo de una cuenta: se escribe lo contado y se compara con el saldo del sistema. Es una comprobación en
 * pantalla; no guarda nada.
 */
export function CashCount({ account }: { account: FinancialAccount }) {
  const t = useTranslations('cash');
  const [counted, setCounted] = useState('');
  const result = compareCount(counted, account.balance);
  const id = `cash-count-${account.id}`;

  return (
    <aside
      aria-label={t('count.title', { name: account.name })}
      className="rounded-xl border border-dashed border-[var(--color-border)] bg-[var(--color-surface)] p-4"
    >
      <h3 className="text-sm font-semibold text-[var(--color-text)]">{t('count.title', { name: account.name })}</h3>
      <dl className="mt-3 grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 text-[13px]">
        <dt className="text-[var(--color-muted)]">{t('count.system')}</dt>
        <dd className={cn(NUM, 'text-right text-[var(--color-text)]')}>
          <MoneyText value={account.balance} currency={account.currency} decimals={2} />
        </dd>
        <dt>
          <label htmlFor={id} className="text-[var(--color-muted)]">
            {t('count.counted', { currency: account.currency })}
          </label>
        </dt>
        <dd>
          <input
            id={id}
            inputMode="decimal"
            autoComplete="off"
            value={counted}
            onChange={(e) => setCounted(e.target.value)}
            placeholder="0,00"
            aria-invalid={result.state === 'invalid'}
            className={inputStyles({ className: 'h-9 w-32 text-right font-mono text-[13px] tabular-nums' })}
          />
        </dd>
        <dt className="text-[var(--color-muted)]">{t('count.difference')}</dt>
        <dd
          role="status"
          className={cn(
            'text-right text-sm font-medium',
            result.state === 'match' && 'text-[var(--color-success)]',
            (result.state === 'over' || result.state === 'short') && 'text-[var(--color-danger)]',
            (result.state === 'empty' || result.state === 'invalid') && 'text-[var(--color-muted)]',
          )}
        >
          {result.state === 'empty' && '—'}
          {result.state === 'invalid' && t('count.invalid')}
          {result.state === 'match' && t('count.match')}
          {(result.state === 'over' || result.state === 'short') && (
            <>
              {t(`count.${result.state}`)}{' '}
              <MoneyText value={result.difference} currency={account.currency} decimals={2} className={NUM} />
            </>
          )}
        </dd>
      </dl>
      <p className="mt-3 text-xs text-[var(--color-muted)]">{t('count.hint')}</p>
    </aside>
  );
}
