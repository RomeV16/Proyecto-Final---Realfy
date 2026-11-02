import { describe, expect, it } from 'vitest';
import {
  absAmount,
  balanceReading,
  currentPeriod,
  isPayoutEntry,
  openingBalanceFormSchema,
  parseSignedAmount,
  payoutFormSchema,
  periodOf,
  suggestedPayout,
} from './owner-accounts';

const ACC = '11111111-1111-4111-8111-111111111111';

describe('lectura del saldo del locador', () => {
  it('positivo: la inmobiliaria le debe; negativo: le debe él; cero: sin saldo', () => {
    expect(balanceReading('1500.00')).toBe('agencyOwes');
    expect(balanceReading(-0.01)).toBe('ownerOwes');
    expect(balanceReading('0.00')).toBe('settled');
    expect(balanceReading(null)).toBe('settled');
    expect(absAmount('-250.5')).toBe('250.50');
  });

  it('los pagos y lo cobrado directo son dinero que ya le llegó', () => {
    expect(isPayoutEntry('Transferencia')).toBe(true);
    expect(isPayoutEntry('CobroDirecto')).toBe(true);
    expect(isPayoutEntry('Comision')).toBe(false);
  });

  it('el pago propuesto descuenta la custodia y nunca es negativo', () => {
    expect(suggestedPayout('46500.00', '500.00')).toBe('46000.00');
    expect(suggestedPayout('46500.00')).toBe('46500.00');
    expect(suggestedPayout('-3500.00', '0')).toBe('');
    expect(suggestedPayout('500.00', '500.00')).toBe('');
    expect(suggestedPayout('500.00', '-10')).toBe('500.00');
  });

  it('períodos', () => {
    expect(currentPeriod(new Date('2026-11-02T12:00:00Z'))).toBe('2026-11');
    expect(periodOf('2026-10-01T00:00:00.000Z')).toBe('2026-10');
  });

  it('importe con signo: acepta coma decimal, cero y negativo', () => {
    expect(parseSignedAmount('-1500,5')).toBe('-1500.5');
    expect(parseSignedAmount('0')).toBe('0');
    expect(parseSignedAmount('-0')).toBe('0');
    expect(parseSignedAmount(' 12.34 ')).toBe('12.34');
    expect(parseSignedAmount('12.345')).toBeNull();
    expect(parseSignedAmount('abc')).toBeNull();
  });
});

describe('formularios de la cuenta corriente', () => {
  it('saldo inicial: arma el cuerpo de la API y marca los campos con su clave', () => {
    const ok = openingBalanceFormSchema.safeParse({ currency: 'USD', amount: '-250,50', date: '', reason: ' último acumulador ' });
    expect(ok).toEqual({ success: true, data: { currency: 'USD', amount: '-250.50', reason: 'último acumulador' } });
    const withDate = openingBalanceFormSchema.safeParse({ currency: 'ARS', amount: '10', date: '2026-10-31', reason: 'motivo' });
    expect(withDate.success && withDate.data.date).toBe('2026-10-31');
    const bad = openingBalanceFormSchema.safeParse({ currency: 'ARS', amount: '', date: '', reason: 'x' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.map((i) => [i.path[0], i.message])).toEqual(
        expect.arrayContaining([
          ['amount', 'ownerAccounts.errors.amount'],
          ['reason', 'ownerAccounts.errors.reason'],
        ]),
      );
    }
  });

  it('pago al locador: importe positivo, cuenta y forma de pago', () => {
    const base = { accountId: ACC, method: 'Transferencia', amount: '1.000,5', date: '2026-11-02', note: ' ' };
    expect(payoutFormSchema.safeParse({ ...base, amount: '1000,5' })).toEqual({
      success: true,
      data: { accountId: ACC, method: 'Transferencia', amount: '1000.5', date: '2026-11-02', note: null },
    });
    const bad = payoutFormSchema.safeParse({ ...base, accountId: '', amount: '0' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(['accountId', 'amount']));
  });
});
