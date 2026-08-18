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
import { UserRole, PersonRole } from '@realfy/shared';

describe('Persons (e2e)', () => {
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

  // ─── Helper ──────────────────────────────────────────

  const createPersonPayload = {
    firstName: 'Juan',
    lastName: 'Pérez',
    email: 'juan@test.com',
    phone: '+5411-1234-5678',
    cuit: '20-12345678-6', // valid CUIT
  };

  // ─── CRUD operations ────────────────────────────────

  describe('CRUD operations', () => {
    it('POST /persons — creates a person and returns 201', async () => {
      const user = await registerUser(app, {
        email: 'admin@crud-person.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const res = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      expect(res.body.id).toBeDefined();
      expect(res.body.firstName).toBe('Juan');
      expect(res.body.lastName).toBe('Pérez');
      expect(res.body.cuit).toBe('20-12345678-6');
    });

    it('GET /persons — lists persons with pagination', async () => {
      const user = await registerUser(app, {
        email: 'admin@list-person.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ ...createPersonPayload, firstName: 'María', lastName: 'García', email: 'maria@test.com', cuit: null })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(2);
      expect(res.body.total).toBe(2);
      expect(res.body.page).toBe(1);
    });

    it('GET /persons/:id — returns full detail with roles and documents', async () => {
      const user = await registerUser(app, {
        email: 'admin@detail-person.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      const res = await request(app.getHttpServer())
        .get(`/api/persons/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(res.body.id).toBe(created.body.id);
      expect(res.body.roles).toBeDefined();
      expect(res.body.documents).toBeDefined();
      expect(Array.isArray(res.body.roles)).toBe(true);
      expect(Array.isArray(res.body.documents)).toBe(true);
    });

    it('PATCH /persons/:id — updates person fields', async () => {
      const user = await registerUser(app, {
        email: 'admin@update-person.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      const res = await request(app.getHttpServer())
        .patch(`/api/persons/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ firstName: 'Carlos', phone: '+5411-9999-0000' })
        .expect(200);

      expect(res.body.firstName).toBe('Carlos');
      expect(res.body.phone).toBe('+5411-9999-0000');
    });

    it('DELETE /persons/:id — soft deletes (sets isActive=false)', async () => {
      const user = await registerUser(app, {
        email: 'admin@delete-person.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const created = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      await request(app.getHttpServer())
        .delete(`/api/persons/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // Verify soft-deleted — person still accessible but inactive
      const detail = await request(app.getHttpServer())
        .get(`/api/persons/${created.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(detail.body.isActive).toBe(false);
    });
  });

  // ─── Tenant Isolation ────────────────────────────────

  describe('Tenant isolation', () => {
    it('user A cannot see user B persons (different tenants)', async () => {
      const userA = await registerUser(app, {
        email: 'admin@tenant-a-person.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'A',
      });

      const userB = await registerUser(app, {
        email: 'admin@tenant-b-person.com',
        password: 'Password123!',
        firstName: 'Tenant',
        lastName: 'B',
      });

      // User A creates a person
      const personA = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${userA.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      // User B creates a person
      await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .send({ ...createPersonPayload, firstName: 'Persona', lastName: 'TenantB', email: 'b@test.com', cuit: null })
        .expect(201);

      // User B lists persons — should only see their own
      const listB = await request(app.getHttpServer())
        .get('/api/persons')
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(200);

      expect(listB.body.items).toHaveLength(1);
      expect(listB.body.items[0].lastName).toBe('TenantB');

      // User B cannot get User A's person by ID
      await request(app.getHttpServer())
        .get(`/api/persons/${personA.body.id}`)
        .set('Authorization', `Bearer ${userB.accessToken}`)
        .expect(404);
    });
  });

  // ─── RBAC ────────────────────────────────────────────

  describe('RBAC enforcement', () => {
    it('Lectura role cannot create persons (403)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@rbac-person-create.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura@rbac-person-create.com',
        password: 'Password123!',
        firstName: 'Lectura',
        lastName: 'User',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@rbac-person-create.com', 'Password123!');

      // Lectura cannot POST
      await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send(createPersonPayload)
        .expect(403);
    });

    it('Lectura role cannot update or delete persons (403)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@rbac-person-ud.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      // Create a person as admin
      const created = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${admin.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura@rbac-person-ud.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@rbac-person-ud.com', 'Password123!');

      // Lectura cannot PATCH
      await request(app.getHttpServer())
        .patch(`/api/persons/${created.body.id}`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .send({ firstName: 'Hacked' })
        .expect(403);

      // Lectura cannot DELETE
      await request(app.getHttpServer())
        .delete(`/api/persons/${created.body.id}`)
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(403);
    });

    it('Lectura role can read persons (200)', async () => {
      const admin = await registerUser(app, {
        email: 'admin@rbac-person-read.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'lectura@rbac-person-read.com',
        password: 'Password123!',
        role: UserRole.Lectura,
      });

      const lectura = await loginUser(app, 'lectura@rbac-person-read.com', 'Password123!');

      // Lectura CAN read
      await request(app.getHttpServer())
        .get('/api/persons')
        .set('Authorization', `Bearer ${lectura.accessToken}`)
        .expect(200);
    });

    it('Ventas role can create and update but not delete persons', async () => {
      const admin = await registerUser(app, {
        email: 'admin@rbac-person-ventas.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      await createUserDirect(prisma, admin.user.tenantId, {
        email: 'ventas@rbac-person-ventas.com',
        password: 'Password123!',
        role: UserRole.Ventas,
      });

      const ventas = await loginUser(app, 'ventas@rbac-person-ventas.com', 'Password123!');

      // Ventas can POST
      const created = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      // Ventas can PATCH
      await request(app.getHttpServer())
        .patch(`/api/persons/${created.body.id}`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .send({ firstName: 'Updated by Ventas' })
        .expect(200);

      // Ventas CANNOT DELETE (Admin/Gerente only)
      await request(app.getHttpServer())
        .delete(`/api/persons/${created.body.id}`)
        .set('Authorization', `Bearer ${ventas.accessToken}`)
        .expect(403);
    });
  });

  // ─── Multi-Role Assignment ───────────────────────────

  describe('Multi-role assignment', () => {
    it('assigns multiple roles to a person', async () => {
      const user = await registerUser(app, {
        email: 'admin@multi-role.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const person = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      // Assign Propietario
      await request(app.getHttpServer())
        .post(`/api/persons/${person.body.id}/roles`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ role: PersonRole.Propietario })
        .expect(201);

      // Assign Inquilino
      await request(app.getHttpServer())
        .post(`/api/persons/${person.body.id}/roles`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ role: PersonRole.Inquilino })
        .expect(201);

      // Verify both roles present
      const detail = await request(app.getHttpServer())
        .get(`/api/persons/${person.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(detail.body.roles).toHaveLength(2);
      const roleNames = detail.body.roles.map((r: any) => r.role).sort();
      expect(roleNames).toEqual([PersonRole.Inquilino, PersonRole.Propietario]);
    });

    it('rejects duplicate role assignment with 400 ROLE_ALREADY_ASSIGNED', async () => {
      const user = await registerUser(app, {
        email: 'admin@dup-role.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const person = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      // Assign Propietario first time
      await request(app.getHttpServer())
        .post(`/api/persons/${person.body.id}/roles`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ role: PersonRole.Propietario })
        .expect(201);

      // Duplicate assignment → 400
      const res = await request(app.getHttpServer())
        .post(`/api/persons/${person.body.id}/roles`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ role: PersonRole.Propietario })
        .expect(400);

      expect(res.body.error).toBe('ROLE_ALREADY_ASSIGNED');
    });

    it('removes one role without affecting the other', async () => {
      const user = await registerUser(app, {
        email: 'admin@remove-role.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const person = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send(createPersonPayload)
        .expect(201);

      // Assign two roles
      const role1 = await request(app.getHttpServer())
        .post(`/api/persons/${person.body.id}/roles`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ role: PersonRole.Propietario })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/api/persons/${person.body.id}/roles`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({ role: PersonRole.Inquilino })
        .expect(201);

      // Remove the first role
      await request(app.getHttpServer())
        .delete(`/api/persons/${person.body.id}/roles/${role1.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      // Verify only one role remains
      const detail = await request(app.getHttpServer())
        .get(`/api/persons/${person.body.id}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);

      expect(detail.body.roles).toHaveLength(1);
      expect(detail.body.roles[0].role).toBe(PersonRole.Inquilino);
    });
  });

  // ─── Search ──────────────────────────────────────────

  describe('Search', () => {
    let authToken: string;

    beforeEach(async () => {
      const user = await registerUser(app, {
        email: `admin@search-person-${Date.now()}.com`,
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });
      authToken = user.accessToken;

      // Create two persons for search tests
      await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: 'Juan',
          lastName: 'Pérez',
          cuit: '20-12345678-6',
        })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          firstName: 'María',
          lastName: 'García',
        })
        .expect(201);
    });

    it('finds person by first name (case insensitive)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/persons')
        .query({ search: 'juan' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].firstName).toBe('Juan');
    });

    it('finds person by last name (case insensitive, diacritics)', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/persons')
        .query({ search: 'PÉREZ' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].lastName).toBe('Pérez');
    });

    it('finds person by CUIT fragment', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/persons')
        .query({ search: '12345678' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].cuit).toBe('20-12345678-6');
    });

    it('finds person by last name with accented characters', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/persons')
        .query({ search: 'García' })
        .set('Authorization', `Bearer ${authToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0].lastName).toBe('García');
    });
  });

  // ─── CUIT Validation ─────────────────────────────────

  describe('CUIT validation', () => {
    it('rejects invalid CUIT check digit with 400 VALIDATION_ERROR', async () => {
      const user = await registerUser(app, {
        email: 'admin@cuit-validation.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'User',
      });

      const res = await request(app.getHttpServer())
        .post('/api/persons')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({
          firstName: 'Test',
          lastName: 'InvalidCuit',
          cuit: '20-12345678-0', // wrong check digit (should be 6)
        })
        .expect(400);

      expect(res.body.error).toBe('VALIDATION_ERROR');
    });
  });
});
