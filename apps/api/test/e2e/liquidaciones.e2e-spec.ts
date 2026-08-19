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
  PropertyType,
  AdjustmentType,
  AdjustmentPeriod,
  LiquidacionStatus,
  PaymentMethod,
  LineItemType,
} from '@realfy/shared';

describe('Liquidaciones (e2e)', () => {
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
   * Creates a property via API, returns the response body.
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
   * Creates a person with a role assignment via API.
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
   * Creates an active contract with property and persons (propietario + inquilino).
   * Returns everything needed for liquidación tests.
   */
  async function setupFullContract(emailPrefix: string) {
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

    const contractRes = await request(app.getHttpServer())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${user.accessToken}`)
      .send({
        propertyId: property.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        rentAmount: '150000.00',
        rentCurrency: 'ARS',
        depositAmount: '300000.00',
        depositCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        notes: 'Contrato de alquiler test',
        persons: [
          { personId: propietario.person.id, role: PersonRole.Propietario },
          { personId: inquilino.person.id, role: PersonRole.Inquilino },
        ],
        guarantees: [],
      })
      .expect(201);

    return {
      user,
      property,
      propietario,
      inquilino,
      contract: contractRes.body,
    };
  }

  /**
   * Registers a user, creates a full contract, generates a liquidación for the given
   * month/year, and returns the full entity graph.
   */
  async function setupFullLiquidacion(
    emailPrefix: string,
    month = 3,
    year = 2026,
  ) {
    const setup = await setupFullContract(emailPrefix);

    const genRes = await request(app.getHttpServer())
      .post('/api/liquidaciones/generate')
      .set('Authorization', `Bearer ${setup.user.accessToken}`)
      .send({ month, year })
      .expect(201);

    // Fetch the generated liquidación
    const listRes = await request(app.getHttpServer())
      .get('/api/liquidaciones')
      .set('Authorization', `Bearer ${setup.user.accessToken}`)
      .expect(200);

    const liquidacion = listRes.body.items[0];

    return {
      ...setup,
      liquidacion,
      generationResult: genRes.body,
    };
  }

  /**
   * Transitions a liquidación through successive states.
   */
  async function transitionTo(
    token: string,
    liquidacionId: string,
    statuses: LiquidacionStatus[],
  ) {
    let result: any;
    for (const status of statuses) {
      const res = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacionId}/transition`)
        .set('Authorization', `Bearer ${token}`)
        .send({ status })
        .expect(200);
      result = res.body;
    }
    return result;
  }

  // ─── CRUD ────────────────────────────────────────────

  describe('Liquidaciones CRUD', () => {
    it('POST /liquidaciones/generate creates liquidaciones for active contracts', async () => {
      const { user } = await setupFullContract('gen-basic');

      const res = await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(201);

      expect(res.body.created).toBe(1);
      expect(res.body.skipped).toBe(0);
      expect(res.body.total).toBe(1);
    });

    it('POST /liquidaciones/generate skips contracts that already have a liquidación for the period', async () => {
      const { user } = await setupFullContract('gen-dedup');

      // First generation
      await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(201);

      // Second generation — same period should skip
      const res = await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(201);

      expect(res.body.created).toBe(0);
      expect(res.body.skipped).toBe(1);
    });

    it('POST /liquidaciones/generate skips inactive/terminated contracts', async () => {
      const { user, contract } = await setupFullContract('gen-inactive');

      // Terminate the contract
      await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/terminate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      // Generate — should find 0 active contracts
      const res = await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(201);

      expect(res.body.created).toBe(0);
      expect(res.body.total).toBe(0);
    });

    it('GET /liquidaciones returns paginated list with correct total', async () => {
      const { user } = await setupFullLiquidacion('list-pag');

      const res = await request(app.getHttpServer())
        .get('/api/liquidaciones')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
      expect(res.body.items[0].lineItems).toBeDefined();
      expect(res.body.items[0].contract).toBeDefined();
    });

    it('GET /liquidaciones filters by status, month, year', async () => {
      const { user } = await setupFullLiquidacion('list-filter', 3, 2026);

      // Filter by status — Borrador should match
      const byStatus = await request(app.getHttpServer())
        .get('/api/liquidaciones?status=Borrador')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(byStatus.body.items).toHaveLength(1);

      // Filter by status — Aprobada should not match
      const byWrongStatus = await request(app.getHttpServer())
        .get('/api/liquidaciones?status=Aprobada')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(byWrongStatus.body.items).toHaveLength(0);

      // Filter by month+year
      const byPeriod = await request(app.getHttpServer())
        .get('/api/liquidaciones?month=3&year=2026')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(byPeriod.body.items).toHaveLength(1);

      // Wrong month should not match
      const byWrongPeriod = await request(app.getHttpServer())
        .get('/api/liquidaciones?month=4&year=2026')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(byWrongPeriod.body.items).toHaveLength(0);
    });

    it('GET /liquidaciones/:id returns full detail with lineItems and payments', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('detail');

      const res = await request(app.getHttpServer())
        .get(`/api/liquidaciones/${liquidacion.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(liquidacion.id);
      expect(res.body.lineItems).toBeDefined();
      expect(res.body.lineItems.length).toBeGreaterThanOrEqual(1);
      expect(res.body.payments).toBeDefined();
      expect(res.body.contract).toBeDefined();
      expect(res.body.contract.property).toBeDefined();
    });
  });

  // ─── Tenant Isolation ────────────────────────────────

  describe('Tenant isolation', () => {
    it('User from tenant A cannot see liquidaciones from tenant B (GET returns empty)', async () => {
      await setupFullLiquidacion('tenant-a-liq');

      // User B in a different tenant
      const userB = await registerUser(app, {
        email: 'tenant-b-liq@test.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      const res = await request(app.getHttpServer())
        .get('/api/liquidaciones')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('User from tenant A cannot transition liquidaciones from tenant B (404)', async () => {
      const { liquidacion } = await setupFullLiquidacion('tenant-iso-a-liq');

      const userB = await registerUser(app, {
        email: 'tenant-iso-b-liq@test.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/transition`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ status: LiquidacionStatus.Revision })
        .expect(404);
    });
  });

  // ─── RBAC ────────────────────────────────────────────

  describe('RBAC enforcement', () => {
    it('Lectura role can GET /liquidaciones (200)', async () => {
      const { user } = await setupFullLiquidacion('rbac-lectura-read');

      // Create a Lectura user in the same tenant
      await createUserDirect(prisma, user.user.tenantId, {
        email: 'lectura-liq-read@test.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura-liq-read@test.com', 'Password123!');

      const res = await request(app.getHttpServer())
        .get('/api/liquidaciones')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(200);

      expect(res.body.items).toBeDefined();
    });

    it('Lectura role is blocked from POST /liquidaciones/generate (403)', async () => {
      const admin = await registerUser(app, {
        email: 'admin-rbac-gen@test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura-liq-gen@test.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura-liq-gen@test.com', 'Password123!');

      await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(403);
    });

    it('Lectura role is blocked from POST /liquidaciones/:id/transition (403)', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('rbac-lectura-trans');

      await createUserDirect(prisma, user.user.tenantId, {
        email: 'lectura-liq-trans@test.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura-liq-trans@test.com', 'Password123!');

      await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/transition`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({ status: LiquidacionStatus.Revision })
        .expect(403);
    });

    it('Lectura role is blocked from POST /liquidaciones/:id/payments (403)', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('rbac-lectura-pay');

      // Transition to Enviada (payment-eligible state)
      await transitionTo(user.accessToken, liquidacion.id, [
        LiquidacionStatus.Revision,
        LiquidacionStatus.Aprobada,
        LiquidacionStatus.Enviada,
      ]);

      await createUserDirect(prisma, user.user.tenantId, {
        email: 'lectura-liq-pay@test.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura-liq-pay@test.com', 'Password123!');

      await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/payments`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({
          amount: '150000.00',
          method: PaymentMethod.Transferencia,
          paidAt: new Date().toISOString(),
        })
        .expect(403);
    });

    it('Liquidaciones role can POST /liquidaciones/generate (201)', async () => {
      const admin = await registerUser(app, {
        email: 'admin-rbac-liqrole@test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      // Create property and contract first (as admin)
      const property = await createProperty(admin.accessToken);
      const propietario = await createPersonWithRole(admin.accessToken, {
        firstName: 'Carlos',
        lastName: 'Propietario',
        role: PersonRole.Propietario,
        email: 'prop-rbac-liqrole@test.com',
      });
      const inquilino = await createPersonWithRole(admin.accessToken, {
        firstName: 'Ana',
        lastName: 'Inquilina',
        role: PersonRole.Inquilino,
        email: 'inq-rbac-liqrole@test.com',
      });

      await request(app.getHttpServer())
        .post('/api/contracts')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          propertyId: property.id,
          contractType: ContractType.Alquiler,
          status: ContractStatus.Activo,
          startDate: '2025-01-01T00:00:00.000Z',
          endDate: '2027-01-01T00:00:00.000Z',
          rentAmount: '150000.00',
          rentCurrency: 'ARS',
          depositAmount: '300000.00',
          depositCurrency: 'ARS',
          adjustmentType: AdjustmentType.IPC,
          adjustmentPeriod: AdjustmentPeriod.Trimestral,
          persons: [
            { personId: propietario.person.id, role: PersonRole.Propietario },
            { personId: inquilino.person.id, role: PersonRole.Inquilino },
          ],
          guarantees: [],
        })
        .expect(201);

      // Create a Liquidaciones-role user
      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'liqrole@test.com',
        password: 'Password123!',
        role: UserRole.Liquidaciones,
      });

      const liqUser = await loginUser(app, 'liqrole@test.com', 'Password123!');

      const res = await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${liqUser.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(201);

      expect(res.body.created).toBe(1);
    });

    it('Liquidaciones role can POST /liquidaciones/:id/transition (200)', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('rbac-liqrole-trans');

      await createUserDirect(prisma, user.user.tenantId, {
        email: 'liqrole-trans@test.com',
        password: 'Password123!',
        role: UserRole.Liquidaciones,
      });

      const liqUser = await loginUser(app, 'liqrole-trans@test.com', 'Password123!');

      const res = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/transition`)
        .set('Authorization', `Bearer ${liqUser.accessToken}`)
        .send({ status: LiquidacionStatus.Revision })
        .expect(200);

      expect(res.body.status).toBe(LiquidacionStatus.Revision);
    });
  });

  // ─── State Transitions ──────────────────────────────

  describe('State transitions', () => {
    it('Full path: Borrador → Revision → Aprobada → Enviada → Pagada (via payment)', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('trans-full');

      // Borrador → Revision
      const r1 = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/transition`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: LiquidacionStatus.Revision })
        .expect(200);
      expect(r1.body.status).toBe(LiquidacionStatus.Revision);

      // Revision → Aprobada
      const r2 = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/transition`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: LiquidacionStatus.Aprobada })
        .expect(200);
      expect(r2.body.status).toBe(LiquidacionStatus.Aprobada);

      // Aprobada → Enviada
      const r3 = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/transition`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: LiquidacionStatus.Enviada })
        .expect(200);
      expect(r3.body.status).toBe(LiquidacionStatus.Enviada);
      expect(r3.body.sentAt).toBeDefined();

      // Register full payment → auto-transition to Pagada
      const r4 = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/payments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: '150000.00',
          method: PaymentMethod.Transferencia,
          paidAt: new Date().toISOString(),
        })
        .expect(200);
      expect(r4.body.status).toBe(LiquidacionStatus.Pagada);
      expect(r4.body.paidAt).toBeDefined();
    });

    it('salda la liquidacion con la fecha del pago y no con la de registracion', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('trans-fecha');

      for (const status of [
        LiquidacionStatus.Revision,
        LiquidacionStatus.Aprobada,
        LiquidacionStatus.Enviada,
      ]) {
        await request(app.getHttpServer())
          .post(`/api/liquidaciones/${liquidacion.id}/transition`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ status })
          .expect(200);
      }

      // Un pago hecho hace veinte dias, cargado recien ahora.
      const pagadoEl = new Date(Date.now() - 20 * 24 * 60 * 60 * 1000);
      const res = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/payments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: '150000.00',
          method: PaymentMethod.Transferencia,
          paidAt: pagadoEl.toISOString(),
        })
        .expect(200);

      expect(res.body.status).toBe(LiquidacionStatus.Pagada);
      expect(new Date(res.body.paidAt).toISOString().slice(0, 10)).toBe(
        pagadoEl.toISOString().slice(0, 10),
      );
    });

    it('Invalid: Borrador → Pagada returns 400', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('trans-inv-1');

      const res = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/transition`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: LiquidacionStatus.Pagada })
        .expect(400);

      expect(res.body.error).toBe('INVALID_TRANSITION');
      expect(res.body.validTransitions).toBeDefined();
    });

    it('Invalid: Pagada → Borrador returns 400 (terminal)', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('trans-inv-2');

      // Get to Pagada via full path
      await transitionTo(user.accessToken, liquidacion.id, [
        LiquidacionStatus.Revision,
        LiquidacionStatus.Aprobada,
        LiquidacionStatus.Enviada,
      ]);

      // Register full payment
      await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/payments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: '150000.00',
          method: PaymentMethod.Transferencia,
          paidAt: new Date().toISOString(),
        })
        .expect(200);

      // Try to go back to Borrador
      const res = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/transition`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: LiquidacionStatus.Borrador })
        .expect(400);

      expect(res.body.error).toBe('INVALID_TRANSITION');
    });

    it('Anulada is terminal — no transitions out', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('trans-anulada');

      // Transition to Revision, then Anulada
      await transitionTo(user.accessToken, liquidacion.id, [
        LiquidacionStatus.Revision,
        LiquidacionStatus.Aprobada,
        LiquidacionStatus.Anulada,
      ]);

      // Try to transition back to Borrador
      const res = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/transition`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: LiquidacionStatus.Borrador })
        .expect(400);

      expect(res.body.error).toBe('INVALID_TRANSITION');
      expect(res.body.validTransitions).toEqual([]);
    });
  });

  // ─── Line Items ─────────────────────────────────────

  describe('Line items', () => {
    it('POST add line item to Borrador liquidación succeeds', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('li-add');

      const res = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/line-items`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          type: LineItemType.Extra,
          description: 'Expensas extraordinarias',
          amount: '5000.00',
        })
        .expect(201);

      // Should return full liquidación with updated line items
      expect(res.body.lineItems.length).toBeGreaterThanOrEqual(2);
      // Total should include the extra
      expect(Number(res.body.total)).toBe(155000);
    });

    it('POST add line item to Aprobada liquidación returns 400 (locked)', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('li-locked');

      // Transition to Aprobada
      await transitionTo(user.accessToken, liquidacion.id, [
        LiquidacionStatus.Revision,
        LiquidacionStatus.Aprobada,
      ]);

      await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/line-items`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          type: LineItemType.Extra,
          description: 'Should fail',
          amount: '5000.00',
        })
        .expect(400);
    });

    it('Totals recalculated after adding/removing line items', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('li-calc');

      // Add an extra
      const addRes = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/line-items`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          type: LineItemType.Extra,
          description: 'Expensas',
          amount: '10000.00',
        })
        .expect(201);

      expect(Number(addRes.body.total)).toBe(160000);

      // Add a discount
      const discountRes = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/line-items`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          type: LineItemType.Descuento,
          description: 'Descuento pronto pago',
          amount: '5000.00',
        })
        .expect(201);

      // Discount subtracts: 150000 + 10000 - 5000 = 155000
      expect(Number(discountRes.body.total)).toBe(155000);

      // Remove the discount
      const discountItem = discountRes.body.lineItems.find(
        (li: any) => li.type === LineItemType.Descuento,
      );
      const removeRes = await request(app.getHttpServer())
        .delete(`/api/liquidaciones/${liquidacion.id}/line-items/${discountItem.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // Back to 160000
      expect(Number(removeRes.body.total)).toBe(160000);
    });
  });

  // ─── Payments ───────────────────────────────────────

  describe('Payments', () => {
    it('Register payment reduces remaining balance', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('pay-balance');

      // Transition to Enviada
      await transitionTo(user.accessToken, liquidacion.id, [
        LiquidacionStatus.Revision,
        LiquidacionStatus.Aprobada,
        LiquidacionStatus.Enviada,
      ]);

      const res = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/payments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: '50000.00',
          method: PaymentMethod.Transferencia,
          paidAt: new Date().toISOString(),
        })
        .expect(200);

      // Still Enviada (not fully paid)
      expect(res.body.status).toBe(LiquidacionStatus.Enviada);
      expect(res.body.payments).toHaveLength(1);
      expect(Number(res.body.payments[0].amount)).toBe(50000);
    });

    it('Full payment auto-transitions to Pagada', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('pay-full');

      await transitionTo(user.accessToken, liquidacion.id, [
        LiquidacionStatus.Revision,
        LiquidacionStatus.Aprobada,
        LiquidacionStatus.Enviada,
      ]);

      const res = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/payments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: '150000.00',
          method: PaymentMethod.Efectivo,
          paidAt: new Date().toISOString(),
        })
        .expect(200);

      expect(res.body.status).toBe(LiquidacionStatus.Pagada);
      expect(res.body.paidAt).toBeDefined();
    });

    it('Partial payment does NOT auto-transition (still Enviada)', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('pay-partial');

      await transitionTo(user.accessToken, liquidacion.id, [
        LiquidacionStatus.Revision,
        LiquidacionStatus.Aprobada,
        LiquidacionStatus.Enviada,
      ]);

      const res = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/payments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: '75000.00',
          method: PaymentMethod.MercadoPago,
          paidAt: new Date().toISOString(),
        })
        .expect(200);

      expect(res.body.status).toBe(LiquidacionStatus.Enviada);
      expect(res.body.payments).toHaveLength(1);
    });

    it('Multiple partial payments summing to total triggers auto-transition', async () => {
      const { user, liquidacion } = await setupFullLiquidacion('pay-multi');

      await transitionTo(user.accessToken, liquidacion.id, [
        LiquidacionStatus.Revision,
        LiquidacionStatus.Aprobada,
        LiquidacionStatus.Enviada,
      ]);

      // First partial payment: 50k
      const r1 = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/payments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: '50000.00',
          method: PaymentMethod.Transferencia,
          paidAt: new Date().toISOString(),
        })
        .expect(200);
      expect(r1.body.status).toBe(LiquidacionStatus.Enviada);

      // Second partial payment: 50k
      const r2 = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/payments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: '50000.00',
          method: PaymentMethod.Transferencia,
          paidAt: new Date().toISOString(),
        })
        .expect(200);
      expect(r2.body.status).toBe(LiquidacionStatus.Enviada);

      // Third partial payment: remaining 50k
      const r3 = await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liquidacion.id}/payments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: '50000.00',
          method: PaymentMethod.Transferencia,
          paidAt: new Date().toISOString(),
        })
        .expect(200);

      expect(r3.body.status).toBe(LiquidacionStatus.Pagada);
      expect(r3.body.paidAt).toBeDefined();
      expect(r3.body.payments).toHaveLength(3);
    });
  });
});
