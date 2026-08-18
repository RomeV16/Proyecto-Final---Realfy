import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import {
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createUserDirect,
  loginUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { IndexScraperService } from '../../src/modules/index-data/index-scraper.service';
import {
  UserRole,
  IndexType,
  PersonRole,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  PropertyType,
} from '@realfy/shared';

describe('IndexData (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  // ─── Mock IndexScraperService so refresh tests never hit BCRA/INDEC ─────────

  const mockScraperService = {
    upsertAll: jest.fn().mockResolvedValue({ icl: 3, uva: 5, ipc: 2 }),
    fetchICL: jest.fn().mockResolvedValue([]),
    fetchUVA: jest.fn().mockResolvedValue([]),
    fetchIPC: jest.fn().mockResolvedValue([]),
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [(await import('../../src/app.module')).AppModule],
    })
      .overrideProvider(IndexScraperService)
      .useValue(mockScraperService)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    await app.init();

    prisma = moduleFixture.get(PrismaService);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    if (app) await app.close();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
    jest.clearAllMocks();
    mockScraperService.upsertAll.mockResolvedValue({ icl: 3, uva: 5, ipc: 2 });
  });

  // ─── CRUD ────────────────────────────────────────────

  describe('CRUD operations', () => {
    it('POST /index-data — creates an index data point as Admin', async () => {
      const admin = await registerUser(app, {
        email: 'admin@indexdata-create.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const res = await request(app.getHttpServer())
        .post('/api/index-data')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({
          indexType: IndexType.IPC,
          period: '2025-01-01T00:00:00.000Z',
          value: '5.200000',
          source: 'INDEC',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.indexType).toBe(IndexType.IPC);
      expect(res.body.source).toBe('INDEC');
    });

    it('GET /index-data — lists with type filter', async () => {
      const admin = await registerUser(app, {
        email: 'admin@indexdata-list.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await request(app.getHttpServer())
        .post('/api/index-data')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ indexType: IndexType.IPC, period: '2025-01-01T00:00:00.000Z', value: '5.200000' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/index-data')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ indexType: IndexType.ICL, period: '2025-01-01T00:00:00.000Z', value: '1250.500000' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/index-data')
        .query({ indexType: IndexType.IPC })
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].indexType).toBe(IndexType.IPC);
    });

    it('DELETE /index-data/:id — removes entry as Admin', async () => {
      const admin = await registerUser(app, {
        email: 'admin@indexdata-delete.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/index-data')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ indexType: IndexType.IPC, period: '2025-01-01T00:00:00.000Z', value: '5.200000' })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/index-data/${created.body.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      const listRes = await request(app.getHttpServer())
        .get('/api/index-data')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(listRes.body.items).toHaveLength(0);
    });
  });

  // ─── GET /index-data/latest ───────────────────────────

  describe('GET /index-data/latest', () => {
    it('returns current values for ICL/UVA/IPC as Admin', async () => {
      const admin = await registerUser(app, {
        email: 'admin@latest-admin.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const entries: [IndexType, string][] = [
        [IndexType.ICL, '1250.75'],
        [IndexType.UVA, '980.33'],
        [IndexType.IPC, '5.20'],
      ];
      for (const [type, value] of entries) {
        await request(app.getHttpServer())
          .post('/api/index-data')
          .set('Authorization', `Bearer ${admin.accessToken}`)
          .send({ indexType: type, period: '2025-03-01T00:00:00.000Z', value })
          .expect(201);
      }

      const res = await request(app.getHttpServer())
        .get('/api/index-data/latest')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      const types = res.body.map((r: any) => r.indexType);
      expect(types).toContain(IndexType.ICL);
      expect(types).toContain(IndexType.UVA);
      expect(types).toContain(IndexType.IPC);

      const iclEntry = res.body.find((r: any) => r.indexType === IndexType.ICL);
      expect(iclEntry.latest).not.toBeNull();
    });

    it('returns 200 as Gerente', async () => {
      const admin = await registerUser(app, {
        email: 'admin@latest-gerente-setup.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'gerente@latest-gerente.com',
        password: 'Password123!',
        role: UserRole.Gerente,
      });

      const gerente = await loginUser(app, 'gerente@latest-gerente.com', 'Password123!');

      await request(app.getHttpServer())
        .get('/api/index-data/latest')
        .set('Authorization', `Bearer ${gerente.accessToken}`)
        .expect(200);
    });

    it('returns 403 for Lectura role (insufficient privilege)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@latest-forbidden.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura@latest-forbidden.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@latest-forbidden.com', 'Password123!');

      await request(app.getHttpServer())
        .get('/api/index-data/latest')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(403);
    });
  });

  // ─── POST /index-data/refresh ─────────────────────────

  describe('POST /index-data/refresh', () => {
    it('returns 401 without auth token', async () => {
      await request(app.getHttpServer())
        .post('/api/index-data/refresh')
        .expect(401);
    });

    it('returns 403 as Gerente', async () => {
      const admin = await registerUser(app, {
        email: 'admin@refresh-gerente-setup.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'gerente@refresh-gerente.com',
        password: 'Password123!',
        role: UserRole.Gerente,
      });

      const gerente = await loginUser(app, 'gerente@refresh-gerente.com', 'Password123!');

      await request(app.getHttpServer())
        .post('/api/index-data/refresh')
        .set('Authorization', `Bearer ${gerente.accessToken}`)
        .expect(403);

      expect(mockScraperService.upsertAll).not.toHaveBeenCalled();
    });

    it('returns 201 as Admin and delegates to IndexScraperService.upsertAll', async () => {
      const admin = await registerUser(app, {
        email: 'admin@refresh-admin.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const res = await request(app.getHttpServer())
        .post('/api/index-data/refresh')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(201);

      expect(mockScraperService.upsertAll).toHaveBeenCalledTimes(1);
      expect(res.body.counts).toEqual({ icl: 3, uva: 5, ipc: 2 });
      expect(res.body.total).toBe(10);
    });

    it('after refresh, GET /index-data/latest still serves existing DB data', async () => {
      const admin = await registerUser(app, {
        email: 'admin@refresh-then-latest.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await request(app.getHttpServer())
        .post('/api/index-data')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ indexType: IndexType.ICL, period: '2025-01-01T00:00:00.000Z', value: '1000.00' })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/index-data/refresh')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/index-data/latest')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);

      const iclEntry = res.body.find((r: any) => r.indexType === IndexType.ICL);
      expect(iclEntry.latest).not.toBeNull();
      expect(Number(iclEntry.latest.value)).toBe(1000);
    });
  });

  // ─── POST /contracts/:id/preview-adjustment ──────────

  describe('POST /contracts/:id/preview-adjustment', () => {
    async function createProperty(token: string) {
      const res = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${token}`)
        .send({
          title: 'Depto Test',
          type: PropertyType.Departamento,
          street: 'Av. Corrientes',
          number: '1000',
          city: 'Buenos Aires',
          province: 'CABA',
          area: 60,
          rooms: 2,
          bedrooms: 1,
          bathrooms: 1,
          price: 100000,
          currency: 'USD',
        })
        .expect(201);
      return res.body;
    }

    async function createPerson(token: string, emailPrefix: string, role: PersonRole) {
      const personRes = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${token}`)
        .send({ firstName: 'Test', lastName: 'Person', email: `${emailPrefix}@test.com` })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/persons/${personRes.body.id}/roles`)
        .set('Authorization', `Bearer ${token}`)
        .send({ role })
        .expect(201);

      return personRes.body;
    }

    async function createContractWithIPC(emailPrefix: string) {
      const user = await registerUser(app, {
        email: `${emailPrefix}@test.com`,
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const property = await createProperty(user.accessToken);
      const propietario = await createPerson(
        user.accessToken,
        `prop-${emailPrefix}`,
        PersonRole.Propietario,
      );
      const inquilino = await createPerson(
        user.accessToken,
        `inq-${emailPrefix}`,
        PersonRole.Inquilino,
      );

      for (const [period, value] of [
        ['2025-01-01T00:00:00.000Z', '5.20'],
        ['2025-02-01T00:00:00.000Z', '4.80'],
        ['2025-03-01T00:00:00.000Z', '5.10'],
      ] as [string, string][]) {
        await request(app.getHttpServer())
          .post('/api/index-data')
          .set('Authorization', `Bearer ${user.accessToken}`)
          .send({ indexType: IndexType.IPC, period, value })
          .expect(201);
      }

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
          notes: 'Test contract',
          persons: [
            { personId: propietario.id, role: PersonRole.Propietario },
            { personId: inquilino.id, role: PersonRole.Inquilino },
          ],
          guarantees: [],
        })
        .expect(201);

      return { user, contract: contractRes.body };
    }

    it('returns projected values for a contract with IPC adjustment as Admin', async () => {
      const { user, contract } = await createContractWithIPC('preview-admin');

      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/preview-adjustment`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      expect(res.body.period).toBeDefined();
      expect(res.body.indexType).toBe(IndexType.IPC);
      expect(res.body.factor).toBeDefined();
      expect(res.body.currentRent).toBeDefined();
      expect(res.body.projectedRent).toBeDefined();
      expect(res.body.projectedDelta).toBeDefined();
      expect(Number(res.body.currentRent)).toBe(150000);
    });

    it('returns 201 as Gerente for own-tenant contract', async () => {
      const { user, contract } = await createContractWithIPC('preview-gerente-setup');

      await createUserDirect(prisma, user.user.tenantId, {
        email: 'gerente@preview-gerente.com',
        password: 'Password123!',
        role: UserRole.Gerente,
      });

      const gerente = await loginUser(app, 'gerente@preview-gerente.com', 'Password123!');

      const res = await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/preview-adjustment`)
        .set('Authorization', `Bearer ${gerente.accessToken}`)
        .expect(201);

      expect(res.body.currentRent).toBeDefined();
    });

    it('returns 403 for Lectura role (Inquilino-level access)', async () => {
      const { user, contract } = await createContractWithIPC('preview-lectura-setup');

      await createUserDirect(prisma, user.user.tenantId, {
        email: 'lectura@preview-lectura.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@preview-lectura.com', 'Password123!');

      await request(app.getHttpServer())
        .post(`/api/contracts/${contract.id}/preview-adjustment`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(403);
    });

    it('returns 404 for unknown contract id', async () => {
      const admin = await registerUser(app, {
        email: 'admin@preview-404.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await request(app.getHttpServer())
        .post('/api/contracts/00000000-0000-0000-0000-000000000000/preview-adjustment')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(404);
    });

    it('tenant isolation: tenant A cannot preview tenant B contract (404)', async () => {
      const { contract: contractB } = await createContractWithIPC('preview-tenant-b');

      const tenantA = await registerUser(app, {
        email: 'admin@preview-tenant-a.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'A',
      });

      await request(app.getHttpServer())
        .post(`/api/contracts/${contractB.id}/preview-adjustment`)
        .set('Authorization', `Bearer ${tenantA.accessToken}`)
        .expect(404);
    });
  });

  // ─── RBAC enforcement ────────────────────────────────

  describe('RBAC enforcement', () => {
    it('Ventas role cannot create index data (403, Admin only)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@indexdata-rbac-ventas.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas@indexdata-rbac.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const ventas = await loginUser(app, 'ventas@indexdata-rbac.com', 'Password123!');

      await request(app.getHttpServer())
        .post('/api/index-data')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({ indexType: IndexType.IPC, period: '2025-01-01T00:00:00.000Z', value: '5.200000' })
        .expect(403);
    });

    it('Lectura role can read index data list (200)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@indexdata-rbac-lectura.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await request(app.getHttpServer())
        .post('/api/index-data')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ indexType: IndexType.IPC, period: '2025-01-01T00:00:00.000Z', value: '5.200000' })
        .expect(201);

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura@indexdata-rbac.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@indexdata-rbac.com', 'Password123!');

      const res = await request(app.getHttpServer())
        .get('/api/index-data')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
    });
  });

  // ─── Tenant Isolation ────────────────────────────────

  describe('Tenant isolation', () => {
    it('Admin tenant 1 cannot see Admin tenant 2 index data', async () => {
      const admin1 = await registerUser(app, {
        email: 'admin1@indexdata-tenant.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'One',
      });

      const admin2 = await registerUser(app, {
        email: 'admin2@indexdata-tenant.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'Two',
      });

      await request(app.getHttpServer())
        .post('/api/index-data')
        .set('Authorization', `Bearer ${admin1.accessToken}`)
        .send({ indexType: IndexType.IPC, period: '2025-01-01T00:00:00.000Z', value: '5.200000' })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/index-data')
        .set('Authorization', `Bearer ${admin2.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });
  });
});
