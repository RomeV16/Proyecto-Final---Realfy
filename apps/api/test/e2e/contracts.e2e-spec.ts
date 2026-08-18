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
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  GuaranteeType,
  GuaranteeStatus,
  IndexType,
  PropertyType,
} from '@realfy/shared';

describe('Contracts (e2e)', () => {
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

  // ─── Helpers ──────────────────────────────────────────

  /**
   * Creates a property via API, returns the response body (with .id).
   */
  async function createProperty(token: string) {
    const res = await request(app.getHttpServer())
      .post('/api/properties')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Depto Palermo',
        type: PropertyType.Departamento,
        street: 'Av. Santa Fe',
        number: '1234',
        city: 'Buenos Aires',
        province: 'CABA',
        area: 65,
        rooms: 2,
        bedrooms: 1,
        bathrooms: 1,
        price: 100000,
        currency: 'USD',
      })
      .expect(201);
    return res.body;
  }

  /**
   * Creates a person with a role assignment via API, returns { person, role }.
   */
  async function createPersonWithRole(
    token: string,
    overrides: { firstName: string; lastName: string; role: PersonRole; email?: string },
  ) {
    const personRes = await request(app.getHttpServer())
      .post('/api/persons')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: overrides.firstName,
        lastName: overrides.lastName,
        email: overrides.email ?? `${overrides.firstName.toLowerCase()}@test.com`,
      })
      .expect(201);

    const roleRes = await request(app.getHttpServer())
      .post(`/api/persons/${personRes.body.id}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: overrides.role })
      .expect(201);

    return { person: personRes.body, role: roleRes.body };
  }

  /**
   * Full contract creation payload builder.
   */
  function buildContractPayload(opts: {
    propertyId: string;
    propietarioId: string;
    inquilinoId: string;
    garanteId?: string;
    adjustmentType?: AdjustmentType;
    adjustmentPeriod?: AdjustmentPeriod;
    guaranteeEndDate?: string;
    customAdjustmentPct?: string;
  }) {
    const persons = [
      { personId: opts.propietarioId, role: PersonRole.Propietario },
      { personId: opts.inquilinoId, role: PersonRole.Inquilino },
    ];
    if (opts.garanteId) {
      persons.push({ personId: opts.garanteId, role: PersonRole.Garante });
    }

    const guarantees: any[] = [];
    if (opts.garanteId) {
      guarantees.push({
        type: GuaranteeType.Seguro_de_caucion,
        status: GuaranteeStatus.Vigente,
        description: 'Póliza seguro de caución',
        amount: '50000.00',
        currency: 'ARS',
        issuer: 'Finaer',
        policyNumber: 'POL-12345',
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: opts.guaranteeEndDate ?? '2027-01-01T00:00:00.000Z',
      });
    }

    return {
      propertyId: opts.propertyId,
      contractType: ContractType.Alquiler,
      status: ContractStatus.Activo,
      startDate: '2025-01-01T00:00:00.000Z',
      endDate: '2027-01-01T00:00:00.000Z',
      rentAmount: '150000.00',
      rentCurrency: 'ARS',
      depositAmount: '300000.00',
      depositCurrency: 'ARS',
      adjustmentType: opts.adjustmentType ?? AdjustmentType.IPC,
      adjustmentPeriod: opts.adjustmentPeriod ?? AdjustmentPeriod.Trimestral,
      customAdjustmentPct: opts.customAdjustmentPct,
      notes: 'Contrato de alquiler test',
      persons,
      guarantees,
    };
  }

  /**
   * Registers a user, creates property + 3 persons with roles, creates a contract.
   * Returns everything needed for follow-up tests.
   */
  async function setupFullContract(emailPrefix: string, overrides?: {
    adjustmentType?: AdjustmentType;
    adjustmentPeriod?: AdjustmentPeriod;
    guaranteeEndDate?: string;
    customAdjustmentPct?: string;
  }) {
    const user = await registerUser(app, {
      email: `${emailPrefix}@test.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });

    const property = await createProperty(user.accessToken);
    const propietario = await createPersonWithRole(user.accessToken, {
      firstName: 'Carlos',
      lastName: 'Propietario',
      role: PersonRole.Propietario,
      email: `propietario-${emailPrefix}@test.com`,
    });
    const inquilino = await createPersonWithRole(user.accessToken, {
      firstName: 'Ana',
      lastName: 'Inquilina',
      role: PersonRole.Inquilino,
      email: `inquilino-${emailPrefix}@test.com`,
    });
    const garante = await createPersonWithRole(user.accessToken, {
      firstName: 'Roberto',
      lastName: 'Garante',
      role: PersonRole.Garante,
      email: `garante-${emailPrefix}@test.com`,
    });

    const payload = buildContractPayload({
      propertyId: property.id,
      propietarioId: propietario.person.id,
      inquilinoId: inquilino.person.id,
      garanteId: garante.person.id,
      adjustmentType: overrides?.adjustmentType,
      adjustmentPeriod: overrides?.adjustmentPeriod,
      guaranteeEndDate: overrides?.guaranteeEndDate,
      customAdjustmentPct: overrides?.customAdjustmentPct,
    });

    const contractRes = await request(app.getHttpServer())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send(payload)
      .expect(201);

    return {
      user,
      property,
      propietario,
      inquilino,
      garante,
      contract: contractRes.body,
    };
  }

  // ─── CRUD ────────────────────────────────────────────

  describe('CRUD operations', () => {
    it('POST /contracts — creates contract with property, persons, guarantee and returns full relations', async () => {
      const { contract } = await setupFullContract('crud-create');

      expect(contract.id).toBeDefined();
      expect(contract.contractType).toBe(ContractType.Alquiler);
      expect(contract.status).toBe(ContractStatus.Activo);
      expect(contract.persons).toHaveLength(3);
      expect(contract.guarantees).toHaveLength(1);
      expect(contract.property).toBeDefined();
      expect(contract.schedules.length).toBeGreaterThan(0);
    });

    it('GET /contracts — lists contracts with pagination', async () => {
      const { user } = await setupFullContract('crud-list');

      const res = await request(app.getHttpServer())
        .get('/api/contracts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.items[0].persons).toBeDefined();
    });

    it('GET /contracts/:id — returns full detail with persons, guarantees, property', async () => {
      const { user, contract } = await setupFullContract('crud-detail');

      const res = await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(contract.id);
      expect(res.body.persons).toHaveLength(3);
      expect(res.body.guarantees).toHaveLength(1);
      expect(res.body.property).toBeDefined();
      expect(res.body.adjustments).toBeDefined();
      expect(res.body.schedules).toBeDefined();
    });

    it('PATCH /contracts/:id — updates contract fields', async () => {
      const { user, contract } = await setupFullContract('crud-update');

      const res = await request(app.getHttpServer())
        .patch(`/api/contracts/${contract.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ notes: 'Updated notes' })
        .expect(200);

      expect(res.body.notes).toBe('Updated notes');
    });
  });

  // ─── Tenant Isolation ────────────────────────────────

  describe('Tenant isolation', () => {
    it('user A cannot list user B contracts (different tenants)', async () => {
      // User A creates a contract
      await setupFullContract('tenant-a');

      // User B (different tenant) registers
      const userB = await registerUser(app, {
        email: 'tenant-b@test.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      // User B should see empty contracts list
      const res = await request(app.getHttpServer())
        .get('/api/contracts')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('user B cannot access user A contract by ID (returns 404)', async () => {
      const { contract } = await setupFullContract('tenant-iso-a');

      const userB = await registerUser(app, {
        email: 'tenant-iso-b@test.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });
  });

  // ─── RBAC ────────────────────────────────────────────

  describe('RBAC enforcement', () => {
    it('Lectura role cannot create contracts (403)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@rbac-contract-create.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura@rbac-contract-create.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@rbac-contract-create.com', 'Password123!');

      await request(app.getHttpServer())
        .post('/api/contracts')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({ contractType: ContractType.Alquiler })
        .expect(403);
    });

    it('Lectura role cannot update contracts (403)', async () => {
      const { user, contract } = await setupFullContract('rbac-lectura-update');

      await createUserDirect(prisma, user.user.tenantId, {
        email: 'lectura@rbac-contract-update.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@rbac-contract-update.com', 'Password123!');

      await request(app.getHttpServer())
        .patch(`/api/contracts/${contract.id}`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({ notes: 'hacked' })
        .expect(403);
    });

    it('Ventas role cannot terminate contracts (403, Admin/Gerente only)', async () => {
      const { user, contract } = await setupFullContract('rbac-ventas-terminate');

      await createUserDirect(prisma, user.user.tenantId, {
        email: 'ventas@rbac-terminate.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const ventas = await loginUser(app, 'ventas@rbac-terminate.com', 'Password123!');

      await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/terminate`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(403);
    });
  });

  // ─── Adjustment Flow ─────────────────────────────────

  describe('Adjustment flow (IPC)', () => {
    it('POST /index-data — creates IPC index values for 3 months', async () => {
      const user = await registerUser(app, {
        email: 'admin@adj-index.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const months = [
        { period: '2025-01-01T00:00:00.000Z', value: '5.200000' },
        { period: '2025-02-01T00:00:00.000Z', value: '4.800000' },
        { period: '2025-03-01T00:00:00.000Z', value: '5.100000' },
      ];

      for (const m of months) {
        const res = await request(app.getHttpServer())
          .post('/api/index-data')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({
            indexType: IndexType.IPC,
            period: m.period,
            value: m.value,
            source: 'INDEC',
          })
          .expect(201);

        expect(res.body.id).toBeDefined();
        expect(res.body.indexType).toBe(IndexType.IPC);
      }
    });

    it('POST /contracts/:id/adjustments/calculate — returns calculated adjustment with correct values', async () => {
      const { user, contract } = await setupFullContract('adj-calc', {
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
      });

      // Create IPC index data covering the first trimester
      const months = [
        { period: '2025-01-01T00:00:00.000Z', value: '5.200000' },
        { period: '2025-02-01T00:00:00.000Z', value: '4.800000' },
        { period: '2025-03-01T00:00:00.000Z', value: '5.100000' },
        { period: '2025-04-01T00:00:00.000Z', value: '4.500000' },
      ];
      for (const m of months) {
        await request(app.getHttpServer())
          .post('/api/index-data')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ indexType: IndexType.IPC, ...m })
          .expect(201);
      }

      // Get the first pending schedule
      const detail = await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pendingSchedule = detail.body.schedules.find(
        (s: any) => s.status === 'Pending',
      );
      expect(pendingSchedule).toBeDefined();

      // Calculate adjustment
      const calcRes = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/adjustments/calculate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ scheduleId: pendingSchedule.id })
        .expect(201);

      expect(calcRes.body.id).toBeDefined();
      expect(calcRes.body.contractId).toBe(contract.id);
      expect(calcRes.body.periodNumber).toBe(pendingSchedule.periodNumber);
      expect(Number(calcRes.body.previousAmount)).toBe(150000);
      expect(Number(calcRes.body.newAmount)).toBeGreaterThan(150000);
      expect(Number(calcRes.body.percentage)).toBeGreaterThan(0);
    });

    it('POST /contracts/:id/adjustments/:adjId/apply — applies adjustment and updates rentAmount', async () => {
      const { user, contract } = await setupFullContract('adj-apply', {
        adjustmentType: AdjustmentType.FixedPercent,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        customAdjustmentPct: '10.00',
      });

      // Get first pending schedule
      const detail = await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const pendingSchedule = detail.body.schedules.find(
        (s: any) => s.status === 'Pending',
      );

      // Calculate
      const calcRes = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/adjustments/calculate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ scheduleId: pendingSchedule.id })
        .expect(201);

      // Verify calculated 10% increase: 150000 * 1.10 = 165000
      expect(Number(calcRes.body.newAmount)).toBeCloseTo(165000, 0);

      // Apply
      const applyRes = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/adjustments/${calcRes.body.id}/apply`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      // Verify rentAmount was updated on the contract
      expect(Number(applyRes.body.rentAmount)).toBeCloseTo(165000, 0);
    });
  });

  // ─── Guarantee Expiry ────────────────────────────────

  describe('Guarantee expiry', () => {
    it('contract with guarantee expiring in 45 days — guarantee status Vigente', async () => {
      const futureDate = new Date();
      futureDate.setDate(futureDate.getDate() + 45);
      const futureISO = futureDate.toISOString();

      const { user, contract } = await setupFullContract('guarantee-45d', {
        guaranteeEndDate: futureISO,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.guarantees).toHaveLength(1);
      expect(res.body.guarantees[0].status).toBe(GuaranteeStatus.Vigente);
      // endDate should match what we set
      const endDate = new Date(res.body.guarantees[0].endDate);
      const diffDays = Math.ceil((endDate.getTime() - Date.now()) / (1000 * 60 * 60 * 24));
      expect(diffDays).toBeLessThanOrEqual(46);
      expect(diffDays).toBeGreaterThanOrEqual(44);
    });

    it('contract with guarantee already expired — guarantee status reflects it was created as Vigente but endDate is past', async () => {
      // Set endDate in the past
      const pastDate = new Date();
      pastDate.setDate(pastDate.getDate() - 30);
      const pastISO = pastDate.toISOString();

      const { user, contract } = await setupFullContract('guarantee-expired', {
        guaranteeEndDate: pastISO,
      });

      const res = await request(app.getHttpServer())
        .get(`/api/contracts/${contract.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.guarantees).toHaveLength(1);
      // The guarantee was created with status Vigente, endDate is in the past
      // The system stores what was set; client-side computes expiry warning
      const endDate = new Date(res.body.guarantees[0].endDate);
      expect(endDate.getTime()).toBeLessThan(Date.now());
    });
  });

  // ─── Terminate ───────────────────────────────────────

  describe('Contract termination', () => {
    it('POST /contracts/:id/terminate — sets status Rescindido and isActive false', async () => {
      const { user, contract } = await setupFullContract('terminate');

      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/terminate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      expect(res.body.status).toBe(ContractStatus.Rescindido);
      expect(res.body.isActive).toBe(false);
    });

    it('GET /contracts after terminate — contract still findable with Rescindido status', async () => {
      const { user, contract } = await setupFullContract('terminate-list');

      await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/terminate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      const listRes = await request(app.getHttpServer())
        .get('/api/contracts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(listRes.body.items).toHaveLength(1);
      expect(listRes.body.items[0].status).toBe(ContractStatus.Rescindido);
    });
  });
});
