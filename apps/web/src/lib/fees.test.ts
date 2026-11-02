import { describe, expect, it } from 'vitest';
import {
  canCancelFee,
  canPayInstallment,
  canSettleToLessor,
  checkDraft,
  draftEstimate,
  draftFromPreview,
  feeBody,
  feePlace,
  installmentReceipt,
  isAdjusted,
  isRentalKind,
  newRowKey,
  paidInstallments,
  payCommissionFormSchema,
  payInstallmentFormSchema,
  type Fee,
  type FeeDraft,
  type FeeInstallment,
  type FeePreview,
} from './fees';

const CONTRACT = '11111111-1111-4111-8111-111111111111';
const TENANT = '22222222-2222-4222-8222-222222222222';
const LESSOR = '33333333-3333-4333-8333-333333333333';
const USER = '44444444-4444-4444-8444-444444444444';
const ACCOUNT = '55555555-5555-4555-8555-555555555555';

const preview = (o: Partial<FeePreview> = {}): FeePreview => ({
  kind: 'AltaAlquiler',
  basis: 'TotalContrato',
  baseAmount: '1200000.00',
  pct: '5',
  currency: 'ARS',
  payerMode: 'Reparto',
  payerChoice: 'Inquilino',
  payers: [{ role: 'Inquilino', personId: TENANT, name: 'Ana Inquilina', sharePct: '100' }],
  firstDueDate: '2026-11-01',
  installments: 2,
  adjustInstallments: true,
  vatMode: 'NoAplica',
  vatPct: '21',
  staffCommissionPct: '10',
  staffCommissionBase: 'Neto',
  contractId: CONTRACT,
  contractPeriodId: null,
  estimate: ['60000.00'],
  ...o,
});

const installment = (o: Partial<FeeInstallment> = {}): FeeInstallment => ({
  id: 'i1',
  n: 1,
  dueDate: '2026-11-01T00:00:00.000Z',
  amount: '30000',
  adjustedAmount: null,
  status: 'Pendiente',
  paidAt: null,
  paidAmount: null,
  settlement: null,
  receiptId: null,
  receipt: null,
  dueAmount: '30000.00',
  ...o,
});

describe('lectura', () => {
  it('distingue los honorarios de alquiler', () => {
    expect(isRentalKind('AltaAlquiler')).toBe(true);
    expect(isRentalKind('Renovacion')).toBe(true);
    expect(isRentalKind('Venta')).toBe(false);
  });

  it('la propiedad sale del contrato o de la operación', () => {
    expect(feePlace({ contract: { property: { title: 'Depto' } }, property: null })).toBe('Depto');
    expect(feePlace({ contract: null, property: { title: 'Lote' } })).toBe('Lote');
    expect(feePlace({})).toBe('');
  });

  it('cuenta las cuotas cobradas y marca la ajustada', () => {
    expect(paidInstallments({ installmentRows: [installment({ status: 'Pagada' }), installment()] })).toBe(1);
    expect(isAdjusted(installment())).toBe(false);
    expect(isAdjusted(installment({ dueAmount: '33000.00' }))).toBe(true);
  });

  it('solo se cobra una cuota pendiente de un honorario vigente; solo el locador descuenta de su cuenta', () => {
    expect(canPayInstallment(installment(), { status: 'Pendiente' })).toBe(true);
    expect(canPayInstallment(installment({ status: 'Pagada' }), { status: 'Parcial' })).toBe(false);
    expect(canPayInstallment(installment(), { status: 'Anulado' })).toBe(false);
    expect(canSettleToLessor('Locador')).toBe(true);
    expect(canSettleToLessor('Inquilino')).toBe(false);
  });

  it('se anula sin cobros ni comisiones pagadas', () => {
    const base = { status: 'Pendiente', installmentRows: [installment()], staffCommissions: [] as Fee['staffCommissions'] };
    expect(canCancelFee(base)).toBe(true);
    expect(canCancelFee({ ...base, status: 'Anulado' })).toBe(false);
    expect(canCancelFee({ ...base, installmentRows: [installment({ status: 'Pagada' })] })).toBe(false);
    expect(
      canCancelFee({
        ...base,
        staffCommissions: [
          { id: 'c', userId: USER, personId: null, pct: '10', baseAmount: '1', amount: '1', currency: 'ARS', paidAt: '2026-11-02', beneficiaryName: 'X' },
        ],
      }),
    ).toBe(false);
  });

  it('número del recibo de una cuota cobrada a la caja', () => {
    const rows = [installment({ n: 1, receipt: { id: 'r', series: 'RECIBO_COBRO', number: 42 } }), installment({ n: 2 })];
    expect(installmentReceipt({ installmentRows: rows }, 1)).toBe('00000042');
    expect(installmentReceipt({ installmentRows: rows }, 2)).toBeNull();
    const labelled = [installment({ n: 1, receipt: { id: 'r', series: 'RECIBO_COBRO_USD', number: 7, label: 'USD-00000007' } })];
    expect(installmentReceipt({ installmentRows: labelled }, 1)).toBe('USD-00000007');
  });
});

