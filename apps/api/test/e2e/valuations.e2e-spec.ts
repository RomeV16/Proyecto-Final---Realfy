import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { PropertyType, ValuationMethod, Currency } from '@realfy/shared';

describe('Valuations (e2e)', () => {
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

  // ─── Helpers ─────────────────────────────────────────

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

  const createValuationPayload = {
    valuationDate: '2025-06-15',
    value: 180000,
    currency: Currency.USD,
    method: ValuationMethod.Comparativo,
    appraiser: 'Tasador Juan Pérez',
    notes: 'Valuación de referencia',
  };

  async function createAuthenticatedUser(emailPrefix: string) {
    return registerUser(app, {
      email: `${emailPrefix}@val-test.com`,
      password: 'Password123!',
      firstName: 'Test',
      lastName: 'User',
    });
  }

  async function createPropertyForUser(token: string) {
    const res = await request(app.getHttpServer())
      .post('/api/properties')
      .set('Authorization', `Bearer ${token}`)
      .send(createPropertyPayload)
      .expect(201);
    return res.body;
  }

  // ─── CRUD ────────────────────────────────────────────

  describe('CRUD operations', () => {
    it('POST /properties/:id/valuations — creates a valuation', async () => {
      const user = await createAuthenticatedUser('crud-create');
      const property = await createPropertyForUser(user.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/api/properties/${property.id}/valuations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createValuationPayload)
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(Number(res.body.value)).toBe(180000);
      expect(res.body.method).toBe(ValuationMethod.Comparativo);
      expect(res.body.appraiser).toBe('Tasador Juan Pérez');
      expect(res.body.propertyId).toBe(property.id);
    });

    it('GET /properties/:id/valuations — lists valuations with pagination', async () => {
      const user = await createAuthenticatedUser('crud-list');
      const property = await createPropertyForUser(user.accessToken);

      // Create two valuations
      await request(app.getHttpServer())
        .post(`/api/properties/${property.id}/valuations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createValuationPayload)
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/properties/${property.id}/valuations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          ...createValuationPayload,
          value: 200000,
          method: ValuationMethod.Costo,
          valuationDate: '2025-07-01',
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/properties/${property.id}/valuations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
    });

    it('GET /properties/:id/valuations/:valuationId — returns detail', async () => {
      const user = await createAuthenticatedUser('crud-detail');
      const property = await createPropertyForUser(user.accessToken);

      const created = await request(app.getHttpServer())
        .post(`/api/properties/${property.id}/valuations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createValuationPayload)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/properties/${property.id}/valuations/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(created.body.id);
      expect(Number(res.body.value)).toBe(180000);
    });

    it('PATCH /properties/:id/valuations/:valuationId — updates a valuation', async () => {
      const user = await createAuthenticatedUser('crud-update');
      const property = await createPropertyForUser(user.accessToken);

      const created = await request(app.getHttpServer())
        .post(`/api/properties/${property.id}/valuations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createValuationPayload)
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/properties/${property.id}/valuations/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ value: 195000, notes: 'Actualizado' })
        .expect(200);

      expect(Number(res.body.value)).toBe(195000);
      expect(res.body.notes).toBe('Actualizado');
    });

    it('DELETE /properties/:id/valuations/:valuationId — deletes a valuation', async () => {
      const user = await createAuthenticatedUser('crud-delete');
      const property = await createPropertyForUser(user.accessToken);

      const created = await request(app.getHttpServer())
        .post(`/api/properties/${property.id}/valuations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createValuationPayload)
        .expect(201);

      const res = await request(app.getHttpServer())
        .delete(`/api/properties/${property.id}/valuations/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.deleted).toBe(true);

      // Verify gone
      await request(app.getHttpServer())
        .get(`/api/properties/${property.id}/valuations/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });

    it('returns 404 for non-existent valuation', async () => {
      const user = await createAuthenticatedUser('crud-404');
      const property = await createPropertyForUser(user.accessToken);

      await request(app.getHttpServer())
        .get(`/api/properties/${property.id}/valuations/00000000-0000-0000-0000-000000000000`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
    });

    it('returns 400 for invalid valuation data', async () => {
      const user = await createAuthenticatedUser('crud-invalid');
      const property = await createPropertyForUser(user.accessToken);

      const res = await request(app.getHttpServer())
        .post(`/api/properties/${property.id}/valuations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ value: -100 }) // missing required fields, negative value
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });

  // ─── Comparable Properties ───────────────────────────

  describe('Comparable properties', () => {
    it('GET /properties/:id/valuations/comparables — returns similar properties', async () => {
      const user = await createAuthenticatedUser('comp-basic');
      const property = await createPropertyForUser(user.accessToken);

      // Create a comparable property: same city, same type, similar rooms
      const comp = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          ...createPropertyPayload,
          title: 'Otro depto en Palermo',
          rooms: 3,
        })
        .expect(201);

      // Create a non-comparable property: different type
      await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          ...createPropertyPayload,
          title: 'Casa en Buenos Aires',
          type: PropertyType.Casa,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/properties/${property.id}/valuations/comparables`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(Array.isArray(res.body)).toBe(true);
      // Should find the comparable depto but not the Casa
      const ids = res.body.map((c: any) => c.id);
      expect(ids).toContain(comp.body.id);
      // The original property should NOT be in comparables
      expect(ids).not.toContain(property.id);
    });

    it('comparables include latestValuation when available', async () => {
      const user = await createAuthenticatedUser('comp-val');
      const property = await createPropertyForUser(user.accessToken);

      // Create comparable and add a valuation to it
      const comp = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...createPropertyPayload, title: 'Comparable con tasación' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/properties/${comp.body.id}/valuations`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createValuationPayload)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/properties/${property.id}/valuations/comparables`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      const found = res.body.find((c: any) => c.id === comp.body.id);
      expect(found).toBeDefined();
      expect(found.latestValuation).not.toBeNull();
      expect(Number(found.latestValuation.value)).toBe(180000);
    });

    it('returns empty array when no comparables exist', async () => {
      const user = await createAuthenticatedUser('comp-empty');

      // Create a unique property with no comparables
      const property = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          ...createPropertyPayload,
          type: PropertyType.Campo,
          city: 'Tandil',
          rooms: 10,
        })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/properties/${property.body.id}/valuations/comparables`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body).toEqual([]);
    });
  });

  // ─── Tenant Isolation ────────────────────────────────

  describe('Tenant isolation', () => {
    it('tenant A cannot see tenant B valuations', async () => {
      const userA = await registerUser(app, {
        email: 'admin@val-tenant-a.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'A',
      });

      const userB = await registerUser(app, {
        email: 'admin@val-tenant-b.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      // User A creates property + valuation
      const propA = await createPropertyForUser(userA.accessToken);

      await request(app.getHttpServer())
        .post(`/api/properties/${propA.id}/valuations`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send(createValuationPayload)
        .expect(201);

      // User B creates their own property
      const propB = await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ ...createPropertyPayload, title: 'Prop B' })
        .expect(201);

      // User B cannot access tenant A's property's valuations (404 — property not found in their scope)
      await request(app.getHttpServer())
        .get(`/api/properties/${propA.id}/valuations`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);

      // User B's property has no valuations
      const res = await request(app.getHttpServer())
        .get(`/api/properties/${propB.body.id}/valuations`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(0);
    });

    it('tenant A comparables do not include tenant B properties', async () => {
      const userA = await registerUser(app, {
        email: 'admin@comp-iso-a.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'A',
      });

      const userB = await registerUser(app, {
        email: 'admin@comp-iso-b.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      // Both create properties with same city/type/rooms
      const propA = await createPropertyForUser(userA.accessToken);

      await request(app.getHttpServer())
        .post('/api/properties')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send(createPropertyPayload)
        .expect(201);

      // Tenant A sees only their own comparables (or none if only one property)
      const res = await request(app.getHttpServer())
        .get(`/api/properties/${propA.id}/valuations/comparables`)
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .expect(200);

      // Comparables should not include properties from other tenants
      for (const comp of res.body) {
        // Each comparable should be accessible by user A (same tenant)
        const detail = await request(app.getHttpServer())
          .get(`/api/properties/${comp.id}`)
          .set('Authorization', `Bearer ${userA.accessToken}`)
          .expect(200);
        expect(detail.body.id).toBe(comp.id);
      }
    });
  });
});
