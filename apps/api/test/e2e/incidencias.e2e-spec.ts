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
const ALL_ROLES = Object.values(UserRole);

/**
 * Incidencias y reparaciones: caso → preautorización → presupuesto → ejecución →
 * pago al proveedor → imputación. Alquiler de 300000 por mes; el límite de la
 * inmobiliaria sin consultar al locador es 100000.
 */
describe('Incidencias y reparaciones (e2e)', () => {
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
  const put = (token: string, path: string, body: object = {}) =>
    http().put(`/api${path}`).set(auth(token)).send(body);
  const del = (token: string, path: string) => http().delete(`/api${path}`).set(auth(token));

  async function agency(tag: string) {
    const admin = await registerUser(app, {
      email: `admin@${tag}.test`,
      password: PASSWORD,
      firstName: 'Admin',
      lastName: 'Prueba',
    });
    const tokens = { [UserRole.Admin]: admin.accessToken } as Record<UserRole, string>;
    for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin)) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    await put(tokens[UserRole.Admin], '/tenants/me/operational-defaults', {
      repairs: { preauthLimit: 100000, managementFeePct: 10 },
    }).expect(200);
    return { tenantId: admin.user.tenantId as string, tokens };
  }

  async function createContract(token: string) {
    const owner = (await post(token, '/persons', { firstName: 'Ana', lastName: 'Sintética' }).expect(201)).body.id;
    const tenantPerson = (await post(token, '/persons', { firstName: 'Ines', lastName: 'Sintética' }).expect(201)).body.id;
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = (
      await post(token, '/properties', { title: 'Unidad de prueba', type: PropertyType.Departamento }).expect(201)
    ).body.id;
    const res = await post(token, '/contracts', {
      propertyId: property,
      contractType: ContractType.Alquiler,
      status: ContractStatus.Activo,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2028-12-31T00:00:00.000Z',
      rentAmount: '300000.00',
      rentCurrency: 'ARS',
      adjustmentType: AdjustmentType.IPC,
      adjustmentPeriod: AdjustmentPeriod.Trimestral,
      guarantees: [],
      persons: [
        { personId: owner, role: PersonRole.Propietario },
        { personId: tenantPerson, role: PersonRole.Inquilino },
      ],
    }).expect(201);
    return { ...(res.body as any), ownerId: owner as string };
  }

  const createProvider = async (token: string, lastName = 'Plomero') =>
    (await post(token, '/providers', { firstName: 'Carlos', lastName, rubros: ['Plomería'], coverageZones: ['CABA'] }).expect(201))
      .body.id as string;

  const createCaja = async (token: string, currency = 'ARS') =>
    (await post(token, '/financial-accounts', { kind: 'Caja', name: `Caja ${currency}`, currency }).expect(201)).body.id as string;

  const newTicket = async (token: string, propertyId: string, extra: Record<string, unknown> = {}) =>
    (await post(token, '/tickets', { propertyId, title: 'Pérdida en la cocina', priority: 'Alta', ...extra }).expect(201)).body;

  const statusOf = async (token: string, id: string) => (await get(token, `/tickets/${id}`).expect(200)).body.status as string;

  /** Lleva un ticket con proveedor hasta TrabajoRealizado (la ejecución) tras aprobar un presupuesto. */
  async function approved(token: string, contract: any, amount = '80000') {
    const ticket = await newTicket(token, contract.propertyId);
    const provider = await createProvider(token);
    const quote = (await post(token, `/tickets/${ticket.id}/quotes`, { providerId: provider, amount }).expect(201)).body;
    await post(token, `/tickets/${ticket.id}/quotes/${quote.id}/approve`, {
      approvedByPersonId: contract.ownerId,
      channel: 'WhatsApp',
    }).expect(200);
    return { ticket, provider, quote };
  }

  async function worked(token: string, contract: any, amount = '80000') {
    const ctx = await approved(token, contract, amount);
    await post(token, `/tickets/${ctx.ticket.id}/assign-provider`, { providerId: ctx.provider }).expect(200);
    for (const status of ['ProveedorEnCamino', 'TrabajoRealizado']) {
      await post(token, `/tickets/${ctx.ticket.id}/transition`, { status }).expect(200);
    }
    return ctx;
  }

  const pay = (token: string, ticketId: string, accountId: string, amount: string, extra: object = {}) =>
    post(token, `/tickets/${ticketId}/provider-payments`, { accountId, amount, date: '2026-10-21', ...extra });

  const charges = async (token: string, query = '') => (await get(token, `/charges?limit=100${query}`).expect(200)).body.items as any[];
  const generate = (token: string, month: number, year: number) =>
    post(token, '/liquidaciones/generate', { month, year }).expect(201);
  const liquidacionOf = async (token: string, period: string) =>
    ((await get(token, '/liquidaciones?limit=100').expect(200)).body.items as any[]).find((l) => l.period.startsWith(period));

  it('CP-500 — un estimado por encima del límite espera la autorización del locador; por debajo sigue', async () => {
    const { tokens } = await agency('inc-1');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const ticket = await newTicket(token, contract.propertyId);
    expect(ticket.contractId).toBe(contract.id);

    const low = (await post(token, `/tickets/${ticket.id}/estimate`, { amount: '100000' }).expect(200)).body;
    expect(low).toMatchObject({ requiresAuthorization: false, limit: 100000 });
    expect(low.ticket.status).toBe('Abierto');

    const high = (await post(token, `/tickets/${ticket.id}/estimate`, { amount: '100000.01' }).expect(200)).body;
    expect(high.requiresAuthorization).toBe(true);
    expect(high.ticket).toMatchObject({ status: 'PendienteAutorizacion', estimatedAmount: '100000.01' });
    expect(high.ticket.validTransitions).toEqual(['Presupuestado', 'Cancelado']);

    // Mientras espera, no se presupuesta.
    const provider = await createProvider(token);
    expect((await post(token, `/tickets/${ticket.id}/quotes`, { providerId: provider, amount: '1000' }).expect(409)).body.error).toBe(
      'TICKET_NEEDS_AUTHORIZATION',
    );
  });

  it('CP-501 — la preautorización guarda tope, quién, cuándo y canal, y habilita los presupuestos', async () => {
    const { tokens } = await agency('inc-2');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const ticket = await newTicket(token, contract.propertyId);
    await post(token, `/tickets/${ticket.id}/estimate`, { amount: '250000' }).expect(200);

    // No se preautoriza un caso que no espera autorización.
    const other = await newTicket(token, contract.propertyId, { title: 'Otro' });
    await post(token, `/tickets/${other.id}/preauthorize`, { amount: '1', approvedByPersonId: contract.ownerId, channel: 'Mail' }).expect(409);
    // Hace falta saber quién y por qué canal.
    await post(token, `/tickets/${ticket.id}/preauthorize`, { amount: '300000' }).expect(400);

    const res = (
      await post(token, `/tickets/${ticket.id}/preauthorize`, {
        amount: '300000',
        approvedByPersonId: contract.ownerId,
        channel: 'Telefono',
      }).expect(200)
    ).body;
    expect(res).toMatchObject({
      status: 'Presupuestado',
      preauthorizedAmount: '300000',
      preauthorizedByPersonId: contract.ownerId,
      preauthorizedChannel: 'Telefono',
    });
    expect(res.preauthorizedAt).toBeTruthy();

    // Con el tope autorizado, un estimado menor ya no pide consultar de nuevo.
    expect((await post(token, `/tickets/${ticket.id}/estimate`, { amount: '280000' }).expect(200)).body.requiresAuthorization).toBe(false);
    const audit = await prisma.baseClient.auditLog.findFirst({
      where: { entity: 'Ticket', entityId: ticket.id, action: 'UPDATE' },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    expect(audit).not.toBeNull();
  });

  it('CP-502 — presupuestos: se cargan, se corrigen y se aprueba uno con quién y canal, auditado', async () => {
    const { tokens } = await agency('inc-3');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const ticket = await newTicket(token, contract.propertyId);
    const p1 = await createProvider(token, 'Uno');
    const p2 = await createProvider(token, 'Dos');

    const q1 = (await post(token, `/tickets/${ticket.id}/quotes`, { providerId: p1, amount: '90000.50', notes: 'con materiales' }).expect(201)).body;
    const q2 = (await post(token, `/tickets/${ticket.id}/quotes`, { providerId: p2, amount: '70000' }).expect(201)).body;
    expect(await statusOf(token, ticket.id)).toBe('Presupuestado');
    await post(token, `/tickets/${ticket.id}/quotes`, { providerId: contract.ownerId, amount: '1' }).expect(404);

    const fixed = (await http().patch(`/api/tickets/${ticket.id}/quotes/${q1.id}`).set(auth(token)).send({ amount: '88000' }).expect(200)).body;
    expect(fixed.amount).toBe('88000');
    const q3 = (await post(token, `/tickets/${ticket.id}/quotes`, { providerId: p1, amount: '5' }).expect(201)).body;
    await del(token, `/tickets/${ticket.id}/quotes/${q3.id}`).expect(200);
    expect(((await get(token, `/tickets/${ticket.id}/quotes`).expect(200)).body as any[]).map((q) => q.id)).toEqual([q1.id, q2.id]);

    // Aprobar sin decir quién ni por dónde no se puede.
    await post(token, `/tickets/${ticket.id}/quotes/${q2.id}/approve`, {}).expect(400);
    const res = (
      await post(token, `/tickets/${ticket.id}/quotes/${q2.id}/approve`, {
        approvedByPersonId: contract.ownerId,
        channel: 'Presencial',
        note: 'Lo firmó en la oficina',
      }).expect(200)
    ).body;
    expect(res.quote).toMatchObject({ status: 'Aprobado', approvedByPersonId: contract.ownerId, channel: 'Presencial' });
    expect(res.quote.approvedAt).toBeTruthy();
    expect(res.ticket).toMatchObject({ status: 'PresupuestoAprobado', providerId: p2, costAmount: '70000', costCurrency: 'ARS' });

    const list = (await get(token, `/tickets/${ticket.id}/quotes`).expect(200)).body as any[];
    expect(list.map((q) => [q.id, q.status])).toEqual([
      [q1.id, 'Rechazado'],
      [q2.id, 'Aprobado'],
    ]);
    // Ya aprobado, no se aprueba otro ni se toca el presupuesto.
    await post(token, `/tickets/${ticket.id}/quotes/${q1.id}/approve`, { approvedByPersonId: contract.ownerId, channel: 'Mail' }).expect(409);
    await del(token, `/tickets/${ticket.id}/quotes/${q2.id}`).expect(409);

    const audit = await prisma.baseClient.auditLog.findFirst({ where: { entity: 'TicketQuote', entityId: q2.id, action: 'UPDATE' } });
    expect(audit?.changes).toMatchObject({
      operation: 'ticket-quote-approve',
      after: { status: 'Aprobado', approvedByPersonId: contract.ownerId, channel: 'Presencial' },
    });
  });

  it('CP-503 — pago al proveedor desde una cuenta de la inmobiliaria: movimiento PagoProveedor y tope de lo aprobado', async () => {
    const { tokens } = await agency('inc-4');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const caja = await createCaja(token);
    const { ticket, provider } = await approved(token, contract, '80000');

    // Con el presupuesto aprobado ya se puede dar un anticipo.
    const first = (await pay(token, ticket.id, caja, '30000').expect(201)).body;
    expect(first).toMatchObject({ paid: '30000.00' });
    expect(first.movement).toMatchObject({
      direction: 'Out',
      category: 'PagoProveedor',
      amount: '30000',
      counterpartyId: provider,
      contractId: contract.id,
      sourceType: 'Ticket',
      sourceId: ticket.id,
    });
    const second = (await pay(token, ticket.id, caja, '50000').expect(201)).body;
    expect(second.paid).toBe('80000.00');
    // No se paga más de lo aprobado.
    expect((await pay(token, ticket.id, caja, '0.01').expect(409)).body.error).toBe('PAYMENT_EXCEEDS_APPROVED');

    const listed = (await get(token, `/tickets/${ticket.id}/provider-payments`).expect(200)).body;
    expect(listed).toMatchObject({ total: '80000.00', currency: 'ARS' });
    expect(listed.items.map((m: any) => m.amount)).toEqual(['30000', '50000']);
    const ledger = (await get(token, '/cash-movements?category=PagoProveedor').expect(200)).body;
    expect(ledger.total).toBe(2);

    // Otra moneda y las cuentas de custodia no sirven.
    const usd = await createCaja(token, 'USD');
    const { ticket: t2 } = await approved(token, contract, '1000');
    expect((await pay(token, t2.id, usd, '10').expect(400)).body.error).toBe('CURRENCY_MISMATCH');
    const custody = (
      await post(token, '/financial-accounts', { kind: 'Custodia', name: 'Custodia', currency: 'ARS', ownerPersonId: contract.ownerId }).expect(201)
    ).body.id;
    expect((await pay(token, t2.id, custody, '10').expect(400)).body.error).toBe('CUSTODY_ACCOUNT_RESERVED');
  });

  it('CP-504 — imputar al locador: un cargo Reparación al estado del locador, una sola vez, con honorario de gestión aparte', async () => {
    const { tokens } = await agency('inc-5');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const caja = await createCaja(token);
    const { ticket } = await worked(token, contract, '80000');
    await pay(token, ticket.id, caja, '80000').expect(201);

    const res = (
      await post(token, `/tickets/${ticket.id}/impute`, { chargedTo: 'Locador', managementFee: { mode: 'Percent' } }).expect(200)
    ).body;
    expect(res).toMatchObject({ total: '80000.00', currency: 'ARS' });
    expect(res.charge).toMatchObject({
      kind: 'Reparacion',
      chargedTo: 'Locador',
      amount: '80000',
      status: 'Pendiente',
      beneficiary: 'Inmobiliaria',
      sourceType: 'Ticket',
      sourceId: ticket.id,
      contractId: contract.id,
      lessorPersonId: contract.ownerId,
    });
    // El honorario sale del porcentaje por defecto (10 %), es de la inmobiliaria y no es comisión.
    expect(res.feeCharge).toMatchObject({
      kind: 'HonorarioGestion',
      chargedTo: 'Locador',
      amount: '8000',
      beneficiary: 'Inmobiliaria',
      sourceType: 'Ticket',
      sourceId: ticket.id,
    });
    expect(res.ticket).toMatchObject({ costPayer: 'Locador' });
    expect(res.ticket.imputedAt).toBeTruthy();

    const bySource = (await charges(token)).filter((c) => c.sourceType === 'Ticket' && c.sourceId === ticket.id);
    expect(bySource.map((c) => c.kind).sort()).toEqual(['HonorarioGestion', 'Reparacion']);

    // Exactamente una vez: ni otra imputación ni otro pago.
    expect((await post(token, `/tickets/${ticket.id}/impute`, { chargedTo: 'Locador' }).expect(409)).body.error).toBe('TICKET_ALREADY_IMPUTED');
    expect((await pay(token, ticket.id, caja, '1').expect(409)).body.error).toBe('TICKET_ALREADY_IMPUTED');
    expect((await charges(token)).filter((c) => c.sourceId === ticket.id)).toHaveLength(2);

    const audit = await prisma.baseClient.auditLog.findFirst({
      where: { entity: 'Ticket', entityId: ticket.id, action: 'UPDATE' },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
    });
    expect(audit?.changes).toMatchObject({ operation: 'ticket-impute', chargedTo: 'Locador', total: '80000.00' });
  });

  it('CP-505 — imputar al inquilino: el gasto y el honorario entran una sola vez en su próxima liquidación', async () => {
    const { tokens } = await agency('inc-6');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const caja = await createCaja(token);
    const { ticket } = await worked(token, contract, '30000');
    await pay(token, ticket.id, caja, '30000').expect(201);

    const res = (
      await post(token, `/tickets/${ticket.id}/impute`, {
        chargedTo: 'Inquilino',
        managementFee: { mode: 'Fixed', amount: '1500' },
      }).expect(200)
    ).body;
    expect(res.charge).toMatchObject({ chargedTo: 'Inquilino', status: 'Pendiente', requiresUpfront: false, amount: '30000' });
    expect(res.feeCharge).toMatchObject({ kind: 'HonorarioGestion', amount: '1500', chargedTo: 'Inquilino' });

    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    const lines = nov.lineItems.filter((l: any) => l.sourceType === 'PendingCharge');
    expect(lines.map((l: any) => [l.type, l.amount, l.commissionable, l.beneficiary]).sort()).toEqual(
      [
        ['Cargo', '30000', false, 'Inmobiliaria'],
        ['Honorario', '1500', false, 'Inmobiliaria'],
      ].sort(),
    );
    expect(nov.total).toBe('331500');
    const after = (await charges(token)).filter((c) => c.sourceId === ticket.id);
    expect(after.every((c) => c.status === 'Imputado' && c.imputedLiquidacionId === nov.id)).toBe(true);
  });

  it('CP-506 — imputar a la inmobiliaria: el cargo queda resuelto, sin honorario y sin duplicar el egreso de la caja', async () => {
    const { tokens } = await agency('inc-7');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const caja = await createCaja(token);
    const { ticket } = await worked(token, contract, '20000');
    await pay(token, ticket.id, caja, '20000').expect(201);

    // La inmobiliaria no se cobra honorario a sí misma.
    expect(
      (await post(token, `/tickets/${ticket.id}/impute`, { chargedTo: 'Inmobiliaria', managementFee: { mode: 'Percent', pct: 10 } }).expect(400)).body.error,
    ).toBe('FEE_NOT_APPLICABLE');

    const res = (await post(token, `/tickets/${ticket.id}/impute`, { chargedTo: 'Inmobiliaria' }).expect(200)).body;
    expect(res.charge).toMatchObject({ chargedTo: 'Inmobiliaria', status: 'Imputado', kind: 'Reparacion', amount: '20000' });
    expect(res.feeCharge).toBeNull();
    // Un solo egreso en el libro: el pago al proveedor.
    const ledger = (await get(token, '/cash-movements').expect(200)).body;
    expect(ledger.items.map((m: any) => [m.category, m.direction, m.amount])).toEqual([['PagoProveedor', 'Out', '20000']]);
  });

  it('CP-507 — sin pagos, sin pagador o sin contrato no se imputa; y el pagador del ticket se respeta', async () => {
    const { tokens } = await agency('inc-8');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const caja = await createCaja(token);
    const { ticket } = await worked(token, contract, '10000');

    expect((await post(token, `/tickets/${ticket.id}/impute`, { chargedTo: 'Locador' }).expect(409)).body.error).toBe('NO_PROVIDER_PAYMENTS');
    await pay(token, ticket.id, caja, '10000').expect(201);
    expect((await post(token, `/tickets/${ticket.id}/impute`, {}).expect(400)).body.error).toBe('PAYER_REQUIRED');

    // Con el pagador anotado en el ticket no hace falta repetirlo.
    await http().patch(`/api/tickets/${ticket.id}/cost`).set(auth(token)).send({ costPayer: 'Locador' }).expect(200);
    const res = (await post(token, `/tickets/${ticket.id}/impute`, {}).expect(200)).body;
    expect(res.charge.chargedTo).toBe('Locador');

    // Un ticket sin contrato no se le cobra al inquilino.
    const prop = (await post(token, '/properties', { title: 'Sin contrato', type: PropertyType.Departamento }).expect(201)).body.id;
    const orphan = await newTicket(token, prop);
    expect(orphan.contractId).toBeNull();
  });

  it('CP-508 — no se puede saltear etapas: pagar antes de aprobar, imputar antes de terminar, aprobar sin presupuestar', async () => {
    const { tokens } = await agency('inc-9');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const caja = await createCaja(token);
    const ticket = await newTicket(token, contract.propertyId);

    expect((await pay(token, ticket.id, caja, '10').expect(409)).body.error).toBe('TICKET_NOT_PAYABLE');
    expect((await post(token, `/tickets/${ticket.id}/impute`, { chargedTo: 'Locador' }).expect(409)).body.error).toBe('TICKET_NOT_IMPUTABLE');
    const bad = (await post(token, `/tickets/${ticket.id}/transition`, { status: 'PresupuestoAprobado' }).expect(400)).body;
    expect(bad.error).toBe('INVALID_TRANSITION');
    await post(token, `/tickets/${ticket.id}/transition`, { status: 'PendienteAutorizacion' }).expect(200);
    expect((await post(token, `/tickets/${ticket.id}/transition`, { status: 'Cancelado' }).expect(200)).body.status).toBe('Cancelado');
    // Un caso cancelado no se estima ni se presupuesta.
    await post(token, `/tickets/${ticket.id}/estimate`, { amount: '5' }).expect(409);
  });

  it('CP-509 — permisos: soporte presupuesta y aprueba pero no paga; liquidaciones paga y imputa pero no aprueba; lectura solo mira', async () => {
    const { tokens } = await agency('inc-10');
    const admin = tokens[UserRole.Admin];
    const contract = await createContract(admin);
    const caja = await createCaja(admin);
    const ticket = await newTicket(admin, contract.propertyId);
    const provider = await createProvider(admin);

    const soporte = tokens[UserRole.Soporte];
    const quote = (await post(soporte, `/tickets/${ticket.id}/quotes`, { providerId: provider, amount: '5000' }).expect(201)).body;
    await post(soporte, `/tickets/${ticket.id}/quotes/${quote.id}/approve`, { approvedByPersonId: contract.ownerId, channel: 'Mail' }).expect(200);
    await post(soporte, `/tickets/${ticket.id}/assign-provider`, { providerId: provider }).expect(200);
    await pay(soporte, ticket.id, caja, '5000').expect(403);
    await post(soporte, `/tickets/${ticket.id}/impute`, { chargedTo: 'Locador' }).expect(403);

    const liq = tokens[UserRole.Liquidaciones];
    await pay(liq, ticket.id, caja, '5000').expect(201);
    await post(liq, `/tickets/${ticket.id}/quotes`, { providerId: provider, amount: '1' }).expect(403);
    await post(liq, `/tickets/${ticket.id}/estimate`, { amount: '1' }).expect(403);

    const lectura = tokens[UserRole.Lectura];
    await get(lectura, `/tickets/${ticket.id}/quotes`).expect(200);
    await get(lectura, `/tickets/${ticket.id}/provider-payments`).expect(200);
    await pay(lectura, ticket.id, caja, '1').expect(403);
    await post(lectura, `/tickets/${ticket.id}/quotes`, { providerId: provider, amount: '1' }).expect(403);
  });

  it('CP-510 — dos imputaciones a la vez: una sola gana y el gasto se carga una vez', async () => {
    const { tokens } = await agency('inc-11');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const caja = await createCaja(token);
    const { ticket } = await worked(token, contract, '40000');
    await pay(token, ticket.id, caja, '40000').expect(201);

    const results = await Promise.all([
      post(token, `/tickets/${ticket.id}/impute`, { chargedTo: 'Locador' }),
      post(token, `/tickets/${ticket.id}/impute`, { chargedTo: 'Locador' }),
      post(token, `/tickets/${ticket.id}/impute`, { chargedTo: 'Locador' }),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409, 409]);
    expect((await charges(token)).filter((c) => c.sourceId === ticket.id)).toHaveLength(1);
  });

  it('CP-511 — otra inmobiliaria no ve ni toca las incidencias de la primera', async () => {
    const a = await agency('inc-12a');
    const b = await agency('inc-12b');
    const contract = await createContract(a.tokens[UserRole.Admin]);
    const { ticket, quote } = await approved(a.tokens[UserRole.Admin], contract);

    const other = b.tokens[UserRole.Admin];
    await get(other, `/tickets/${ticket.id}/quotes`).expect(404);
    await post(other, `/tickets/${ticket.id}/quotes/${quote.id}/approve`, { approvedByPersonId: contract.ownerId, channel: 'Mail' }).expect(404);
    await post(other, `/tickets/${ticket.id}/impute`, { chargedTo: 'Locador' }).expect(404);
    await get(other, `/tickets/${ticket.id}/provider-payments`).expect(404);
  });

  it('CP-512 — el valor por defecto de la inmobiliaria: sin límite configurado siempre se consulta al locador', async () => {
    const { tokens } = await agency('inc-13');
    const token = tokens[UserRole.Admin];
    await put(token, '/tenants/me/operational-defaults', {}).expect(200);
    const contract = await createContract(token);
    const ticket = await newTicket(token, contract.propertyId);
    const res = (await post(token, `/tickets/${ticket.id}/estimate`, { amount: '1' }).expect(200)).body;
    expect(res).toMatchObject({ requiresAuthorization: true, limit: 0 });
    expect(res.ticket.status).toBe('PendienteAutorizacion');
  });
});
