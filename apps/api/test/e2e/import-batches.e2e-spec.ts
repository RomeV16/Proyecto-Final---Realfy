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
import { UserRole } from '@realfy/shared';

const CBU_A = '0000000000000000000001';

/** Cartera sintética: dos locadores, un inquilino, un garante, un edificio con una unidad y un contrato activo. */
function portfolio() {
  return {
    persons: [
      {
        externalRef: 'P-LOC-1',
        firstName: 'Luz',
        lastName: 'Locadora',
        dni: '10000001',
        email: 'luz@ejemplo.test',
        roles: ['Propietario'],
        bankAccounts: [{ currency: 'ARS', bank: 'Banco Uno', cbu: CBU_A, alias: 'luz.loc', isDefault: true }],
      },
      { externalRef: 'P-LOC-2', firstName: 'Leo', lastName: 'Locador', dni: '10000002', roles: ['Propietario'] },
      { externalRef: 'P-INQ-1', firstName: 'Ines', lastName: 'Inquilina', dni: '20000001', roles: ['Inquilino'] },
      { externalRef: 'P-GAR-1', firstName: 'Gaspar', lastName: 'Garante', dni: '30000001', roles: ['Garante'] },
      { externalRef: 'P-SA-1', personType: 'Juridica', businessName: 'Ejemplo SA', roles: ['Propietario'] },
    ],
    properties: [
      { externalRef: 'U-EDIF', type: 'Edificio', street: 'Calle Falsa', number: '123', city: 'Cordoba' },
      {
        externalRef: 'U-1',
        type: 'Departamento',
        street: 'Calle Falsa',
        number: '123',
        floor: '2',
        unit: 'B',
        city: 'Cordoba',
        cadastralId: '11-01-001',
        parentExternalRef: 'U-EDIF',
        owners: [
          { personExternalRef: 'P-LOC-1', sharePct: 50 },
          { personExternalRef: 'P-LOC-2', sharePct: 50 },
        ],
      },
    ],
    contracts: [
      {
        externalRef: 'C-1',
        propertyExternalRef: 'U-1',
        status: 'Activo',
        startDate: '2025-01-01',
        endDate: '2027-12-31',
        rentAmount: 180000,
        currency: 'ARS',
        initialRent: 100000,
        tenants: ['P-INQ-1'],
        guarantors: ['P-GAR-1'],
        lessors: [
          { personExternalRef: 'P-LOC-1', payoutPct: 60, bankAccountCbu: CBU_A },
          { personExternalRef: 'P-LOC-2', payoutPct: 40, needsReview: true },
        ],
        terms: { adjustmentType: 'IPC', adjustmentPeriod: 'Trimestral', dueDay: 10 },
        commission: { type: 'FixedPercent', percentage: 7, adminFee: 0 },
        adjustmentsHistory: [
          { periodNumber: 1, appliedAt: '2025-04-01', previousAmount: 100000, newAmount: 120000, factor: 1.2 },
          { periodNumber: 2, appliedAt: '2025-07-01', previousAmount: 120000, newAmount: 150000 },
          { periodNumber: 3, appliedAt: '2025-10-01', previousAmount: 150000, newAmount: 180000 },
        ],
      },
      {
        externalRef: 'C-OLD',
        propertyExternalRef: 'U-1',
        status: 'Vencido',
        startDate: '2022-01-01',
        endDate: '2024-12-31',
        rentAmount: 90000,
        tenants: ['P-INQ-1'],
        terms: { adjustmentType: 'ICL', adjustmentPeriod: 'Semestral' },
      },
    ],
  };
}

