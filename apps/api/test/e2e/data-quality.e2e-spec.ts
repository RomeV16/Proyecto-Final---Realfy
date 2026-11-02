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
  AdjustmentType,
  AdjustmentPeriod,
} from '@realfy/shared';

const START = '2026-01-01T00:00:00.000Z';
const END = '2028-01-01T00:00:00.000Z';

describe('Panel de calidad de datos (e2e)', () => {
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
  const db = () => prisma.baseClient;

  async function setup(email: string) {
    const admin = await registerUser(app, {
      email,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Prueba',
    });
    return { token: admin.accessToken, tenantId: admin.user.tenantId as string };
  }

  async function login(tenantId: string, role: UserRole, email: string) {
    await createUserDirect(prisma, tenantId, { email, password: 'Password123!', role });
    return (await loginUser(app, email, 'Password123!')).accessToken;
  }

  const person = (tenantId: string, firstName: string, lastName: string, extra: Record<string, unknown> = {}) =>
    db().person.create({ data: { tenantId, firstName, lastName, ...extra } });

  async function activeContract(token: string, tenantId: string, title: string) {
    const prop = await http()
      .post('/api/properties')
      .set(auth(token))
      .send({ title, type: PropertyType.Departamento })
      .expect(201);
    const owner = await person(tenantId, 'Dueña', title.replace(/\s/g, ''));
    const tenant = await person(tenantId, 'Inquilina', title.replace(/\s/g, ''));
    await db().personRoleAssignment.create({ data: { tenantId, personId: tenant.id, role: PersonRole.Inquilino } });
    const created = await http()
      .post('/api/contracts')
      .set(auth(token))
      .send({
        propertyId: prop.body.id,
        contractType: ContractType.Alquiler,
        startDate: START,
        endDate: END,
        rentAmount: '100000.00',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        guarantees: [],
        persons: [
          { personId: owner.id, role: PersonRole.Propietario },
          { personId: tenant.id, role: PersonRole.Inquilino },
        ],
      })
      .expect(201);
    await http().post(`/api/contracts/${created.body.id}/activate`).set(auth(token)).expect(201);
    return { contractId: created.body.id as string, propertyId: prop.body.id as string, ownerId: owner.id };
  }

  const findings = async (token: string, check: string) =>
    (await http().get(`/api/data-quality/${check}`).set(auth(token)).expect(200)).body;

  it('CP-430 — el resumen cuenta duplicados, sumas de locadores y contratos sin decisión', async () => {
    const { token, tenantId } = await setup('admin@dq-1.test');

    // Duplicados sintéticos: mismo CUIT escrito distinto, mismo teléfono con otro prefijo, mismo correo.
    await person(tenantId, 'Ana', 'Duplicada', { cuit: '20-12345678-6', phone: '+54 9 11 5555-0101', email: 'ana@ejemplo.test' });
    await person(tenantId, 'Ana', 'Duplicada', { cuit: '20123456786', phone: '011 15 5555 0101', email: 'ANA@ejemplo.test ' });
    await person(tenantId, 'Otra', 'Persona', { cuit: '27-87654321-0' });

    // Locadores que no suman 100: un contrato activo al que se le rompe el reparto por fuera.
    const broken = await activeContract(token, tenantId, 'Unidad Rota');
    await db().contractLessor.updateMany({ where: { contractId: broken.contractId }, data: { payoutPct: 70 } });
    const fine = await activeContract(token, tenantId, 'Unidad Sana');

    // Contrato vencido sin decisión y propiedad sin titular.
    const expired = await activeContract(token, tenantId, 'Unidad Vencida');
    await db().contract.update({
      where: { id: expired.contractId },
      data: { status: 'Vencido', endDate: new Date('2026-02-01T00:00:00Z') },
    });

    const res = await http().get('/api/data-quality').set(auth(token)).expect(200);
    const count = (id: string) => res.body.checks.find((c: any) => c.check === id).count;
    expect(count('duplicate-cuit')).toBe(1);
    expect(count('duplicate-phone')).toBe(1);
    expect(count('duplicate-email')).toBe(1);
    expect(count('duplicate-name')).toBe(1);
    expect(count('lessors-sum')).toBe(1);
    expect(count('contract-expired-undecided')).toBe(1);
    expect(count('property-no-owner')).toBeGreaterThanOrEqual(3);
    expect(res.body.total).toBeGreaterThan(0);

    const sums = await findings(token, 'lessors-sum');
    expect(sums.items).toHaveLength(1);
    expect(sums.items[0]).toMatchObject({
      entityId: broken.contractId,
      link: `/contracts/${broken.contractId}`,
      details: { sum: 70, lessors: 1 },
    });
    expect(sums.items.map((i: any) => i.entityId)).not.toContain(fine.contractId);

    const dupes = await findings(token, 'duplicate-cuit');
    expect(dupes.items[0].members).toHaveLength(2);
    const expiredFindings = await findings(token, 'contract-expired-undecided');
    expect(expiredFindings.items[0].entityId).toBe(expired.contractId);
  });

  it('CP-431 — los hallazgos se paginan, un control desconocido da 400 y cada inmobiliaria ve lo suyo', async () => {
    const one = await setup('admin@dq-2.test');
    for (let i = 0; i < 3; i++) {
      await person(one.tenantId, `Dup${i}`, 'Mismo', { email: `mismo${i}@ejemplo.test`, phone: `1155550${i}00` });
      await person(one.tenantId, `Dup${i}`, 'Mismo', { email: `mismo${i}@ejemplo.test` });
    }
    const page = (await http().get('/api/data-quality/duplicate-email?page=2&limit=2').set(auth(one.token)).expect(200)).body;
    expect(page).toMatchObject({ total: 3, page: 2, limit: 2, totalPages: 2 });
    expect(page.items).toHaveLength(1);

    await http().get('/api/data-quality/nope').set(auth(one.token)).expect(400);
    await http().get('/api/data-quality/duplicate-email?limit=9999').set(auth(one.token)).expect(400);

    const other = await setup('admin@dq-3.test');
    const otherSummary = (await http().get('/api/data-quality').set(auth(other.token)).expect(200)).body;
    expect(otherSummary.checks.find((c: any) => c.check === 'duplicate-email').count).toBe(0);
  });

  it('CP-432 — el panel lo leen Admin y Gerente; unir personas sólo Admin', async () => {
    const { token, tenantId } = await setup('admin@dq-4.test');
    const gerente = await login(tenantId, UserRole.Gerente, 'gerente@dq-4.test');
    const ventas = await login(tenantId, UserRole.Ventas, 'ventas@dq-4.test');
    const a = await person(tenantId, 'Ana', 'Uno');
    const b = await person(tenantId, 'Ana', 'Uno');

    await http().get('/api/data-quality').set(auth(gerente)).expect(200);
    await http().get('/api/data-quality').set(auth(ventas)).expect(403);
    await http().get('/api/data-quality/duplicate-name').set(auth(ventas)).expect(403);
    await http().post('/api/data-quality/persons/merge/preview').set(auth(gerente)).send({ keepId: a.id, mergeIds: [b.id] }).expect(201);
    await http().post('/api/data-quality/persons/merge').set(auth(gerente)).send({ keepId: a.id, mergeIds: [b.id] }).expect(403);
    await http().post('/api/data-quality/persons/merge').set(auth(token)).send({ keepId: a.id, mergeIds: [b.id] }).expect(201);
  });

  it('CP-433 — unir personas mueve titularidades, cuentas y contratos, da de baja a la unida y deja auditoría', async () => {
    const { token, tenantId } = await setup('admin@dq-5.test');
    const keep = await person(tenantId, 'Ana', 'Pérez', { cuit: null });
    const dup = await person(tenantId, 'ANA', 'Perez', { cuit: '20-12345678-6', email: 'ana@ejemplo.test', payoutMethod: 'Transferencia' });
    await db().personRoleAssignment.create({ data: { tenantId, personId: keep.id, role: PersonRole.Propietario } });
    await db().personRoleAssignment.create({ data: { tenantId, personId: dup.id, role: PersonRole.Propietario } });
    await db().personBankAccount.create({
      data: { tenantId, personId: dup.id, currency: 'ARS', cbu: '0170000040000000123456', isDefault: true },
    });
    const contract = await activeContract(token, tenantId, 'Unidad Unida');
    await db().contractLessor.updateMany({ where: { contractId: contract.contractId }, data: { personId: dup.id } });
    await db().propertyOwnership.create({ data: { tenantId, propertyId: contract.propertyId, personId: dup.id } });

    const names = await findings(token, 'duplicate-name');
    expect(names.items).toHaveLength(1);

    const preview = (
      await http().post('/api/data-quality/persons/merge/preview').set(auth(token)).send({ keepId: keep.id, mergeIds: [dup.id] }).expect(201)
    ).body;
    expect(preview.items).toEqual(
      expect.arrayContaining([
        { entity: 'contractLessor', field: 'personId', count: 1 },
        { entity: 'propertyOwnership', field: 'personId', count: 1 },
        { entity: 'personBankAccount', field: 'personId', count: 1 },
      ]),
    );
    expect(preview.discarded).toEqual([{ entity: 'personRoleAssignment', field: 'personId', count: 1 }]);
    expect((await db().person.findUnique({ where: { id: dup.id } }))!.isActive).toBe(true);

    const merged = (
      await http().post('/api/data-quality/persons/merge').set(auth(token)).send({ keepId: keep.id, mergeIds: [dup.id] }).expect(201)
    ).body;
    expect(merged.merged).toBe(1);

    const after = await db().person.findUnique({ where: { id: keep.id } });
    expect(after).toMatchObject({ isActive: true, cuit: '20-12345678-6', email: 'ana@ejemplo.test', payoutMethod: 'Transferencia' });
    const gone = await db().person.findUnique({ where: { id: dup.id } });
    expect(gone).toMatchObject({ isActive: false, cuit: null });
    expect(gone!.notes).toContain(keep.id);
    expect(await db().contractLessor.count({ where: { personId: keep.id } })).toBe(1);
    expect(await db().propertyOwnership.count({ where: { personId: keep.id } })).toBe(1);
    expect(await db().personBankAccount.count({ where: { personId: keep.id } })).toBe(1);
    expect(await db().personRoleAssignment.count({ where: { personId: keep.id } })).toBe(1);

    const audit = await db().auditLog.findMany({ where: { tenantId, entity: 'Person', entityId: keep.id } });
    const mergeRow = audit.find((a: any) => (a.changes as any)?.metadata?.operation === 'persons.merge' || (a.changes as any)?.operation === 'persons.merge');
    expect(mergeRow).toBeDefined();
    expect((mergeRow!.changes as any).before).toBeDefined();
    expect((mergeRow!.changes as any).after).toBeDefined();

    // La persona unida ya no aparece como duplicada.
    expect((await findings(token, 'duplicate-name')).items).toHaveLength(0);
  });

  it('CP-434 — unir con un perfil de proveedor en ambas personas da 409 y no cambia nada', async () => {
    const { token, tenantId } = await setup('admin@dq-6.test');
    const keep = await person(tenantId, 'Ana', 'Proveedora');
    const dup = await person(tenantId, 'Ana', 'Proveedora');
    await db().providerProfile.create({ data: { tenantId, personId: keep.id, rubros: [] } });
    await db().providerProfile.create({ data: { tenantId, personId: dup.id, rubros: [] } });
    await db().propertyOwnership.create({
      data: { tenantId, personId: dup.id, propertyId: (await activeContract(token, tenantId, 'Unidad X')).propertyId },
    });

    const res = await http()
      .post('/api/data-quality/persons/merge')
      .set(auth(token))
      .send({ keepId: keep.id, mergeIds: [dup.id] })
      .expect(409);
    expect(res.body.error).toBe('MERGE_CONFLICT');
    expect((await db().person.findUnique({ where: { id: dup.id } }))!.isActive).toBe(true);
    expect(await db().propertyOwnership.count({ where: { personId: dup.id } })).toBe(1);

    await http()
      .post('/api/data-quality/persons/merge')
      .set(auth(token))
      .send({ keepId: keep.id, mergeIds: ['00000000-0000-4000-8000-000000000000'] })
      .expect(404);
    await http().post('/api/data-quality/persons/merge').set(auth(token)).send({ keepId: keep.id, mergeIds: [keep.id] }).expect(400);
  });
});
