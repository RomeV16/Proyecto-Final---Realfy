import { describe, expect, it } from 'vitest';
import {
  availableMonths,
  currentMonthKey,
  dayKey,
  defaultMonth,
  fromCents,
  groupByDay,
  methodBreakdown,
  monthKey,
  neighbourMonth,
  paymentsOfMonth,
  toCents,
  totalsByCurrency,
  type PaymentRow,
} from './statement';

const pay = (id: string, amount: string, paidAt: string, o: Partial<PaymentRow> = {}): PaymentRow => ({
  id,
  amount,
  currency: 'ARS',
  method: 'Transferencia',
  paidAt,
  ...o,
});

const ROWS = [
  pay('a', '100.10', '2026-11-03T12:00:00.000Z'),
  pay('b', '200.20', '2026-11-03T15:00:00.000Z', { method: 'Efectivo' }),
  pay('c', '0.30', '2026-11-01T12:00:00.000Z', { method: 'Efectivo' }),
  pay('d', '50', '2026-10-20T12:00:00.000Z', { currency: 'USD' }),
  pay('e', '10', 'no es una fecha'),
];

describe('extracto de pagos', () => {
  it('convierte importes a centavos sin errores de coma flotante', () => {
    expect(toCents('0.1') + toCents('0.2')).toBe(30);
    expect(toCents(null)).toBe(0);
    expect(toCents('x')).toBe(0);
    expect(fromCents(30)).toBe('0.30');
  });

  it('saca el día y el mes de un cobro, o null si la fecha no se lee', () => {
    expect(dayKey('2026-11-03T12:00:00.000Z')).toBe('2026-11-03');
    expect(monthKey('2026-11-03T12:00:00.000Z')).toBe('2026-11');
    expect(dayKey('nada')).toBeNull();
    expect(monthKey('nada')).toBeNull();
    expect(currentMonthKey(new Date('2026-02-10T12:00:00.000Z'))).toBe('2026-02');
  });

  it('lista los meses con cobros del más reciente al más viejo y elige el que se abre', () => {
    const months = availableMonths(ROWS);
    expect(months).toEqual(['2026-11', '2026-10']);
    expect(defaultMonth(months, new Date('2026-11-20T12:00:00.000Z'))).toBe('2026-11');
    expect(defaultMonth(months, new Date('2026-12-02T12:00:00.000Z'))).toBe('2026-11');
    expect(defaultMonth([], new Date('2026-12-02T12:00:00.000Z'))).toBe('2026-12');
    expect(neighbourMonth(months, '2026-11', 'older')).toBe('2026-10');
    expect(neighbourMonth(months, '2026-11', 'newer')).toBeNull();
    expect(neighbourMonth(months, '2026-10', 'newer')).toBe('2026-11');
    expect(neighbourMonth(months, '2020-01', 'older')).toBeNull();
  });

  it('suma por moneda y reparte por medio de pago', () => {
    const november = paymentsOfMonth(ROWS, '2026-11');
    expect(november.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(totalsByCurrency(ROWS.slice(0, 4))).toEqual([
      { currency: 'ARS', amount: '300.60', count: 3 },
      { currency: 'USD', amount: '50.00', count: 1 },
    ]);
    const shares = methodBreakdown(november, 'ARS');
    expect(shares.map((s) => [s.method, s.amount, s.count])).toEqual([
      ['Efectivo', '200.50', 2],
      ['Transferencia', '100.10', 1],
    ]);
    expect(Math.round(shares[0].share + shares[1].share)).toBe(100);
    expect(methodBreakdown([pay('z', '0', '2026-11-03T12:00:00.000Z')], 'ARS')[0].share).toBe(0);
    expect(methodBreakdown(november, 'EUR')).toEqual([]);
  });

  it('agrupa por día del más reciente al más viejo con el total de cada día', () => {
    const days = groupByDay(ROWS);
    expect(days.map((d) => d.day)).toEqual(['2026-11-03', '2026-11-01', '2026-10-20']);
    expect(days[0].items.map((p) => p.id)).toEqual(['a', 'b']);
    expect(days[0].totals).toEqual([{ currency: 'ARS', amount: '300.30', count: 2 }]);
  });
});
