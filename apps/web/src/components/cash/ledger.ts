import { CashDirection } from '@realfy/shared';
import type { CashMovementRow } from '@/lib/cash';

/** Centavos de un importe de la API: los saldos se arrastran en enteros. */
export function toCents(amount: string | number | null | undefined): number {
  const value = Number(amount ?? 0);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export const fromCents = (cents: number): string => (cents / 100).toFixed(2);

/** Centavos con signo de un movimiento: la salida resta. */
export function signedCents(row: Pick<CashMovementRow, 'direction' | 'amount'>): number {
  const cents = toCents(row.amount);
  return row.direction === CashDirection.Out ? -cents : cents;
}

export interface LedgerBalances {
  /** Saldo de la cuenta después de cada movimiento, en el orden de las filas. */
  after: string[];
  /** Saldo antes del movimiento más viejo de la lista. */
  opening: string;
}

/**
 * Saldo fila por fila de un libro ordenado del movimiento más nuevo al más viejo: `closing` es el saldo después
 * del primero de la lista y cada fila descuenta la anterior.
 */
export function runningBalances(rows: readonly Pick<CashMovementRow, 'direction' | 'amount'>[], closing: number): LedgerBalances {
  const after: string[] = [];
  let balance = closing;
  for (const row of rows) {
    after.push(fromCents(balance));
    balance -= signedCents(row);
  }
  return { after, opening: fromCents(balance) };
}

export interface LedgerTotals {
  currency: string;
  in: string;
  out: string;
}

/** Ingresos y egresos de las filas, por moneda. */
export function ledgerTotals(rows: readonly Pick<CashMovementRow, 'direction' | 'amount' | 'currency'>[]): LedgerTotals[] {
  const byCurrency = new Map<string, { in: number; out: number }>();
  for (const row of rows) {
    const entry = byCurrency.get(row.currency) ?? { in: 0, out: 0 };
    if (row.direction === CashDirection.Out) entry.out += toCents(row.amount);
    else entry.in += toCents(row.amount);
    byCurrency.set(row.currency, entry);
  }
  return [...byCurrency.entries()]
    .map(([currency, t]) => ({ currency, in: fromCents(t.in), out: fromCents(t.out) }))
    .sort((a, b) => a.currency.localeCompare(b.currency));
}

export type CountResult = { state: 'empty' } | { state: 'invalid' } | { state: 'match' | 'over' | 'short'; difference: string };

/** Arqueo: compara lo contado (texto del campo, con coma o punto) con el saldo del sistema. */
export function compareCount(counted: string, systemBalance: string): CountResult {
  const text = counted.trim().replace(/\s/g, '');
  if (text === '') return { state: 'empty' };
  // "150.000,50" y "150.000" llevan el punto como separador de miles; "150000.5" lo lleva como decimal.
  const thousands = text.includes(',') || /^\d{1,3}(\.\d{3})+$/.test(text);
  const normalized = thousands ? text.replace(/\./g, '').replace(',', '.') : text;
  if (!/^\d+(\.\d{1,2})?$/.test(normalized)) return { state: 'invalid' };
  const difference = toCents(normalized) - toCents(systemBalance);
  if (difference === 0) return { state: 'match', difference: '0.00' };
  return { state: difference > 0 ? 'over' : 'short', difference: fromCents(Math.abs(difference)) };
}
