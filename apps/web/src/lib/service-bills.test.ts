import { describe, expect, it } from 'vitest';
import {
  currentMonth,
  defaultInstallment,
  parseAmountInput,
  parseConsumptionInput,
  parseDateInput,
  proposedDueDate,
} from './service-bills';

describe('service-bills', () => {
  it('el mes actual y la cuota propuesta', () => {
    expect(currentMonth(new Date(2026, 10, 5))).toBe('2026-11');
    expect(defaultInstallment('2026-09')).toBe('09/2026');
  });

  it('el vencimiento propuesto no pasa del último día del mes', () => {
    expect(proposedDueDate('2026-11', 10)).toBe('2026-11-10');
    expect(proposedDueDate('2026-02', 31)).toBe('2026-02-28');
  });

  it('importes: coma decimal, hasta dos decimales y sin signo', () => {
    expect(parseAmountInput('12345,5')).toBe('12345.5');
    expect(parseAmountInput('100.25')).toBe('100.25');
    expect(parseAmountInput('100,255')).toBeNull();
    expect(parseAmountInput('-5')).toBeNull();
    expect(parseAmountInput('abc')).toBeNull();
  });

  it('consumo: hasta tres decimales', () => {
    expect(parseConsumptionInput('120,5')).toBe('120.5');
    expect(parseConsumptionInput('1,2345')).toBeNull();
  });

  it('fechas: ISO y día/mes/año, solo las que existen', () => {
    expect(parseDateInput('2026-11-10')).toBe('2026-11-10');
    expect(parseDateInput('10/11/2026')).toBe('2026-11-10');
    expect(parseDateInput('5-3-2026')).toBe('2026-03-05');
    expect(parseDateInput('31/02/2026')).toBeNull();
    expect(parseDateInput('mañana')).toBeNull();
  });
});
