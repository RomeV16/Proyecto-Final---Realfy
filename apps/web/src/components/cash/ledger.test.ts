import { describe, expect, it } from 'vitest';
import { compareCount, fromCents, ledgerTotals, runningBalances, signedCents, toCents } from './ledger';

const row = (direction: string, amount: string, currency = 'ARS') => ({ direction, amount, currency });

describe('libro de caja', () => {
  it('pasa importes a centavos y los movimientos de salida restan', () => {
    expect(toCents('10.05')).toBe(1005);
    expect(toCents(undefined)).toBe(0);
    expect(toCents('nada')).toBe(0);
    expect(fromCents(1005)).toBe('10.05');
    expect(signedCents(row('In', '10'))).toBe(1000);
    expect(signedCents(row('Out', '10'))).toBe(-1000);
  });

  it('arrastra el saldo hacia atrás desde el saldo actual', () => {
    const rows = [row('In', '100000'), row('Out', '5000.50'), row('Out', '100000')];
    expect(runningBalances(rows, toCents('150000'))).toEqual({
      after: ['150000.00', '50000.00', '55000.50'],
      opening: '155000.50',
    });
    expect(runningBalances([], 1234)).toEqual({ after: [], opening: '12.34' });
  });

  it('suma ingresos y egresos por moneda', () => {
    expect(ledgerTotals([row('In', '0.10'), row('In', '0.20'), row('Out', '1'), row('Out', '2', 'USD')])).toEqual([
      { currency: 'ARS', in: '0.30', out: '1.00' },
      { currency: 'USD', in: '0.00', out: '2.00' },
    ]);
  });

  it('compara lo contado con el saldo, aceptando coma decimal y punto de miles', () => {
    expect(compareCount('  ', '100.00')).toEqual({ state: 'empty' });
    expect(compareCount('abc', '100.00')).toEqual({ state: 'invalid' });
    expect(compareCount('1,234', '100.00')).toEqual({ state: 'invalid' });
    expect(compareCount('100', '100.00')).toEqual({ state: 'match', difference: '0.00' });
    expect(compareCount('150.000,50', '150000.50')).toEqual({ state: 'match', difference: '0.00' });
    expect(compareCount('150.000', '150000.00')).toEqual({ state: 'match', difference: '0.00' });
    expect(compareCount('150000.5', '150000.00')).toEqual({ state: 'over', difference: '0.50' });
    expect(compareCount('99,5', '100.00')).toEqual({ state: 'short', difference: '0.50' });
  });
});
