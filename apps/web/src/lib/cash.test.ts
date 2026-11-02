import { describe, expect, it } from 'vitest';
import {
  accountFormSchema,
  agencyAccounts,
  conversionFormSchema,
  convertedAmount,
  custodyAccounts,
  deliverFormSchema,
  movementFormSchema,
  parsePositiveAmount,
  parseRate,
  personLabel,
  signedAmount,
  today,
  type FinancialAccount,
} from './cash';

const ACC = '11111111-1111-4111-8111-111111111111';
const ACC2 = '22222222-2222-4222-8222-222222222222';
const PERSON = '33333333-3333-4333-8333-333333333333';

const account = (o: Partial<FinancialAccount>): FinancialAccount => ({
  id: ACC,
  kind: 'Caja',
  name: 'Caja ARS',
  currency: 'ARS',
  ownerPersonId: null,
  isActive: true,
  owner: null,
  balance: '0.00',
  ...o,
});

describe('importes y tipo de cambio', () => {
  it('acepta coma decimal y hasta 2 decimales en un importe positivo', () => {
    expect(parsePositiveAmount('8000,50')).toBe('8000.50');
    expect(parsePositiveAmount(' 12 ')).toBe('12');
    expect(parsePositiveAmount('0')).toBeNull();
    expect(parsePositiveAmount('-5')).toBeNull();
    expect(parsePositiveAmount('1.234')).toBeNull();
    expect(parsePositiveAmount('abc')).toBeNull();
  });

  it('acepta hasta 6 decimales en el tipo de cambio', () => {
    expect(parseRate('1250,123456')).toBe('1250.123456');
    expect(parseRate('0')).toBeNull();
    expect(parseRate('')).toBeNull();
  });

  it('calcula el importe de destino de una conversión redondeado al centavo', () => {
    expect(convertedAmount('100', '1250,5')).toBe('125050.00');
    expect(convertedAmount('10,01', '0.333333')).toBe('3.34');
    expect(convertedAmount('', '1000')).toBeNull();
    expect(convertedAmount('100', 'x')).toBeNull();
  });
});

describe('cuentas', () => {
  it('separa las cuentas de la inmobiliaria activas (por moneda) de las de custodia', () => {
    const list = [
      account({ id: 'a' }),
      account({ id: 'b', kind: 'Banco', currency: 'USD' }),
      account({ id: 'c', isActive: false }),
      account({ id: 'd', kind: 'Custodia', ownerPersonId: PERSON }),
    ];
    expect(agencyAccounts(list).map((a) => a.id)).toEqual(['a', 'b']);
    expect(agencyAccounts(list, 'USD').map((a) => a.id)).toEqual(['b']);
    expect(custodyAccounts(list).map((a) => a.id)).toEqual(['d']);
  });

  it('nombra a una persona o devuelve vacío', () => {
    expect(personLabel({ id: PERSON, firstName: 'Ana', lastName: 'Ejemplo' })).toBe('Ana Ejemplo');
    expect(personLabel(null)).toBe('');
  });

  it('muestra una salida con signo negativo', () => {
    expect(signedAmount({ direction: 'Out', amount: '100.00' })).toBe('-100.00');
    expect(signedAmount({ direction: 'In', amount: '100.00' })).toBe('100.00');
  });

  it('la fecha de hoy es YYYY-MM-DD', () => {
    expect(today()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});

describe('esquemas de los formularios', () => {
  it('una cuenta de custodia pide su locador; las demás no lo mandan', () => {
    const custody = accountFormSchema.safeParse({ kind: 'Custodia', name: 'Custodia', currency: 'ARS', ownerPersonId: '' });
    expect(custody.success).toBe(false);
    if (!custody.success) expect(custody.error.issues[0]).toEqual({ path: ['ownerPersonId'], message: 'cash.errors.ownerPersonId' });

    const bank = accountFormSchema.safeParse({ kind: 'Banco', name: ' Banco ', currency: 'EUR', ownerPersonId: PERSON });
    expect(bank).toEqual({ success: true, data: { kind: 'Banco', name: 'Banco', currency: 'EUR', ownerPersonId: null } });
  });

  it('un movimiento manual convierte el importe y vacía lo opcional', () => {
    const ok = movementFormSchema.safeParse({
      accountId: ACC,
      date: '2026-11-02',
      direction: 'Out',
      amount: '1500,5',
      category: 'Gasto',
      counterpartyId: '',
      contractId: '',
      note: ' ',
    });
    expect(ok).toEqual({
      success: true,
      data: {
        accountId: ACC,
        date: '2026-11-02',
        direction: 'Out',
        amount: '1500.5',
        category: 'Gasto',
        counterpartyId: null,
        contractId: null,
        note: null,
      },
    });
    const bad = movementFormSchema.safeParse({ accountId: '', date: 'x', direction: 'Out', amount: '0', category: 'Gasto' });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.error.issues.map((i) => i.path[0])).toEqual(expect.arrayContaining(['accountId', 'date', 'amount']));
    }
  });

  it('una conversión necesita dos cuentas distintas y un tipo de cambio', () => {
    const ok = conversionFormSchema.safeParse({ fromAccountId: ACC, toAccountId: ACC2, date: '2026-11-02', amount: '100', rate: '1200', note: '' });
    expect(ok.success).toBe(true);
    const same = conversionFormSchema.safeParse({ fromAccountId: ACC, toAccountId: ACC, date: '2026-11-02', amount: '100', rate: '1200', note: '' });
    expect(same.success).toBe(false);
    if (!same.success) expect(same.error.issues[0].message).toBe('cash.errors.toAccountId');
  });

  it('la entrega de custodia sin importe entrega todo; un importe inválido se marca', () => {
    expect(deliverFormSchema.safeParse({ amount: '', date: '2026-11-02', note: '' })).toEqual({
      success: true,
      data: { date: '2026-11-02', note: null },
    });
    expect(deliverFormSchema.safeParse({ amount: '65,5', date: '2026-11-02', note: 'en mano' })).toEqual({
      success: true,
      data: { amount: '65.5', date: '2026-11-02', note: 'en mano' },
    });
    const bad = deliverFormSchema.safeParse({ amount: 'mucho', date: '2026-11-02', note: '' });
    expect(bad.success).toBe(false);
    if (!bad.success) expect(bad.error.issues[0].path).toEqual(['amount']);
  });
});
