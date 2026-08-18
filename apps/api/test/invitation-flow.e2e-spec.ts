import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  loginUser,
} from './helpers/test-utils';
import { PrismaService } from '../src/common/prisma/prisma.service';

describe('Invitation Flow (e2e)', () => {
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

  it('Full invitation flow: invite → accept → login → correct tenant + role', async () => {
    // Step 1: Register admin
    const admin = await registerUser(app, {
      email: 'admin@invite-test.com',
      password: 'Password123!',
      firstName: 'Invite',
      lastName: 'Admin',
    });

    // Step 2: Admin invites a user with Ventas role
    const inviteRes = await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ email: 'newuser@invite-test.com', role: 'Ventas' })
      .expect(201);

    expect(inviteRes.body.token).toBeDefined();
    expect(inviteRes.body.email).toBe('newuser@invite-test.com');
    expect(inviteRes.body.role).toBe('Ventas');
    expect(inviteRes.body.expiresAt).toBeDefined();

    // Step 3: Accept the invitation
    const acceptRes = await request(app.getHttpServer())
      .post('/api/users/accept-invitation')
      .send({
        token: inviteRes.body.token,
        password: 'NewUserPass123!',
        firstName: 'New',
        lastName: 'User',
      })
      .expect(201);

    expect(acceptRes.body.email).toBe('newuser@invite-test.com');
    expect(acceptRes.body.role).toBe('Ventas');
    expect(acceptRes.body.tenantId).toBe(admin.user.tenantId);

    // Step 4: New user can login
    const newUser = await loginUser(app, 'newuser@invite-test.com', 'NewUserPass123!');

    expect(newUser.accessToken).toBeDefined();
    expect(newUser.user.tenantId).toBe(admin.user.tenantId);
    expect(newUser.user.role).toBe('Ventas');

    // Step 5: Both users appear in the same tenant's user list
    const usersRes = await request(app.getHttpServer())
      .get('/api/users')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);

    expect(usersRes.body).toHaveLength(2);
    const emails = usersRes.body.map((u: any) => u.email).sort();
    expect(emails).toEqual(['admin@invite-test.com', 'newuser@invite-test.com']);
  });

  it('Cannot accept an expired invitation', async () => {
    const admin = await registerUser(app, {
      email: 'admin@expired-test.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });

    // Create invitation directly with expired date
    const invitation = await prisma.baseClient.userInvitation.create({
      data: {
        email: 'expired@test.com',
        role: 'Lectura',
        tenantId: admin.user.tenantId,
        invitedByUserId: admin.user.id,
        token: 'expired-token-123',
        expiresAt: new Date('2020-01-01'), // expired
      },
    });

    const res = await request(app.getHttpServer())
      .post('/api/users/accept-invitation')
      .send({
        token: 'expired-token-123',
        password: 'Password123!',
        firstName: 'Expired',
        lastName: 'User',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVITATION_EXPIRED');
  });

  it('Cannot accept an already-accepted invitation', async () => {
    const admin = await registerUser(app, {
      email: 'admin@double-accept.com',
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'User',
    });

    // Invite a user
    const inviteRes = await request(app.getHttpServer())
      .post('/api/users/invite')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({ email: 'double@test.com', role: 'Lectura' })
      .expect(201);

    // Accept the first time
    await request(app.getHttpServer())
      .post('/api/users/accept-invitation')
      .send({
        token: inviteRes.body.token,
        password: 'Password123!',
        firstName: 'Double',
        lastName: 'Accept',
      })
      .expect(201);

    // Try to accept again
    const secondRes = await request(app.getHttpServer())
      .post('/api/users/accept-invitation')
      .send({
        token: inviteRes.body.token,
        password: 'Password123!',
        firstName: 'Double',
        lastName: 'Accept',
      });

    expect(secondRes.status).toBe(400);
    expect(secondRes.body.error).toBe('INVITATION_ALREADY_ACCEPTED');
  });

  it('Cannot accept with invalid token', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/users/accept-invitation')
      .send({
        token: 'nonexistent-token',
        password: 'Password123!',
        firstName: 'Ghost',
        lastName: 'User',
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toBe('INVITATION_NOT_FOUND');
  });

  it('Refresh token rotation: login → refresh → old token rejected → new works', async () => {
    const admin = await registerUser(app, {
      email: 'admin@refresh-test.com',
      password: 'Password123!',
      firstName: 'Refresh',
      lastName: 'Admin',
    });

    // Login to get tokens
    const login = await loginUser(app, 'admin@refresh-test.com', 'Password123!');

    // Refresh with the refresh token
    const refreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: login.refreshToken })
      .expect(200);

    expect(refreshRes.body.tokens.accessToken).toBeDefined();
    expect(refreshRes.body.tokens.refreshToken).toBeDefined();
    expect(refreshRes.body.tokens.refreshToken).not.toBe(login.refreshToken);

    // New refresh token should work (test BEFORE trying old token,
    // since old token reuse triggers theft detection which revokes ALL tokens)
    const newRefreshRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: refreshRes.body.tokens.refreshToken })
      .expect(200);

    expect(newRefreshRes.body.tokens.accessToken).toBeDefined();
    expect(newRefreshRes.body.tokens.refreshToken).toBeDefined();

    // Old refresh token should now be rejected (after rotation)
    const oldTokenRes = await request(app.getHttpServer())
      .post('/api/auth/refresh')
      .send({ refreshToken: login.refreshToken });

    expect(oldTokenRes.status).toBe(401);
    expect(oldTokenRes.body.error).toBe('TOKEN_REVOKED');
  });
});
