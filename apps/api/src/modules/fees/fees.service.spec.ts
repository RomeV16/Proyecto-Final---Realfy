import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import {
  CONTRACT_ID,
  LESSOR_PERSON,
  PERIOD_ID,
  PROPERTY_ID,
  TENANT_PERSON,
  USER_ID,
  altaInput,
  buildFees,
  d,
} from './fees.testing';

const amounts = (rows: any[]) => rows.map((r) => String(r.amount));

describe('FeesService: alta', () => {
  it('alta 5 % del total al inquilino en 3 cuotas mensuales', async () => {
    const { service, client, audit } = buildFees();
    const res = await service.create(altaInput());
    expect(res.items).toHaveLength(1);
    const fee = client.fee.rows[0];
    expect(fee).toMatchObject({
      kind: 'AltaAlquiler',
      status: 'Pendiente',
      contractId: CONTRACT_ID,
      propertyId: PROPERTY_ID,
      payerPersonId: TENANT_PERSON,
      payerRole: 'Inquilino',
      pct: '5',
      netAmount: '600000.00',
      vatAmount: '0.00',
      total: '600000.00',
      installments: 3,
      groupId: null,
    });
    expect(amounts(client.feeInstallment.rows)).toEqual(['200000.00', '200000.00', '200000.00']);
    expect(client.feeInstallment.rows.map((i: any) => i.dueDate.toISOString().slice(0, 10))).toEqual([
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
    ]);
    expect(audit.record.mock.calls[0][1]).toMatchObject({ entity: 'Fee', metadata: { operation: 'fee-create' } });
    expect(res.items[0].installmentRows.map((i: any) => i.dueAmount)).toEqual(['200000.00', '200000.00', '200000.00']);
  });

  it('pagan los dos: un honorario por persona con el mismo grupo y el porcentaje repartido', async () => {
    const { service, client } = buildFees();
    await service.create(
      altaInput({
        payers: [
          { role: 'Inquilino', personId: TENANT_PERSON, sharePct: '60' },
          { role: 'Locador', personId: LESSOR_PERSON, sharePct: '40' },
        ],
        baseAmount: '2000.20',
        installments: 1,
      }),
    );
    const [tenantFee, lessorFee] = client.fee.rows;
    expect([tenantFee.total, lessorFee.total]).toEqual(['60.01', '40.00']);
    expect([tenantFee.pct, lessorFee.pct]).toEqual(['3', '2']);
    expect(tenantFee.groupId).toBeTruthy();
    expect(tenantFee.groupId).toBe(lessorFee.groupId);
  });

  it('venta: cada parte paga su porcentaje sobre el valor real, con coorretaje y comisión del personal', async () => {
    const { service, client } = buildFees();
    await service.create({
      kind: 'Venta',
      propertyId: PROPERTY_ID,
      basis: 'ValorOperacion',
      baseAmount: '120000',
      pct: '3',
      currency: 'USD',
      payerMode: 'CadaParte',
      payers: [
        { role: 'Comprador', personId: TENANT_PERSON },
        { role: 'Vendedor', personId: LESSOR_PERSON },
      ],
      firstDueDate: '2026-11-02',
      shares: [{ counterparty: 'Inmobiliaria Sintética', pct: '50' }],
      staff: [{ userId: USER_ID, pct: '10' }],
    });
    expect(client.fee.rows.map((f: any) => [f.payerRole, f.total, f.pct])).toEqual([
      ['Comprador', '3600.00', '3'],
      ['Vendedor', '3600.00', '3'],
    ]);
    expect(amounts(client.feeShare.rows)).toEqual(['1800.00', '1800.00']);
    expect(client.staffCommission.rows.map((c: any) => [c.baseAmount, c.amount, c.currency])).toEqual([
      ['1800.00', '180.00', 'USD'],
      ['1800.00', '180.00', 'USD'],
    ]);
  });

  it('IVA sumado: el neto se reparte y el total lleva el IVA', async () => {
    const { service, client } = buildFees();
    await service.create(altaInput({ vatMode: 'Adicional', vatPct: '21', installments: 1 }));
    expect(client.fee.rows[0]).toMatchObject({ netAmount: '600000.00', vatAmount: '126000.00', total: '726000.00' });
  });

  it('tasación sin cargo: honorario en cero, sin cuotas', async () => {
    const ok = buildFees({ valuation: { id: 'b3b9a0f2-6a8f-4a57-9a3b-7b2a1e2e2a01', propertyId: PROPERTY_ID } });
    await ok.service.create({
      kind: 'Tasacion',
      valuationId: 'b3b9a0f2-6a8f-4a57-9a3b-7b2a1e2e2a01',
      basis: 'MontoFijo',
      baseAmount: '0',
      currency: 'USD',
      payers: [{ role: 'Otro', personId: LESSOR_PERSON }],
      firstDueDate: '2026-11-02',
    });
    expect(ok.client.fee.rows[0]).toMatchObject({ status: 'SinCargo', total: '0.00', installments: 0, propertyId: PROPERTY_ID });
    expect(ok.client.feeInstallment.rows).toHaveLength(0);
  });

  it('renovación desde el período: toma el contrato del período', async () => {
    const { service, client } = buildFees();
    await service.create(
      altaInput({ kind: 'Renovacion', contractId: undefined, contractPeriodId: PERIOD_ID, basis: 'MontoFijo', pct: undefined, baseAmount: '96000', installments: 2 }),
    );
    expect(client.fee.rows[0]).toMatchObject({ kind: 'Renovacion', contractId: CONTRACT_ID, contractPeriodId: PERIOD_ID, total: '96000.00' });
  });

  it.each([
    ['contrato inexistente', { contract: null }, altaInput(), NotFoundException],
    ['persona inexistente', { persons: [] }, altaInput(), NotFoundException],
    ['usuario inexistente', { users: [] }, altaInput({ staff: [{ userId: USER_ID, pct: '5' }] }), NotFoundException],
    ['período de otro contrato', {}, altaInput({ contractPeriodId: PERIOD_ID, contractId: '99999999-9999-4999-8999-999999999999' }), BadRequestException],
    ['período inexistente', { periods: [] }, altaInput({ contractPeriodId: PERIOD_ID }), NotFoundException],
    ['alquiler sin contrato', {}, altaInput({ contractId: undefined, basis: 'MontoFijo', pct: undefined }), BadRequestException],
    ['propiedad inexistente', {}, altaInput({ propertyId: '99999999-9999-4999-8999-999999999999' }), NotFoundException],
    ['coorretaje de más de 100', {}, altaInput({ shares: [{ counterparty: 'AA', pct: '60' }, { counterparty: 'BB', pct: '50' }] }), BadRequestException],
    ['cuerpo inválido', {}, { kind: 'AltaAlquiler' }, BadRequestException],
  ])('rechaza: %s', async (_label, world, input, error) => {
    const { service } = buildFees(world as any);
    await expect(service.create(input)).rejects.toBeInstanceOf(error);
  });
});

