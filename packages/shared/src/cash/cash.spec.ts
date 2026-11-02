import { CashCategory, CashDirection } from '../enums';
import { MANUAL_CASH_CATEGORIES, ReceiptSeriesMode, defaultDirectionFor, receiptSeriesFor } from './index';
import { OperationalDefaultsSchema } from '../schemas/operational-defaults.schema';
import { operationalDefaultsFromForm, operationalDefaultsToForm } from '../schemas/operational-defaults.form';
import { CreatePaymentSchema } from '../schemas/liquidacion.schema';
import { CreateCashMovementSchema, CreateConversionSchema, CreateFinancialAccountSchema } from '../schemas/cash.schema';

describe('cash — series de recibos', () => {
  it('una serie única por defecto', () => {
    expect(receiptSeriesFor(ReceiptSeriesMode.Unica, { currency: 'USD', accountId: 'acc-1' })).toBe('RECIBO_COBRO');
  });

  it('una serie por moneda', () => {
    expect(receiptSeriesFor(ReceiptSeriesMode.PorMoneda, { currency: 'EUR' })).toBe('RECIBO_COBRO_EUR');
  });

  it('una serie por cuenta; sin cuenta, la única', () => {
    expect(receiptSeriesFor(ReceiptSeriesMode.PorCuenta, { currency: 'ARS', accountId: 'acc-1' })).toBe(
      'RECIBO_COBRO_acc-1',
    );
    expect(receiptSeriesFor(ReceiptSeriesMode.PorCuenta, { currency: 'ARS', accountId: null })).toBe('RECIBO_COBRO');
  });
});

describe('cash — movimientos manuales', () => {
  it('no deja cargar a mano cobros, custodia, compensaciones ni conversiones', () => {
    for (const category of [
      CashCategory.AlquilerCobrado,
      CashCategory.Custodia,
      CashCategory.Compensacion,
      CashCategory.Conversion,
    ]) {
      expect(MANUAL_CASH_CATEGORIES).not.toContain(category);
    }
  });

  it('propone entrada para honorarios y señas, salida para el resto', () => {
    expect(defaultDirectionFor(CashCategory.Honorario)).toBe(CashDirection.In);
    expect(defaultDirectionFor(CashCategory.Sena)).toBe(CashDirection.In);
    expect(defaultDirectionFor(CashCategory.Gasto)).toBe(CashDirection.Out);
  });
});

describe('cash — opciones de la inmobiliaria y esquemas', () => {
  it('las opciones de caja viajan por el formulario de valores por defecto', () => {
    const saved = OperationalDefaultsSchema.parse({
      cash: { receiptSeries: 'PorMoneda', custodyInAgencyBalance: true, compensationScope: 'MismoContrato' },
    });
    const form = operationalDefaultsToForm(saved);
    expect(form.cashReceiptSeries).toBe('PorMoneda');
    expect(OperationalDefaultsSchema.parse(operationalDefaultsFromForm(form)).cash).toEqual({
      lessorDirectOwes: 'TodoLoAjeno',
      partialAllocation: 'Proporcional',
      custodyInAgencyBalance: true,
      receiptSeries: 'PorMoneda',
      receiptWhenLessorReceives: false,
      compensationScope: 'MismoContrato',
    });
    expect(() => OperationalDefaultsSchema.parse({ cash: { receiptSeries: 'Otra' } })).toThrow();
  });

  it('un cobro que recibió el locador no tiene cuenta ni custodia', () => {
    const base = { amount: '100', method: 'Transferencia', paidAt: '2026-11-02T12:00:00.000Z' };
    expect(CreatePaymentSchema.safeParse({ ...base, receivedBy: 'Locador' }).success).toBe(true);
    expect(CreatePaymentSchema.safeParse({ ...base, receivedBy: 'Locador', inCustody: true }).success).toBe(false);
    expect(
      CreatePaymentSchema.safeParse({ ...base, receivedBy: 'Locador', accountId: '00000000-0000-4000-8000-000000000001' })
        .success,
    ).toBe(false);
    expect(CreatePaymentSchema.safeParse({ ...base, receivedBy: 'Inmobiliaria', inCustody: true }).success).toBe(true);
  });

  it('una cuenta de custodia necesita dueño y las demás no lo admiten', () => {
    const owner = '00000000-0000-4000-8000-000000000001';
    const parse = (v: object) => CreateFinancialAccountSchema.safeParse(v).success;
    expect(parse({ kind: 'Custodia', name: 'C', currency: 'USD', ownerPersonId: owner })).toBe(true);
    expect(parse({ kind: 'Custodia', name: 'C', currency: 'USD' })).toBe(false);
    expect(parse({ kind: 'Caja', name: 'C', currency: 'ARS', ownerPersonId: owner })).toBe(false);
  });

  it('un movimiento manual no usa categorías del sistema; una conversión necesita dos cuentas', () => {
    const acc = '00000000-0000-4000-8000-000000000001';
    const mov = { accountId: acc, date: '2026-11-02', direction: 'Out', amount: '10.50' };
    expect(CreateCashMovementSchema.safeParse({ ...mov, category: 'Gasto' }).success).toBe(true);
    expect(CreateCashMovementSchema.safeParse({ ...mov, category: 'AlquilerCobrado' }).success).toBe(false);
    expect(CreateCashMovementSchema.safeParse({ ...mov, category: 'Gasto', amount: '0' }).success).toBe(false);
    const conversion = { fromAccountId: acc, toAccountId: acc, date: '2026-11-02', amount: '1', rate: '1000' };
    expect(CreateConversionSchema.safeParse(conversion).success).toBe(false);
  });
});
