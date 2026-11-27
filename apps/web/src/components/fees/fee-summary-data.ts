import { FeeInstallmentStatus, FeeStatus } from '@realfy/shared';
import type { InstallmentItem } from '@/lib/fees';

type SummaryRow = Pick<InstallmentItem, 'dueDate' | 'status' | 'dueAmount' | 'paidAmount'> & {
  fee: Pick<InstallmentItem['fee'], 'status' | 'currency'>;
};

export interface MonthBucket {
  /** `YYYY-MM`. */
  month: string;
  collected: number;
  pending: number;
}

export interface FeeSummaryData {
  currency: string;
  buckets: MonthBucket[];
  collected: number;
  pending: number;
  /** Parte de lo pendiente cuyo vencimiento ya pasó. */
  overdue: number;
  /** Cuotas contadas (sin las anuladas). */
  count: number;
  /** Otras monedas con cuotas en el período, que no entran en los importes. */
  otherCurrencies: string[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Los `count` meses que terminan en el mes en curso, del más viejo al más nuevo (`YYYY-MM`). */
export function summaryMonths(now = new Date(), count = 6): string[] {
  const months: string[] = [];
  for (let back = count - 1; back >= 0; back -= 1) {
    const date = new Date(now.getFullYear(), now.getMonth() - back, 1);
    months.push(`${date.getFullYear()}-${pad(date.getMonth() + 1)}`);
  }
  return months;
}

export function todayKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

const cents = (amount: string | null | undefined): number => {
  const value = Number(amount ?? 0);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
};

/**
 * Resume las cuotas que vencen en los meses dados: cuánto se cobró y cuánto falta, mes a mes y en total, en la
 * moneda con más cuotas. Las cuotas anuladas (o de un honorario anulado) no cuentan. Los importes van en centavos.
 */
export function summarizeInstallments(rows: readonly SummaryRow[], months: readonly string[], today: string): FeeSummaryData {
  const live = rows.filter(
    (row) => row.status !== FeeInstallmentStatus.Anulada && row.fee.status !== FeeStatus.Anulado && months.includes(row.dueDate.slice(0, 7)),
  );
  const perCurrency = new Map<string, number>();
  for (const row of live) perCurrency.set(row.fee.currency, (perCurrency.get(row.fee.currency) ?? 0) + 1);
  const ranked = [...perCurrency.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const currency = ranked[0]?.[0] ?? 'ARS';

  const buckets = new Map<string, MonthBucket>(months.map((month) => [month, { month, collected: 0, pending: 0 }]));
  let overdue = 0;
  let count = 0;
  for (const row of live) {
    if (row.fee.currency !== currency) continue;
    const bucket = buckets.get(row.dueDate.slice(0, 7))!;
    count += 1;
    if (row.status === FeeInstallmentStatus.Pagada) {
      bucket.collected += cents(row.paidAmount ?? row.dueAmount);
    } else {
      const due = cents(row.dueAmount);
      bucket.pending += due;
      if (row.dueDate.slice(0, 10) < today) overdue += due;
    }
  }
  const list = [...buckets.values()];
  return {
    currency,
    buckets: list,
    collected: list.reduce((sum, b) => sum + b.collected, 0),
    pending: list.reduce((sum, b) => sum + b.pending, 0),
    overdue,
    count,
    otherCurrencies: ranked.slice(1).map(([c]) => c),
  };
}