describe('FeesService: lectura y cuotas ajustadas', () => {
  it('las cuotas que vencen después de un ajuste muestran el importe ajustado', async () => {
    const { service } = buildFees({
      adjustments: [
        { contractId: CONTRACT_ID, periodNumber: 1, adjustmentDate: d('2026-06-01'), newAmount: '530000', isProvisional: true },
        { contractId: CONTRACT_ID, periodNumber: 1, adjustmentDate: d('2026-06-01'), newAmount: '560000', isProvisional: false },
      ],
    });
    // La corrección (no provisoria) viene primero en el orden de la consulta.
    const { client } = (service as any).prisma;
    client.contractAdjustment.findMany.mockResolvedValueOnce([
      { contractId: CONTRACT_ID, periodNumber: 1, adjustmentDate: d('2026-06-01'), newAmount: '560000', isProvisional: false },
      { contractId: CONTRACT_ID, periodNumber: 1, adjustmentDate: d('2026-06-01'), newAmount: '530000', isProvisional: true },
    ]);
    const created = await service.create(altaInput({ baseAmount: '12000000', installments: 6, adjustInstallments: true }));
    expect(created.items[0].installmentRows.map((i: any) => i.dueAmount)).toEqual([
      '100000.00',
      '100000.00',
      '100000.00',
      '112000.00',
      '112000.00',
      '112000.00',
    ]);
  });

  it('lista honorarios con filtros y paginado', async () => {
    const { service, client } = buildFees();
    await service.create(altaInput());
    const res = await service.findAll({ kind: 'AltaAlquiler', status: 'Pendiente', payerRole: 'Inquilino', period: '2026-04', contractId: CONTRACT_ID, propertyId: PROPERTY_ID, payerPersonId: TENANT_PERSON });
    expect(res.total).toBe(1);
    expect(res.items[0].payerName).toBe('Paga Sintetico');
    const where = client.fee.findMany.mock.calls.at(-1)[0].where;
    expect(where.installmentRows).toEqual({ some: { dueDate: { gte: d('2026-04-01'), lt: d('2026-05-01') } } });
  });

  it('lista cuotas por mes con el importe a cobrar', async () => {
    const { service, client } = buildFees();
    await service.create(altaInput());
    const res = await service.findInstallments({ period: '2026-04', status: 'Pendiente', kind: 'AltaAlquiler', payerRole: 'Inquilino', contractId: CONTRACT_ID });
    expect(res.items).toHaveLength(1);
    expect(res.items[0]).toMatchObject({ n: 2, dueAmount: '200000.00', fee: { kind: 'AltaAlquiler', payerName: 'Paga Sintetico' } });
    expect(client.feeInstallment.findMany.mock.calls[0][0].where.fee).toEqual({ kind: 'AltaAlquiler', payerRole: 'Inquilino', contractId: CONTRACT_ID });
  });

  it('un honorario inexistente es 404', async () => {
    await expect(buildFees().service.findOne('nada')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FeesService: cambios', () => {
  async function withFee(world = {}) {
    const ctx = buildFees(world);
    await ctx.service.create(altaInput({ staff: [{ userId: USER_ID, pct: '10' }] }));
    return { ...ctx, fee: ctx.client.fee.rows[0] };
  }

  it('cambia las notas', async () => {
    const { service, fee, client } = await withFee();
    await service.update(fee.id, { notes: 'pactado en la firma' });
    expect(client.fee.rows[0].notes).toBe('pactado en la firma');
  });

  it('agregar coorretaje recalcula las comisiones sin pagar; quitarlo las restituye', async () => {
    const { service, fee, client } = await withFee();
    expect(client.staffCommission.rows[0].amount).toBe('60000.00');
    await service.addShare(fee.id, { counterparty: 'Otra inmobiliaria', pct: '50' });
    expect(client.feeShare.rows[0].amount).toBe('300000.00');
    expect(client.staffCommission.rows[0]).toMatchObject({ baseAmount: '300000.00', amount: '30000.00' });
    await service.removeShare(fee.id, client.feeShare.rows[0].id);
    expect(client.staffCommission.rows[0].amount).toBe('60000.00');
    await expect(service.removeShare(fee.id, 'nada')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('una comisión pagada no se recalcula ni se borra', async () => {
    const { service, fee, client } = await withFee();
    client.staffCommission.rows[0].paidAt = d('2026-03-05');
    await service.addShare(fee.id, { counterparty: 'Otra inmobiliaria', pct: '50' });
    expect(client.staffCommission.rows[0].amount).toBe('60000.00');
    await expect(service.removeStaffCommission(fee.id, client.staffCommission.rows[0].id)).rejects.toBeInstanceOf(ConflictException);
  });

  it('agrega y quita comisiones del personal', async () => {
    const { service, fee, client } = await withFee();
    await service.addStaffCommission(fee.id, { personId: LESSOR_PERSON, pct: '5' });
    expect(client.staffCommission.rows[1]).toMatchObject({ personId: LESSOR_PERSON, amount: '30000.00', currency: 'ARS' });
    await service.removeStaffCommission(fee.id, client.staffCommission.rows[1].id);
    expect(client.staffCommission.rows).toHaveLength(1);
    await expect(service.removeStaffCommission(fee.id, 'nada')).rejects.toBeInstanceOf(NotFoundException);
    await expect(service.addStaffCommission(fee.id, { userId: USER_ID, personId: LESSOR_PERSON, pct: '5' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('anula: las cuotas pendientes quedan anuladas y ya no se cambia', async () => {
    const { service, fee, client } = await withFee();
    await service.cancel(fee.id, { reason: 'el inquilino desistió' });
    expect(client.fee.rows[0]).toMatchObject({ status: 'Anulado', cancelReason: 'el inquilino desistió' });
    expect(client.feeInstallment.rows.every((i: any) => i.status === 'Anulada')).toBe(true);
    await expect(service.cancel(fee.id, { reason: 'otra vez' })).rejects.toBeInstanceOf(ConflictException);
    await expect(service.addShare(fee.id, { counterparty: 'Otra', pct: '10' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('no anula con cuotas cobradas ni con comisiones pagadas', async () => {
    const a = await withFee();
    a.client.feeInstallment.rows[0].status = 'Pagada';
    await expect(a.service.cancel(a.fee.id, { reason: 'error de carga' })).rejects.toMatchObject({ response: { error: 'FEE_HAS_PAYMENTS' } });
    const b = await withFee();
    b.client.staffCommission.rows[0].paidAt = d('2026-03-05');
    await expect(b.service.cancel(b.fee.id, { reason: 'error de carga' })).rejects.toMatchObject({
      response: { error: 'FEE_HAS_PAID_COMMISSIONS' },
    });
  });

  it('un honorario inexistente no se cambia', async () => {
    const { service } = buildFees();
    await expect(service.update('nada', { notes: 'x' })).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('FeesService: honorario de una renovación', () => {
  it('monto pactado del período a quien paga según la inmobiliaria, con sus cuotas', async () => {
    const { service, client } = buildFees({ defaults: { fees: { payer: 'Ambos', installments: 2 } as any } });
    const ids = await service.createRenewalFee(client, 'tenant-1', {
      contractId: CONTRACT_ID,
      contractPeriodId: PERIOD_ID,
      amount: '96000',
      currency: 'ARS',
      firstDueDate: d('2028-03-01'),
    });
    expect(ids).toHaveLength(2);
    expect(client.fee.rows.map((f: any) => [f.kind, f.basis, f.payerRole, f.total, f.contractPeriodId])).toEqual([
      ['Renovacion', 'MontoFijo', 'Inquilino', '48000.00', PERIOD_ID],
      ['Renovacion', 'MontoFijo', 'Locador', '48000.00', PERIOD_ID],
    ]);
    expect(client.feeInstallment.rows.map((i: any) => i.dueDate.toISOString().slice(0, 10))).toEqual([
      '2028-03-01',
      '2028-04-01',
      '2028-03-01',
      '2028-04-01',
    ]);
  });

  it('sin contrato o sin quién pague, no se carga', async () => {
    const args = { contractId: CONTRACT_ID, contractPeriodId: PERIOD_ID, amount: '1', currency: 'ARS', firstDueDate: d('2028-03-01') };
    const none = buildFees({ contract: null });
    await expect(none.service.createRenewalFee(none.client, 'tenant-1', args)).rejects.toBeInstanceOf(NotFoundException);
    const nobody = buildFees({ contract: { ...syntheticContractWithoutTenant() } });
    await expect(nobody.service.createRenewalFee(nobody.client, 'tenant-1', args)).rejects.toMatchObject({
      response: { error: 'FEE_PAYER_NOT_FOUND' },
    });
  });
});

function syntheticContractWithoutTenant() {
  return { id: CONTRACT_ID, propertyId: PROPERTY_ID, persons: [] };
}
