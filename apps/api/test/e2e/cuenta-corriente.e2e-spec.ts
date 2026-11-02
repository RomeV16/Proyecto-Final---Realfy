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
 * Cuenta corriente y estado de cuenta del locador (ítem 37, FB-10, ADR-0009).
 * Contratos de 100000 con dos locadores al 50 % y la comisión de la
 * inmobiliaria (7 %): 50000 de alquiler y −3500 de comisión para cada uno.
 */
describe('Cuenta corriente del locador (e2e)', () => {
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

  async function contractWithLessors(token: string, title = 'Unidad sintética', lessors?: { a: string; b: string }) {
    const a = lessors?.a ?? (await post(token, '/persons', { firstName: 'Ana', lastName: 'Locadora' }).expect(201)).body.id;
    const b = lessors?.b ?? (await post(token, '/persons', { firstName: 'Beto', lastName: 'Locador' }).expect(201)).body.id;
    const tenantPerson = (await post(token, '/persons', { firstName: 'Ines', lastName: `Inquilina ${title}` }).expect(201)).body.id;
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = await post(token, '/properties', { title, type: PropertyType.Departamento }).expect(201);
    const contract = (
      await post(token, '/contracts', {
        propertyId: property.body.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: '2026-01-01T00:00:00.000Z',
        endDate: '2028-12-31T00:00:00.000Z',
        rentAmount: '100000.00',
        rentCurrency: 'ARS',
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
    return { contract, a, b, propertyId: property.body.id as string };
  }

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

  const ledgerOf = async (token: string, personId: string, query = '') =>
    (await get(token, `/owners/${personId}/ledger${query}`).expect(200)).body;
  const rows = (ledger: any) => ledger.items.map((i: any) => [i.type, i.amount]);

  it('CP-464 — un cobro de la inmobiliaria deja alquiler y comisión de cada locador, una sola vez', async () => {
    const { token, tokens } = await agency('cc-1');
    const { contract, a, b } = await contractWithLessors(token);
    const jan = await sent(token, contract.id, 1);
    const payment = (await pay(token, jan.id, { amount: '100000' }).expect(200)).body.registeredPayment;
    expect(payment.receipt.label).toBe('00000001');

    const ledger = await ledgerOf(tokens[UserRole.Lectura], a);
    expect(rows(ledger)).toEqual([
      ['Alquiler', '50000.00'],
      ['Comision', '-3500.00'],
    ]);
    expect(ledger).toMatchObject({ currency: 'ARS', currencies: ['ARS'], opening: '0.00', closing: '46500.00' });
    expect(ledger.items[0]).toMatchObject({ property: 'Unidad sintética', sourceType: 'Payment', sourceId: payment.id, statement: null });
    expect((await ledgerOf(token, b)).closing).toBe('46500.00');
    const count = await prisma.baseClient.ownerLedgerEntry.count({ where: { sourceId: payment.id } });
    expect(count).toBe(4);

    const balances = (await get(token, '/owners/balances').expect(200)).body.items;
    expect(balances.map((x: any) => [x.name, x.balance, x.payoutDue])).toEqual([
      ['Ana Locadora', '46500.00', '46500.00'],
      ['Beto Locador', '46500.00', '46500.00'],
    ]);
    await get(tokens[UserRole.Ventas], `/owners/${a}/ledger`).expect(403);
    await get(tokens[UserRole.Ventas], '/owners/balances').expect(403);
  });

  it('CP-465 — cobro directo del locador: lo bruto, lo cobrado en mano y lo que debe; pactado por contrato', async () => {
    const { token } = await agency('cc-2');
    const { contract, a } = await contractWithLessors(token);
    await prisma.baseClient.contractTermsVersion.updateMany({ where: { contractId: contract.id }, data: { paymentFlow: 'TodoLocador' } });
    const jan = await sent(token, contract.id, 1);
    await pay(token, jan.id, { amount: '100000', method: 'Transferencia' }).expect(200);
    const ledger = await ledgerOf(token, a);
    expect(rows(ledger)).toEqual([
      ['Alquiler', '50000.00'],
      ['Comision', '-3500.00'],
      ['CobroDirecto', '-50000.00'],
    ]);
    expect(ledger.closing).toBe('-3500.00');

    // El contrato pacta que el locador paga los entes él mismo; null vuelve al de la inmobiliaria.
    await post(token, `/contracts/${contract.id}/agreements`, {
      kind: 'CambioRegla',
      effectiveFrom: '2026-02-01T00:00:00.000Z',
      termsPatch: { lessorDirectOwes: 'SoloInmobiliaria' },
    }).expect(201);
    const terms = (await get(token, `/contracts/${contract.id}/terms`).expect(200)).body;
    expect(terms.versions.map((v: any) => v.lessorDirectOwes)).toEqual(expect.arrayContaining([null, 'SoloInmobiliaria']));
    await post(token, `/contracts/${contract.id}/agreements`, {
      kind: 'CambioRegla',
      effectiveFrom: '2026-03-01T00:00:00.000Z',
      termsPatch: { lessorDirectOwes: 'Todo' },
    }).expect(400);
  });

  it('CP-466 — saldo inicial: solo la gerencia, con motivo y auditado; se corrige hasta que se emite', async () => {
    const { token, tokens, tenantId } = await agency('cc-3');
    const { a } = await contractWithLessors(token);
    const body = { currency: 'ARS', amount: '-1500.50', date: '2026-01-01', reason: 'último acumulador' };
    await post(tokens[UserRole.Liquidaciones], `/owners/${a}/opening-balance`, body).expect(403);
    await post(tokens[UserRole.Gerente], `/owners/${a}/opening-balance`, { ...body, reason: '' }).expect(400);
    const created = (await post(tokens[UserRole.Gerente], `/owners/${a}/opening-balance`, body).expect(200)).body;
    expect(created).toMatchObject({ type: 'SaldoInicial', amount: '-1500.50', currency: 'ARS' });
    await post(token, `/owners/${a}/opening-balance`, { ...body, amount: '2000', reason: 'corrección' }).expect(200);
    expect(rows(await ledgerOf(token, a))).toEqual([['SaldoInicial', '2000.00']]);
    const audits = await prisma.baseClient.auditLog.findMany({ where: { tenantId, entity: 'OwnerLedgerEntry' }, orderBy: { createdAt: 'asc' } });
    expect(audits.map((x) => [x.action, (x.changes as any).reason])).toEqual([
      ['CREATE', 'último acumulador'],
      ['UPDATE', 'corrección'],
    ]);

    await post(token, '/owner-statements/generate?period=2026-01').expect(200);
    const st = (await get(token, `/owner-statements?personId=${a}`).expect(200)).body.items[0];
    await post(token, `/owner-statements/${st.id}/issue`).expect(200);
    const locked = await post(token, `/owners/${a}/opening-balance`, { ...body, reason: 'otra corrección' });
    expect(locked.status).toBe(409);
    expect(locked.body.error).toBe('OPENING_BALANCE_LOCKED');
  });

  it('CP-467 — pago al locador: egreso de la cuenta y asiento; la entrega de custodia también es un pago', async () => {
    const { token, tokens } = await agency('cc-4');
    const { contract, a, b } = await contractWithLessors(token);
    const jan = await sent(token, contract.id, 1);
    await pay(token, jan.id, { amount: '100000', inCustody: true }).expect(200);
    const caja = (await get(token, '/financial-accounts?kind=Caja').expect(200)).body.items[0];

    await post(tokens[UserRole.Lectura], `/owners/${a}/payouts`, { accountId: caja.id, method: 'Transferencia', amount: '1', date: '2026-01-20' }).expect(403);
    const paid = (
      await post(tokens[UserRole.Liquidaciones], `/owners/${a}/payouts`, {
        accountId: caja.id,
        method: 'EntregaEfectivo',
        amount: '1000',
        date: '2026-01-20',
        note: 'adelanto',
      }).expect(201)
    ).body;
    expect(paid.movement).toMatchObject({ direction: 'Out', category: 'PagoLocador', counterpartyId: a });
    expect(paid.balance).toBe('45500.00');
    const custody = (await get(token, `/financial-accounts?kind=Custodia&ownerPersonId=${b}`).expect(200)).body.items[0];
    await post(token, `/custody/${custody.id}/deliver`, { date: '2026-01-21', amount: '46000' }).expect(200);
    const ledgerB = await ledgerOf(token, b);
    expect(rows(ledgerB).at(-1)).toEqual(['EntregaEfectivo', '-46000.00']);
    expect(ledgerB).toMatchObject({ closing: '500.00', custody: '500.00' });
    // Desde una custodia no se paga: se entrega.
    const fromCustody = await post(token, `/owners/${b}/payouts`, { accountId: custody.id, method: 'EntregaEfectivo', amount: '1', date: '2026-01-21' });
    expect(fromCustody.body.error).toBe('CUSTODY_ACCOUNT_RESERVED');
    // El pago al locador ya no es un movimiento manual.
    const manual = await post(token, '/cash-movements', { accountId: caja.id, date: '2026-01-21', direction: 'Out', amount: '1', category: 'PagoLocador' });
    expect(manual.status).toBe(400);
  });

  it('CP-468 — compensación: resta a quien cobró y suma a quien le correspondía', async () => {
    const { token } = await agency('cc-5');
    const { contract, a, b } = await contractWithLessors(token);
    const x = (await contractWithLessors(token, 'Otra unidad')).a;
    await prisma.baseClient.contractTermsVersion.updateMany({ where: { contractId: contract.id }, data: { paymentFlow: 'TodoLocador' } });
    const jan = await sent(token, contract.id, 1);
    const payment = (await pay(token, jan.id, { amount: '100000', method: 'Transferencia' }).expect(200)).body.registeredPayment;
    await post(token, '/compensations', { paymentId: payment.id, fromLessorId: x, toLessorId: a }).expect(201);
    expect(rows(await ledgerOf(token, x))).toEqual([['Compensacion', '-46500.00']]);
    const ledgerA = await ledgerOf(token, a);
    expect(rows(ledgerA).at(-1)).toEqual(['Compensacion', '46500.00']);
    // A no cobró: queda a favor lo suyo menos lo que debía por comisión (46500 − 3500 − 50000 + 46500).
    expect(ledgerA.closing).toBe('43000.00');
    expect((await ledgerOf(token, b)).closing).toBe('-3500.00');
  });

  it('CP-469 — estado mensual: borradores de todos los locadores, cargos al locador, varias unidades, PDF, emitir y anular', async () => {
    const { token, tokens } = await agency('cc-6');
    const first = await contractWithLessors(token, 'Belgrano 100');
    const second = await contractWithLessors(token, 'Arenales 200', { a: first.a, b: first.b });
    for (const c of [first, second]) {
      const jan = await sent(token, c.contract.id, 1);
      await pay(token, jan.id, { amount: '100000' }).expect(200);
    }
    const charge = (
      await post(token, '/charges', {
        contractId: first.contract.id,
        chargedTo: 'Locador',
        lessorPersonId: first.a,
        kind: 'Reparacion',
        description: 'Cambio de canilla',
        amount: '12000',
        incurredAt: '2026-01-15',
      }).expect(201)
    ).body.items[0];

    await post(tokens[UserRole.Lectura], '/owner-statements/generate?period=2026-01').expect(403);
    const gen = (await post(tokens[UserRole.Liquidaciones], '/owner-statements/generate?period=2026-01').expect(200)).body;
    expect(gen).toMatchObject({ period: '2026-01', created: 2, updated: 0, chargesPosted: 1 });
    const list = (await get(tokens[UserRole.Lectura], '/owner-statements?period=2026-01').expect(200)).body;
    expect(list.items.map((s: any) => [s.person.name, s.status, s.closing])).toEqual([
      ['Ana Locadora', 'Borrador', '81000.00'],
      ['Beto Locador', 'Borrador', '93000.00'],
    ]);
    const stA = list.items[0];
    const detail = (await get(token, `/owner-statements/${stA.id}`).expect(200)).body;
    expect(detail.groups.map((g: any) => [g.label, g.net])).toEqual([
      ['Arenales 200', '46500.00'],
      ['Belgrano 100', '34500.00'],
    ]);
    const chargeNow = (await get(token, `/charges/${charge.id}`).expect(200)).body;
    expect(chargeNow).toMatchObject({ status: 'Imputado', imputedStatementId: stA.id });
    expect((await post(token, `/charges/${charge.id}/release`)).body.error).toBe('CHARGE_IN_STATEMENT');

    const pdf = await get(token, `/owner-statements/${stA.id}/pdf`).expect(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('estado-de-cuenta-ana-locadora-2026-01-ARS.pdf');

    const issued = (await post(tokens[UserRole.Liquidaciones], `/owner-statements/${stA.id}/issue`).expect(200)).body;
    expect(issued).toMatchObject({ status: 'Emitido', closing: '81000.00' });
    expect(await prisma.baseClient.ownerLedgerEntry.count({ where: { statementId: stA.id } })).toBe(6);
    expect((await post(token, `/owner-statements/${stA.id}/issue`)).body.error).toBe('STATEMENT_NOT_DRAFT');

    // Febrero arrastra el saldo de enero.
    const feb = (await post(token, '/owner-statements/generate', { period: '2026-02', personId: first.a }).expect(200)).body;
    expect(feb.created).toBe(1);
    const stFeb = (await get(token, `/owner-statements?period=2026-02&personId=${first.a}`).expect(200)).body.items[0];
    expect(stFeb).toMatchObject({ opening: '81000.00', closing: '81000.00' });

    await post(tokens[UserRole.Liquidaciones], `/owner-statements/${stA.id}/annul`, { reason: 'error' }).expect(403);
    const annulled = (await post(tokens[UserRole.Gerente], `/owner-statements/${stA.id}/annul`, { reason: 'faltaba un gasto' }).expect(200)).body;
    expect(annulled).toMatchObject({ status: 'Anulado', annulReason: 'faltaba un gasto' });
    expect(await prisma.baseClient.ownerLedgerEntry.count({ where: { statementId: stA.id } })).toBe(0);
  });

  it('CP-470 — aislamiento entre inmobiliarias', async () => {
    const one = await agency('cc-7a');
    const two = await agency('cc-7b');
    const { contract, a } = await contractWithLessors(one.token);
    const jan = await sent(one.token, contract.id, 1);
    await pay(one.token, jan.id, { amount: '100000' }).expect(200);
    await post(one.token, '/owner-statements/generate?period=2026-01').expect(200);
    const st = (await get(one.token, '/owner-statements').expect(200)).body.items[0];

    await get(two.token, `/owners/${a}/ledger`).expect(404);
    await get(two.token, `/owner-statements/${st.id}`).expect(404);
    await post(two.token, `/owner-statements/${st.id}/issue`).expect(404);
    await post(two.token, `/owners/${a}/opening-balance`, { currency: 'ARS', amount: '1', reason: 'intrusión' }).expect(404);
    expect((await get(two.token, '/owner-statements').expect(200)).body.total).toBe(0);
    expect((await get(two.token, '/owners/balances').expect(200)).body.items).toEqual([]);
    expect((await post(two.token, '/owner-statements/generate?period=2026-01').expect(200)).body.created).toBe(0);
  });
});