describe('Importación por lotes (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let token: string;
  let tenantId: string;

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
    const admin = await registerUser(app, {
      email: `imp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@test.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Prueba',
    });
    token = admin.accessToken;
    tenantId = admin.user.tenantId;
  });

  const http = () => request(app.getHttpServer());
  const post = (body: unknown, t = token) =>
    http().post('/api/import/batches').set('Authorization', `Bearer ${t}`).send(body as object);
  const counts = (res: request.Response, entity: string) => res.body.counts.byEntity[entity];
  const rowFor = (res: request.Response, externalRef: string) =>
    res.body.rows.find((r: any) => r.externalRef === externalRef);

  it('dryRun valida y calcula las acciones sin escribir nada', async () => {
    const res = await post({ dryRun: true, ...portfolio() }).expect(201);

    expect(res.body.status).toBe('Validado');
    expect(res.body.dryRun).toBe(true);
    expect(res.body.counts.errors).toBe(0);
    expect(counts(res, 'Persona').Creado).toBe(5);
    expect(counts(res, 'Propiedad').Creado).toBe(2);
    expect(counts(res, 'Contrato').Creado).toBe(2);

    expect(await prisma.baseClient.person.count()).toBe(0);
    expect(await prisma.baseClient.property.count()).toBe(0);
    expect(await prisma.baseClient.contract.count()).toBe(0);
    // El lote y su registro sí quedan.
    expect(await prisma.baseClient.importRowLog.count({ where: { batchId: res.body.id } })).toBe(9);
  });

  it('ejecuta el lote: personas, propiedades, contratos con locadores, reglas e historial', async () => {
    const res = await post({ dryRun: false, ...portfolio() }).expect(201);

    expect(res.body.status).toBe('Completado');
    expect(res.body.counts.errors).toBe(0);

    const loc1 = await prisma.baseClient.person.findFirstOrThrow({
      where: { externalRef: 'P-LOC-1' },
      include: { roles: true, bankAccounts: true },
    });
    expect(loc1.roles.map((r) => r.role)).toContain('Propietario');
    expect(loc1.bankAccounts).toHaveLength(1);
    expect(loc1.bankAccounts[0]).toMatchObject({ cbu: CBU_A, isDefault: true, currency: 'ARS' });
    const sa = await prisma.baseClient.person.findFirstOrThrow({ where: { externalRef: 'P-SA-1' } });
    expect(sa).toMatchObject({ personType: 'Juridica', firstName: 'Ejemplo SA', lastName: '' });

    const unit = await prisma.baseClient.property.findFirstOrThrow({
      where: { externalRef: 'U-1' },
      include: { ownerships: true, operations: true },
    });
    expect(unit.parentPropertyId).toBeTruthy();
    expect(unit.ownerships).toHaveLength(2);
    expect(unit.title).toBe('Calle Falsa 123, Piso 2 Depto B');
    // Contrato activo importado: la propiedad queda alquilada, sin pasar por la activación.
    expect(unit.operations.find((o) => o.operationType === 'Alquiler')?.state).toBe('Alquilado');

    const contract = await prisma.baseClient.contract.findFirstOrThrow({
      where: { externalRef: 'C-1' },
      include: {
        lessors: true,
        persons: true,
        termsVersions: true,
        periods: true,
        commission: true,
        adjustments: { orderBy: { periodNumber: 'asc' } },
        schedules: true,
      },
    });
    expect(contract.status).toBe('Activo');
    expect(contract.lessors.map((l) => Number(l.payoutPct)).sort()).toEqual([40, 60]);
    expect(contract.lessors.find((l) => l.needsReview)).toBeTruthy();
    expect(contract.lessors.find((l) => l.bankAccountId)).toBeTruthy();
    expect(contract.persons.map((p) => p.role).sort()).toEqual(['Garante', 'Inquilino']);
    // Contrato nuevo: el rezago es el de la inmobiliaria.
    expect(contract.termsVersions).toHaveLength(1);
    expect(contract.termsVersions[0]).toMatchObject({ indexLagMonths: 2, dueDay: 10, adjustmentType: 'IPC' });
    expect(Number(contract.periods[0].initialRent)).toBe(100000);
    expect(Number(contract.commission!.percentage)).toBe(7);

    // El historial reproduce el monto vigente.
    expect(contract.adjustments.map((a) => Number(a.newAmount))).toEqual([120000, 150000, 180000]);
    expect(Number(contract.adjustments[contract.adjustments.length - 1].newAmount)).toBe(Number(contract.rentAmount));
    expect(Number(contract.adjustments[0].percentage)).toBe(20);
    for (let i = 1; i < contract.adjustments.length; i++) {
      expect(Number(contract.adjustments[i].previousAmount)).toBe(Number(contract.adjustments[i - 1].newAmount));
    }
    const applied = contract.schedules.filter((s) => s.status === 'Applied').map((s) => s.periodNumber);
    expect(applied.sort()).toEqual([1, 2, 3]);

    const old = await prisma.baseClient.contract.findFirstOrThrow({ where: { externalRef: 'C-OLD' } });
    expect(old.status).toBe('Vencido');
  });

  it('volver a correr el mismo lote deja todo SinCambios', async () => {
    await post({ dryRun: false, ...portfolio() }).expect(201);
    const before = {
      persons: await prisma.baseClient.person.count(),
      lessors: await prisma.baseClient.contractLessor.count(),
      adjustments: await prisma.baseClient.contractAdjustment.count(),
    };

    const again = await post({ dryRun: false, ...portfolio() }).expect(201);

    expect(again.body.counts.errors).toBe(0);
    for (const entity of ['Persona', 'Propiedad', 'Contrato']) {
      expect(counts(again, entity).Creado).toBe(0);
      expect(counts(again, entity).Actualizado).toBe(0);
    }
    expect(counts(again, 'Persona').SinCambios).toBe(5);
    expect(counts(again, 'Contrato').SinCambios).toBe(2);
    expect({
      persons: await prisma.baseClient.person.count(),
      lessors: await prisma.baseClient.contractLessor.count(),
      adjustments: await prisma.baseClient.contractAdjustment.count(),
    }).toEqual(before);
  });

  it('un campo cambiado en el lote da Actualizado y sólo en esa fila', async () => {
    await post({ dryRun: false, ...portfolio() }).expect(201);

    const next = portfolio();
    next.persons[0].email = 'luz.nueva@ejemplo.test';
    next.persons[2].roles = ['Inquilino', 'Propietario'];
    next.properties[1].city = 'Villa Maria';
    (next.contracts[0].lessors as any[])[0].payoutPct = 50;
    (next.contracts[0].lessors as any[])[1].payoutPct = 50;
    const res = await post({ dryRun: false, ...next }).expect(201);

    expect(rowFor(res, 'P-LOC-1').action).toBe('Actualizado');
    expect(rowFor(res, 'P-INQ-1').action).toBe('Actualizado');
    expect(rowFor(res, 'P-LOC-2').action).toBe('SinCambios');
    expect(rowFor(res, 'U-1').action).toBe('Actualizado');
    expect(rowFor(res, 'C-1').action).toBe('Actualizado');
    expect(rowFor(res, 'C-OLD').action).toBe('SinCambios');

    const luz = await prisma.baseClient.person.findFirstOrThrow({ where: { externalRef: 'P-LOC-1' } });
    expect(luz.email).toBe('luz.nueva@ejemplo.test');
    const shares = await prisma.baseClient.contractLessor.findMany({ where: { contract: { externalRef: 'C-1' } } });
    expect(shares.map((l) => Number(l.payoutPct))).toEqual([50, 50]);
  });

  it('un contrato ya cargado conserva su rezago aunque cambie el valor por defecto', async () => {
    await post({ dryRun: false, ...portfolio() }).expect(201);
    await prisma.baseClient.contractTermsVersion.updateMany({ data: { indexLagMonths: 0 } });
    await prisma.baseClient.tenant.update({ where: { id: tenantId }, data: { operationalDefaults: { ipcLagMonths: 4 } } });

    const res = await post({ dryRun: false, ...portfolio() }).expect(201);

    expect(rowFor(res, 'C-1').action).toBe('SinCambios');
    const terms = await prisma.baseClient.contractTermsVersion.findFirstOrThrow({ where: { contract: { externalRef: 'C-1' } } });
    expect(terms.indexLagMonths).toBe(0);
  });

  it('un contrato que deja de estar activo libera la propiedad', async () => {
    await post({ dryRun: false, ...portfolio() }).expect(201);

    const next = portfolio();
    next.contracts[0].status = 'Vencido';
    const res = await post({ dryRun: false, ...next }).expect(201);

    expect(rowFor(res, 'C-1').action).toBe('Actualizado');
    const op = await prisma.baseClient.propertyOperation.findFirstOrThrow({
      where: { property: { externalRef: 'U-1' }, operationType: 'Alquiler' },
    });
    expect(op.state).toBe('Disponible');
  });

  it('autoadministrado: cobra directo y sólo lleva la comisión inicial', async () => {
    const body = portfolio();
    const own = {
      ...body.contracts[0],
      externalRef: 'C-SELF',
      status: 'Vencido',
      selfManaged: true,
      commission: { fixedAmount: 50000 },
      adjustmentsHistory: undefined,
      rentAmount: 100000,
      initialRent: undefined,
    };
    body.contracts = [own as any];
    const res = await post({ dryRun: false, ...body }).expect(201);

    expect(rowFor(res, 'C-SELF').action).toBe('Creado');
    const contract = await prisma.baseClient.contract.findFirstOrThrow({
      where: { externalRef: 'C-SELF' },
      include: { commission: true, termsVersions: true },
    });
    expect(contract.termsVersions[0].paymentFlow).toBe('TodoLocador');
    expect(contract.commission).toMatchObject({ type: 'FixedAmount', percentage: null });
    expect(Number(contract.commission!.fixedAmount)).toBe(50000);
  });

  it('una referencia sin resolver es error de esa fila y el resto sigue', async () => {
    const body = portfolio();
    body.contracts[0].tenants = ['P-NO-EXISTE'];
    const res = await post({ dryRun: false, ...body }).expect(201);

    expect(res.body.status).toBe('Completado');
    expect(res.body.counts.errors).toBe(1);
    const row = rowFor(res, 'C-1');
    expect(row.action).toBe('Error');
    expect(row.errors[0]).toMatchObject({ code: 'REFERENCE_NOT_FOUND', field: 'tenants[0]' });
    expect(rowFor(res, 'C-OLD').action).toBe('Creado');
    expect(await prisma.baseClient.contract.count({ where: { externalRef: 'C-1' } })).toBe(0);
    expect(await prisma.baseClient.person.count()).toBe(5);
  });

  it('locadores que no suman 100 en un contrato activo: LESSOR_SHARES_INVALID', async () => {
    const body = portfolio();
    (body.contracts[0].lessors as any[])[1].payoutPct = 30;
    const res = await post({ dryRun: false, ...body }).expect(201);

    expect(rowFor(res, 'C-1').errors[0].code).toBe('LESSOR_SHARES_INVALID');
    expect(res.body.counts.byEntity.Contrato.Error).toBe(1);
  });

  it('un historial que no llega al monto vigente es RENT_MISMATCH y uno cortado es ADJUSTMENT_HISTORY_INVALID', async () => {
    const mismatch = portfolio();
    mismatch.contracts[0].rentAmount = 200000;
    const a = await post({ dryRun: true, ...mismatch }).expect(201);
    expect(rowFor(a, 'C-1').errors[0].code).toBe('RENT_MISMATCH');

    const broken = portfolio();
    broken.contracts[0].adjustmentsHistory![1].previousAmount = 119000;
    const b = await post({ dryRun: true, ...broken }).expect(201);
    expect(rowFor(b, 'C-1').errors[0].code).toBe('ADJUSTMENT_HISTORY_INVALID');
  });

  it('errores de forma son VALIDATION_ERROR con el campo', async () => {
    const body = portfolio();
    (body.persons[0] as any).cuit = '20-12345678-0';
    (body.persons[1] as any).bankAccounts = [{ currency: 'ARS', cbu: '123' }];
    const res = await post({ dryRun: true, ...body }).expect(201);

    expect(rowFor(res, 'P-LOC-1').errors[0]).toMatchObject({ code: 'VALIDATION_ERROR', field: 'cuit' });
    expect(rowFor(res, 'P-LOC-2').errors[0].code).toBe('VALIDATION_ERROR');
  });

  it('el mismo externalRef dos veces en el lote: la segunda fila es DUPLICATE_IN_BATCH', async () => {
    const body = portfolio();
    body.persons.push({ ...body.persons[2] });
    const res = await post({ dryRun: false, ...body }).expect(201);

    const rows = res.body.rows.filter((r: any) => r.externalRef === 'P-INQ-1');
    expect(rows.map((r: any) => r.action)).toEqual(['Creado', 'Error']);
    expect(rows[1].errors[0].code).toBe('DUPLICATE_IN_BATCH');
  });

  it('atomic: si una fila falla no se escribe nada y el lote queda Fallido', async () => {
    const body = portfolio();
    body.contracts[0].tenants = ['P-NO-EXISTE'];
    const res = await post({ dryRun: false, atomic: true, ...body }).expect(201);

    expect(res.body.status).toBe('Fallido');
    expect(res.body.counts.errors).toBe(1);
    expect(await prisma.baseClient.person.count()).toBe(0);
    expect(await prisma.baseClient.contract.count()).toBe(0);
  });

  it('atomic sin errores escribe todo', async () => {
    const res = await post({ dryRun: false, atomic: true, ...portfolio() }).expect(201);

    expect(res.body.status).toBe('Completado');
    expect(await prisma.baseClient.contract.count()).toBe(2);
  });

  it('dos contratos activos que se pisan en la misma propiedad: OVERLAPPING_ACTIVE_CONTRACT', async () => {
    const body = portfolio();
    body.contracts.push({
      ...body.contracts[0],
      externalRef: 'C-2',
      adjustmentsHistory: undefined,
      rentAmount: 1,
      initialRent: undefined,
    } as any);
    const res = await post({ dryRun: false, ...body }).expect(201);

    expect(rowFor(res, 'C-2').errors[0].code).toBe('OVERLAPPING_ACTIVE_CONTRACT');
  });

  it('consulta de lotes y filas, con filtro por acción', async () => {
    const body = portfolio();
    body.contracts[0].tenants = ['P-NO-EXISTE'];
    const run = await post({ dryRun: false, ...body }).expect(201);

    const list = await http().get('/api/import/batches').set('Authorization', `Bearer ${token}`).expect(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0].id).toBe(run.body.id);

    const one = await http().get(`/api/import/batches/${run.body.id}`).set('Authorization', `Bearer ${token}`).expect(200);
    expect(one.body.counts.errors).toBe(1);

    const errors = await http()
      .get(`/api/import/batches/${run.body.id}/rows?action=Error`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(errors.body.total).toBe(1);
    expect(errors.body.data[0]).toMatchObject({ entity: 'Contrato', externalRef: 'C-1', action: 'Error' });

    const csv = await http()
      .get(`/api/import/batches/${run.body.id}/rows/csv?action=Error`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.headers['content-disposition']).toContain('-error.csv');
    expect(csv.text).toContain('REFERENCE_NOT_FOUND');
    expect(csv.text).not.toContain('P-LOC-1');

    await http()
      .get(`/api/import/batches/${run.body.id}/rows?action=Nope`)
      .set('Authorization', `Bearer ${token}`)
      .expect(400);
  });

  it('un cuerpo mal formado es 400', async () => {
    await post({ persons: [] }).expect(400);
    await post({ dryRun: false, personas: [] }).expect(400);
  });

  describe('permisos y aislamiento', () => {
    it('sólo Admin: Gerente y sin sesión no pueden', async () => {
      const email = `ger-${Date.now()}@test.com`;
      await createUserDirect(prisma, tenantId, { email, password: 'Password123!', role: UserRole.Gerente });
      const gerente = (await loginUser(app, email, 'Password123!')).accessToken;

      await post({ dryRun: true }, gerente).expect(403);
      await http().get('/api/import/batches').set('Authorization', `Bearer ${gerente}`).expect(403);
      await http().post('/api/import/batches').send({ dryRun: true }).expect(401);
    });

    it('otra inmobiliaria no ve el lote ni resuelve referencias ajenas', async () => {
      const run = await post({ dryRun: false, ...portfolio() }).expect(201);

      const other = await registerUser(app, {
        email: `otra-${Date.now()}@test.com`,
        password: 'Password123!',
        firstName: 'Otra',
        lastName: 'Admin',
      });
      await http().get(`/api/import/batches/${run.body.id}`).set('Authorization', `Bearer ${other.accessToken}`).expect(404);
      await http().get(`/api/import/batches/${run.body.id}/rows`).set('Authorization', `Bearer ${other.accessToken}`).expect(404);
      const list = await http().get('/api/import/batches').set('Authorization', `Bearer ${other.accessToken}`).expect(200);
      expect(list.body).toHaveLength(0);

      // Sus contratos no encuentran las personas de la primera inmobiliaria...
      const probe = await post({ dryRun: true, contracts: portfolio().contracts }, other.accessToken).expect(201);
      expect(rowFor(probe, 'C-1').errors[0].code).toBe('REFERENCE_NOT_FOUND');

      // ...y la misma referencia externa es una persona distinta en cada una.
      const mine = await post({ dryRun: false, persons: portfolio().persons.slice(0, 1) }, other.accessToken).expect(201);
      expect(counts(mine, 'Persona').Creado).toBe(1);
      expect(await prisma.baseClient.person.count({ where: { externalRef: 'P-LOC-1' } })).toBe(2);
    });
  });
});
