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
import { hashToken } from '../../src/common/auth/one-time-token';
import { UserRole } from '@realfy/shared';

const PASSWORD = 'Password123!';

describe('Usuarios, invitaciones y contraseña (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

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

  /** Admin de una inmobiliaria más uno de cada otro rol, ya con sesión. */
  async function team(prefix: string) {
    const admin = await registerUser(app, {
      email: `admin@${prefix}.com`,
      password: PASSWORD,
      firstName: 'Admin',
      lastName: prefix,
    });
    const sessions: Record<string, { accessToken: string; refreshToken: string; user: any }> = {};
    for (const role of [UserRole.Gerente, UserRole.Ventas, UserRole.Lectura]) {
      await createUserDirect(prisma, admin.user.tenantId, {
        email: `${role.toLowerCase()}@${prefix}.com`,
        password: PASSWORD,
        role,
      });
      sessions[role] = await loginUser(app, `${role.toLowerCase()}@${prefix}.com`, PASSWORD);
    }
    return { admin, ...sessions } as {
      admin: typeof admin;
      Gerente: (typeof sessions)[string];
      Ventas: (typeof sessions)[string];
      Lectura: (typeof sessions)[string];
    };
  }

  function invite(token: string, email: string, role = 'Ventas') {
    return http().post('/api/users/invite').set(auth(token)).send({ email, role });
  }

  async function waitForAudit(where: Record<string, unknown>, min = 1) {
    for (let i = 0; i < 40; i++) {
      const rows = await prisma.baseClient.auditLog.findMany({ where: where as any });
      if (rows.length >= min) return rows;
      await new Promise((r) => setTimeout(r, 50));
    }
    return prisma.baseClient.auditLog.findMany({ where: where as any });
  }

  // ─── Invitaciones ─────────────────────────────────────────────────────────

  describe('invitar (CP-100)', () => {
    it('el Admin recibe token y enlace; en base queda solo el hash', async () => {
      const t = await team('inv1');
      const res = await invite(t.admin.accessToken, 'nuevo@inv1.com', 'Gerente').expect(201);

      expect(Buffer.from(res.body.token, 'base64url').length).toBeGreaterThanOrEqual(32);
      expect(res.body.link).toContain(`/auth/accept-invitation?token=${encodeURIComponent(res.body.token)}`);
      expect(res.body.emailSent).toBe(false);
      const days = (new Date(res.body.expiresAt).getTime() - Date.now()) / 86400000;
      expect(days).toBeGreaterThan(6.9);
      expect(days).toBeLessThanOrEqual(7);

      const row = await prisma.baseClient.userInvitation.findFirst({ where: { email: 'nuevo@inv1.com' } });
      expect(row!.token).toBe(hashToken(res.body.token));
      expect(row!.token).not.toBe(res.body.token);
      expect(row!.role).toBe('Gerente');
      expect(row!.tenantId).toBe(t.admin.user.tenantId);
    });

    it.each(['Gerente', 'Ventas', 'Lectura'] as const)('%s no puede invitar (403)', async (role) => {
      const t = await team(`inv-${role.toLowerCase()}`);
      await invite(t[role].accessToken, 'x@example.com').expect(403);
    });

    it('rechaza un usuario existente, una invitación vigente y datos inválidos', async () => {
      const t = await team('inv2');
      const dup = await invite(t.admin.accessToken, 'ventas@inv2.com').expect(400);
      expect(dup.body.error).toBe('USER_ALREADY_EXISTS');

      await invite(t.admin.accessToken, 'otro@inv2.com').expect(201);
      const pending = await invite(t.admin.accessToken, 'OTRO@inv2.com').expect(409);
      expect(pending.body.error).toBe('INVITATION_ALREADY_PENDING');

      await invite(t.admin.accessToken, 'no-es-correo').expect(400);
      await invite(t.admin.accessToken, 'ok@inv2.com', 'Rey').expect(400);
    });

    it('sin sesión, 401', async () => {
      await http().post('/api/users/invite').send({ email: 'a@b.com', role: 'Ventas' }).expect(401);
    });
  });

  describe('aceptar y reenviar (CP-101)', () => {
    it('acepta una sola vez y el rol queda asignado desde la invitación', async () => {
      const t = await team('acc1');
      const inv = await invite(t.admin.accessToken, 'nuevo@acc1.com', 'Liquidaciones').expect(201);
      const body = { token: inv.body.token, password: 'NuevaClave123', firstName: 'Nu', lastName: 'Evo' };

      const ok = await http().post('/api/users/accept-invitation').send(body).expect(201);
      expect(ok.body).toMatchObject({ email: 'nuevo@acc1.com', role: 'Liquidaciones', tenantId: t.admin.user.tenantId });
      expect(ok.body.passwordHash).toBeUndefined();

      const again = await http().post('/api/users/accept-invitation').send(body).expect(400);
      expect(again.body.error).toBe('INVITATION_ALREADY_ACCEPTED');

      const session = await loginUser(app, 'nuevo@acc1.com', 'NuevaClave123');
      expect(session.user.role).toBe('Liquidaciones');
    });

    it('rechaza contraseña corta, token inexistente y vencido', async () => {
      const t = await team('acc2');
      const inv = await invite(t.admin.accessToken, 'nuevo@acc2.com').expect(201);
      await http()
        .post('/api/users/accept-invitation')
        .send({ token: inv.body.token, password: 'corta', firstName: 'A', lastName: 'B' })
        .expect(400);
      const ghost = await http()
        .post('/api/users/accept-invitation')
        .send({ token: 'inexistente', password: 'NuevaClave123', firstName: 'A', lastName: 'B' })
        .expect(400);
      expect(ghost.body.error).toBe('INVITATION_NOT_FOUND');

      await prisma.baseClient.userInvitation.updateMany({ data: { expiresAt: new Date('2020-01-01') } });
      const late = await http()
        .post('/api/users/accept-invitation')
        .send({ token: inv.body.token, password: 'NuevaClave123', firstName: 'A', lastName: 'B' })
        .expect(400);
      expect(late.body.error).toBe('INVITATION_EXPIRED');
    });

    it('el token en claro guardado en la base no sirve: solo vale el original', async () => {
      const t = await team('acc3');
      const inv = await invite(t.admin.accessToken, 'nuevo@acc3.com').expect(201);
      const row = await prisma.baseClient.userInvitation.findFirst({ where: { email: 'nuevo@acc3.com' } });
      const res = await http()
        .post('/api/users/accept-invitation')
        .send({ token: row!.token, password: 'NuevaClave123', firstName: 'A', lastName: 'B' })
        .expect(400);
      expect(res.body.error).toBe('INVITATION_NOT_FOUND');
      expect(inv.body.token).not.toBe(row!.token);
    });

    it('reenviar rota el token: el anterior deja de servir y el nuevo renueva el plazo', async () => {
      const t = await team('res1');
      const inv = await invite(t.admin.accessToken, 'nuevo@res1.com').expect(201);
      await prisma.baseClient.userInvitation.updateMany({ data: { expiresAt: new Date('2020-01-01') } });

      const re = await http()
        .post(`/api/users/${inv.body.id}/invitation/resend`)
        .set(auth(t.admin.accessToken))
        .expect(201);
      expect(re.body.token).not.toBe(inv.body.token);
      expect(new Date(re.body.expiresAt).getTime()).toBeGreaterThan(Date.now());

      const old = await http()
        .post('/api/users/accept-invitation')
        .send({ token: inv.body.token, password: 'NuevaClave123', firstName: 'A', lastName: 'B' })
        .expect(400);
      expect(old.body.error).toBe('INVITATION_NOT_FOUND');
      await http()
        .post('/api/users/accept-invitation')
        .send({ token: re.body.token, password: 'NuevaClave123', firstName: 'A', lastName: 'B' })
        .expect(201);
    });

    it('reenviar: roles no Admin 403, otra inmobiliaria 404, ya aceptada 404', async () => {
      const t = await team('res2');
      const other = await team('res2b');
      const inv = await invite(t.admin.accessToken, 'nuevo@res2.com').expect(201);

      await http().post(`/api/users/${inv.body.id}/invitation/resend`).set(auth(t.Gerente.accessToken)).expect(403);
      await http().post(`/api/users/${inv.body.id}/invitation/resend`).set(auth(t.Ventas.accessToken)).expect(403);
      await http().post(`/api/users/${inv.body.id}/invitation/resend`).set(auth(t.Lectura.accessToken)).expect(403);
      const cross = await http()
        .post(`/api/users/${inv.body.id}/invitation/resend`)
        .set(auth(other.admin.accessToken))
        .expect(404);
      expect(cross.body.error).toBe('INVITATION_NOT_FOUND');

      await http()
        .post('/api/users/accept-invitation')
        .send({ token: inv.body.token, password: 'NuevaClave123', firstName: 'A', lastName: 'B' })
        .expect(201);
      await http().post(`/api/users/${inv.body.id}/invitation/resend`).set(auth(t.admin.accessToken)).expect(404);
    });
  });

  // ─── Listado ──────────────────────────────────────────────────────────────

  describe('listado con estados (CP-102)', () => {
    it('muestra Invitado, Activo y Desactivado, solo de la propia inmobiliaria', async () => {
      const t = await team('list1');
      const other = await team('list1b');
      await invite(t.admin.accessToken, 'pendiente@list1.com', 'Soporte').expect(201);
      await invite(other.admin.accessToken, 'ajena@list1b.com').expect(201);
      await http().post(`/api/users/${t.Lectura.user.id}/deactivate`).set(auth(t.admin.accessToken)).expect(201);

      const res = await http().get('/api/users').set(auth(t.Gerente.accessToken)).expect(200);
      const byEmail = Object.fromEntries(res.body.map((m: any) => [m.email, m]));
      expect(byEmail['pendiente@list1.com']).toMatchObject({ status: 'invited', role: 'Soporte', invitationExpired: false });
      expect(byEmail['admin@list1.com'].status).toBe('active');
      expect(byEmail['lectura@list1.com'].status).toBe('inactive');
      expect(byEmail['ajena@list1b.com']).toBeUndefined();
      expect(res.body.every((m: any) => m.token === undefined && m.passwordHash === undefined)).toBe(true);
    });

    it('Ventas y Lectura no listan (403)', async () => {
      const t = await team('list2');
      await http().get('/api/users').set(auth(t.Ventas.accessToken)).expect(403);
      await http().get('/api/users').set(auth(t.Lectura.accessToken)).expect(403);
    });
  });

  // ─── Rol, baja y reactivación ─────────────────────────────────────────────

  describe('cambio de rol (CP-103)', () => {
    it('el Admin cambia el rol; los demás roles reciben 403', async () => {
      const t = await team('rol1');
      const res = await http()
        .patch(`/api/users/${t.Ventas.user.id}`)
        .set(auth(t.admin.accessToken))
        .send({ role: 'Gerente' })
        .expect(200);
      expect(res.body.role).toBe('Gerente');

      for (const role of ['Gerente', 'Ventas', 'Lectura'] as const) {
        await http()
          .patch(`/api/users/${t.Lectura.user.id}`)
          .set(auth(t[role].accessToken))
          .send({ role: 'Admin' })
          .expect(403);
      }
    });

    it('rol inválido 400, otra inmobiliaria 404', async () => {
      const t = await team('rol2');
      const other = await team('rol2b');
      await http().patch(`/api/users/${t.Ventas.user.id}`).set(auth(t.admin.accessToken)).send({ role: 'Rey' }).expect(400);
      const cross = await http()
        .patch(`/api/users/${other.Ventas.user.id}`)
        .set(auth(t.admin.accessToken))
        .send({ role: 'Gerente' })
        .expect(404);
      expect(cross.body.error).toBe('USER_NOT_FOUND');
    });

    it('no se puede degradar al último Admin; con otro Admin sí', async () => {
      const t = await team('rol3');
      const res = await http()
        .patch(`/api/users/${t.admin.user.id}`)
        .set(auth(t.admin.accessToken))
        .send({ role: 'Gerente' })
        .expect(409);
      expect(res.body.error).toBe('LAST_ADMIN');

      await http().patch(`/api/users/${t.Gerente.user.id}`).set(auth(t.admin.accessToken)).send({ role: 'Admin' }).expect(200);
      await http().patch(`/api/users/${t.admin.user.id}`).set(auth(t.admin.accessToken)).send({ role: 'Gerente' }).expect(200);
    });
  });

  describe('baja y reactivación (CP-104)', () => {
    it('la baja cierra sesiones y bloquea el ingreso; reactivar lo devuelve', async () => {
      const t = await team('baja1');
      await http().post(`/api/users/${t.Ventas.user.id}/deactivate`).set(auth(t.admin.accessToken)).expect(201);

      const refresh = await http().post('/api/auth/refresh').send({ refreshToken: t.Ventas.refreshToken }).expect(401);
      expect(refresh.body.error).toBe('TOKEN_REVOKED');
      await http().post('/api/auth/login').send({ email: 'ventas@baja1.com', password: PASSWORD }).expect(401);

      const back = await http().post(`/api/users/${t.Ventas.user.id}/reactivate`).set(auth(t.admin.accessToken)).expect(201);
      expect(back.body.isActive).toBe(true);
      await loginUser(app, 'ventas@baja1.com', PASSWORD);
    });

    it('no puede darse de baja a sí mismo', async () => {
      const t = await team('baja2');
      const self = await http().post(`/api/users/${t.admin.user.id}/deactivate`).set(auth(t.admin.accessToken)).expect(400);
      expect(self.body.error).toBe('CANNOT_DEACTIVATE_SELF');
    });

    it('la baja rige de inmediato: el token de acceso vigente deja de servir', async () => {
      const t = await team('baja3');
      await http().get('/api/users').set(auth(t.Gerente.accessToken)).expect(200);
      await http().post(`/api/users/${t.Gerente.user.id}/deactivate`).set(auth(t.admin.accessToken)).expect(201);
      await http().get('/api/users').set(auth(t.Gerente.accessToken)).expect(401);
    });

    it('el cambio de rol rige de inmediato', async () => {
      const t = await team('baja5');
      await http().get('/api/users').set(auth(t.Gerente.accessToken)).expect(200);
      await http().patch(`/api/users/${t.Gerente.user.id}`).set(auth(t.admin.accessToken)).send({ role: 'Lectura' }).expect(200);
      await http().get('/api/users').set(auth(t.Gerente.accessToken)).expect(403);
    });

    it('otra inmobiliaria 404 y roles no Admin 403', async () => {
      const t = await team('baja4');
      const other = await team('baja4b');
      await http().post(`/api/users/${other.Ventas.user.id}/deactivate`).set(auth(t.admin.accessToken)).expect(404);
      await http().post(`/api/users/${other.Ventas.user.id}/reactivate`).set(auth(t.admin.accessToken)).expect(404);
      for (const role of ['Gerente', 'Ventas', 'Lectura'] as const) {
        await http().post(`/api/users/${t.Lectura.user.id}/deactivate`).set(auth(t[role].accessToken)).expect(403);
        await http().post(`/api/users/${t.Lectura.user.id}/reactivate`).set(auth(t[role].accessToken)).expect(403);
      }
    });
  });

  // ─── Contraseña ───────────────────────────────────────────────────────────

  describe('cambio de contraseña (CP-105)', () => {
    it('pide la actual, valida la nueva y revoca las otras sesiones', async () => {
      const t = await team('pw1');
      const other = await loginUser(app, 'ventas@pw1.com', PASSWORD);
      const current = t.Ventas;

      const wrong = await http()
        .post('/api/auth/change-password')
        .set(auth(current.accessToken))
        .send({ currentPassword: 'equivocada', newPassword: 'ClaveNueva123' })
        .expect(400);
      expect(wrong.body.error).toBe('INVALID_CURRENT_PASSWORD');

      await http()
        .post('/api/auth/change-password')
        .set(auth(current.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'corta' })
        .expect(400);

      await http()
        .post('/api/auth/change-password')
        .set(auth(current.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'ClaveNueva123', refreshToken: current.refreshToken })
        .expect(204);

      // la sesión actual puede renovar; la otra quedó cerrada (se prueba al
      // final porque reusar un token revocado cierra todas las sesiones)
      await http().post('/api/auth/refresh').send({ refreshToken: current.refreshToken }).expect(200);
      const revoked = await http().post('/api/auth/refresh').send({ refreshToken: other.refreshToken }).expect(401);
      expect(revoked.body.error).toBe('TOKEN_REVOKED');

      await http().post('/api/auth/login').send({ email: 'ventas@pw1.com', password: PASSWORD }).expect(401);
      await loginUser(app, 'ventas@pw1.com', 'ClaveNueva123');
    });

    it('sin sesión, 401', async () => {
      await http().post('/api/auth/change-password').send({ currentPassword: 'a', newPassword: 'ClaveNueva123' }).expect(401);
    });
  });

  describe('recupero por correo (CP-106)', () => {
    it('responde 202 igual exista o no la cuenta y, sin correo configurado, no crea token', async () => {
      await team('rec1');
      const known = await http().post('/api/auth/password-reset/request').send({ email: 'admin@rec1.com' }).expect(202);
      const unknown = await http().post('/api/auth/password-reset/request').send({ email: 'nadie@rec1.com' }).expect(202);
      expect(known.body).toEqual(unknown.body);
      expect(await prisma.baseClient.passwordResetToken.count()).toBe(0);
    });

    it('un correo mal formado es 400', async () => {
      await http().post('/api/auth/password-reset/request').send({ email: 'no-es-correo' }).expect(400);
    });
  });

  describe('enlace de recupero del Admin (CP-107)', () => {
    it('lo genera el Admin, sirve una sola vez y revoca las sesiones', async () => {
      const t = await team('lnk1');
      const res = await http()
        .post(`/api/users/${t.Ventas.user.id}/password-reset-link`)
        .set(auth(t.admin.accessToken))
        .expect(201);
      expect(res.body.link).toContain('/auth/password-reset?token=');
      expect(res.body.email).toBe('ventas@lnk1.com');
      const minutes = (new Date(res.body.expiresAt).getTime() - Date.now()) / 60000;
      expect(minutes).toBeGreaterThan(58);
      expect(minutes).toBeLessThanOrEqual(60);

      const row = await prisma.baseClient.passwordResetToken.findFirst();
      expect(row!.tokenHash).toBe(hashToken(res.body.token));
      expect(row!.createdById).toBe(t.admin.user.id);
      expect(row!.tenantId).toBe(t.admin.user.tenantId);

      await http().post('/api/auth/password-reset/confirm').send({ token: res.body.token, newPassword: 'corta' }).expect(400);
      await http()
        .post('/api/auth/password-reset/confirm')
        .send({ token: res.body.token, newPassword: 'OtraClave1234' })
        .expect(204);

      const reuse = await http()
        .post('/api/auth/password-reset/confirm')
        .send({ token: res.body.token, newPassword: 'OtraClave5678' })
        .expect(400);
      expect(reuse.body.error).toBe('PASSWORD_RESET_USED');

      const revoked = await http().post('/api/auth/refresh').send({ refreshToken: t.Ventas.refreshToken }).expect(401);
      expect(revoked.body.error).toBe('TOKEN_REVOKED');
      await http().post('/api/auth/login').send({ email: 'ventas@lnk1.com', password: PASSWORD }).expect(401);
      await loginUser(app, 'ventas@lnk1.com', 'OtraClave1234');
    });

    it('un enlace nuevo invalida el anterior', async () => {
      const t = await team('lnk2');
      const first = await http().post(`/api/users/${t.Ventas.user.id}/password-reset-link`).set(auth(t.admin.accessToken)).expect(201);
      const second = await http().post(`/api/users/${t.Ventas.user.id}/password-reset-link`).set(auth(t.admin.accessToken)).expect(201);
      const res = await http()
        .post('/api/auth/password-reset/confirm')
        .send({ token: first.body.token, newPassword: 'OtraClave1234' })
        .expect(400);
      expect(res.body.error).toBe('PASSWORD_RESET_USED');
      await http().post('/api/auth/password-reset/confirm').send({ token: second.body.token, newPassword: 'OtraClave1234' }).expect(204);
    });

    it('vencido, inexistente y de usuario dado de baja se rechazan', async () => {
      const t = await team('lnk3');
      const res = await http().post(`/api/users/${t.Ventas.user.id}/password-reset-link`).set(auth(t.admin.accessToken)).expect(201);

      const ghost = await http().post('/api/auth/password-reset/confirm').send({ token: 'inexistente', newPassword: 'OtraClave1234' }).expect(400);
      expect(ghost.body.error).toBe('PASSWORD_RESET_INVALID');

      await prisma.baseClient.passwordResetToken.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
      const late = await http().post('/api/auth/password-reset/confirm').send({ token: res.body.token, newPassword: 'OtraClave1234' }).expect(400);
      expect(late.body.error).toBe('PASSWORD_RESET_EXPIRED');

      await http().post(`/api/users/${t.Ventas.user.id}/deactivate`).set(auth(t.admin.accessToken)).expect(201);
      await http().post(`/api/users/${t.Ventas.user.id}/password-reset-link`).set(auth(t.admin.accessToken)).expect(400);
    });

    it('roles no Admin 403 y otra inmobiliaria 404', async () => {
      const t = await team('lnk4');
      const other = await team('lnk4b');
      for (const role of ['Gerente', 'Ventas', 'Lectura'] as const) {
        await http().post(`/api/users/${t.Lectura.user.id}/password-reset-link`).set(auth(t[role].accessToken)).expect(403);
      }
      await http().post(`/api/users/${other.Ventas.user.id}/password-reset-link`).set(auth(t.admin.accessToken)).expect(404);
      expect(await prisma.baseClient.passwordResetToken.count()).toBe(0);
    });
  });

  describe('bitácora (CP-108)', () => {
    it('registra cambio de rol, baja y enlace de recupero sin filtrar secretos', async () => {
      const t = await team('aud1');
      const where = { tenantId: t.admin.user.tenantId, entity: 'User' };

      await http().patch(`/api/users/${t.Ventas.user.id}`).set(auth(t.admin.accessToken)).send({ role: 'Gerente' }).expect(200);
      await http().post(`/api/users/${t.Lectura.user.id}/deactivate`).set(auth(t.admin.accessToken)).expect(201);
      const link = await http().post(`/api/users/${t.Gerente.user.id}/password-reset-link`).set(auth(t.admin.accessToken)).expect(201);
      await http()
        .post('/api/auth/change-password')
        .set(auth(t.Gerente.accessToken))
        .send({ currentPassword: PASSWORD, newPassword: 'ClaveNueva123' })
        .expect(204);

      const rows = await waitForAudit(where, 3);
      const ops = rows.map((r: any) => (r.changes as any)?.operation);
      expect(ops).toEqual(expect.arrayContaining(['role-change', 'deactivate', 'password-reset-link']));
      expect(rows.find((r: any) => r.changes?.operation === 'role-change')).toMatchObject({
        userId: t.admin.user.id,
        entityId: t.Ventas.user.id,
        changes: { role: 'Gerente' },
      });

      const all = JSON.stringify(await prisma.baseClient.auditLog.findMany({ where: { tenantId: t.admin.user.tenantId } }));
      expect(all).not.toContain(link.body.token);
      expect(all).not.toContain('ClaveNueva123');
      expect(all).not.toContain(PASSWORD);
    });
  });
});
