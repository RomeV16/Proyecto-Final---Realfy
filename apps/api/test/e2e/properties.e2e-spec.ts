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
import { UserRole, PropertyType, PropertyOperationType, PropertyState } from '@realfy/shared';

describe('Properties (e2e)', () => {
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

  // ─── Helper ──────────────────────────────────────

  const createPropertyPayload = {
    title: 'Departamento en Palermo',
    type: PropertyType.Departamento,
    description: 'Luminoso 3 ambientes',
    street: 'Av. Santa Fe',
    number: '1234',
    city: 'Buenos Aires',
    province: 'CABA',
    area: 85,
    rooms: 3,
    bedrooms: 2,
    bathrooms: 1,
    price: 150000,
    currency: 'USD',
    amenities: ['balcón', 'parrilla'],
  };

  // ─── CRUD ────────────────────────────────────────

  describe('CRUD operations', () => {
    it('POST /properties — creates a property and returns 201', async () => {
      const user = await registerUser(app, {
        email: 'admin@crud-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const res = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.title).toBe(createPropertyPayload.title);
      expect(res.body.type).toBe(PropertyType.Departamento);
      expect(res.body.city).toBe('Buenos Aires');
    });

    it('GET /properties — lists properties with pagination', async () => {
      const user = await registerUser(app, {
        email: 'admin@list-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      // Create 2 properties
      await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...createPropertyPayload, title: 'Casa en Belgrano', type: PropertyType.Casa })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
    });

    it('GET /properties — filters by type', async () => {
      const user = await registerUser(app, {
        email: 'admin@filter-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...createPropertyPayload, title: 'Casa', type: PropertyType.Casa })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/properties')
        .query({ type: PropertyType.Casa })
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].type).toBe(PropertyType.Casa);
    });

    it('GET /properties/:id — returns full detail', async () => {
      const user = await registerUser(app, {
        email: 'admin@detail-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/properties/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(created.body.id);
      expect(res.body.operations).toBeDefined();
      expect(res.body.media).toBeDefined();
      expect(res.body.priceHistory).toBeDefined();
    });

    it('PATCH /properties/:id — updates a property', async () => {
      const user = await registerUser(app, {
        email: 'admin@update-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/properties/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ title: 'Updated Title', rooms: 4 })
        .expect(200);

      expect(res.body.title).toBe('Updated Title');
      expect(res.body.rooms).toBe(4);
    });

    it('DELETE /properties/:id — soft deletes (sets isActive=false)', async () => {
      const user = await registerUser(app, {
        email: 'admin@delete-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/properties/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // Verify soft-deleted
      const detail = await request(app.getHttpServer())
        .get(`/api/properties/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(detail.body.isActive).toBe(false);
    });
  });

  // ─── State Transitions ───────────────────────────

  describe('State transitions', () => {
    it('accepts valid state transition (Borrador → Disponible for Venta)', async () => {
      const user = await registerUser(app, {
        email: 'admin@state-valid-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      // Add Venta operation
      const opRes = await request(app.getHttpServer())
        .post(`/api/properties/${created.body.id}/operations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          operationType: PropertyOperationType.Venta,
          price: 200000,
          currency: 'USD',
        })
        .expect(201);

      expect(opRes.body.state).toBe(PropertyState.Borrador);

      // Transition Borrador → Disponible
      const transRes = await request(app.getHttpServer())
        .patch(`/api/properties/${created.body.id}/operations/${opRes.body.id}/state`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ toState: PropertyState.Disponible })
        .expect(200);

      expect(transRes.body.state).toBe(PropertyState.Disponible);
    });

    it('rejects invalid state transition with 400 and validTransitions', async () => {
      const user = await registerUser(app, {
        email: 'admin@state-invalid-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      // Add Venta operation
      const opRes = await request(app.getHttpServer())
        .post(`/api/properties/${created.body.id}/operations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ operationType: PropertyOperationType.Venta })
        .expect(201);

      // Try invalid transition: Borrador → Vendido (not allowed)
      const transRes = await request(app.getHttpServer())
        .patch(`/api/properties/${created.body.id}/operations/${opRes.body.id}/state`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ toState: PropertyState.Vendido })
        .expect(400);

      expect(transRes.body.error).toBe('INVALID_STATE_TRANSITION');
      expect(transRes.body.validTransitions).toBeDefined();
      expect(transRes.body.validTransitions).toContain(PropertyState.Disponible);
      expect(transRes.body.validTransitions).toContain(PropertyState.Archivado);
    });
  });

  // ─── Tenant Isolation ────────────────────────────

  describe('Tenant isolation', () => {
    it('user A cannot see user B properties (different tenants)', async () => {
      // Register two users in different tenants
      const userA = await registerUser(app, {
        email: 'admin@tenant-a.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'A',
      });

      const userB = await registerUser(app, {
        email: 'admin@tenant-b.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      // User A creates a property
      const propA = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      // User B creates a property
      await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ ...createPropertyPayload, title: 'Propiedad Tenant B' })
        .expect(201);

      // User B lists properties — should only see their own
      const listB = await request(app.getHttpServer())
        .get('/api/properties')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(listB.body.items).toHaveLength(1);
      expect(listB.body.items[0].title).toBe('Propiedad Tenant B');

      // User B cannot get User A's property by ID
      await request(app.getHttpServer())
        .get(`/api/properties/${propA.body.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });
  });

  // ─── RBAC ────────────────────────────────────────

  describe('RBAC enforcement', () => {
    it('Lectura role cannot create properties (403)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@rbac-prop-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      // Create a Lectura user in same tenant
      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura@rbac-prop-test.com',
        password: 'Password123!',
        firstName: 'Lectura',
        lastName: 'User',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@rbac-prop-test.com', 'Password123!');

      // Lectura cannot POST
      await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send(createPropertyPayload)
        .expect(403);

      // But Lectura CAN read (no @Roles on GET)
      await request(app.getHttpServer())
        .get('/api/properties')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(200);
    });

    it('Lectura role cannot delete properties (403)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@rbac-del-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      // Create a property as admin
      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      // Create and login as Lectura
      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura@rbac-del-test.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@rbac-del-test.com', 'Password123!');

      // Lectura cannot DELETE
      await request(app.getHttpServer())
        .delete(`/api/properties/${created.body.id}`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(403);
    });

    it('Ventas role can create and update properties', async () => {
      const admin = await registerUser(app, {
        email: 'admin@rbac-ventas-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas@rbac-ventas-test.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const ventas = await loginUser(app, 'ventas@rbac-ventas-test.com', 'Password123!');

      // Ventas can POST
      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      // Ventas can PATCH
      await request(app.getHttpServer())
        .patch(`/api/properties/${created.body.id}`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({ title: 'Updated by Ventas' })
        .expect(200);

      // Ventas CANNOT DELETE (Admin/Gerente only)
      await request(app.getHttpServer())
        .delete(`/api/properties/${created.body.id}`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(403);
    });
  });

  // ─── Price History ────────────────────────────────

  describe('Price history tracking', () => {
    it('creates PriceHistory on property creation with price', async () => {
      const user = await registerUser(app, {
        email: 'admin@price-create-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      const detail = await request(app.getHttpServer())
        .get(`/api/properties/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(detail.body.priceHistory).toHaveLength(1);
      expect(Number(detail.body.priceHistory[0].price)).toBe(150000);
    });

    it('creates PriceHistory on price change', async () => {
      const user = await registerUser(app, {
        email: 'admin@price-change-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      // Update price
      await request(app.getHttpServer())
        .patch(`/api/properties/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ price: 160000 })
        .expect(200);

      const detail = await request(app.getHttpServer())
        .get(`/api/properties/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // Should have 2 records: initial + update
      expect(detail.body.priceHistory).toHaveLength(2);
      expect(Number(detail.body.priceHistory[0].price)).toBe(160000); // most recent first
    });
  });

  // ─── Operations ──────────────────────────────────

  describe('Operations', () => {
    it('adds an operation to a property', async () => {
      const user = await registerUser(app, {
        email: 'admin@op-add-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      const opRes = await request(app.getHttpServer())
        .post(`/api/properties/${created.body.id}/operations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          operationType: PropertyOperationType.Alquiler,
          price: 800,
          currency: 'USD',
        })
        .expect(201);

      expect(opRes.body.operationType).toBe(PropertyOperationType.Alquiler);
      expect(opRes.body.state).toBe(PropertyState.Borrador);
    });

    it('rejects duplicate operation type on same property', async () => {
      const user = await registerUser(app, {
        email: 'admin@op-dup-test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/properties/${created.body.id}/operations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ operationType: PropertyOperationType.Venta })
        .expect(201);

      // Duplicate
      await request(app.getHttpServer())
        .post(`/api/properties/${created.body.id}/operations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ operationType: PropertyOperationType.Venta })
        .expect(400);
    });
  });
});
