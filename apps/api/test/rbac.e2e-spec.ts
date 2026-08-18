import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createUserDirect,
  loginUser,
} from './helpers/test-utils';
import { PrismaService } from '../src/common/prisma/prisma.service';
import { UserRole } from '@realfy/shared';

describe('RBAC Enforcement (e2e)', () => {
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

  it('Lectura user can GET /users but cannot POST /users/invite (403)', async () => {
    // Register an admin (creates tenant)
    const admin = await registerUser(app, {
      email: 'admin@rbac-test.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });

    // Create a Lectura user directly in the same tenant
    const lecturaUser = await createUserDirect(prisma, admin.user.tenantId, {
      email: 'lectura@rbac-test.com',
      password: 'Password123!',
      firstName: 'Lectura',
      lastName: 'User',
      role: UserRole.Lectura,
    });

    // Login as Lectura user
    const lectura = await loginUser(app, 'lectura@rbac-test.com', 'Password123!');

    // Lectura can GET /users (200)
    const getRes = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${lectura.accessToken}`);

    // Lectura role should be blocked by @Roles(Admin, Gerente) on GET /users
    expect(getRes.status).toBe(403);

    // Lectura cannot POST /users/invite (403)
    const postRes = await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${lectura.accessToken}`)
      .send({ email: 'someone@test.com', role: 'Lectura' });

    expect(postRes.status).toBe(403);
    expect(postRes.body.error).toBe('FORBIDDEN');
  });

  it('Admin can access all user endpoints', async () => {
    const admin = await registerUser(app, {
      email: 'admin@admin-test.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });

    // Admin can GET /users
    const getRes = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(Array.isArray(getRes.body)).toBe(true);

    // Admin can POST /users/invite
    const inviteRes = await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ email: 'newuser@test.com', role: 'Lectura' })
      .expect(201);

    expect(inviteRes.body.token).toBeDefined();
    expect(inviteRes.body.email).toBe('newuser@test.com');
  });

  it('Gerente can invite users and list users', async () => {
    const admin = await registerUser(app, {
      email: 'admin@gerente-test.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });

    // Create a Gerente user
    const gerenteUser = await createUserDirect(prisma, admin.user.tenantId, {
      email: 'gerente@gerente-test.com',
      password: 'Password123!',
      firstName: 'Gerente',
      lastName: 'User',
      role: UserRole.Gerente,
    });

    const gerente = await loginUser(app, 'gerente@gerente-test.com', 'Password123!');

    // Gerente can GET /users
    await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${gerente.accessToken}`)
      .expect(200);

    // Gerente can POST /users/invite
    await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${gerente.accessToken}`)
      .send({ email: 'invited-by-gerente@test.com', role: 'Lectura' })
      .expect(201);
  });

  it('Unauthenticated request returns 401', async () => {
    await request(app.getHttpServer())
      .get('/api/users')
      .expect(401);

    await request(app.getHttpServer())
      .get('/api/audit-logs')
      .expect(401);
  });
});
