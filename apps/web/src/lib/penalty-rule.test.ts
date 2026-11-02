import { describe, expect, it } from 'vitest';
import { formToRule, isPercentMode, ruleToForm } from './penalty-rule';

describe('penalty-rule', () => {
  it('los modos de porcentaje se cargan en % por día', () => {
    expect(isPercentMode('daily_fixed')).toBe(false);
    expect(isPercentMode('max_bna_or_daily')).toBe(true);
    const form = ruleToForm({ mode: 'daily_percent', value: '0.003', graceDays: 2, maxMultiplier: '2.0' });
    expect(form).toMatchObject({ mode: 'daily_percent', value: '0.3', graceDays: '2', maxMultiplier: '2.0' });
  });

  it('el monto fijo no se escala y sin regla rige el modo de la tasa BNA', () => {
    expect(ruleToForm({ mode: 'daily_fixed', value: '25', graceDays: 0, maxMultiplier: '2' }).value).toBe('25');
    expect(ruleToForm(null)).toMatchObject({ mode: 'max_bna_or_daily', value: '0.3', bnaMultiplier: '2', yearDays: '365' });
    expect(
      ruleToForm({ mode: 'max_bna_or_daily', value: '0.003', graceDays: 0, maxMultiplier: '2', bnaMultiplier: '3', yearDays: 360 }),
    ).toMatchObject({ bnaMultiplier: '3', yearDays: '360' });
  });

  it('convierte el formulario a la regla de la API', () => {
    const result = formToRule({ ...ruleToForm(null), graceDays: '5' });
    expect(result).toEqual({
      ok: true,
      value: {
        mode: 'max_bna_or_daily',
        value: '0.003',
        graceDays: 5,
        maxMultiplier: '2',
        bnaMultiplier: '2',
        yearDays: 365,
        partialPaymentAllocation: 'RentaPrimero',
        roundingMode: 'Total',
        capBase: 'SaldoInicioMora',
        bnaRateKind: 'Nominal',
        missingRateBehavior: 'AplicarPiso',
      },
    });
    const fixed = formToRule({ ...ruleToForm(null), mode: 'daily_fixed', value: '25', graceDays: '0', bnaMultiplier: '', yearDays: '' });
    // las opciones de la tasa BNA no viajan en los demás modos
    expect(fixed).toEqual({
      ok: true,
      value: { mode: 'daily_fixed', value: '25', graceDays: 0, maxMultiplier: '2', partialPaymentAllocation: 'RentaPrimero', roundingMode: 'Total', capBase: 'SaldoInicioMora' },
    });
  });

  it('marca los campos inválidos', () => {
    const result = formToRule({ ...ruleToForm(null), value: 'abc', graceDays: '', yearDays: '12' });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(Object.keys(result.errors).sort()).toEqual(['graceDays', 'value', 'yearDays']);
  });

  it('lleva las opciones elegidas de ida y vuelta', () => {
    const rule = {
      mode: 'max_bna_or_daily' as const,
      value: '0.003',
      graceDays: 1,
      maxMultiplier: '2',
      bnaMultiplier: '2',
      yearDays: 360 as const,
      bnaRateKind: 'Efectiva' as const,
      partialPaymentAllocation: 'PunitorioPrimero' as const,
      roundingMode: 'Diario' as const,
      capBase: 'TotalOriginal' as const,
      missingRateBehavior: 'Bloquear' as const,
    };
    expect(formToRule(ruleToForm(rule))).toEqual({ ok: true, value: rule });
  });

  it('un valor que no es número se deja tal cual', () => {
    expect(ruleToForm({ mode: 'daily_percent', value: 'x', graceDays: 0, maxMultiplier: '2' }).value).toBe('x');
  });
});
