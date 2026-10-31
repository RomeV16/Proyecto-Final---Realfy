import { computeNextRunAt } from './compute-next-run-at';

describe('computeNextRunAt', () => {
  const at = (iso: string) => new Date(iso);

  it('daily: mañana a las 12:00 UTC, también al cruzar el mes y el año', () => {
    expect(computeNextRunAt('daily', at('2026-03-10T08:00:00Z')).toISOString()).toBe('2026-03-11T12:00:00.000Z');
    expect(computeNextRunAt('daily', at('2026-02-28T23:59:00Z')).toISOString()).toBe('2026-03-01T12:00:00.000Z');
    expect(computeNextRunAt('daily', at('2025-12-31T10:00:00Z')).toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });

  it('weekly: el próximo lunes, nunca el mismo día', () => {
    // 2026-03-09 es lunes
    expect(computeNextRunAt('weekly', at('2026-03-09T08:00:00Z')).toISOString()).toBe('2026-03-16T12:00:00.000Z');
    expect(computeNextRunAt('weekly', at('2026-03-08T08:00:00Z')).toISOString()).toBe('2026-03-09T12:00:00.000Z');
    expect(computeNextRunAt('weekly', at('2026-03-13T08:00:00Z')).toISOString()).toBe('2026-03-16T12:00:00.000Z');
  });

  it('monthly: el 1 del mes siguiente, incluso desde diciembre', () => {
    expect(computeNextRunAt('monthly', at('2026-03-31T08:00:00Z')).toISOString()).toBe('2026-04-01T12:00:00.000Z');
    expect(computeNextRunAt('monthly', at('2025-12-15T08:00:00Z')).toISOString()).toBe('2026-01-01T12:00:00.000Z');
  });

  it('una frecuencia desconocida se trata como diaria', () => {
    expect(computeNextRunAt('x', at('2026-03-10T08:00:00Z')).toISOString()).toBe('2026-03-11T12:00:00.000Z');
  });
});
