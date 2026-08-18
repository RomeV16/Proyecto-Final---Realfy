import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createPortalInvitation,
  portalSetPassword,
  portalLogin,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  PersonRole,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  PropertyType,
} from '@realfy/shared';

describe('Portal Auth (e2e)', () => {
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
   * Register staff user, create a person (inquilino), and return all context.
   */
  async function setupInquilino(emailPrefix: string) {
    const staff = await registerUser(app, {
      email: `${emailPrefix}-staff@test.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Staff',
    });

    // Create a person (inquilino)
    const personRes = await request(app.getHttpServer())
      .post('/api/persons')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({
        firstName: 'Ana',
        lastName: 'Inquilina',
        email: `${emailPrefix}-inquilino@test.com`,
      })
      .expect(201);

    // Assign Inquilino role
    await request(app.getHttpServer())
      .post(`/api/persons/${personRes.body.id}/roles`)
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({ role: PersonRole.Inquilino })
      .expect(201);

    return {
      staff,
      person: personRes.body,
      inquilinoEmail: `${emailPrefix}-inquilino@test.com`,
    };
  }

  /**
   * Full setup: create inquilino + invitation + set-password → logged-in portal user.
   */
  async function setupPortalUser(emailPrefix: string) {
    const setup = await setupInquilino(emailPrefix);

    const invitation = await createPortalInvitation(
      app,
      setup.staff.accessToken,
      setup.person.id,
    );

    const passwordResult = await portalSetPassword(
      app,
      invitation.token,
      'PortalPass123!',
    );

    return {
      ...setup,
      invitation,
      portalTokens: passwordResult.tokens,
    };
  }

  // ─── Invite Flow ────────────────────────────────────

  describe('Invite flow', () => {
    it('POST /persons/:id/portal-invite creates invitation with token', async () => {
      const { staff, person } = await setupInquilino('invite-basic');

      const invitation = await createPortalInvitation(
        app,
        staff.accessToken,
        person.id,
      );

      expect(invitation.id).toBeDefined();
      expect(invitation.token).toBeDefined();
      expect(invitation.personId).toBe(person.id);
      expect(invitation.expiresAt).toBeDefined();
    });
  });

  // ─── Set Password ───────────────────────────────────

  describe('Set password', () => {
    it('set-password with valid invitation token succeeds', async () => {
      const { staff, person } = await setupInquilino('setpw-valid');

      const invitation = await createPortalInvitation(
        app,
        staff.accessToken,
        person.id,
      );

      const result = await portalSetPassword(
        app,
        invitation.token,
        'MyPortalPass1!',
      );

      expect(result.person.id).toBe(person.id);
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });

    it('set-password with expired token fails', async () => {
      const { staff, person } = await setupInquilino('setpw-expired');

      const invitation = await createPortalInvitation(
        app,
        staff.accessToken,
        person.id,
      );

      // Expire the invitation directly in DB
      await prisma.baseClient.portalInvitation.update({
        where: { id: invitation.id },
        data: { expiresAt: new Date('2020-01-01') },
      });

      const res = await request(app.getHttpServer())
        .post('/api/portal/auth/set-password')
        .send({ token: invitation.token, password: 'MyPortalPass1!' })
        .expect(400);

      expect(res.body.error).toBe('INVITATION_EXPIRED');
    });

    it('set-password with already-used token fails', async () => {
      const { staff, person } = await setupInquilino('setpw-used');

      const invitation = await createPortalInvitation(
        app,
        staff.accessToken,
        person.id,
      );

      // First use succeeds
      await portalSetPassword(app, invitation.token, 'MyPortalPass1!');

      // Second use fails
      const res = await request(app.getHttpServer())
        .post('/api/portal/auth/set-password')
        .send({ token: invitation.token, password: 'MyPortalPass2!' })
        .expect(400);

      expect(res.body.error).toBe('INVITATION_ALREADY_ACCEPTED');
    });

    it('set-password with invalid (non-existent) token fails', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/portal/auth/set-password')
        .send({ token: 'non-existent-token', password: 'MyPortalPass1!' })
        .expect(400);

      expect(res.body.error).toBe('INVITATION_INVALID');
    });
  });

  // ─── Login ──────────────────────────────────────────

  describe('Login', () => {
    it('login with correct credentials succeeds', async () => {
      const setup = await setupPortalUser('login-ok');

      const result = await portalLogin(
        app,
        setup.inquilinoEmail,
        'PortalPass123!',
      );

      expect(result.person.id).toBe(setup.person.id);
      expect(result.person.email).toBe(setup.inquilinoEmail);
      expect(result.tokens.accessToken).toBeDefined();
      expect(result.tokens.refreshToken).toBeDefined();
    });

    it('login with wrong password fails', async () => {
      await setupPortalUser('login-wrongpw');

      const res = await request(app.getHttpServer())
        .post('/api/portal/auth/login')
        .send({
          email: 'login-wrongpw-inquilino@test.com',
          password: 'WrongPassword!',
        })
        .expect(401);

      expect(res.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('login with non-existent email fails', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/portal/auth/login')
        .send({
          email: 'nobody@test.com',
          password: 'Password123!',
        })
        .expect(401);

      expect(res.body.error).toBe('INVALID_CREDENTIALS');
    });

    it('login with deactivated credential fails', async () => {
      const setup = await setupPortalUser('login-deactivated');

      // Deactivate the credential
      await prisma.baseClient.inquilinoCredential.updateMany({
        where: { personId: setup.person.id },
        data: { isActive: false },
      });

      const res = await request(app.getHttpServer())
        .post('/api/portal/auth/login')
        .send({
          email: setup.inquilinoEmail,
          password: 'PortalPass123!',
        })
        .expect(401);

      expect(res.body.error).toBe('INVALID_CREDENTIALS');
    });
  });

  // ─── Token Refresh ──────────────────────────────────

  describe('Token refresh', () => {
    it('refresh with valid token returns new tokens (rotation)', async () => {
      const setup = await setupPortalUser('refresh-ok');

      const res = await request(app.getHttpServer())
        .post('/api/portal/auth/refresh')
        .send({ refreshToken: setup.portalTokens.refreshToken })
        .expect(200);

      expect(res.body.accessToken).toBeDefined();
      expect(res.body.refreshToken).toBeDefined();
      // New refresh token should differ (rotation)
      expect(res.body.refreshToken).not.toBe(setup.portalTokens.refreshToken);
    });

    it('refresh with already-used (rotated) token revokes all tokens (theft detection)', async () => {
      const setup = await setupPortalUser('refresh-revoked');

      // First refresh succeeds
      const firstRefresh = await request(app.getHttpServer())
        .post('/api/portal/auth/refresh')
        .send({ refreshToken: setup.portalTokens.refreshToken })
        .expect(200);

      // Second attempt with OLD token — triggers revocation
      const res = await request(app.getHttpServer())
        .post('/api/portal/auth/refresh')
        .send({ refreshToken: setup.portalTokens.refreshToken })
        .expect(401);

      expect(res.body.error).toBe('TOKEN_REVOKED');

      // The new token from first refresh should ALSO be revoked now
      const res2 = await request(app.getHttpServer())
        .post('/api/portal/auth/refresh')
        .send({ refreshToken: firstRefresh.body.refreshToken })
        .expect(401);

      // All tokens revoked — so it could be TOKEN_REVOKED or TOKEN_INVALID
      expect(['TOKEN_REVOKED', 'TOKEN_INVALID']).toContain(res2.body.error);
    });

    it('refresh with non-existent token fails', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/portal/auth/refresh')
        .send({ refreshToken: 'non-existent-token-uuid' })
        .expect(401);

      expect(res.body.error).toBe('TOKEN_INVALID');
    });
  });

  // ─── Logout ─────────────────────────────────────────

  describe('Logout', () => {
    it('logout revokes all portal refresh tokens', async () => {
      const setup = await setupPortalUser('logout-ok');

      // Login again to get a fresh set of tokens
      const loginResult = await portalLogin(
        app,
        setup.inquilinoEmail,
        'PortalPass123!',
      );

      // Logout with the fresh access token
      await request(app.getHttpServer())
        .post('/api/portal/auth/logout')
        .set('Authorization', `Bearer ${loginResult.tokens.accessToken}`)
        .expect(200);

      // Try to refresh with either token — should fail
      const res = await request(app.getHttpServer())
        .post('/api/portal/auth/refresh')
        .send({ refreshToken: loginResult.tokens.refreshToken })
        .expect(401);

      expect(res.body.error).toBe('TOKEN_REVOKED');
    });
  });

  // ─── Token Isolation ────────────────────────────────

  describe('Token isolation', () => {
    it('portal token is rejected on staff endpoint', async () => {
      const setup = await setupPortalUser('iso-portal-on-staff');

      await request(app.getHttpServer())
        .get('/api/persons')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(401);
    });

    it('staff token is rejected on portal endpoint', async () => {
      const setup = await setupPortalUser('iso-staff-on-portal');

      // Use the staff access token on a portal data endpoint
      // Returns 403 (authenticated but not a portal user)
      const res = await request(app.getHttpServer())
        .get('/api/portal/contract')
        .set('Authorization', `Bearer ${setup.staff.accessToken}`);

      expect([401, 403]).toContain(res.status);
    });

    it('no token is rejected on portal endpoint', async () => {
      const res = await request(app.getHttpServer())
        .get('/api/portal/contract');

      expect([401, 403]).toContain(res.status);

      expect(res.body.error).toBe('PORTAL_UNAUTHORIZED');
    });
  });
});
