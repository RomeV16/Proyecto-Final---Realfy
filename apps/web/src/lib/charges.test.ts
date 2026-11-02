import { describe, expect, it } from 'vitest';
import { chargeActions, chargeBody, chargeFormSchema, chargeMonth, parseChargeAmount } from './charges';

describe('parseChargeAmount', () => {
  it('acepta coma decimal, signo y hasta 2 decimales', () => {
    expect(parseChargeAmount('8000,50')).toBe('8000.50');
    expect(parseChargeAmount('-3000')).toBe('-3000');
    expect(parseChargeAmount(' 12.5 ')).toBe('12.5');
  });

  it('rechaza cero, vacío, más de 2 decimales y texto', () => {
    expect(parseChargeAmount('0')).toBeNull();
    expect(parseChargeAmount('0,00')).toBeNull();
    expect(parseChargeAmount('')).toBeNull();
    expect(parseChargeAmount('1,234')).toBeNull();
    expect(parseChargeAmount('mucho')).toBeNull();
  });
});

describe('chargeBody', () => {
  it('arma el cuerpo de la API desde los valores del formulario', () => {
    const body = chargeBody({
      contractId: 'c1',
      propertyId: '',
      chargedTo: 'Inquilino',
      lessorPersonId: 'les-1',
      kind: 'Reparacion',
      description: ' Canilla ',
      amount: '8000,50',
      currency: 'ARS',
      beneficiary: 'Locador',
      incurredAt: '20/10/2026',
      targetPeriod: '2026-11',
      installments: '3',
      notes: '',
    });
    expect(body).toEqual({
      contractId: 'c1',
      propertyId: undefined,
      chargedTo: 'Inquilino',
      lessorPersonId: null,
      kind: 'Reparacion',
      description: 'Canilla',
      amount: '8000.50',
      currency: 'ARS',
      beneficiary: 'Locador',
      incurredAt: '2026-10-20',
      targetPeriod: '2026-11',
      installments: 3,
      notes: null,
    });
  });

  it('el locador solo viaja en un gasto al locador', () => {
    const base = { description: 'x', amount: '1', incurredAt: '2026-10-20', kind: 'Otro', lessorPersonId: 'les-1' };
    expect(chargeBody({ ...base, chargedTo: 'Locador' }).lessorPersonId).toBe('les-1');
    expect(chargeBody({ ...base, chargedTo: 'Locador', lessorPersonId: '' }).lessorPersonId).toBeNull();
  });

  it('lo vacío queda sin valor para que mande el esquema', () => {
    const body = chargeBody({ chargedTo: 'Locador', kind: 'Otro', description: 'x', amount: '1', incurredAt: '2026-10-20' });
    expect(body).toMatchObject({ contractId: null, propertyId: undefined, currency: undefined, installments: undefined, targetPeriod: null });
  });
});

describe('chargeFormSchema', () => {
  const valid = {
    contractId: '11111111-1111-4111-8111-111111111111',
    propertyId: '',
    chargedTo: 'Inquilino',
    lessorPersonId: '',
    kind: 'Reparacion',
    description: 'Canilla',
    amount: '8000,50',
    currency: 'ARS',
    beneficiary: 'Locador',
    incurredAt: '2026-10-20',
    targetPeriod: '',
    installments: '1',
    notes: '',
  };

  it('acepta un cargo completo', () => {
    const result = chargeFormSchema.safeParse(valid);
    expect(result.success).toBe(true);
  });

  it('marca cada campo inválido con su clave de mensaje', () => {
    const result = chargeFormSchema.safeParse({ ...valid, contractId: '', amount: '', description: '', incurredAt: 'ayer' });
    expect(result.success).toBe(false);
    if (result.success) return;
    const messages = Object.fromEntries(result.error.issues.map((i) => [String(i.path[0]), i.message]));
    expect(messages).toMatchObject({
      contractId: 'charges.errors.contractId',
      amount: 'charges.errors.amount',
      description: 'charges.errors.description',
      incurredAt: 'charges.errors.incurredAt',
    });
  });

  it('sin contrato ni propiedad pide elegir uno', () => {
    const result = chargeFormSchema.safeParse({ ...valid, chargedTo: 'Locador', contractId: '' });
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.issues[0].message).toBe('charges.errors.propertyId');
  });
});

describe('chargeActions', () => {
  it('un cargo al inquilino que pide anticipo se puede forzar o marcar cobrado', () => {
    expect(chargeActions({ status: 'Pendiente', chargedTo: 'Inquilino', requiresUpfront: true })).toEqual([
      'forceImpute',
      'markPaidUpfront',
      'cancel',
    ]);
    expect(chargeActions({ status: 'Pendiente', chargedTo: 'Inquilino', requiresUpfront: false })).toEqual([
      'markPaidUpfront',
      'cancel',
    ]);
  });

  it('un cargo al locador solo se anula; uno imputado se libera; el resto no tiene acciones', () => {
    expect(chargeActions({ status: 'Pendiente', chargedTo: 'Locador', requiresUpfront: false })).toEqual(['cancel']);
    expect(chargeActions({ status: 'Imputado', chargedTo: 'Inmobiliaria', requiresUpfront: false })).toEqual(['release']);
    expect(chargeActions({ status: 'Imputado', chargedTo: 'Inquilino', requiresUpfront: false })).toEqual(['release']);
    expect(chargeActions({ status: 'Anulado', chargedTo: 'Inquilino', requiresUpfront: false })).toEqual([]);
    expect(chargeActions({ status: 'CobradoAnticipado', chargedTo: 'Inquilino', requiresUpfront: false })).toEqual([]);
  });
});

describe('chargeActions: gasto de la inmobiliaria', () => {
  it('un cargo pendiente a la inmobiliaria se registra como gasto o se anula', () => {
    expect(chargeActions({ status: 'Pendiente', chargedTo: 'Inmobiliaria', requiresUpfront: false })).toEqual([
      'agencyExpense',
      'cancel',
    ]);
  });
});

describe('chargeMonth', () => {
  it('muestra el mes de imputación o, sin él, el del gasto', () => {
    expect(chargeMonth({ targetPeriod: '2026-12-01T00:00:00.000Z', incurredAt: '2026-10-20T00:00:00.000Z' })).toBe('2026-12');
    expect(chargeMonth({ targetPeriod: null, incurredAt: '2026-10-20T00:00:00.000Z' })).toBe('2026-10');
  });
});
