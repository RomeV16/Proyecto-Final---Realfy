import {
  CreateFeeSchema,
  FeePreviewSchema,
  PayFeeInstallmentSchema,
  StaffCommissionInputSchema,
} from './fee.schema';

const P1 = '33333333-3333-4333-8333-333333333333';
const P2 = '44444444-4444-4444-8444-444444444444';
const C1 = '11111111-1111-4111-8111-111111111111';

const alta = (over: Record<string, unknown> = {}) => ({
  kind: 'AltaAlquiler',
  contractId: C1,
  basis: 'TotalContrato',
  baseAmount: '12000000',
  pct: '5',
  currency: 'ARS',
  payers: [{ role: 'Inquilino', personId: P1 }],
  firstDueDate: '2026-03-01',
  ...over,
});

describe('CreateFeeSchema', () => {
  it('completa los valores de fábrica', () => {
    const parsed = CreateFeeSchema.parse(alta());
    expect(parsed).toMatchObject({ payerMode: 'Reparto', vatMode: 'NoAplica', vatPct: '0', installments: 1, adjustInstallments: false, shares: [], staff: [] });
  });

  it('acepta un reparto que suma 100 y cada parte en una venta', () => {
    expect(
      CreateFeeSchema.safeParse(
        alta({
          payers: [
            { role: 'Inquilino', personId: P1, sharePct: '50' },
            { role: 'Locador', personId: P2, sharePct: 50 },
          ],
        }),
      ).success,
    ).toBe(true);
    expect(
      CreateFeeSchema.safeParse({
        kind: 'Venta',
        basis: 'ValorOperacion',
        baseAmount: '120000',
        pct: '3',
        currency: 'USD',
        payerMode: 'CadaParte',
        payers: [
          { role: 'Comprador', personId: P1 },
          { role: 'Vendedor', personId: P2 },
        ],
        firstDueDate: '2026-11-02',
      }).success,
    ).toBe(true);
  });

  it.each([
    ['porcentaje faltante', alta({ pct: undefined })],
    ['total del contrato sin contrato', alta({ contractId: undefined })],
    ['reparto que no suma 100', alta({ payers: [{ role: 'Inquilino', personId: P1, sharePct: '50' }, { role: 'Locador', personId: P2, sharePct: '40' }] })],
    ['persona repetida', alta({ payerMode: 'CadaParte', payers: [{ role: 'Inquilino', personId: P1 }, { role: 'Inquilino', personId: P1 }] })],
    ['cuotas con ajuste sin contrato', alta({ kind: 'Venta', basis: 'ValorOperacion', contractId: undefined, adjustInstallments: true })],
    ['porcentaje de más de 100', alta({ pct: '100.5' })],
    ['porcentaje con 5 decimales', alta({ pct: '1.12345' })],
    ['cuotas de más', alta({ installments: 61 })],
    ['campo desconocido', alta({ otro: 1 })],
  ])('rechaza: %s', (_label, input) => {
    expect(CreateFeeSchema.safeParse(input).success).toBe(false);
  });
});

describe('otros esquemas de honorarios', () => {
  it('la propuesta de un alquiler necesita contrato o período', () => {
    expect(FeePreviewSchema.safeParse({ kind: 'AltaAlquiler' }).success).toBe(false);
    expect(FeePreviewSchema.safeParse({ kind: 'Renovacion', contractPeriodId: C1 }).success).toBe(true);
    expect(FeePreviewSchema.safeParse({ kind: 'Tasacion' }).success).toBe(true);
  });

  it('la comisión va a un usuario o a una persona', () => {
    expect(StaffCommissionInputSchema.safeParse({ userId: P1, pct: '10' }).success).toBe(true);
    expect(StaffCommissionInputSchema.safeParse({ pct: '10' }).success).toBe(false);
    expect(StaffCommissionInputSchema.safeParse({ userId: P1, personId: P2, pct: '10' }).success).toBe(false);
  });

  it('el cobro de una cuota va a caja por defecto; el descuento al locador no lleva cuenta', () => {
    expect(PayFeeInstallmentSchema.parse({ date: '2026-03-05' })).toMatchObject({ settlement: 'Caja', method: 'Efectivo' });
    expect(PayFeeInstallmentSchema.safeParse({ date: '2026-03-05', settlement: 'CuentaLocador', accountId: C1 }).success).toBe(false);
    expect(PayFeeInstallmentSchema.safeParse({ date: '2026-03-05', amount: '0' }).success).toBe(false);
  });
});
