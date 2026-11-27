/** Un cobro como lo devuelve `GET /payments`. */
export interface PaymentRow {
  id: string;
  amount: string;
  currency: string;
  method: string;
  paidAt: string;
  reference?: string | null;
  liquidacion?: { period?: string | null; contract?: { id: string } | null } | null;
  account?: { id: string; name: string } | null;
}

export interface CurrencyTotal {
  currency: string;
  /** Importe con 2 decimales. */
  amount: string;
  count: number;
}

export interface MethodShare {
  method: string;
  amount: string;
  count: number;
  /** Parte del total de la moneda, de 0 a 100. */
  share: number;
}

export interface StatementDay {
  /** `YYYY-MM-DD`: el día de cobro que se cargó. */
  day: string;
  items: PaymentRow[];
  totals: CurrencyTotal[];
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Centavos de un importe de la API: las sumas se hacen en enteros. */
export function toCents(amount: string | number | null | undefined): number {
  const value = Number(amount ?? 0);
  return Number.isFinite(value) ? Math.round(value * 100) : 0;
}

export const fromCents = (cents: number): string => (cents / 100).toFixed(2);

/**
 * Día calendario de un cobro (`YYYY-MM-DD`), o null si la fecha no se lee. La fecha de cobro se carga como un día
 * y la API la guarda a medianoche UTC: se lee en UTC, igual que la fecha del movimiento de caja que genera. Leída
 * en la zona del navegador, en Argentina un cobro del 1 caería en el día 31 del mes anterior.
 */
export function dayKey(paidAt: string): string | null {
  const date = new Date(paidAt);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}

/** Mes de un cobro (`YYYY-MM`). */
export function monthKey(paidAt: string): string | null {
  return dayKey(paidAt)?.slice(0, 7) ?? null;
}

export function currentMonthKey(now = new Date()): string {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}`;
}

/** Meses con cobros, del más reciente al más viejo. */
export function availableMonths(payments: readonly PaymentRow[]): string[] {
  const months = new Set<string>();
  for (const p of payments) {
    const key = monthKey(p.paidAt);
    if (key) months.add(key);
  }
  return [...months].sort((a, b) => b.localeCompare(a));
}

/** El mes en curso si tiene cobros; si no, el último mes con cobros (o el mes en curso si no hay ninguno). */
export function defaultMonth(months: readonly string[], now = new Date()): string {
  const current = currentMonthKey(now);
  return months.includes(current) ? current : (months[0] ?? current);
}

export function paymentsOfMonth(payments: readonly PaymentRow[], month: string): PaymentRow[] {
  return payments.filter((p) => monthKey(p.paidAt) === month);
}

/** Total y cantidad por moneda; primero la moneda con más cobros. */
export function totalsByCurrency(items: readonly PaymentRow[]): CurrencyTotal[] {
  const byCurrency = new Map<string, { cents: number; count: number }>();
  for (const p of items) {
    const entry = byCurrency.get(p.currency) ?? { cents: 0, count: 0 };
    entry.cents += toCents(p.amount);
    entry.count += 1;
    byCurrency.set(p.currency, entry);
  }
  return [...byCurrency.entries()]
    .map(([currency, { cents, count }]) => ({ currency, amount: fromCents(cents), count }))
    .sort((a, b) => b.count - a.count || a.currency.localeCompare(b.currency));
}

/** Lo cobrado en una moneda repartido por medio de pago, de mayor a menor. */
export function methodBreakdown(items: readonly PaymentRow[], currency: string): MethodShare[] {
  const byMethod = new Map<string, { cents: number; count: number }>();
  let total = 0;
  for (const p of items) {
    if (p.currency !== currency) continue;
    const cents = toCents(p.amount);
    const entry = byMethod.get(p.method) ?? { cents: 0, count: 0 };
    entry.cents += cents;
    entry.count += 1;
    byMethod.set(p.method, entry);
    total += cents;
  }
  return [...byMethod.entries()]
    .map(([method, { cents, count }]) => ({
      method,
      amount: fromCents(cents),
      count,
      share: total > 0 ? (cents / total) * 100 : 0,
    }))
    .sort((a, b) => Number(b.amount) - Number(a.amount));
}

/** Los cobros agrupados por día, del más reciente al más viejo, con el total de cada día. */
export function groupByDay(items: readonly PaymentRow[]): StatementDay[] {
  const byDay = new Map<string, PaymentRow[]>();
  for (const p of items) {
    const key = dayKey(p.paidAt);
    if (!key) continue;
    byDay.set(key, [...(byDay.get(key) ?? []), p]);
  }
  return [...byDay.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([day, rows]) => ({ day, items: rows, totals: totalsByCurrency(rows) }));
}

/** El mes anterior o siguiente de la lista (ordenada del más reciente al más viejo), o null en el borde. */
export function neighbourMonth(months: readonly string[], month: string, step: 'older' | 'newer'): string | null {
  const index = months.indexOf(month);
  if (index === -1) return null;
  return months[index + (step === 'older' ? 1 : -1)] ?? null;
}
