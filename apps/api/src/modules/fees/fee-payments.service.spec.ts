import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { installmentLabel } from './fee-labels';
import { withLabel } from './fees.helpers';
import { ACCOUNT_ID, CONTRACT_ID, LESSOR_PERSON, TENANT_PERSON, USER_ID, altaInput, buildFees, d } from './fees.testing';

async function withFee(input: Record<string, unknown> = {}, world: Record<string, unknown> = {}) {
  const ctx = buildFees(world as any);
  await ctx.service.create(altaInput(input));
  return { ...ctx, fee: ctx.client.fee.rows[0] };
}

describe('FeePaymentsService: cobro de cuotas', () => {
  it('a caja: movimiento Honorario, recibo de la serie de cobros y honorario parcial', async () => {
    const { payments, fee, client, cash, receipts, audit } = await withFee();
    const res = await payments.payInstallment(fee.id, 1, { date: '2026-03-05', method: 'Transferencia', accountId: ACCOUNT_ID });
    expect(cash.resolveAgencyAccount.mock.calls[0][2]).toEqual({ accountId: ACCOUNT_ID, currency: 'ARS', method: 'Transferencia' });
    expect(cash.recordMovement.mock.calls[0][1]).toMatchObject({
      direction: 'In',
      category: 'Honorario',
      counterpartyId: TENANT_PERSON,
      contractId: CONTRACT_ID,
      sourceType: 'FeeInstallment',
      note: 'Honorarios de alta de alquiler, cuota 1/3',
    });
    expect(receipts[0]).toMatchObject({ series: 'RECIBO_COBRO', amount: '200000.00', currency: 'ARS', issuedAt: d('2026-03-05') });
    expect(client.feeInstallment.rows[0]).toMatchObject({
      status: 'Pagada',
      paidAmount: '200000.00',
      adjustedAmount: null,
      settlement: 'Caja',
      receiptId: 'rec-1',
    });
    expect(client.fee.rows[0].status).toBe('Parcial');
    expect(res.payment).toEqual({ receiptId: 'rec-1', movementId: 'mov-1' });
    expect(withLabel({ receipt: { series: 'RECIBO_COBRO_USD', number: 7 } }).receipt).toMatchObject({ label: 'USD-00000007' });
    expect(withLabel({ receipt: null })).toEqual({ receipt: null });
    expect(audit.record.mock.calls.at(-1)[1].metadata).toEqual({ operation: 'fee-installment-pay', feeId: fee.id, n: 1 });
  });

  it('cobrar la última cuota deja el honorario pagado; la cuota ajustada guarda su importe', async () => {
    const { payments, fee, client } = await withFee({ installments: 1, adjustInstallments: true, firstDueDate: '2026-07-01' }, {
      adjustments: [{ contractId: CONTRACT_ID, periodNumber: 1, adjustmentDate: d('2026-06-01'), newAmount: '560000', isProvisional: false }],
    });
    await payments.payInstallment(fee.id, 1, { date: '2026-07-02' });
    expect(client.feeInstallment.rows[0]).toMatchObject({ paidAmount: '672000.00', adjustedAmount: '672000.00' });
    expect(client.fee.rows[0].status).toBe('Pagado');
  });

  it('un importe distinto se respeta', async () => {
    const { payments, fee, client } = await withFee();
    await payments.payInstallment(fee.id, 2, { date: '2026-04-01', amount: '150000' });
    expect(client.feeInstallment.rows[1].paidAmount).toBe('150000.00');
  });

  it('descontado de la cuenta del locador: asiento Honorario negativo, sin caja ni recibo', async () => {
    const { payments, fee, ledger, cash, receipts, client } = await withFee({
      payers: [{ role: 'Locador', personId: LESSOR_PERSON }],
      installments: 1,
    });
    await payments.payInstallment(fee.id, 1, { date: '2026-03-10', settlement: 'CuentaLocador' });
    expect(cash.recordMovement).not.toHaveBeenCalled();
    expect(receipts).toHaveLength(0);
    expect(ledger).toEqual([
      expect.objectContaining({
        personId: LESSOR_PERSON,
        type: 'Honorario',
        amount: '-600000.00',
        currency: 'ARS',
        sourceType: 'FeeInstallment',
        sourceId: client.feeInstallment.rows[0].id,
        period: d('2026-03-01'),
        description: 'Honorarios de alta de alquiler',
      }),
    ]);
    expect(client.feeInstallment.rows[0]).toMatchObject({ settlement: 'CuentaLocador', receiptId: null });
  });

  it('solo se descuenta de la cuenta de un locador del contrato', async () => {
    const a = await withFee();
    await expect(a.payments.payInstallment(a.fee.id, 1, { date: '2026-03-10', settlement: 'CuentaLocador' })).rejects.toMatchObject({
      response: { error: 'FEE_PAYER_NOT_LESSOR' },
    });
    const b = await withFee({ payers: [{ role: 'Locador', personId: LESSOR_PERSON }] }, { lessors: [] });
    await expect(b.payments.payInstallment(b.fee.id, 1, { date: '2026-03-10', settlement: 'CuentaLocador' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it.each([
    ['honorario inexistente', 'nada', 1, NotFoundException],
    ['cuota inexistente', null, 9, NotFoundException],
  ])('rechaza: %s', async (_label, feeId, n, error) => {
    const { payments, fee } = await withFee();
    await expect(payments.payInstallment(feeId ?? fee.id, n as number, { date: '2026-03-05' })).rejects.toBeInstanceOf(error);
  });

  it('una cuota cobrada o de un honorario anulado no se vuelve a cobrar', async () => {
    const { payments, service, fee, client } = await withFee();
    await payments.payInstallment(fee.id, 1, { date: '2026-03-05' });
    await expect(payments.payInstallment(fee.id, 1, { date: '2026-03-05' })).rejects.toBeInstanceOf(ConflictException);
    client.feeInstallment.rows[0].status = 'Pendiente';
    client.feeInstallment.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(payments.payInstallment(fee.id, 1, { date: '2026-03-05' })).rejects.toMatchObject({
      response: { error: 'FEE_INSTALLMENT_NOT_PENDING' },
    });
    const other = await withFee();
    await other.service.cancel(other.fee.id, { reason: 'error de carga' });
    await expect(other.payments.payInstallment(other.fee.id, 2, { date: '2026-03-05' })).rejects.toMatchObject({
      response: { error: 'FEE_CANCELLED' },
    });
    expect(service).toBeDefined();
  });

  it('una cuenta para un descuento al locador es inválida', async () => {
    const { payments, fee } = await withFee();
    await expect(
      payments.payInstallment(fee.id, 1, { date: '2026-03-05', settlement: 'CuentaLocador', accountId: ACCOUNT_ID }),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('FeePaymentsService: comisiones del personal', () => {
  it('lista con filtros y nombres', async () => {
    const { payments, client } = await withFee({ staff: [{ userId: USER_ID, pct: '10' }] });
    client.staffCommission.findMany.mockResolvedValueOnce([
      { ...client.staffCommission.rows[0], user: { firstName: 'Vera', lastName: 'Vendedora' }, fee: { kind: 'AltaAlquiler', payer: { firstName: 'Ines', lastName: 'Inquilina' } } },
    ]);
    const res = await payments.listStaffCommissions({ paid: 'false', userId: USER_ID, feeId: '88888888-8888-4888-8888-888888888888' });
    expect(res.items[0]).toMatchObject({ beneficiaryName: 'Vera Vendedora', amount: '60000.00', fee: { payerName: 'Ines Inquilina' } });
    expect(client.staffCommission.findMany.mock.calls[0][0].where).toMatchObject({ paidAt: null, userId: USER_ID, feeId: '88888888-8888-4888-8888-888888888888' });
    await payments.listStaffCommissions({ paid: 'true', personId: LESSOR_PERSON });
    expect(client.staffCommission.findMany.mock.calls[1][0].where).toMatchObject({ paidAt: { not: null }, personId: LESSOR_PERSON });
  });

  it('paga desde una cuenta como ComisionEmpleado y no se paga dos veces', async () => {
    const { payments, client, cash } = await withFee({ staff: [{ personId: LESSOR_PERSON, pct: '10' }] });
    const commission = client.staffCommission.rows[0];
    client.staffCommission.findFirst.mockResolvedValueOnce({ ...commission, fee: { kind: 'AltaAlquiler', status: 'Pendiente', contractId: CONTRACT_ID }, user: null });
    await payments.payStaffCommission(commission.id, { accountId: ACCOUNT_ID, date: '2026-03-31' });
    expect(cash.recordMovement.mock.calls[0][1]).toMatchObject({
      direction: 'Out',
      category: 'ComisionEmpleado',
      amount: '60000.00',
      counterpartyId: LESSOR_PERSON,
      sourceType: 'StaffCommission',
      note: 'Comisión por honorarios de alta de alquiler',
    });
    expect(client.staffCommission.rows[0].paidAt).toEqual(d('2026-03-31'));
    client.staffCommission.findFirst.mockResolvedValueOnce({ ...client.staffCommission.rows[0], fee: { status: 'Pendiente' } });
    await expect(payments.payStaffCommission(commission.id, { accountId: ACCOUNT_ID, date: '2026-03-31' })).rejects.toBeInstanceOf(
      ConflictException,
    );
  });

  it('rechaza: inexistente, honorario anulado, moneda distinta o pago simultáneo', async () => {
    const { payments, client, cash } = await withFee({ staff: [{ userId: USER_ID, pct: '10' }] });
    const commission = client.staffCommission.rows[0];
    await expect(payments.payStaffCommission('nada', { accountId: ACCOUNT_ID, date: '2026-03-31' })).rejects.toBeInstanceOf(NotFoundException);
    client.staffCommission.findFirst.mockResolvedValueOnce({ ...commission, fee: { status: 'Anulado' } });
    await expect(payments.payStaffCommission(commission.id, { accountId: ACCOUNT_ID, date: '2026-03-31' })).rejects.toMatchObject({
      response: { error: 'FEE_CANCELLED' },
    });
    cash.findAccount.mockResolvedValueOnce({ id: ACCOUNT_ID, kind: 'Banco', currency: 'USD', isActive: true });
    client.staffCommission.findFirst.mockResolvedValueOnce({ ...commission, fee: { kind: 'Venta', status: 'Pendiente' }, user: { firstName: 'Vera', lastName: 'Vendedora' } });
    await expect(payments.payStaffCommission(commission.id, { accountId: ACCOUNT_ID, date: '2026-03-31' })).rejects.toMatchObject({
      response: { error: 'CURRENCY_MISMATCH' },
    });
    client.staffCommission.findFirst.mockResolvedValueOnce({ ...commission, fee: { kind: 'Venta', status: 'Pendiente' }, user: { firstName: 'Vera', lastName: 'Vendedora' } });
    client.staffCommission.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(payments.payStaffCommission(commission.id, { accountId: ACCOUNT_ID, date: '2026-03-31' })).rejects.toMatchObject({
      response: { error: 'STAFF_COMMISSION_PAID' },
    });
    expect(cash.recordMovement.mock.calls.at(-1)?.[1].note).toBe('Comisión por honorarios de venta — Vera Vendedora');
  });
});

describe('installmentLabel', () => {
  it('nombra la operación y la cuota', () => {
    expect(installmentLabel({ kind: 'Renovacion', installments: 3 }, 2)).toBe('Honorarios de renovación, cuota 2/3');
    expect(installmentLabel({ kind: 'Tasacion', installments: 1 }, 1)).toBe('Honorarios de tasación');
    expect(installmentLabel({ kind: 'Otro', installments: 1 }, 1)).toBe('Honorarios de Otro');
  });
});