describe('alta', () => {
  const draft = (o: Partial<FeeDraft> = {}): FeeDraft => ({ ...draftFromPreview(preview()), ...o });

  it('arma el formulario con la propuesta y conserva lo indicado', () => {
    const d = draftFromPreview(preview(), { notes: 'Pactado' });
    expect(d).toMatchObject({
      kind: 'AltaAlquiler',
      contractId: CONTRACT,
      contractPeriodId: '',
      propertyId: '',
      pct: '5',
      installments: '2',
      staffCommissionPct: '10',
      shares: [],
      staff: [],
      notes: 'Pactado',
    });
    expect(draftFromPreview(preview({ pct: null, basis: 'MontoFijo' })).pct).toBe('');
    expect(newRowKey()).not.toBe(newRowKey());
  });

  it('cuerpo de POST /fees: reparto con partes, coma decimal y filas de coorretaje y personal', () => {
    const body = feeBody(
      draft({
        payers: [
          { role: 'Inquilino', personId: TENANT, name: 'Ana', sharePct: '60' },
          { role: 'Locador', personId: LESSOR, name: 'Luis', sharePct: '40' },
        ],
        baseAmount: '1200000,50',
        shares: [{ key: 'a', counterparty: '  Otra Inmobiliaria ', pct: '20' }],
        staff: [{ key: 'b', userId: USER, pct: '10,5' }],
        notes: '  ',
      }),
    );
    expect(body).toMatchObject({
      contractId: CONTRACT,
      contractPeriodId: null,
      propertyId: null,
      baseAmount: '1200000.50',
      pct: '5',
      vatPct: '0',
      installments: 2,
      adjustInstallments: true,
      payers: [
        { role: 'Inquilino', personId: TENANT, sharePct: '60' },
        { role: 'Locador', personId: LESSOR, sharePct: '40' },
      ],
      shares: [{ counterparty: 'Otra Inmobiliaria', pct: '20' }],
      staff: [{ userId: USER, pct: '10.5' }],
      notes: null,
    });
    expect(checkDraft(draft()).ok).toBe(true);
  });

  it('monto fijo sin porcentaje; una venta no ajusta cuotas; cada parte no lleva su parte', () => {
    const body = feeBody(
      draft({
        kind: 'Venta',
        contractId: '',
        basis: 'MontoFijo',
        pct: '3',
        payerMode: 'CadaParte',
        vatMode: 'Adicional',
        vatPct: '21',
        payers: [
          { role: 'Comprador', personId: TENANT, name: 'C', sharePct: '' },
          { role: 'Vendedor', personId: LESSOR, name: 'V', sharePct: '' },
        ],
      }),
    );
    expect(body).toMatchObject({ pct: null, adjustInstallments: false, vatPct: '21', contractId: null });
    expect((body.payers as object[])[0]).toEqual({ role: 'Comprador', personId: TENANT });
  });

  it('valida con el esquema compartido y devuelve el primer campo con error', () => {
    expect(checkDraft(draft({ payers: [] }))).toEqual({ ok: false, field: 'payers' });
    expect(checkDraft(draft({ installments: '0' }))).toEqual({ ok: false, field: 'installments' });
    expect(checkDraft(draft({ baseAmount: 'abc' }))).toEqual({ ok: false, field: 'baseAmount' });
  });

  it('estima lo que paga cada uno, las cuotas, el coorretaje y la comisión del personal', () => {
    const estimate = draftEstimate(
      draft({
        payers: [
          { role: 'Inquilino', personId: TENANT, name: 'Ana', sharePct: '50' },
          { role: 'Locador', personId: LESSOR, name: 'Luis', sharePct: '50' },
        ],
        vatMode: 'Adicional',
        vatPct: '21',
        shares: [{ key: 'a', counterparty: 'Otra', pct: '20' }],
        staff: [{ key: 'b', userId: USER, pct: '10' }],
      }),
    );
    // 5 % de 1.200.000 = 60.000, mitad cada uno, más 21 % de IVA.
    expect(estimate).toEqual({
      payers: [
        { total: '36300.00', installment: '18150.00' },
        { total: '36300.00', installment: '18150.00' },
      ],
      net: '60000.00',
      shares: ['12000.00'],
      staff: ['4800.00'],
    });
  });

  it('cada parte paga el porcentaje completo; monto fijo sin porcentaje', () => {
    const sale = draftEstimate(
      draft({
        payerMode: 'CadaParte',
        payers: [
          { role: 'Comprador', personId: TENANT, name: 'C', sharePct: '' },
          { role: 'Vendedor', personId: LESSOR, name: 'V', sharePct: '' },
        ],
        installments: '1',
      }),
    );
    expect(sale?.payers).toEqual([
      { total: '60000.00', installment: '60000.00' },
      { total: '60000.00', installment: '60000.00' },
    ]);
    expect(draftEstimate(draft({ basis: 'MontoFijo', baseAmount: '100', pct: '', payers: [] }))?.payers).toEqual([
      { total: '100.00', installment: '50.00' },
    ]);
  });

  it('sin estimación mientras falte un número o no cierre el reparto', () => {
    expect(draftEstimate(draft({ baseAmount: '' }))).toBeNull();
    expect(draftEstimate(draft({ pct: 'x' }))).toBeNull();
    expect(draftEstimate(draft({ installments: '61' }))).toBeNull();
    expect(
      draftEstimate(
        draft({
          payers: [
            { role: 'Inquilino', personId: TENANT, name: 'Ana', sharePct: '50' },
            { role: 'Locador', personId: LESSOR, name: 'Luis', sharePct: '10' },
          ],
        }),
      ),
    ).toBeNull();
  });
});

