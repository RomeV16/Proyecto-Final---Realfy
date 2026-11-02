import { OperationalDefaultsSchema } from './operational-defaults.schema';
import { operationalDefaultsFromForm, operationalDefaultsToForm } from './operational-defaults.form';
import {
  AnnulOwnerStatementSchema,
  GenerateOwnerStatementsSchema,
  OpeningBalanceSchema,
  OwnerLedgerFilterSchema,
  OwnerPayoutSchema,
  OwnerStatementListSchema,
} from './owner-account.schema';

const ACC = '00000000-0000-4000-8000-000000000001';

describe('esquemas de la cuenta corriente del locador', () => {
  it('saldo inicial: con signo o cero, con motivo; sin moneda no', () => {
    const ok = (v: object) => OpeningBalanceSchema.safeParse(v).success;
    expect(ok({ currency: 'ARS', amount: '-1500.50', reason: 'último acumulador' })).toBe(true);
    expect(ok({ currency: 'USD', amount: 0, date: '2026-10-31', reason: 'sin saldo' })).toBe(true);
    expect(ok({ currency: 'ARS', amount: '10', reason: 'x' })).toBe(false);
    expect(ok({ amount: '10', reason: 'sin moneda' })).toBe(false);
    expect(ok({ currency: 'ARS', amount: '10.123', reason: 'tres decimales' })).toBe(false);
  });

  it('pago al locador: transferencia o efectivo, importe positivo', () => {
    const base = { accountId: ACC, method: 'Transferencia', amount: '1000', date: '2026-11-02' };
    expect(OwnerPayoutSchema.safeParse(base).success).toBe(true);
    expect(OwnerPayoutSchema.safeParse({ ...base, method: 'EntregaEfectivo' }).success).toBe(true);
    expect(OwnerPayoutSchema.safeParse({ ...base, method: 'Cargo' }).success).toBe(false);
    expect(OwnerPayoutSchema.safeParse({ ...base, amount: '0' }).success).toBe(false);
    expect(OwnerPayoutSchema.safeParse({ ...base, amount: '-5' }).success).toBe(false);
  });

  it('generar exige el mes YYYY-MM; filtros con valores por defecto', () => {
    expect(GenerateOwnerStatementsSchema.safeParse({ period: '2026-10' }).success).toBe(true);
    expect(GenerateOwnerStatementsSchema.safeParse({ period: '2026-13' }).success).toBe(false);
    expect(OwnerLedgerFilterSchema.parse({})).toEqual({ currency: 'ARS', page: 1, limit: 50 });
    expect(OwnerStatementListSchema.parse({ status: 'Emitido', page: '2' })).toMatchObject({ status: 'Emitido', page: 2 });
    expect(AnnulOwnerStatementSchema.safeParse({ reason: '' }).success).toBe(false);
  });

  it('las opciones del estado viajan por el formulario de valores por defecto (vacío = fin de mes)', () => {
    const saved = OperationalDefaultsSchema.parse({ ownerAccounts: { statementCloseDay: 10, lessorChargeTiming: 'AlEmitirEstado' } });
    const form = operationalDefaultsToForm(saved);
    expect([form.ownerStatementCloseDay, form.ownerLessorChargeTiming]).toEqual(['10', 'AlEmitirEstado']);
    expect(operationalDefaultsFromForm({ ...form, ownerStatementCloseDay: '' }).ownerAccounts).toEqual({
      statementCloseDay: null,
      lessorChargeTiming: 'AlEmitirEstado',
    });
    expect(() => OperationalDefaultsSchema.parse({ ownerAccounts: { statementCloseDay: 31 } })).toThrow();
  });
});
