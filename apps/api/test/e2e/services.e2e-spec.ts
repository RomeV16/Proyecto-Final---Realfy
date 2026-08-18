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
  ServiceType,
  PropertyType,
  Currency,
} from '@realfy/shared';

describe('Services (e2e)', () => {
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

  const servicePayload = {
    serviceType: ServiceType.Electricidad,
    providerName: 'EPEC',
    accountNumber: '123456789',
    amount: 15000,
    currency: Currency.ARS,
    dueDay: 15,
    notes: 'Servicio de electricidad',
  };

  // ─── CRUD ────────────────────────────────────────────

  describe('CRUD operations', () => {
    it('POST /services — creates a service linked to a property', async () => {
      const user = await registerUser(app, {
        email: 'admin@svc-create.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(user.accessToken);

      const res = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...servicePayload, propertyId: property.id })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.serviceType).toBe(ServiceType.Electricidad);
      expect(res.body.providerName).toBe('EPEC');
      expect(Number(res.body.amount)).toBe(15000);
      expect(res.body.property.id).toBe(property.id);
    });

    it('GET /services — lists services filtered by propertyId', async () => {
      const user = await registerUser(app, {
        email: 'admin@svc-list.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(user.accessToken);

      // Create two services
      await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...servicePayload, propertyId: property.id })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          ...servicePayload,
          serviceType: ServiceType.Gas,
          providerName: 'ECOGAS',
          propertyId: property.id,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/services')
        .query({ propertyId: property.id })
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
    });

    it('GET /services/:id — returns full detail with property and payments', async () => {
      const user = await registerUser(app, {
        email: 'admin@svc-detail.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(user.accessToken);

      const created = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...servicePayload, propertyId: property.id })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/services/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(created.body.id);
      expect(res.body.property).toBeDefined();
      expect(res.body.payments).toBeDefined();
      expect(Array.isArray(res.body.payments)).toBe(true);
    });

    it('PATCH /services/:id — updates service fields', async () => {
      const user = await registerUser(app, {
        email: 'admin@svc-update.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(user.accessToken);

      const created = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...servicePayload, propertyId: property.id })
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/services/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ amount: 25000, providerName: 'EPEC SA' })
        .expect(200);

      expect(Number(res.body.amount)).toBe(25000);
      expect(res.body.providerName).toBe('EPEC SA');
    });

    it('DELETE /services/:id — soft deletes (sets isActive=false)', async () => {
      const user = await registerUser(app, {
        email: 'admin@svc-delete.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(user.accessToken);

      const created = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...servicePayload, propertyId: property.id })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/services/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // Verify soft-deleted
      const detail = await request(app.getHttpServer())
        .get(`/api/services/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(detail.body.isActive).toBe(false);
    });
  });

  // ─── Tenant Isolation ────────────────────────────────

  describe('Tenant isolation', () => {
    it('user from tenant A cannot see services from tenant B', async () => {
      const userA = await registerUser(app, {
        email: 'admin@svc-tenant-a.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'A',
      });
      const propertyA = await createProperty(userA.accessToken);

      // Tenant A creates a service
      await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ ...servicePayload, propertyId: propertyA.id })
        .expect(201);

      // Tenant B registers separately
      const userB = await registerUser(app, {
        email: 'admin@svc-tenant-b.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      // Tenant B should see zero services
      const res = await request(app.getHttpServer())
        .get('/api/services')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('user from tenant B cannot get service by id from tenant A (404)', async () => {
      const userA = await registerUser(app, {
        email: 'admin@svc-iso-a.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'A',
      });
      const propertyA = await createProperty(userA.accessToken);

      const serviceA = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send({ ...servicePayload, propertyId: propertyA.id })
        .expect(201);

      const userB = await registerUser(app, {
        email: 'admin@svc-iso-b.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      await request(app.getHttpServer())
        .get(`/api/services/${serviceA.body.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });
  });

  // ─── RBAC ────────────────────────────────────────────

  describe('RBAC enforcement', () => {
    it('Lectura role can GET /services (200)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@svc-rbac-read.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura@svc-rbac-read.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@svc-rbac-read.com', 'Password123!');

      await request(app.getHttpServer())
        .get('/api/services')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(200);
    });

    it('Lectura role cannot POST /services (403)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@svc-rbac-create.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(admin.accessToken);

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura@svc-rbac-create.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@svc-rbac-create.com', 'Password123!');

      await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({ ...servicePayload, propertyId: property.id })
        .expect(403);
    });

    it('Ventas role can POST /services (201)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@svc-rbac-ventas.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(admin.accessToken);

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas@svc-rbac-ventas.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const ventas = await loginUser(app, 'ventas@svc-rbac-ventas.com', 'Password123!');

      const res = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({ ...servicePayload, propertyId: property.id })
        .expect(201);

      expect(res.body.id).toBeDefined();
    });

    it('Admin can DELETE /services (200)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@svc-rbac-delete.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(admin.accessToken);

      const created = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ ...servicePayload, propertyId: property.id })
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/services/${created.body.id}`)
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .expect(200);
    });

    it('Ventas role cannot DELETE /services (403)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@svc-rbac-ventas-del.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(admin.accessToken);

      const created = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send({ ...servicePayload, propertyId: property.id })
        .expect(201);

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas@svc-rbac-ventas-del.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const ventas = await loginUser(app, 'ventas@svc-rbac-ventas-del.com', 'Password123!');

      await request(app.getHttpServer())
        .delete(`/api/services/${created.body.id}`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(403);
    });
  });

  // ─── Property Linkage ────────────────────────────────

  describe('Property linkage', () => {
    it('Creating service with non-existent propertyId returns 404', async () => {
      const user = await registerUser(app, {
        email: 'admin@svc-noprop.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const res = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          ...servicePayload,
          propertyId: '00000000-0000-0000-0000-000000000000',
        })
        .expect(404);

      expect(res.body.error).toBe('PROPERTY_NOT_FOUND');
    });

    it('Creating service with invalid propertyId format returns 400', async () => {
      const user = await registerUser(app, {
        email: 'admin@svc-badprop.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const res = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...servicePayload, propertyId: 'not-a-uuid' })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Payment Registration ────────────────────────────

  describe('Payment registration', () => {
    it('POST /services/:id/payments — creates a payment record', async () => {
      const user = await registerUser(app, {
        email: 'admin@svc-pay.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      const property = await createProperty(user.accessToken);

      const service = await request(app.getHttpServer())
        .post('/api/services')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...servicePayload, propertyId: property.id })
        .expect(201);

      const res = await request(app.getHttpServer())
        .post(`/api/services/${service.body.id}/payments`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: 15000,
          paymentDate: '2026-03-15',
          period: '2026-03-01',
        })
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(Number(res.body.amount)).toBe(15000);
      expect(res.body.serviceId).toBe(service.body.id);
    });

    it('POST /services/:id/payments — rejects for non-existent service (404)', async () => {
      const user = await registerUser(app, {
        email: 'admin@svc-pay-404.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await request(app.getHttpServer())
        .post('/api/services/00000000-0000-0000-0000-000000000000/payments')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          amount: 15000,
          paymentDate: '2026-03-15',
          period: '2026-03-01',
        })
        .expect(404);
    });
  });
});
