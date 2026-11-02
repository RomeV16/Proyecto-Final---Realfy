import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createUserDirect,
  loginUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  UserRole,
  PersonRole,
  PropertyType,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
} from '@realfy/shared';

const PASSWORD = 'Password123!';

/**
 * Honorarios (ítem 41, FB-12, FB-19): alta 5 % del total del contrato, cuotas
 * con ajuste, cobro a caja con recibo o descontado de la cuenta del locador,
 * venta por parte con coorretaje y comisión del personal, tasación.
 * Contrato sintético de 500000 por 24 meses (IPC trimestral): total 12000000.
 */
describe('Honorarios (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await teardownTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => http().get(`/api${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => http().post(`/api${path}`).set(auth(token)).send(body);
  const del = (token: string, path: string) => http().delete(`/api${path}`).set(auth(token));

  async function agency(tag: string) {
    const admin = await registerUser(app, { email: `admin@${tag}.test`, password: PASSWORD, firstName: 'Admin', lastName: 'Prueba' });
    const tokens = { [UserRole.Admin]: admin.accessToken } as Record<UserRole, string>;
    const userIds = {} as Record<UserRole, string>;
    for (const role of [UserRole.Gerente, UserRole.Liquidaciones, UserRole.Lectura, UserRole.Ventas]) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      const user = await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role, firstName: 'Vera', lastName: role });
      userIds[role] = user.id;
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { tenantId: admin.user.tenantId as string, tokens, userIds, token: tokens[UserRole.Admin] };
  }

  async function rental(token: string) {
    const lessor = (await post(token, '/persons', { firstName: 'Luis', lastName: 'Locador' }).expect(201)).body.id;
    const tenantPerson = (await post(token, '/persons', { firstName: 'Ines', lastName: 'Inquilina' }).expect(201)).body.id;
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = await post(token, '/properties', { title: 'Unidad sintética', type: PropertyType.Departamento }).expect(201);
    const contract = (
      await post(token, '/contracts', {
        propertyId: property.body.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: '2026-03-01T00:00:00.000Z',
        endDate: '2028-02-29T00:00:00.000Z',
        rentAmount: '500000.00',
        rentCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        guarantees: [],
        persons: [
          { personId: lessor, role: PersonRole.Propietario },
          { personId: tenantPerson, role: PersonRole.Inquilino },
        ],
      }).expect(201)
    ).body;
    return { contract, lessor, tenantPerson, propertyId: property.body.id as string };
  }

  it('CP-530 — la propuesta de alta es el 5 % del total de 24 meses al inquilino; se crea en cuotas', async () => {
    const { token, tokens } = await agency('hon-1');
    const { contract, tenantPerson } = await rental(token);
    const preview = (await get(tokens[UserRole.Gerente], `/fees/preview?kind=AltaAlquiler&contractId=${contract.id}`).expect(200)).body;
    expect(preview).toMatchObject({
      basis: 'TotalContrato',
      baseAmount: '12000000.00',
      pct: '5',
      currency: 'ARS',
      payers: [{ role: 'Inquilino', personId: tenantPerson, sharePct: '100' }],
      firstDueDate: '2026-03-01',
      contractTotal: { months: 24, indexBased: true },
      estimate: ['600000.00'],
    });
    await get(tokens[UserRole.Liquidaciones], `/fees/preview?kind=AltaAlquiler&contractId=${contract.id}`).expect(403);

    const body = {
      kind: 'AltaAlquiler',
      contractId: contract.id,
      basis: preview.basis,
      baseAmount: preview.baseAmount,
      pct: preview.pct,
      currency: preview.currency,
      payers: preview.payers.map((p: any) => ({ role: p.role, personId: p.personId, sharePct: p.sharePct })),
      installments: 3,
      firstDueDate: preview.firstDueDate,
    };
    await post(tokens[UserRole.Liquidaciones], '/fees', body).expect(403);
    const created = (await post(tokens[UserRole.Gerente], '/fees', body).expect(201)).body.items[0];
    expect(created).toMatchObject({ status: 'Pendiente', total: '600000', installments: 3, payerName: 'Ines Inquilina' });
    expect(created.installmentRows.map((i: any) => [i.n, i.dueDate.slice(0, 10), i.dueAmount])).toEqual([
      [1, '2026-03-01', '200000.00'],
      [2, '2026-04-01', '200000.00'],
      [3, '2026-05-01', '200000.00'],
    ]);
    const list = (await get(tokens[UserRole.Lectura], `/fees?contractId=${contract.id}&period=2026-04`).expect(200)).body;
    expect(list.total).toBe(1);
    const april = (await get(tokens[UserRole.Lectura], '/fees/installments?period=2026-04').expect(200)).body;
    expect(april.items.map((i: any) => [i.n, i.status, i.dueAmount, i.fee.kind])).toEqual([[2, 'Pendiente', '200000.00', 'AltaAlquiler']]);
  });

  it('CP-531 — cobrar una cuota a caja deja el movimiento Honorario y un recibo; no se cobra dos veces', async () => {
    const { token, tokens } = await agency('hon-2');
    const { contract, tenantPerson } = await rental(token);
    const fee = (
      await post(token, '/fees', {
        kind: 'AltaAlquiler',
        contractId: contract.id,
        basis: 'TotalContrato',
        baseAmount: '12000000',
        pct: '5',
        currency: 'ARS',
        payers: [{ role: 'Inquilino', personId: tenantPerson }],
        installments: 2,
        firstDueDate: '2026-03-01',
      }).expect(201)
    ).body.items[0];
    await post(tokens[UserRole.Ventas], `/fees/${fee.id}/installments/1/pay`, { date: '2026-03-05' }).expect(403);
    const paid = (await post(tokens[UserRole.Liquidaciones], `/fees/${fee.id}/installments/1/pay`, { date: '2026-03-05', method: 'Efectivo' }).expect(200)).body;
    expect(paid.status).toBe('Parcial');
    expect(paid.installmentRows[0]).toMatchObject({ status: 'Pagada', settlement: 'Caja', paidAmount: '300000' });
    const movements = (await get(token, '/cash-movements?category=Honorario').expect(200)).body.items;
    expect(movements.map((m: any) => [m.direction, m.amount, m.sourceType, m.counterpartyId])).toEqual([['In', '300000', 'FeeInstallment', tenantPerson]]);
    const receipts = (await get(token, `/receipts?contractId=${contract.id}`).expect(200)).body.items;
    expect(receipts[0]).toMatchObject({ number: '00000001', concept: 'Honorarios de alta de alquiler, cuota 1/2', tenantName: 'Ines Inquilina' });
    await post(token, `/fees/${fee.id}/installments/1/pay`, { date: '2026-03-05' }).expect(409);
    await post(token, `/fees/${fee.id}/cancel`, { reason: 'error de carga' }).expect(409);
    const done = (await post(token, `/fees/${fee.id}/installments/2/pay`, { date: '2026-04-05' }).expect(200)).body;
    expect(done.status).toBe('Pagado');
  });

  it('CP-532 — un honorario del locador se descuenta de su cuenta corriente, sin caja', async () => {
    const { token } = await agency('hon-3');
    const { contract, lessor, tenantPerson } = await rental(token);
    const items = (
      await post(token, '/fees', {
        kind: 'AltaAlquiler',
        contractId: contract.id,
        basis: 'TotalContrato',
        baseAmount: '12000000',
        pct: '5',
        currency: 'ARS',
        payers: [
          { role: 'Inquilino', personId: tenantPerson, sharePct: '50' },
          { role: 'Locador', personId: lessor, sharePct: '50' },
        ],
        firstDueDate: '2026-03-01',
      }).expect(201)
    ).body.items;
    expect(items.map((f: any) => [f.payerRole, f.total, f.pct])).toEqual([
      ['Inquilino', '300000', '2.5'],
      ['Locador', '300000', '2.5'],
    ]);
    expect(items[0].groupId).toBe(items[1].groupId);
    await post(token, `/fees/${items[0].id}/installments/1/pay`, { date: '2026-03-10', settlement: 'CuentaLocador' }).expect(400);
    await post(token, `/fees/${items[1].id}/installments/1/pay`, { date: '2026-03-10', settlement: 'CuentaLocador' }).expect(200);
    const ledger = (await get(token, `/owners/${lessor}/ledger`).expect(200)).body;
    expect(ledger.items.map((i: any) => [i.type, i.amount, i.description])).toEqual([['Honorario', '-300000.00', 'Honorarios de alta de alquiler']]);
    const movements = (await get(token, '/cash-movements?category=Honorario').expect(200)).body.items;
    expect(movements).toHaveLength(0);
  });

  it('CP-533 — venta: cada parte paga el 3 %; coorretaje al 50 % y comisión del personal sobre el neto', async () => {
    const { token, tokens, userIds } = await agency('hon-4');
    const buyer = (await post(token, '/persons', { firstName: 'Carla', lastName: 'Compradora' }).expect(201)).body.id;
    const seller = (await post(token, '/persons', { firstName: 'Victor', lastName: 'Vendedor' }).expect(201)).body.id;
    const property = (await post(token, '/properties', { title: 'Casa sintética', type: PropertyType.Casa }).expect(201)).body;
    const preview = (await get(token, `/fees/preview?kind=Venta&propertyId=${property.id}&baseAmount=120000`).expect(200)).body;
    expect(preview).toMatchObject({ saleAsset: 'Construido', pct: '3', currency: 'USD', payerMode: 'CadaParte', estimate: ['3600.00'] });
    const items = (
      await post(token, '/fees', {
        kind: 'Venta',
        propertyId: property.id,
        basis: 'ValorOperacion',
        baseAmount: '120000',
        pct: '3',
        currency: 'USD',
        payerMode: 'CadaParte',
        payers: [
          { role: 'Comprador', personId: buyer },
          { role: 'Vendedor', personId: seller },
        ],
        firstDueDate: '2026-11-02',
        shares: [{ counterparty: 'Inmobiliaria Sintética', pct: '50' }],
        staff: [{ userId: userIds[UserRole.Ventas], pct: '10' }],
      }).expect(201)
    ).body.items;
    expect(items.map((f: any) => [f.payerRole, f.total, f.shares[0].amount, f.staffCommissions[0].amount])).toEqual([
      ['Comprador', '3600', '1800', '180'],
      ['Vendedor', '3600', '1800', '180'],
    ]);

    await get(tokens[UserRole.Liquidaciones], '/staff-commissions').expect(403);
    const pending = (await get(token, '/staff-commissions?paid=false').expect(200)).body;
    expect(pending.total).toBe(2);
    expect(pending.items[0]).toMatchObject({ beneficiaryName: 'Vera Ventas', currency: 'USD' });
    const usd = (await post(token, '/financial-accounts', { kind: 'Banco', name: 'Banco USD', currency: 'USD' }).expect(201)).body;
    await post(token, `/staff-commissions/${pending.items[0].id}/pay`, { accountId: usd.id, date: '2026-11-10' }).expect(200);
    await post(token, `/staff-commissions/${pending.items[0].id}/pay`, { accountId: usd.id, date: '2026-11-10' }).expect(409);
    const out = (await get(token, '/cash-movements?category=ComisionEmpleado').expect(200)).body.items;
    expect(out.map((m: any) => [m.direction, m.amount, m.currency])).toEqual([['Out', '180', 'USD']]);
    expect((await get(token, '/staff-commissions?paid=true').expect(200)).body.total).toBe(1);

    // Quitar el coorretaje recalcula la comisión que falta pagar; la pagada no cambia.
    const paidFee = items.find((f: any) => f.id === pending.items[0].feeId);
    const unpaidFee = items.find((f: any) => f.id !== pending.items[0].feeId);
    const after = (await del(token, `/fees/${unpaidFee.id}/shares/${unpaidFee.shares[0].id}`).expect(200)).body;
    expect(after.staffCommissions[0].amount).toBe('360');
    const kept = (await del(token, `/fees/${paidFee.id}/shares/${paidFee.shares[0].id}`).expect(200)).body;
    expect(kept.staffCommissions[0]).toMatchObject({ amount: '180', paidAt: '2026-11-10T00:00:00.000Z' });
  });

  it('CP-534 — tasación USD 100 al titular, o sin cargo', async () => {
    const { token, tenantId } = await agency('hon-5');
    const owner = (await post(token, '/persons', { firstName: 'Olga', lastName: 'Titular' }).expect(201)).body.id;
    const property = (await post(token, '/properties', { title: 'Lote sintético', type: PropertyType.Lote }).expect(201)).body;
    const valuation = await prisma.baseClient.propertyValuation.create({
      data: { tenantId, propertyId: property.id, valuationDate: new Date('2026-10-30T00:00:00.000Z'), value: '45000', currency: 'USD', method: 'Comparativo' },
    });
    const preview = (await get(token, `/fees/preview?kind=Tasacion&valuationId=${valuation.id}`).expect(200)).body;
    expect(preview).toMatchObject({ basis: 'MontoFijo', baseAmount: '100', currency: 'USD', propertyId: property.id });
    const charged = (
      await post(token, '/fees', {
        kind: 'Tasacion',
        valuationId: valuation.id,
        basis: 'MontoFijo',
        baseAmount: '100',
        currency: 'USD',
        payers: [{ role: 'Otro', personId: owner }],
        firstDueDate: '2026-11-02',
      }).expect(201)
    ).body.items[0];
    expect(charged).toMatchObject({ status: 'Pendiente', total: '100', propertyId: property.id, installments: 1 });
    const free = (
      await post(token, '/fees', {
        kind: 'Tasacion',
        valuationId: valuation.id,
        basis: 'MontoFijo',
        baseAmount: '0',
        currency: 'USD',
        payers: [{ role: 'Otro', personId: owner }],
        firstDueDate: '2026-11-02',
      }).expect(201)
    ).body.items[0];
    expect(free).toMatchObject({ status: 'SinCargo', total: '0', installments: 0, installmentRows: [] });
  });

  it('CP-535 — las cuotas que vencen después de un ajuste del alquiler se cobran ajustadas', async () => {
    const { token, tenantId } = await agency('hon-6');
    const { contract, tenantPerson } = await rental(token);
    const fee = (
      await post(token, '/fees', {
        kind: 'AltaAlquiler',
        contractId: contract.id,
        basis: 'TotalContrato',
        baseAmount: '12000000',
        pct: '5',
        currency: 'ARS',
        payers: [{ role: 'Inquilino', personId: tenantPerson }],
        installments: 6,
        firstDueDate: '2026-03-01',
        adjustInstallments: true,
      }).expect(201)
    ).body.items[0];
    await prisma.baseClient.contractAdjustment.create({
      data: {
        tenantId,
        contractId: contract.id,
        periodNumber: 1,
        adjustmentDate: new Date('2026-06-01T00:00:00.000Z'),
        previousAmount: '500000',
        newAmount: '560000',
        percentage: '12',
        calculatedAt: new Date('2026-06-01T00:00:00.000Z'),
        appliedAt: new Date('2026-06-01T00:00:00.000Z'),
      },
    });
    const read = (await get(token, `/fees/${fee.id}`).expect(200)).body;
    expect(read.installmentRows.map((i: any) => i.dueAmount)).toEqual(['100000.00', '100000.00', '100000.00', '112000.00', '112000.00', '112000.00']);
    const paid = (await post(token, `/fees/${fee.id}/installments/4/pay`, { date: '2026-06-02' }).expect(200)).body;
    expect(paid.installmentRows[3]).toMatchObject({ paidAmount: '112000', adjustedAmount: '112000' });
  });

  it('CP-536 — anular un honorario sin cobros; otra inmobiliaria no lo ve', async () => {
    const { token } = await agency('hon-7');
    const { contract, tenantPerson } = await rental(token);
    const fee = (
      await post(token, '/fees', {
        kind: 'AltaAlquiler',
        contractId: contract.id,
        basis: 'TotalContrato',
        baseAmount: '12000000',
        pct: '5',
        currency: 'ARS',
        payers: [{ role: 'Inquilino', personId: tenantPerson }],
        firstDueDate: '2026-03-01',
      }).expect(201)
    ).body.items[0];
    const other = await agency('hon-8');
    await get(other.token, `/fees/${fee.id}`).expect(404);
    await post(other.token, `/fees/${fee.id}/installments/1/pay`, { date: '2026-03-05' }).expect(404);
    expect((await get(other.token, '/fees').expect(200)).body.total).toBe(0);

    const cancelled = (await post(token, `/fees/${fee.id}/cancel`, { reason: 'el inquilino desistió' }).expect(200)).body;
    expect(cancelled).toMatchObject({ status: 'Anulado', cancelReason: 'el inquilino desistió' });
    expect(cancelled.installmentRows[0].status).toBe('Anulada');
    await post(token, `/fees/${fee.id}/installments/1/pay`, { date: '2026-03-05' }).expect(409);
  });
});