describe('cobro y pago', () => {
  it('cobro a la caja con cuenta e importe; a la cuenta del locador no manda cuenta', () => {
    const cash = payInstallmentFormSchema.safeParse({
      settlement: 'Caja',
      accountId: ACCOUNT,
      method: 'Transferencia',
      date: '2026-11-02',
      amount: '30000,5',
      note: '',
    });
    expect(cash).toEqual({
      success: true,
      data: { settlement: 'Caja', accountId: ACCOUNT, method: 'Transferencia', date: '2026-11-02', amount: '30000.5', note: null },
    });
    const lessor = payInstallmentFormSchema.safeParse({
      settlement: 'CuentaLocador',
      accountId: ACCOUNT,
      method: 'Efectivo',
      date: '2026-11-02',
      amount: '',
      note: 'x',
    });
    expect(lessor.success && lessor.data).toMatchObject({ settlement: 'CuentaLocador', accountId: null, note: 'x' });
    expect(lessor.success && 'amount' in lessor.data).toBe(false);
  });

  it('un importe inválido o una comisión sin cuenta quedan marcados en su campo', () => {
    const bad = payInstallmentFormSchema.safeParse({ settlement: 'Caja', accountId: '', method: 'Efectivo', date: '2026-11-02', amount: '-3', note: '' });
    expect(bad.success).toBe(false);
    expect(!bad.success && bad.error.issues[0]).toEqual({ path: ['amount'], message: 'fees.errors.amount' });
    const commission = payCommissionFormSchema.safeParse({ accountId: '', date: '2026-11-02', note: '' });
    expect(!commission.success && commission.error.issues[0].path).toEqual(['accountId']);
    expect(payCommissionFormSchema.safeParse({ accountId: ACCOUNT, date: '2026-11-02', note: ' ok ' })).toEqual({
      success: true,
      data: { accountId: ACCOUNT, date: '2026-11-02', note: 'ok' },
    });
  });
});
