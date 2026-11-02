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
 * Centro de carga: alquiler de 300000 con la comisión por defecto de 7 % = 21000
 * por mes; el umbral de anticipo (2 comisiones) es 42000.
 */
describe('Centro de carga (e2e)', () => {
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
    for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin)) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { tenantId: admin.user.tenantId as string, tokens };
  }

  async function createContract(token: string, extra: Record<string, unknown> = {}) {
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
      ...extra,
    }).expect(201);
    return { ...(res.body as any), ownerId: owner as string };
  }

  const charge = (token: string, contract: any, extra: Record<string, unknown> = {}) =>
    post(token, '/charges', {
      contractId: contract.id,
      chargedTo: 'Inquilino',
      kind: 'Reparacion',
      description: 'Canilla de la cocina',
      amount: '8000.50',
      incurredAt: '2026-10-20',
      ...extra,
    });
  const created = async (token: string, contract: any, extra: Record<string, unknown> = {}) =>
    (await charge(token, contract, extra).expect(201)).body.items as any[];

  const generate = (token: string, month: number, year: number) =>
    post(token, '/liquidaciones/generate', { month, year }).expect(201);
  const liquidaciones = async (token: string) =>
    (await get(token, '/liquidaciones?limit=100').expect(200)).body.items as any[];
  const liquidacionOf = async (token: string, period: string) =>
    (await liquidaciones(token)).find((l) => l.period.startsWith(period));

  it('CP-380 — una reparación al inquilino entra una sola vez en su próxima liquidación, sin comisión', async () => {
    const { tokens } = await agency('cargo-1');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const [row] = await created(token, contract, { beneficiary: 'Locador' });
    expect(row).toMatchObject({ status: 'Pendiente', requiresUpfront: false, amount: '8000.5', chargedTo: 'Inquilino' });

    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    const line = nov.lineItems.find((l: any) => l.sourceType === 'PendingCharge');
    expect(line).toMatchObject({
      type: 'Cargo',
      amount: '8000.5',
      commissionable: false,
      beneficiary: 'Locador',
      sourceId: row.id,
    });
    expect(line.description).toBe('Reparación: Canilla de la cocina');
    // 300000 de alquiler + 8000,50 de la reparación.
    expect(nov.total).toBe('308000.5');

    const after = (await get(token, `/charges/${row.id}`).expect(200)).body;
    expect(after).toMatchObject({ status: 'Imputado', imputedLiquidacionId: nov.id });

    // Diciembre no lo repite.
    await generate(token, 12, 2026);
    const dec = await liquidacionOf(token, '2026-12');
    expect(dec.lineItems.filter((l: any) => l.sourceType === 'PendingCharge')).toHaveLength(0);
    expect(dec.total).toBe('300000');
  });

  it('CP-381 — una devolución resta en la liquidación como descuento a favor del inquilino', async () => {
    const { tokens } = await agency('cargo-2');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const [row] = await created(token, contract, { kind: 'Devolucion', description: 'Arreglo que pagó el inquilino', amount: '3000' });
    expect(row.amount).toBe('-3000');

    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    const line = nov.lineItems.find((l: any) => l.sourceType === 'PendingCharge');
    expect(line).toMatchObject({ type: 'Descuento', amount: '3000', commissionable: false });
    expect(line.description).toContain('a favor del inquilino');
    expect(nov.total).toBe('297000');
  });

  it('CP-382 — un importe sobre el umbral de anticipo no entra solo; se fuerza o se cobra por adelantado', async () => {
    const { tokens } = await agency('cargo-3');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const [atLimit] = await created(token, contract, { amount: '42000', description: 'Justo en el umbral' });
    const [over] = await created(token, contract, { amount: '42000.01', description: 'Techo' });
    const [forced] = await created(token, contract, { amount: '90000', description: 'Boiler' });
    const [prepaid] = await created(token, contract, { amount: '60000', description: 'Cerradura' });
    expect(atLimit.requiresUpfront).toBe(false);
    expect(over.requiresUpfront).toBe(true);
    expect(forced.requiresUpfront).toBe(true);

    // Se fuerza uno a la liquidación y otro se marca cobrado por adelantado.
    const forcedRow = (await patch(token, `/charges/${forced.id}`, { requiresUpfront: false }).expect(200)).body;
    expect(forcedRow.requiresUpfront).toBe(false);
    const paid = (await post(token, `/charges/${prepaid.id}/mark-paid-upfront`).expect(200)).body;
    expect(paid.status).toBe('CobradoAnticipado');

    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    const sources = nov.lineItems.filter((l: any) => l.sourceType === 'PendingCharge').map((l: any) => l.sourceId);
    expect(sources.sort()).toEqual([atLimit.id, forced.id].sort());

    // El que pide anticipo sigue pendiente y marcado, a la espera de que se decida.
    const pending = (await get(token, '/charges?status=Pendiente&requiresUpfront=true').expect(200)).body;
    expect(pending.items.map((c: any) => c.id)).toEqual([over.id]);
    // Y ya no se puede cobrar dos veces.
    await post(token, `/charges/${prepaid.id}/mark-paid-upfront`).expect(409);
  });

  it('CP-383 — un cargo al locador o a la inmobiliaria no es un renglón de la liquidación del inquilino', async () => {
    const { tokens } = await agency('cargo-4');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const toLessor = (
      await post(token, '/charges', {
        propertyId: contract.propertyId,
        chargedTo: 'Locador',
        lessorPersonId: contract.ownerId,
        kind: 'ExpensaExtra',
        description: 'Expensa extraordinaria con la unidad vacía',
        amount: '120000',
        incurredAt: '2026-10-05',
      }).expect(201)
    ).body.items[0];
    const toAgency = await created(token, contract, { chargedTo: 'Inmobiliaria', amount: '500', description: 'Llave' });
    expect(toLessor).toMatchObject({ contractId: null, status: 'Pendiente', requiresUpfront: false });

    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    expect(nov.lineItems.filter((l: any) => l.sourceType === 'PendingCharge')).toHaveLength(0);
    expect(nov.total).toBe('300000');
    const stillPending = (await get(token, `/charges?propertyId=${contract.propertyId}&status=Pendiente`).expect(200)).body;
    expect(stillPending.items.map((c: any) => c.id).sort()).toEqual([toLessor.id, toAgency[0].id].sort());

    // Un cargo al inquilino necesita contrato; un cargo a otra propiedad que la del contrato se rechaza.
    await post(token, '/charges', {
      propertyId: contract.propertyId,
      chargedTo: 'Inquilino',
      kind: 'Otro',
      description: 'x',
      amount: '1',
      incurredAt: '2026-10-05',
    }).expect(400);
  });

  it('CP-384 — un cargo en cuotas se parte por mayor resto y entra una cuota por mes', async () => {
    const { tokens } = await agency('cargo-5');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const items = await created(token, contract, { amount: '100.00', installments: 3, targetPeriod: '2026-11' });
    expect(items.map((i) => i.amount)).toEqual(['33.34', '33.33', '33.33']);
    expect(items.map((i) => i.targetPeriod.slice(0, 10))).toEqual(['2026-11-01', '2026-12-01', '2027-01-01']);
    expect(new Set(items.map((i) => i.installmentGroupId)).size).toBe(1);

    await generate(token, 11, 2026);
    await generate(token, 12, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    const dec = await liquidacionOf(token, '2026-12');
    const novLine = nov.lineItems.find((l: any) => l.sourceType === 'PendingCharge');
    const decLine = dec.lineItems.find((l: any) => l.sourceType === 'PendingCharge');
    expect([novLine.amount, decLine.amount]).toEqual(['33.34', '33.33']);
    expect(novLine.description).toContain('cuota 1/3');
    expect(decLine.description).toContain('cuota 2/3');
    // La tercera todavía espera a enero.
    const left = (await get(token, '/charges?status=Pendiente').expect(200)).body.items;
    expect(left).toHaveLength(1);
    expect(left[0].installmentNo).toBe(3);
  });

  it('CP-385 — borrar una liquidación en borrador devuelve sus cargos a Pendiente y quitar el renglón también', async () => {
    const { tokens } = await agency('cargo-6');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const [a] = await created(token, contract, { description: 'A', amount: '1000' });
    const [b] = await created(token, contract, { description: 'B', amount: '2000' });

    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    const lineB = nov.lineItems.find((l: any) => l.sourceId === b.id);
    await http().delete(`/api/liquidaciones/${nov.id}/line-items/${lineB.id}`).set(auth(token)).expect(200);
    expect((await get(token, `/charges/${b.id}`).expect(200)).body.status).toBe('Pendiente');
    expect((await get(token, `/charges/${a.id}`).expect(200)).body.status).toBe('Imputado');

    await http().delete(`/api/liquidaciones/${nov.id}`).set(auth(token)).expect(200);
    expect((await get(token, `/charges/${a.id}`).expect(200)).body).toMatchObject({
      status: 'Pendiente',
      imputedLiquidacionId: null,
    });

    // Vuelven a entrar al generar de nuevo.
    await generate(token, 11, 2026);
    const again = await liquidacionOf(token, '2026-11');
    expect(again.lineItems.filter((l: any) => l.sourceType === 'PendingCharge')).toHaveLength(2);
    expect(await prisma.baseClient.pendingCharge.count({ where: { status: 'Imputado' } })).toBe(2);
  });

  it('CP-386 — al anular la liquidación sus cargos vuelven solos a Pendiente; con la liquidación vigente no se liberan', async () => {
    const { tokens, tenantId } = await agency('cargo-7');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const [row] = await created(token, contract);
    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');

    const active = await post(token, `/charges/${row.id}/release`).expect(409);
    expect(active.body.error).toBe('CHARGE_LIQUIDATION_ACTIVE');
    // Imputado: ni se edita ni se anula.
    await patch(token, `/charges/${row.id}`, { description: 'otra' }).expect(409);
    expect((await post(token, `/charges/${row.id}/cancel`).expect(409)).body.error).toBe('CHARGE_NOT_CANCELLABLE');

    for (const status of ['Revision', 'Aprobada', 'Anulada']) {
      await post(token, `/liquidaciones/${nov.id}/transition`, { status }).expect(200);
    }
    // Anular la liquidación libera el cargo en la misma transacción.
    expect((await get(token, `/charges/${row.id}`).expect(200)).body).toMatchObject({
      status: 'Pendiente',
      imputedLiquidacionId: null,
    });
    expect((await post(token, `/charges/${row.id}/release`).expect(409)).body.error).toBe('CHARGE_NOT_IMPUTED');
    const audit = await prisma.baseClient.auditLog.findFirst({
      where: { tenantId, entity: 'Liquidacion', entityId: nov.id },
      orderBy: { createdAt: 'desc' },
    });
    expect(audit?.changes).toMatchObject({ operation: 'release-on-annulled', released: { charges: 1 } });

    // Y entra en la liquidación del mes siguiente.
    await generate(token, 12, 2026);
    const dec = await liquidacionOf(token, '2026-12');
    expect(dec.lineItems.filter((l: any) => l.sourceId === row.id)).toHaveLength(1);
  });

  it('CP-387 — anular un cargo lo deja en el historial, fuera de la liquidación y auditado', async () => {
    const { tokens, tenantId } = await agency('cargo-8');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const [row] = await created(token, contract);
    const cancelled = (await post(token, `/charges/${row.id}/cancel`).expect(200)).body;
    expect(cancelled.status).toBe('Anulado');

    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    expect(nov.lineItems.filter((l: any) => l.sourceType === 'PendingCharge')).toHaveLength(0);
    expect((await get(token, '/charges?status=Anulado').expect(200)).body.total).toBe(1);

    const audits = await prisma.baseClient.auditLog.findMany({
      where: { tenantId, entity: 'PendingCharge', entityId: row.id },
      orderBy: { createdAt: 'asc' },
    });
    const update = audits.find((a) => a.action === 'UPDATE');
    expect(update?.changes).toMatchObject({ before: { status: 'Pendiente' }, after: { status: 'Anulado' } });
    expect(audits.some((a) => a.action === 'CREATE')).toBe(true);
  });

  it('CP-388 — la carga masiva guarda cada fila por separado e informa las que fallan', async () => {
    const { tokens } = await agency('cargo-9');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const base = { contractId: contract.id, chargedTo: 'Inquilino', kind: 'Reparacion', incurredAt: '2026-10-20' };
    const res = await post(token, '/charges/bulk', {
      rows: [
        { ...base, description: 'Una', amount: '1000' },
        { ...base, description: 'Sin importe', amount: '0' },
        { ...base, description: 'Honorario', kind: 'HonorarioGestion', amount: '2500' },
      ],
    }).expect(200);
    expect(res.body).toMatchObject({ created: 2, failed: 1 });
    expect(res.body.results[1]).toMatchObject({ index: 1, status: 'error', error: { code: 'VALIDATION_ERROR' } });

    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    const fee = nov.lineItems.find((l: any) => l.type === 'Honorario');
    expect(fee).toMatchObject({ amount: '2500', beneficiary: 'Inmobiliaria', commissionable: false });
  });

  it('CP-389 — solo la facturación escribe cargos; todos los roles leen', async () => {
    const { tokens } = await agency('cargo-10');
    const admin = tokens[UserRole.Admin];
    const contract = await createContract(admin);
    const [row] = await created(admin, contract, { description: 'Existente' });

    const writers = [UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones];
    for (const role of ALL_ROLES) {
      const token = tokens[role];
      const allowed = writers.includes(role);
      await charge(token, contract).expect(allowed ? 201 : 403);
      await post(token, '/charges/bulk', { rows: [] }).expect(allowed ? 400 : 403);
      await patch(token, `/charges/${row.id}`, { notes: 'x' }).expect(allowed ? 200 : 403);
      await post(token, `/charges/${row.id}/release`).expect(allowed ? 409 : 403);
      await get(token, '/charges').expect(200);
      await get(token, `/charges/${row.id}`).expect(200);
    }
  });

  it('CP-390 — una inmobiliaria no ve ni toca los cargos de otra', async () => {
    const a = await agency('cargo-11a');
    const b = await agency('cargo-11b');
    const tokenA = a.tokens[UserRole.Admin];
    const tokenB = b.tokens[UserRole.Admin];
    const contract = await createContract(tokenA);
    const [row] = await created(tokenA, contract);

    expect((await get(tokenB, '/charges').expect(200)).body.total).toBe(0);
    await get(tokenB, `/charges/${row.id}`).expect(404);
    await patch(tokenB, `/charges/${row.id}`, { notes: 'x' }).expect(404);
    await post(tokenB, `/charges/${row.id}/cancel`).expect(404);
    await charge(tokenB, contract).expect(404);
  });

  it('CP-391 — los filtros por contrato, estado y mes devuelven lo pedido', async () => {
    const { tokens } = await agency('cargo-12');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const [oct] = await created(token, contract, { description: 'Octubre', incurredAt: '2026-10-10' });
    const [dec] = await created(token, contract, { description: 'Con mes', incurredAt: '2026-10-11', targetPeriod: '2026-12' });

    const byMonth = (await get(token, '/charges?period=2026-10').expect(200)).body.items.map((c: any) => c.id);
    expect(byMonth).toEqual([oct.id]);
    const byTarget = (await get(token, '/charges?period=2026-12').expect(200)).body.items.map((c: any) => c.id);
    expect(byTarget).toEqual([dec.id]);
    expect((await get(token, `/charges?contractId=${contract.id}&status=Imputado`).expect(200)).body.total).toBe(0);
    await get(token, '/charges?status=Inventado').expect(400);

    // Con mes elegido, el cargo espera a ese mes: noviembre no lo trae.
    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    expect(nov.lineItems.filter((l: any) => l.sourceType === 'PendingCharge').map((l: any) => l.sourceId)).toEqual([oct.id]);
  });

  it('CP-395 — anular una liquidación libera cargos y partes de boletas por igual', async () => {
    const { tokens } = await agency('cargo-13');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const [row] = await created(token, contract, { amount: '1000' });
    const service = (
      await post(token, '/services', {
        propertyId: contract.propertyId,
        serviceType: 'Electricidad',
        providerName: 'Ente de prueba',
        amount: 10000,
        dueDay: 10,
      }).expect(201)
    ).body;
    await post(token, `/contracts/${contract.id}/charge-rules`, {
      serviceId: service.id,
      payer: 'Inmobiliaria',
      validFrom: '2026-01-01',
      agreementId: (
        await post(token, `/contracts/${contract.id}/agreements`, {
          kind: 'CambioCargo',
          effectiveFrom: '2026-01-01T00:00:00.000Z',
          notes: 'Acuerdo escrito de prueba',
        }).expect(201)
      ).body.id,
    }).expect(201);
    await post(token, '/service-bills/bulk', [{ serviceId: service.id, period: '2026-11', amount: '7000.00' }]).expect(200);

    await generate(token, 11, 2026);
    const nov = await liquidacionOf(token, '2026-11');
    expect(await prisma.baseClient.serviceBillAllocation.count({ where: { billedAt: { not: null } } })).toBe(1);
    expect((await get(token, `/charges/${row.id}`).expect(200)).body.status).toBe('Imputado');

    for (const status of ['Revision', 'Aprobada', 'Anulada']) {
      await post(token, `/liquidaciones/${nov.id}/transition`, { status }).expect(200);
    }
    expect(await prisma.baseClient.serviceBillAllocation.count({ where: { billedAt: null, liquidacionId: null } })).toBe(1);
    expect((await get(token, `/charges/${row.id}`).expect(200)).body.status).toBe('Pendiente');
  });

  it('CP-396 — el umbral y la base del anticipo se pactan por contrato y rigen a la fecha del gasto', async () => {
    const { tokens } = await agency('cargo-14');
    const token = tokens[UserRole.Admin];
    // Sin pactar: 2 comisiones de 21000 = 42000.
    const plain = await createContract(token);
    expect((await created(token, plain, { amount: '50000' }))[0].requiresUpfront).toBe(true);

    // Pactado al crear: umbral propio de 5 comisiones = 105000.
    const own = await createContract(token, { liquidationRules: { upfrontThresholdFees: 5 } });
    expect((await created(token, own, { amount: '100000' }))[0].requiresUpfront).toBe(false);
    expect((await created(token, own, { amount: '105000.01' }))[0].requiresUpfront).toBe(true);

    // Un convenio desde diciembre baja el umbral a 1 comisión (21000); el gasto de octubre no lo siente.
    await post(token, `/contracts/${plain.id}/agreements`, {
      kind: 'CambioRegla',
      effectiveFrom: '2026-12-01T00:00:00.000Z',
      termsPatch: { upfrontThresholdFees: 1, upfrontBasis: 'PorcentajePorDefecto' },
    }).expect(201);
    const terms = (await get(token, `/contracts/${plain.id}/terms`).expect(200)).body;
    expect(terms.current).toMatchObject({ upfrontThresholdFees: null, upfrontBasis: 'ComisionPactada' });
    expect((await created(token, plain, { amount: '30000', incurredAt: '2026-10-05' }))[0].requiresUpfront).toBe(false);
    expect((await created(token, plain, { amount: '30000', incurredAt: '2026-12-05' }))[0].requiresUpfront).toBe(true);

    // El patch rechaza un umbral fuera de rango.
    await post(token, `/contracts/${plain.id}/agreements`, {
      kind: 'CambioRegla',
      effectiveFrom: '2027-01-01T00:00:00.000Z',
      termsPatch: { upfrontThresholdFees: 99 },
    }).expect(400);
  });
});
