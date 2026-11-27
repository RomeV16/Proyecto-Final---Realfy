/** Un inquilino en mora con su deuda vencida (`GET /penalties/delinquent-tenants`). */
export interface DelinquentTenant {
  personId: string;
  fullName: string;
  propertyId?: string;
  propertyLabel?: string;
  totalDebt: string;
  totalPenalty: string;
  daysOverdueMax: number;
}

/** Tramos de antigüedad de la deuda, del más reciente al más viejo. */
export const AGING_KEYS = ['d30', 'd60', 'd90', 'over'] as const;

export type AgingKey = (typeof AGING_KEYS)[number];

/** Color de cada tramo: del ámbar (primer mes) al rojo (más de 90 días). */
export const AGING_COLOR: Record<AgingKey, string> = {
  d30: 'var(--color-warning)',
  d60: 'color-mix(in oklab, var(--color-warning) 62%, var(--color-danger))',
  d90: 'color-mix(in oklab, var(--color-warning) 28%, var(--color-danger))',
  over: 'var(--color-danger)',
};

/** Tramo al que pertenece una deuda según los días del vencimiento impago más viejo. */
export function agingKeyOf(days: number): AgingKey {
  if (days <= 30) return 'd30';
  if (days <= 60) return 'd60';
  return days <= 90 ? 'd90' : 'over';
}

export interface AgingBucket {
  key: AgingKey;
  amount: number;
  count: number;
  /** Parte del total, de 0 a 100. */
  share: number;
}

export interface AgingSummary {
  total: number;
  penalty: number;
  oldestDays: number;
  buckets: AgingBucket[];
}

const amountOf = (value: string) => Number(value) || 0;

/** Reparte la deuda de la lista en los tramos de antigüedad. */
export function summarizeAging(items: readonly DelinquentTenant[]): AgingSummary {
  const total = items.reduce((sum, i) => sum + amountOf(i.totalDebt), 0);
  const buckets = AGING_KEYS.map((key) => {
    const inBucket = items.filter((i) => agingKeyOf(i.daysOverdueMax) === key);
    const amount = inBucket.reduce((sum, i) => sum + amountOf(i.totalDebt), 0);
    return { key, amount, count: inBucket.length, share: total > 0 ? (amount / total) * 100 : 0 };
  });
  return {
    total,
    penalty: items.reduce((sum, i) => sum + amountOf(i.totalPenalty), 0),
    oldestDays: items.reduce((max, i) => Math.max(max, i.daysOverdueMax), 0),
    buckets,
  };
}

/** Los deudores del más atrasado al menos; a igual atraso, primero el que más debe. */
export function rankDebtors(items: readonly DelinquentTenant[]): DelinquentTenant[] {
  return [...items].sort(
    (a, b) =>
      b.daysOverdueMax - a.daysOverdueMax ||
      amountOf(b.totalDebt) - amountOf(a.totalDebt) ||
      a.fullName.localeCompare(b.fullName),
  );
}
