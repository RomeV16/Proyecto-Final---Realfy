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
import { resetAfipMock } from '../../src/modules/invoices/arca/__mocks__/afip-mock';
import {
  UserRole,
  PersonRole,
  PropertyType,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  FiscalCondition,
} from '@realfy/shared';

const PASSWORD = 'Password123!';
// CUIT sintéticos con dígito verificador válido.
const CUIT_ANA = '20-12345678-6';
const CUIT_BETO = '20-30111222-0';

/**
 * Facturación por cuenta del locador (ítem 38, ADR-0017) con ARCA simulado.
 * Un contrato de 100000 con dos locadores al 50 %: cada uno tiene 50000 de
 * alquiler (y -3500 de comisión) en su cuenta corriente.
 */
describe('Facturación por cuenta del locador (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const previousArcaMock = process.env['ARCA_MOCK'];

  beforeAll(async () => {
    process.env['ARCA_MOCK'] = '1';
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await teardownTestApp();
    if (previousArcaMock === undefined) delete process.env['ARCA_MOCK'];
    else process.env['ARCA_MOCK'] = previousArcaMock;
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    resetAfipMock();
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => http().get(`/api${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) => http().post(`/api${path}`).set(auth(token)).send(body);
  const put = (token: string, path: string, body: object = {}) => http().put(`/api${path}`).set(auth(token)).send(body);

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

  /** Contrato con dos locadores (monotributistas con CUIT) y un inquilino consumidor final. */
  async function contractWithLessors(token: string) {
    const person = async (firstName: string, lastName: string, cuit: string) => {
      const id = (await post(token, '/persons', { firstName, lastName }).expect(201)).body.id as string;
      await prisma.baseClient.person.update({ where: { id }, data: { cuit, fiscalCondition: FiscalCondition.Monotributista } });
      return id;
    };
    const a = await person('Ana', 'Locadora', CUIT_ANA);
    const b = await person('Beto', 'Locador', CUIT_BETO);
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
    return { contract, a, b };
  }

  async function paidJanuary(token: string, contractId: string) {
    await post(token, '/liquidaciones/generate', { month: 1, year: 2026 }).expect(201);
    const list = (await get(token, `/liquidaciones?contractId=${contractId}&limit=100`).expect(200)).body.items as any[];
    const liq = list.find((l) => new Date(l.period).getUTCMonth() + 1 === 1);
    for (const status of ['Revision', 'Aprobada', 'Enviada']) {
      await post(token, `/liquidaciones/${liq.id}/transition`, { status }).expect(200);
    }
    const paid = await post(token, `/liquidaciones/${liq.id}/payments`, {
      method: 'Efectivo',
      paidAt: '2026-01-08T12:00:00.000Z',
      amount: '100000',
    }).expect(200);
    return paid.body.registeredPayment.id as string;
  }

  /** Emisor delegado del locador con su punto de venta 1 y la delegación verificada. */
  async function delegatedIssuer(token: string, personId: string, withPdv = true) {
    const issuer = (await post(token, `/persons/${personId}/invoicing-issuer`).expect(201)).body;
    if (withPdv) await post(token, `/invoices/issuers/${issuer.id}/pdv`, { number: 1 }).expect(201);
    await prisma.baseClient.arcaIssuer.update({ where: { id: issuer.id }, data: { delegationStatus: 'Active' } });
    return issuer.id as string;
  }

  it('CP-600 — el emisor delegado nace de los datos del locador y solo lo gestiona la gerencia', async () => {
    const { token, tokens } = await agency('fac-1');
    const { a } = await contractWithLessors(token);
    const noCuit = (await post(token, '/persons', { firstName: 'Sin', lastName: 'Cuit' }).expect(201)).body.id;
    expect((await post(token, `/persons/${noCuit}/invoicing-issuer`).expect(400)).body.error).toBe('PERSON_CUIT_REQUIRED');
    await post(tokens[UserRole.Liquidaciones], `/persons/${a}/invoicing-issuer`).expect(403);

    const issuer = (await post(tokens[UserRole.Gerente], `/persons/${a}/invoicing-issuer`).expect(201)).body;
    expect(issuer).toMatchObject({ personId: a, businessName: 'Ana Locadora', fiscalCondition: 'Monotributista', isSelf: false });
    expect((await post(token, `/persons/${a}/invoicing-issuer`).expect(409)).body.error).toBe('LESSOR_ISSUER_EXISTS');

    const settings = (await get(tokens[UserRole.Lectura], `/persons/${a}/invoicing-settings`).expect(200)).body;
    expect(settings.issuer.id).toBe(issuer.id);
    expect(settings.effective).toEqual({ scope: 'Alquiler', when: 'Manual', vatPct: 0 });
    await get(tokens[UserRole.Ventas], `/persons/${a}/invoicing-settings`).expect(403);

    await put(tokens[UserRole.Liquidaciones], `/persons/${a}/invoicing-settings`, { when: 'AlPagar' }).expect(403);
    const saved = (await put(token, `/persons/${a}/invoicing-settings`, { scope: 'AlquilerPunitorios', vatPct: 0 }).expect(200)).body;
    expect(saved.effective).toEqual({ scope: 'AlquilerPunitorios', when: 'Manual', vatPct: 0 });
    await put(token, `/persons/${a}/invoicing-settings`, { vatPct: 13 }).expect(400);
  });

  it('CP-601 — facturar un cobro emite a nombre del locador, con el importe de su parte y una sola vez', async () => {
    const { token, tokens } = await agency('fac-2');
    const { contract, a, b } = await contractWithLessors(token);
    const issuerId = await delegatedIssuer(token, a);
    const paymentId = await paidJanuary(token, contract.id);

    await post(tokens[UserRole.Lectura], `/payments/${paymentId}/invoices`).expect(403);
    const first = (await post(tokens[UserRole.Liquidaciones], `/payments/${paymentId}/invoices`).expect(200)).body;
    // Solo Ana tiene emisor delegado: Beto no se factura.
    expect(first.results).toHaveLength(1);
    expect(first.results[0]).toMatchObject({ personId: a, status: 'Emitido' });

    const comprobante = await prisma.baseClient.comprobante.findFirstOrThrow({ where: { paymentId } });
    expect(comprobante).toMatchObject({ issuerId, cbteTipo: 11, receptorName: 'Ines Inquilina', docTipo: 99 });
    expect(comprobante.impTotal.toString()).toBe('50000');
    expect(comprobante.cae).toMatch(/^\d{14}$/);

    // Idempotente: repetir no emite otro.
    const second = (await post(token, `/payments/${paymentId}/invoices`).expect(200)).body;
    expect(second.results[0]).toMatchObject({ status: 'Emitido', comprobanteIds: [comprobante.id] });
    expect(await prisma.baseClient.comprobante.count({ where: { paymentId } })).toBe(1);

    const list = (await get(token, `/invoices?personId=${a}&source=Payment`).expect(200)).body;
    expect(list.total).toBe(1);
    expect((await get(token, `/invoices?personId=${b}`).expect(200)).body.total).toBe(0);
    const forPayment = (await get(token, `/payments/${paymentId}/invoices`).expect(200)).body;
    expect(forPayment.comprobantes).toHaveLength(1);
    expect(forPayment.jobs).toMatchObject([{ status: 'Emitido', kind: 'Factura' }]);

    // Nunca a nombre de la inmobiliaria: ningún comprobante usa un emisor sin persona.
    const own = await prisma.baseClient.comprobante.count({ where: { issuer: { personId: null } } });
    expect(own).toBe(0);
  });

  it('CP-602 — un fallo de ARCA no rompe el cobro: queda pendiente y se emite al reintentar', async () => {
    const { token } = await agency('fac-3');
    const { contract, a } = await contractWithLessors(token);
    await delegatedIssuer(token, a, false);
    const paymentId = await paidJanuary(token, contract.id);

    // Sin punto de venta el emisor no puede emitir: 422 con el motivo y el trabajo queda fallido.
    const failed = await post(token, `/payments/${paymentId}/invoices`).expect(422);
    expect(failed.body.error).toBe('LESSOR_INVOICE_FAILED');
    const pending = (await get(token, '/invoices/pending').expect(200)).body;
    expect(pending.items).toMatchObject([{ status: 'Fallido', personId: a, attempts: 1 }]);
    expect(pending.items[0].lastError).toContain('NO_PUNTO_DE_VENTA');
    expect(await prisma.baseClient.payment.count({ where: { id: paymentId } })).toBe(1);

    const issuerId = (await prisma.baseClient.arcaIssuer.findFirstOrThrow({ where: { personId: a } })).id;
    await post(token, `/invoices/issuers/${issuerId}/pdv`, { number: 1 }).expect(201);
    const run = (await post(token, '/invoices/pending/run').expect(200)).body;
    expect(run).toMatchObject({ processed: 1, emitted: 1, failed: 0 });
    expect((await get(token, '/invoices/pending').expect(200)).body.total).toBe(0);
    expect(await prisma.baseClient.comprobante.count({ where: { paymentId } })).toBe(1);
  });

  it('CP-603 — por estado de cuenta: se factura al emitirlo y la anulación emite la nota de crédito', async () => {
    const { token, tokens } = await agency('fac-4');
    const { contract, a } = await contractWithLessors(token);
    const issuerId = await delegatedIssuer(token, a);
    await put(token, `/persons/${a}/invoicing-settings`, { when: 'AlEmitirEstado' }).expect(200);
    const paymentId = await paidJanuary(token, contract.id);

    // Con la facturación al emitir el estado, el cobro no se factura a mano (evita facturar dos veces).
    expect((await post(token, `/payments/${paymentId}/invoices`).expect(409)).body.error).toBe('INVOICING_TRIGGER_MISMATCH');

    await post(token, '/owner-statements/generate?period=2026-01', { personId: a }).expect(200);
    const st = (await get(token, `/owner-statements?period=2026-01&personId=${a}`).expect(200)).body.items[0];
    expect((await post(token, '/invoices/pending/run').expect(200)).body.enqueued).toBe(0);
    await post(tokens[UserRole.Liquidaciones], `/owner-statements/${st.id}/issue`).expect(200);

    const run = (await post(token, '/invoices/pending/run').expect(200)).body;
    expect(run).toMatchObject({ enqueued: 1, emitted: 1, failed: 0 });
    const invoice = await prisma.baseClient.comprobante.findFirstOrThrow({ where: { ownerStatementId: st.id } });
    expect(invoice).toMatchObject({ issuerId, cbteTipo: 11, paymentId: null });
    expect(invoice.impTotal.toString()).toBe('50000');
    // Volver a correr no factura de nuevo.
    expect((await post(token, '/invoices/pending/run').expect(200)).body).toMatchObject({ enqueued: 0, processed: 0 });

    await post(tokens[UserRole.Gerente], `/owner-statements/${st.id}/annul`, { reason: 'faltaba un gasto' }).expect(200);
    const credit = (await post(token, '/invoices/pending/run').expect(200)).body;
    expect(credit).toMatchObject({ emitted: 1, failed: 0 });
    const nc = await prisma.baseClient.comprobante.findFirstOrThrow({ where: { originalComprobanteId: invoice.id } });
    expect(nc).toMatchObject({ cbteTipo: 13, issuerId });
    expect(nc.impTotal.toString()).toBe('50000');
    expect((await post(token, '/invoices/pending/run').expect(200)).body.processed).toBe(0);
    const forStatement = (await get(token, `/owner-statements/${st.id}/invoices`).expect(200)).body;
    expect(forStatement.jobs.map((j: any) => [j.kind, j.status])).toEqual([
      ['Factura', 'Emitido'],
      ['NotaCredito', 'Emitido'],
    ]);
  });

  it('CP-604 — aislamiento entre inmobiliarias y permisos de la cola', async () => {
    const one = await agency('fac-5a');
    const two = await agency('fac-5b');
    const { contract, a } = await contractWithLessors(one.token);
    await delegatedIssuer(one.token, a);
    const paymentId = await paidJanuary(one.token, contract.id);
    await post(one.token, `/payments/${paymentId}/invoices`).expect(200);

    await get(two.token, `/persons/${a}/invoicing-settings`).expect(404);
    await post(two.token, `/persons/${a}/invoicing-issuer`).expect(404);
    await post(two.token, `/payments/${paymentId}/invoices`).expect(404);
    expect((await get(two.token, '/invoices/pending').expect(200)).body.total).toBe(0);
    expect((await get(two.token, `/invoices?personId=${a}`).expect(200)).body.total).toBe(0);
    await get(one.tokens[UserRole.Ventas], '/invoices/pending').expect(403);
    await post(one.tokens[UserRole.Lectura], '/invoices/pending/run').expect(403);
  });
});
