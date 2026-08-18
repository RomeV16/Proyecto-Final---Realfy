import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
} from './helpers/test-utils';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Cross-Tenant Isolation (e2e)', () => {
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

  it('User in Tenant 1 cannot see Tenant 2 users', async () => {
    // Register two users — each gets their own tenant
    const t1Admin = await registerUser(app, {
      email: 'admin1@tenant1.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'One',
    });

    const t2Admin = await registerUser(app, {
      email: 'admin2@tenant2.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Two',
    });

    // T1 admin invites a user in their tenant
    await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${t1Admin.accessToken}`)
      .send({ email: 'invited@tenant1.com', role: 'Lectura' })
      .expect(201);

    // T2 admin lists users — should see only themselves (1 user)
    const t2UsersRes = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${t2Admin.accessToken}`)
      .expect(200);

    expect(t2UsersRes.body).toHaveLength(1);
    expect(t2UsersRes.body[0].email).toBe('admin2@tenant2.com');

    // T1 admin lists users — should see only themselves (1 user, invitation not yet accepted)
    const t1UsersRes = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${t1Admin.accessToken}`)
      .expect(200);

    expect(t1UsersRes.body).toHaveLength(1);
    expect(t1UsersRes.body[0].email).toBe('admin1@tenant1.com');
  });

  it('Tenant 2 admin cannot update Tenant 1 branding', async () => {
    const t1Admin = await registerUser(app, {
      email: 'admin1@iso.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'One',
    });

    const t2Admin = await registerUser(app, {
      email: 'admin2@iso.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Two',
    });

    // T2 admin tries to update T1's tenant
    const res = await request(app.getHttpServer())
      .patch(`/api/tenants/${t1Admin.user.tenantId}`)
      .set('Authorization', `Bearer ${t2Admin.accessToken}`)
      .send({ brandPrimary: '#ff0000' });

    // Should get 403 because it's not their tenant
    expect(res.status).toBe(403);
  });

  it('GET /tenants/me returns only own tenant', async () => {
    const t1Admin = await registerUser(app, {
      email: 'admin1@me-test.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'One',
    });

    const t2Admin = await registerUser(app, {
      email: 'admin2@me-test.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Two',
    });

    const t1TenantRes = await request(app.getHttpServer())
      .get('/api/tenants/me')
      .set('Authorization', `Bearer ${t1Admin.accessToken}`)
      .expect(200);

    const t2TenantRes = await request(app.getHttpServer())
      .get('/api/tenants/me')
      .set('Authorization', `Bearer ${t2Admin.accessToken}`)
      .expect(200);

    expect(t1TenantRes.body.id).toBe(t1Admin.user.tenantId);
    expect(t2TenantRes.body.id).toBe(t2Admin.user.tenantId);
    expect(t1TenantRes.body.id).not.toBe(t2TenantRes.body.id);
  });
});
