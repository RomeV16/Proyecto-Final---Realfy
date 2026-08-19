import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  PersonRole,
  ContractType,
  ContractStatus,
  PropertyType,
  AdjustmentType,
  AdjustmentPeriod,
  LiquidacionStatus,
  ServiceType,
  Currency,
} from '@realfy/shared';

describe('Dashboard (e2e)', () => {
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

    await request(app.getHttpServer())
      .post(`/api/persons/${personRes.body.id}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: overrides.role })
      .expect(201);

    return personRes.body;
  }

  async function createContractWithProperty(token: string, emailPrefix: string) {
    const property = await createProperty(token);

    const propietario = await createPersonWithRole(token, {
      firstName: 'Carlos',
      lastName: 'Prop',
      role: PersonRole.Propietario,
      email: `propietario-${emailPrefix}@test.com`,
    });

    const inquilino = await createPersonWithRole(token, {
      firstName: 'Ana',
      lastName: 'Inq',
      role: PersonRole.Inquilino,
      email: `inquilino-${emailPrefix}@test.com`,
    });

    const contractRes = await request(app.getHttpServer())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${token}`)
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
          { personId: propietario.id, role: PersonRole.Propietario },
          { personId: inquilino.id, role: PersonRole.Inquilino },
        ],
        guarantees: [],
      })
      .expect(201);

    return { property, contract: contractRes.body };
  }

  // ─── Dashboard Stats ─────────────────────────────────

  describe('GET /dashboard/stats', () => {
    it('returns zeros for an empty tenant', async () => {
      const user = await registerUser(app, {
        email: 'admin@dash-empty.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const res = await request(app.getHttpServer())
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.occupancyRate).toBe(0);
      expect(res.body.totalProperties).toBe(0);
      expect(res.body.activeContracts).toBe(0);
      expect(res.body.expiringContracts.within30).toBe(0);
      expect(res.body.expiringContracts.within60).toBe(0);
      expect(res.body.expiringContracts.within90).toBe(0);
      expect(res.body.collections.pagada).toBe(0);
      expect(res.body.collections.pendiente).toBe(0);
      expect(res.body.collections.vencida).toBe(0);
      expect(res.body.collections.total).toBe(0);
      expect(res.body.pendingLiquidaciones).toBe(0);
      expect(res.body.totalServices).toBe(0);
    });

    it('reflects correct totalProperties and activeContracts after creating data', async () => {
      const user = await registerUser(app, {
        email: 'admin@dash-counts.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createContractWithProperty(user.accessToken, 'dash-counts');

      const res = await request(app.getHttpServer())
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.totalProperties).toBe(1);
      expect(res.body.activeContracts).toBe(1);
    });

    it('pendingLiquidaciones cuenta lo que está a cobrar, no los borradores', async () => {
      const user = await registerUser(app, {
        email: 'admin@dash-liq.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createContractWithProperty(user.accessToken, 'dash-liq');

      await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(201);

      // Recién generada queda en Borrador: todavía no hay nada que cobrar.
      const draftRes = await request(app.getHttpServer())
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(draftRes.body.pendingLiquidaciones).toBe(0);

      const listRes = await request(app.getHttpServer())
        .get('/api/liquidaciones')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const liquidacionId = listRes.body.items[0].id;

      for (const status of ['Revision', 'Aprobada', 'Enviada']) {
        await request(app.getHttpServer())
          .post(`/api/liquidaciones/${liquidacionId}/transition`)
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ status })
          .expect(200);
      }

      // Enviada al inquilino: ahora sí entra en el pendiente de cobro.
      const sentRes = await request(app.getHttpServer())
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(sentRes.body.pendingLiquidaciones).toBeGreaterThanOrEqual(1);
    });

    it('totalServices reflects active service count', async () => {
      const user = await registerUser(app, {
        email: 'admin@dash-svc.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const property = await createProperty(user.accessToken);

      // Create two services
      await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          propertyId: property.id,
          serviceType: ServiceType.Electricidad,
          providerName: 'EPEC',
          amount: 15000,
          currency: Currency.ARS,
          dueDay: 15,
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          propertyId: property.id,
          serviceType: ServiceType.Gas,
          providerName: 'ECOGAS',
          amount: 8000,
          currency: Currency.ARS,
          dueDay: 20,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.totalServices).toBe(2);
    });

    it('collection aggregation correct after transitioning liquidación through statuses', async () => {
      const user = await registerUser(app, {
        email: 'admin@dash-coll.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createContractWithProperty(user.accessToken, 'dash-coll');

      const now = new Date();
      const month = now.getMonth() + 1; // current month for collection to show up
      const year = now.getFullYear();

      await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ month, year })
        .expect(201);

      // Get the liquidación
      const listRes = await request(app.getHttpServer())
        .get('/api/liquidaciones')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const liq = listRes.body.items[0];

      // Transition to Enviada (counts as pendiente in collections)
      await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liq.id}/transition`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: LiquidacionStatus.Revision })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liq.id}/transition`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: LiquidacionStatus.Aprobada })
        .expect(200);

      await request(app.getHttpServer())
        .post(`/api/liquidaciones/${liq.id}/transition`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ status: LiquidacionStatus.Enviada })
        .expect(200);

      const res = await request(app.getHttpServer())
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // total should be > 0 since we have a liquidación for current month
      expect(res.body.collections.total).toBeGreaterThan(0);
    });

    it('tenant isolation — dashboard stats scoped to own tenant', async () => {
      const userA = await registerUser(app, {
        email: 'admin@dash-iso-a.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'A',
      });

      await createContractWithProperty(userA.accessToken, 'dash-iso-a');

      // User B — different tenant, no data
      const userB = await registerUser(app, {
        email: 'admin@dash-iso-b.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      const resA = await request(app.getHttpServer())
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      const resB = await request(app.getHttpServer())
        .get('/api/dashboard/stats')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(resA.body.totalProperties).toBe(1);
      expect(resA.body.activeContracts).toBe(1);
      expect(resB.body.totalProperties).toBe(0);
      expect(resB.body.activeContracts).toBe(0);
    });
  });
  describe('GET /dashboard/occupancy-trend', () => {
    it('cuenta como ocupados los meses en que el contrato estuvo vigente', async () => {
      const user = await registerUser(app, {
        email: 'admin@occ-trend.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      await createContractWithProperty(user.accessToken, 'occ-trend');

      const res = await request(app.getHttpServer())
        .get('/api/dashboard/occupancy-trend?months=6')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body).toHaveLength(6);

      // El contrato del helper corre de 2025 a 2027, asi que cubre toda la
      // ventana: ningun mes puede dar cero. Con el calculo anterior, que
      // proyectaba el estado actual desde el alta del registro, los meses
      // previos al alta daban cero.
      const meses = res.body as Array<{ month: string; occupancyPct: number }>;
      for (const mes of meses) {
        expect(mes.occupancyPct).toBeGreaterThan(0);
      }
    });

    it('no cuenta un contrato que todavia no habia empezado', async () => {
      const user = await registerUser(app, {
        email: 'admin@occ-futuro.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(user.accessToken);

      const propietario = await createPersonWithRole(user.accessToken, {
        firstName: 'Futuro',
        lastName: 'Prop',
        role: PersonRole.Propietario,
        email: 'propietario-occ-futuro@test.com',
      });
      const inquilino = await createPersonWithRole(user.accessToken, {
        firstName: 'Futuro',
        lastName: 'Inq',
        role: PersonRole.Inquilino,
        email: 'inquilino-occ-futuro@test.com',
      });

      const enUnMes = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      const enUnAno = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);

      await request(app.getHttpServer())
        .post('/api/contracts')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          propertyId: property.id,
          contractType: ContractType.Alquiler,
          status: ContractStatus.Activo,
          startDate: enUnMes.toISOString(),
          endDate: enUnAno.toISOString(),
          rentAmount: '150000.00',
          rentCurrency: 'ARS',
          depositAmount: '300000.00',
          depositCurrency: 'ARS',
          adjustmentType: AdjustmentType.IPC,
          adjustmentPeriod: AdjustmentPeriod.Trimestral,
          persons: [
            { personId: propietario.id, role: PersonRole.Propietario },
            { personId: inquilino.id, role: PersonRole.Inquilino },
          ],
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/dashboard/occupancy-trend?months=3')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      for (const mes of res.body as Array<{ occupancyPct: number }>) {
        expect(mes.occupancyPct).toBe(0);
      }
    });
  });
});
