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
 * Caja y cobros (ítem 36, FB-06 y FB-28): cobro en los tres flujos, caja y
 * banco creados al primer uso, recibo numerado una sola vez, custodia hasta la
 * entrega, compensaciones, movimientos manuales, conversión con tipo de cambio
 * explícito y cargos a la inmobiliaria como gasto. Contratos de 100000 con dos
 * locadores al 50 % y la comisión de la inmobiliaria (7 %): 7000 para la
 * inmobiliaria y 46500 para cada locador.
 */
describe('Caja y cobros (e2e)', () => {
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
  const post = (token: string, path: string, body: object = {}) =>
    http().post(`/api${path}`).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: object = {}) =>
    http().patch(`/api${path}`).set(auth(token)).send(body);

  async function agency(tag: string) {
    const admin = await registerUser(app, {
      email: `admin@${tag}.test`,
      password: PASSWORD,
      firstName: 'Admin',
      lastName: 'Prueba',
    });
    const tokens = { [UserRole.Admin]: admin.accessToken } as Record<UserRole, string>;
    for (const role of [UserRole.Gerente, UserRole.Liquidaciones, UserRole.Lectura, UserRole.Ventas]) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { tenantId: admin.user.tenantId as string, tokens, token: tokens[UserRole.Admin] };
  }

  async function contractWithLessors(token: string, currency = 'ARS', rent = '100000.00') {
    const a = (await post(token, '/persons', { firstName: 'Ana', lastName: 'Locadora' }).expect(201)).body.id;
    const b = (await post(token, '/persons', { firstName: 'Beto', lastName: 'Locador' }).expect(201)).body.id;
    const tenantPerson = (await post(token, '/persons', { firstName: 'Ines', lastName: 'Inquilina' }).expect(201)).body.id;
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = await post(token, '/properties', { title: 'Unidad sintética', type: PropertyType.Departamento }).expect(201);
    const contract = (
      await post(token, '/contracts', {
        propertyId: property.body.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2028-12-31T00:00:00.000Z',
        rentAmount: rent,
        rentCurrency: currency,
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Anual,
        guarantees: [],
        persons: [
          { personId: a, role: PersonRole.Propietario },
          { personId: b, role: PersonRole.Propietario },
          { personId: tenantPerson, role: PersonRole.Inquilino },
        ],
      }).expect(201)
    ).body;
    return { contract, a, b, tenantPerson };
  }

  /** Genera el mes y deja la liquidación del contrato Enviada. */
  async function sent(token: string, contractId: string, month: number) {
    await post(token, '/liquidaciones/generate', { month, year: 2026 }).expect(201);
    const list = (await get(token, `/liquidaciones?contractId=${contractId}&limit=100`).expect(200)).body.items as any[];
    const liq = list.find((l) => new Date(l.period).getUTCMonth() + 1 === month);
    for (const status of ['Revision', 'Aprobada', 'Enviada']) {
      await post(token, `/liquidaciones/${liq.id}/transition`, { status }).expect(200);
    }
    return (await get(token, `/liquidaciones/${liq.id}`).expect(200)).body;
  }

  const pay = (token: string, liqId: string, body: Record<string, unknown>) =>
    post(token, `/liquidaciones/${liqId}/payments`, { method: 'Efectivo', paidAt: '2026-01-08T12:00:00.000Z', ...body });

  const accounts = async (token: string) => (await get(token, '/financial-accounts').expect(200)).body;

  it('CP-398 — cobro en efectivo de la inmobiliaria: caja creada al primer uso, ingreso, recibo y reparto', async () => {
    const { token } = await agency('caja-1');
    const { contract, a, b, tenantPerson } = await contractWithLessors(token);
    const jan = await sent(token, contract.id, 1);
    expect(jan.total).toBe('100000');

    const res = (await pay(token, jan.id, { amount: '100000' }).expect(200)).body;
    const payment = res.registeredPayment;
    expect(payment).toMatchObject({ receivedBy: 'Inmobiliaria', inCustody: false });
    expect(payment.account).toMatchObject({ name: 'Caja ARS', kind: 'Caja', currency: 'ARS' });
    expect(payment.receipt).toMatchObject({ series: 'RECIBO_COBRO', number: 1 });
    expect(payment.settlement).toMatchObject({
      flow: 'Inmobiliaria',
      payment: { agency: '7000.00', ente: '0.00', lessors: '93000.00' },
      agencyCash: '100000.00',
    });
    expect(payment.settlement.positions.map((p: any) => [p.personId, p.balance]).sort()).toEqual(
      [
        [a, '46500.00'],
        [b, '46500.00'],
      ].sort(),
    );

    const { items, totals } = await accounts(token);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ name: 'Caja ARS', balance: '100000.00' });
    expect(totals).toEqual([{ currency: 'ARS', agency: '100000.00', custody: '0.00', total: '100000.00' }]);

    const movements = (await get(token, '/cash-movements').expect(200)).body.items;
    expect(movements).toHaveLength(1);
    expect(movements[0]).toMatchObject({
      direction: 'In',
      amount: '100000',
      category: 'AlquilerCobrado',
      contractId: contract.id,
      counterpartyId: tenantPerson,
      sourceType: 'Payment',
      sourceId: payment.id,
    });
  });

  it('CP-399 — cada cobro emite un recibo con el número siguiente, una sola vez; el PDF lleva el número', async () => {
    const { token } = await agency('caja-2');
    const { contract } = await contractWithLessors(token);
    const jan = await sent(token, contract.id, 1);
    const first = (await pay(token, jan.id, { amount: '40000', method: 'Transferencia' }).expect(200)).body.registeredPayment;
    const second = (await pay(token, jan.id, { amount: '60000', method: 'Transferencia' }).expect(200)).body.registeredPayment;
    expect([first.receipt.number, second.receipt.number]).toEqual([1, 2]);
    // Una transferencia entra al banco de la moneda, creado al primer uso.
    expect(second.account).toMatchObject({ name: 'Banco ARS', kind: 'Banco' });
    // Los pagos parciales suman exactamente la liquidación.
    const agencyTotal = Number(first.settlement.payment.agency) + Number(second.settlement.payment.agency);
    expect(agencyTotal.toFixed(2)).toBe('7000.00');

    // El número de la liquidación es otra serie y no cambia.
    const detail = (await get(token, `/liquidaciones/${jan.id}`).expect(200)).body;
    expect(detail.receiptNumber).toBe('00000001');
    expect(detail.status).toBe('Pagada');

    const receipts = (await get(token, '/receipts').expect(200)).body;
    expect(receipts.items.map((r: any) => r.number)).toEqual(['00000002', '00000001']);
    expect(receipts.items[0]).toMatchObject({ amount: '60000', currency: 'ARS', receivedBy: 'Inmobiliaria' });
    const pdf = await get(token, `/receipts/${second.receipt.id}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toContain('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('recibo-00000002.pdf');

    const sequences = await prisma.baseClient.documentSequence.findMany({ orderBy: { series: 'asc' } });
    expect(sequences.map((s) => [s.series, s.next])).toEqual([
      ['RECIBO_COBRO', 3],
      ['RECIBO_LIQUIDACION', 2],
    ]);
  });

  it('CP-400 — cobro directo del locador (flujo TodoLocador): sin caja ni recibo, el locador debe lo ajeno', async () => {
    const { token } = await agency('caja-3');
    const { contract, a, b } = await contractWithLessors(token);
    await prisma.baseClient.contractTermsVersion.updateMany({
      where: { contractId: contract.id },
      data: { paymentFlow: 'TodoLocador' },
    });
    const jan = await sent(token, contract.id, 1);
    const payment = (await pay(token, jan.id, { amount: '100000', method: 'Transferencia' }).expect(200)).body
      .registeredPayment;
    expect(payment).toMatchObject({ receivedBy: 'Locador', accountId: null, receiptId: null });
    expect(payment.settlement.flow).toBe('Locador');
    const balances = Object.fromEntries(payment.settlement.positions.map((p: any) => [p.personId, p.balance]));
    expect(balances).toEqual({ [a]: '-3500.00', [b]: '-3500.00' });
    expect((await get(token, '/cash-movements').expect(200)).body.total).toBe(0);
    expect((await get(token, '/receipts').expect(200)).body.total).toBe(0);

    // Un cobro del locador no tiene cuenta de la inmobiliaria.
    const feb = await sent(token, contract.id, 2);
    const caja = (await post(token, '/financial-accounts', { kind: 'Caja', name: 'Caja oficina', currency: 'ARS' }).expect(201)).body;
    await pay(token, feb.id, { amount: '1000', receivedBy: 'Locador', accountId: caja.id }).expect(400);
    // Pero se puede registrar explícitamente como recibido por la inmobiliaria.
    const explicit = (await pay(token, feb.id, { amount: '1000', receivedBy: 'Inmobiliaria', accountId: caja.id }).expect(200)).body
      .registeredPayment;
    expect(explicit.account.id).toBe(caja.id);
  });

  it('CP-401 — compensación: otro locador recibió el cobro y cubre a los del contrato; con su custodia', async () => {
    const { token } = await agency('caja-4');
    const { contract, a, b } = await contractWithLessors(token);
    const other = await contractWithLessors(token);
    const x = other.a; // locador de otro contrato de la inmobiliaria

    // X tiene efectivo en custodia por su propio contrato.
    const otherJan = await sent(token, other.contract.id, 1);
    await pay(token, otherJan.id, { amount: '100000', inCustody: true }).expect(200);

    // El inquilino del contrato le transfirió a X.
    const jan = await sent(token, contract.id, 1);
    const payment = (await pay(token, jan.id, { amount: '100000', receivedBy: 'Locador', method: 'Transferencia' }).expect(200))
      .body.registeredPayment;

    const toA = (
      await post(token, '/compensations', { paymentId: payment.id, fromLessorId: x, toLessorId: a, fromCustody: true }).expect(201)
    ).body;
    expect(toA).toMatchObject({ amount: '46500', currency: 'ARS', fromLessorId: x, toLessorId: a });
    expect(toA.movements.map((m: any) => [m.direction, m.category, m.amount, m.account.kind])).toEqual([
      ['Out', 'Compensacion', '46500', 'Custodia'],
      ['In', 'Compensacion', '46500', 'Caja'],
    ]);
    await post(token, '/compensations', { paymentId: payment.id, fromLessorId: x, toLessorId: b, amount: '46500' }).expect(201);

    // No más que el cobro, no a sí mismo, no a quien no es locador del contrato.
    const over = await post(token, '/compensations', { paymentId: payment.id, fromLessorId: x, toLessorId: b, amount: '7000.01' });
    expect(over.status).toBe(400);
    expect(over.body.error).toBe('COMPENSATION_EXCEEDS_PAYMENT');
    await post(token, '/compensations', { paymentId: payment.id, fromLessorId: a, toLessorId: a, amount: '1' }).expect(400);
    const outsider = await post(token, '/compensations', { paymentId: payment.id, fromLessorId: a, toLessorId: x, amount: '1' });
    expect(outsider.body.error).toBe('COMPENSATION_OUT_OF_SCOPE');

    const listed = (await get(token, `/compensations?paymentId=${payment.id}`).expect(200)).body;
    expect(listed).toHaveLength(2);

    // Un cobro de la inmobiliaria no se compensa.
    const otherFeb = await sent(token, other.contract.id, 2);
    const agencyPayment = (await pay(token, otherFeb.id, { amount: '100' }).expect(200)).body.registeredPayment;
    const wrong = await post(token, '/compensations', { paymentId: agencyPayment.id, fromLessorId: a, toLessorId: x, amount: '1' });
    expect(wrong.body.error).toBe('COMPENSATION_REQUIRES_LESSOR_RECEIPT');
  });

  it('CP-402 — efectivo en dólares en custodia hasta la entrega al locador', async () => {
    const { token, tokens } = await agency('caja-5');
    const { contract, a, b } = await contractWithLessors(token, 'USD', '1000.00');
    const jan = await sent(token, contract.id, 1);
    const payment = (await pay(token, jan.id, { amount: '1000', inCustody: true }).expect(200)).body.registeredPayment;
    expect(payment).toMatchObject({ receivedBy: 'Inmobiliaria', inCustody: true, currency: 'USD' });
    expect(payment.account.name).toBe('Caja USD');
    expect(payment.receipt.number).toBe(1);

    const { items, totals } = await accounts(token);
    const custodyOf = (owner: string) => items.find((i: any) => i.kind === 'Custodia' && i.ownerPersonId === owner);
    expect(custodyOf(a)).toMatchObject({ currency: 'USD', balance: '465.00' });
    expect(custodyOf(b)).toMatchObject({ currency: 'USD', balance: '465.00' });
    expect(items.find((i: any) => i.kind === 'Caja').balance).toBe('70.00');
    // Por defecto la custodia no suma en el total de la inmobiliaria.
    expect(totals).toEqual([{ currency: 'USD', agency: '70.00', custody: '930.00', total: '70.00' }]);

    // Solo lectura no entrega; se entrega una parte y después el resto.
    await post(tokens[UserRole.Lectura], `/custody/${custodyOf(a).id}/deliver`, { date: '2026-01-15' }).expect(403);
    const part = (await post(tokens[UserRole.Liquidaciones], `/custody/${custodyOf(a).id}/deliver`, { date: '2026-01-15', amount: '65' }).expect(200)).body;
    expect(part).toMatchObject({ balance: '400.00', movement: { direction: 'Out', category: 'Custodia', counterpartyId: a } });
    const tooMuch = await post(token, `/custody/${custodyOf(a).id}/deliver`, { date: '2026-01-16', amount: '400.01' });
    expect(tooMuch.status).toBe(409);
    expect(tooMuch.body.error).toBe('CUSTODY_INSUFFICIENT');
    await post(token, `/custody/${custodyOf(a).id}/deliver`, { date: '2026-01-16' }).expect(200);
    const empty = await post(token, `/custody/${custodyOf(a).id}/deliver`, { date: '2026-01-17' });
    expect(empty.body.error).toBe('CUSTODY_EMPTY');

    // Una caja no se entrega como custodia, y la custodia no admite movimientos manuales.
    const caja = items.find((i: any) => i.kind === 'Caja');
    expect((await post(token, `/custody/${caja.id}/deliver`, { date: '2026-01-17' })).body.error).toBe('ACCOUNT_NOT_CUSTODY');
    const manual = await post(token, '/cash-movements', {
      accountId: custodyOf(b).id,
      date: '2026-01-17',
      direction: 'Out',
      amount: '1',
      category: 'PagoLocador',
    });
    expect(manual.body.error).toBe('CUSTODY_ACCOUNT_RESERVED');
  });

  it('CP-403 — movimientos manuales del libro con filtros; las categorías del sistema no se cargan a mano', async () => {
    const { token, tokens } = await agency('caja-6');
    const caja = (await post(token, '/financial-accounts', { kind: 'Caja', name: 'Caja oficina', currency: 'ARS' }).expect(201)).body;
    const { contract } = await contractWithLessors(token);
    const gasto = (
      await post(tokens[UserRole.Liquidaciones], '/cash-movements', {
        accountId: caja.id,
        date: '2026-02-03',
        direction: 'Out',
        amount: '1500.50',
        category: 'Gasto',
        contractId: contract.id,
        note: 'Librería',
      }).expect(201)
    ).body;
    expect(gasto).toMatchObject({ currency: 'ARS', amount: '1500.5', sourceType: 'Manual' });
    await post(token, '/cash-movements', { accountId: caja.id, date: '2026-03-01', direction: 'In', amount: '20000', category: 'Sena' }).expect(201);
    const reserved = await post(token, '/cash-movements', {
      accountId: caja.id,
      date: '2026-03-01',
      direction: 'In',
      amount: '1',
      category: 'AlquilerCobrado',
    });
    expect(reserved.status).toBe(400);
    await post(tokens[UserRole.Lectura], '/cash-movements', { accountId: caja.id, date: '2026-03-01', direction: 'In', amount: '1', category: 'Sena' }).expect(403);
    await post(tokens[UserRole.Ventas], '/cash-movements', { accountId: caja.id, date: '2026-03-01', direction: 'In', amount: '1', category: 'Sena' }).expect(403);

    expect((await get(token, '/cash-movements?category=Gasto').expect(200)).body.items.map((m: any) => m.id)).toEqual([gasto.id]);
    expect((await get(token, `/cash-movements?contractId=${contract.id}`).expect(200)).body.total).toBe(1);
    expect((await get(token, '/cash-movements?from=2026-02-15&to=2026-03-31').expect(200)).body.total).toBe(1);
    expect((await get(tokens[UserRole.Lectura], `/cash-movements?accountId=${caja.id}`).expect(200)).body.total).toBe(2);
    await get(tokens[UserRole.Ventas], '/cash-movements').expect(403);

    const listed = await accounts(token);
    expect(listed.items[0].balance).toBe('18499.50');

    // Con saldo no se desactiva; el nombre sí cambia. Solo administración edita cuentas.
    await patch(tokens[UserRole.Liquidaciones], `/financial-accounts/${caja.id}`, { name: 'Otra' }).expect(403);
    expect((await patch(token, `/financial-accounts/${caja.id}`, { isActive: false })).body.error).toBe('ACCOUNT_HAS_BALANCE');
    expect((await patch(token, `/financial-accounts/${caja.id}`, { name: 'Caja principal' }).expect(200)).body.name).toBe('Caja principal');
  });

  it('CP-404 — conversión entre monedas solo con tipo de cambio explícito', async () => {
    const { token } = await agency('caja-7');
    const ars = (await post(token, '/financial-accounts', { kind: 'Caja', name: 'Caja ARS', currency: 'ARS' }).expect(201)).body;
    const eur = (await post(token, '/financial-accounts', { kind: 'Caja', name: 'Caja EUR', currency: 'EUR' }).expect(201)).body;
    await post(token, '/cash-movements', { accountId: eur.id, date: '2026-02-01', direction: 'In', amount: '100', category: 'Sena' }).expect(201);
    const res = (
      await post(token, '/cash-movements/conversion', {
        fromAccountId: eur.id,
        toAccountId: ars.id,
        date: '2026-02-02',
        amount: '100',
        rate: '1500.25',
      }).expect(201)
    ).body;
    expect([res.out.amount, res.out.currency, res.in.amount, res.in.currency, res.in.rate]).toEqual([
      '100',
      'EUR',
      '150025',
      'ARS',
      '1500.25',
    ]);
    expect(res.out.sourceId).toBe(res.in.sourceId);
    const same = (await post(token, '/financial-accounts', { kind: 'Banco', name: 'Banco ARS', currency: 'ARS' }).expect(201)).body;
    const sameCurrency = await post(token, '/cash-movements/conversion', {
      fromAccountId: ars.id,
      toAccountId: same.id,
      date: '2026-02-02',
      amount: '1',
      rate: '1',
    });
    expect(sameCurrency.body.error).toBe('CONVERSION_SAME_CURRENCY');
    const totals = (await accounts(token)).totals;
    expect(totals.find((t: any) => t.currency === 'EUR').agency).toBe('0.00');
    expect(totals.find((t: any) => t.currency === 'ARS').agency).toBe('150025.00');
  });

  it('CP-405 — un cargo a la inmobiliaria se cierra como gasto de una cuenta, una sola vez', async () => {
    const { token } = await agency('caja-8');
    const { contract } = await contractWithLessors(token);
    const caja = (await post(token, '/financial-accounts', { kind: 'Caja', name: 'Caja', currency: 'ARS' }).expect(201)).body;
    const [charge] = (
      await post(token, '/charges', {
        contractId: contract.id,
        chargedTo: 'Inmobiliaria',
        kind: 'Reparacion',
        description: 'Arreglo a cargo de la inmobiliaria',
        amount: '15000',
        incurredAt: '2026-02-10',
      }).expect(201)
    ).body.items;
    const closed = (await post(token, `/charges/${charge.id}/agency-expense`, { accountId: caja.id, date: '2026-02-11' }).expect(200)).body;
    expect(closed.charge.status).toBe('Imputado');
    expect(closed.movement).toMatchObject({
      direction: 'Out',
      category: 'Gasto',
      amount: '15000',
      sourceType: 'PendingCharge',
      sourceId: charge.id,
      contractId: contract.id,
    });
    expect((await post(token, `/charges/${charge.id}/agency-expense`, { accountId: caja.id })).body.error).toBe('CHARGE_NOT_PENDING');
    expect((await post(token, `/charges/${charge.id}/release`)).body.error).toBe('CHARGE_PAID_BY_AGENCY');

    const [toTenant] = (
      await post(token, '/charges', {
        contractId: contract.id,
        chargedTo: 'Inquilino',
        kind: 'Reparacion',
        description: 'Cargo al inquilino',
        amount: '100',
        incurredAt: '2026-02-10',
      }).expect(201)
    ).body.items;
    expect((await post(token, `/charges/${toTenant.id}/agency-expense`, { accountId: caja.id })).body.error).toBe('CHARGE_NOT_AGENCY');
  });

  it('CP-406 — aislamiento entre inmobiliarias y referencia externa única', async () => {
    const one = await agency('caja-9a');
    const two = await agency('caja-9b');
    const { contract } = await contractWithLessors(one.token);
    const jan = await sent(one.token, contract.id, 1);
    const payment = (await pay(one.token, jan.id, { amount: '50000', externalRef: 'ANT-001' }).expect(200)).body.registeredPayment;
    const dup = await pay(one.token, jan.id, { amount: '1', externalRef: 'ANT-001' });
    expect(dup.status).toBe(409);
    expect(dup.body.error).toBe('PAYMENT_EXTERNAL_REF_EXISTS');

    expect((await accounts(two.token)).items).toHaveLength(0);
    expect((await get(two.token, '/receipts').expect(200)).body.total).toBe(0);
    await get(two.token, `/receipts/${payment.receipt.id}/pdf`).expect(404);
    await post(two.token, `/custody/${payment.account.id}/deliver`, { date: '2026-01-10' }).expect(404);
    await post(two.token, '/compensations', { paymentId: payment.id, fromLessorId: payment.id, toLessorId: contract.id, amount: '1' }).expect(404);
    // La otra inmobiliaria arranca su propia numeración.
    const { contract: c2 } = await contractWithLessors(two.token);
    const jan2 = await sent(two.token, c2.id, 1);
    expect((await pay(two.token, jan2.id, { amount: '1' }).expect(200)).body.registeredPayment.receipt.number).toBe(1);
  });
});
