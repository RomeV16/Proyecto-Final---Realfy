import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { UserRole } from '@realfy/shared';
import { UsersService } from './users.service';
import { hashToken } from '../../common/auth/one-time-token';

function build(opts: { role?: UserRole; mailConfigured?: boolean; mailOk?: boolean } = {}) {
  const client = {
    user: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      count: jest.fn().mockResolvedValue(1),
      update: jest.fn().mockImplementation(async ({ where, data }) => ({
        id: where.id,
        email: 'a@example.com',
        role: 'Ventas',
        isActive: true,
        ...data,
      })),
    },
    userInvitation: {
      findMany: jest.fn().mockResolvedValue([]),
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'inv-1', ...data })),
      update: jest.fn().mockImplementation(async ({ data }) => ({
        id: 'inv-1',
        email: 'a@example.com',
        role: 'Ventas',
        ...data,
      })),
    },
  };
  const base = {
    refreshToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
    userInvitation: { findUnique: jest.fn(), updateMany: jest.fn() },
    $transaction: jest.fn(),
  };
  const prisma: any = { client, baseClient: base };
  const tenantContext: any = {
    getTenantId: () => 't1',
    getUserId: () => 'me',
    getUserRole: () => opts.role ?? UserRole.Admin,
  };
  const config: any = {
    get: (k: string) => (k === 'WEB_BASE_URL' ? 'https://app.example.com' : undefined),
  };
  const email: any = {
    isConfigured: jest.fn().mockReturnValue(opts.mailConfigured ?? false),
    sendEmail: jest.fn().mockResolvedValue(opts.mailOk === false ? null : { id: 'm' }),
  };
  const service = new UsersService(prisma, tenantContext, config, email);
  return { service, client, base, email };
}

describe('UsersService', () => {
  describe('findAll', () => {
    it('une usuarios e invitaciones con su estado', async () => {
      const { service, client } = build();
      const past = new Date('2020-01-01');
      client.user.findMany.mockResolvedValue([
        { id: 'u1', email: 'a@x.com', firstName: 'A', lastName: 'B', role: 'Admin', isActive: true, lastLoginAt: null, createdAt: new Date('2026-01-01') },
        { id: 'u2', email: 'b@x.com', firstName: 'C', lastName: 'D', role: 'Ventas', isActive: false, lastLoginAt: new Date('2026-02-01'), createdAt: new Date('2026-01-02') },
      ]);
      client.userInvitation.findMany.mockResolvedValue([
        { id: 'i1', email: 'c@x.com', role: 'Lectura', expiresAt: past, createdAt: new Date('2026-01-03') },
      ]);
      const list = await service.findAll();
      expect(list.map((m) => m.status)).toEqual(['active', 'inactive', 'invited']);
      expect(list[2]).toMatchObject({ invitationExpired: true, firstName: null });
      expect(client.userInvitation.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { acceptedAt: null } }),
      );
    });
  });

  describe('invite', () => {
    it('guarda solo el hash y devuelve el token y el enlace', async () => {
      const { service, client } = build();
      const res = await service.invite({ email: 'new@x.com', role: 'Ventas' });
      const stored = client.userInvitation.create.mock.calls[0][0].data;
      expect(stored.token).toBe(hashToken(res.token));
      expect(stored.token).not.toBe(res.token);
      expect(res.link).toBe(`https://app.example.com/auth/accept-invitation?token=${encodeURIComponent(res.token)}`);
      expect(res.emailSent).toBe(false);
      expect(new Date(res.expiresAt).getTime()).toBeGreaterThan(Date.now() + 6 * 86400000);
    });

    it('solo un Admin recibe el enlace', async () => {
      const { service } = build({ role: UserRole.Gerente });
      await expect(service.invite({ email: 'n@x.com', role: 'Ventas' })).rejects.toThrow(ForbiddenException);
    });

    it('rechaza un correo que ya es usuario', async () => {
      const { service, client } = build();
      client.user.findFirst.mockResolvedValue({ id: 'u' });
      await expect(service.invite({ email: 'n@x.com', role: 'Ventas' })).rejects.toMatchObject({
        response: { error: 'USER_ALREADY_EXISTS' },
      });
    });

    it('rechaza una invitación vigente y reutiliza una vencida', async () => {
      const { service, client } = build();
      client.userInvitation.findFirst.mockResolvedValueOnce({ id: 'old', expiresAt: new Date(Date.now() + 1000) });
      await expect(service.invite({ email: 'n@x.com', role: 'Ventas' })).rejects.toThrow(ConflictException);

      client.userInvitation.findFirst.mockResolvedValueOnce({ id: 'old', expiresAt: new Date('2020-01-01') });
      await service.invite({ email: 'n@x.com', role: 'Gerente' });
      expect(client.userInvitation.update).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'old' } }),
      );
      expect(client.userInvitation.create).not.toHaveBeenCalled();
    });

    it('manda el correo si hay servicio y no falla si el envío falla', async () => {
      const ok = build({ mailConfigured: true });
      expect((await ok.service.invite({ email: 'n@x.com', role: 'Ventas' })).emailSent).toBe(true);
      expect(ok.email.sendEmail).toHaveBeenCalledTimes(1);

      const bad = build({ mailConfigured: true, mailOk: false });
      expect((await bad.service.invite({ email: 'n@x.com', role: 'Ventas' })).emailSent).toBe(false);
    });

    it('valida el cuerpo', async () => {
      const { service } = build();
      await expect(service.invite({ email: 'nope', role: 'Ventas' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('resendInvitation', () => {
    it('rota el token y renueva el plazo', async () => {
      const { service, client } = build();
      client.userInvitation.findFirst.mockResolvedValue({ id: 'inv-1', email: 'a@example.com', role: 'Ventas' });
      const res = await service.resendInvitation('inv-1');
      const data = client.userInvitation.update.mock.calls[0][0].data;
      expect(data.token).toBe(hashToken(res.token));
    });

    it('404 si no hay invitación pendiente en la inmobiliaria', async () => {
      const { service } = build();
      await expect(service.resendInvitation('x')).rejects.toThrow(NotFoundException);
    });
  });

  describe('acceptInvitation', () => {
    const body = { token: 'tok', password: 'Password123!', firstName: 'N', lastName: 'U' };

    it('busca por hash y distingue inexistente, usada y vencida', async () => {
      const { service, base } = build();
      base.userInvitation.findUnique.mockResolvedValueOnce(null);
      await expect(service.acceptInvitation(body)).rejects.toMatchObject({ response: { error: 'INVITATION_NOT_FOUND' } });
      expect(base.userInvitation.findUnique).toHaveBeenCalledWith({ where: { token: hashToken('tok') } });

      base.userInvitation.findUnique.mockResolvedValueOnce({ acceptedAt: new Date(), expiresAt: new Date(Date.now() + 1e6) });
      await expect(service.acceptInvitation(body)).rejects.toMatchObject({ response: { error: 'INVITATION_ALREADY_ACCEPTED' } });

      base.userInvitation.findUnique.mockResolvedValueOnce({ acceptedAt: null, expiresAt: new Date('2020-01-01') });
      await expect(service.acceptInvitation(body)).rejects.toMatchObject({ response: { error: 'INVITATION_EXPIRED' } });
    });

    it('exige contraseña de al menos 8 caracteres', async () => {
      const { service } = build();
      await expect(service.acceptInvitation({ ...body, password: 'short' })).rejects.toThrow(BadRequestException);
    });

    it('la reclamación concurrente perdedora no crea usuario', async () => {
      const { service, base } = build();
      base.userInvitation.findUnique.mockResolvedValue({
        id: 'i', email: 'n@x.com', role: 'Ventas', tenantId: 't1', acceptedAt: null, expiresAt: new Date(Date.now() + 1e6),
      });
      const tx = { userInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) }, user: { create: jest.fn() } };
      base.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(service.acceptInvitation(body)).rejects.toMatchObject({ response: { error: 'INVITATION_ALREADY_ACCEPTED' } });
      expect(tx.user.create).not.toHaveBeenCalled();
    });

    it('crea el usuario con el rol de la invitación', async () => {
      const { service, base } = build();
      base.userInvitation.findUnique.mockResolvedValue({
        id: 'i', email: 'n@x.com', role: 'Ventas', tenantId: 't1', acceptedAt: null, expiresAt: new Date(Date.now() + 1e6),
      });
      const tx = {
        userInvitation: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        user: { create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'u', ...data })) },
      };
      base.$transaction.mockImplementation((fn: any) => fn(tx));
      const res = await service.acceptInvitation(body);
      expect(res).toMatchObject({ email: 'n@x.com', role: 'Ventas', tenantId: 't1' });
      expect(res).not.toHaveProperty('passwordHash');
      expect(tx.user.create.mock.calls[0][0].data.passwordHash).not.toBe(body.password);
    });
  });

  describe('roles y baja', () => {
    it('404 si el usuario no es de la inmobiliaria', async () => {
      const { service } = build();
      await expect(service.updateRole('x', { role: 'Ventas' })).rejects.toThrow(NotFoundException);
      await expect(service.reactivate('x')).rejects.toThrow(NotFoundException);
    });

    it('no deja sin Admin a la inmobiliaria al cambiar el rol', async () => {
      const { service, client } = build();
      client.user.findFirst.mockResolvedValue({ id: 'a', email: 'a@x.com', role: 'Admin', isActive: true });
      client.user.count.mockResolvedValue(0);
      await expect(service.updateRole('a', { role: 'Gerente' })).rejects.toMatchObject({ response: { error: 'LAST_ADMIN' } });
      client.user.count.mockResolvedValue(1);
      await expect(service.updateRole('a', { role: 'Gerente' })).resolves.toMatchObject({ role: 'Gerente' });
    });

    it('promover o repetir el rol no consulta el último Admin', async () => {
      const { service, client } = build();
      client.user.findFirst.mockResolvedValue({ id: 'a', email: 'a@x.com', role: 'Ventas', isActive: true });
      await service.updateRole('a', { role: 'Admin' });
      await service.updateRole('a', { role: 'Ventas' });
      expect(client.user.count).not.toHaveBeenCalled();
    });

    it('no permite darse de baja a uno mismo', async () => {
      const { service } = build();
      await expect(service.deactivate('me')).rejects.toMatchObject({ response: { error: 'CANNOT_DEACTIVATE_SELF' } });
    });

    it('no permite dar de baja al último Admin', async () => {
      const { service, client } = build();
      client.user.findFirst.mockResolvedValue({ id: 'a', email: 'a@x.com', role: 'Admin', isActive: true });
      client.user.count.mockResolvedValue(0);
      await expect(service.deactivate('a')).rejects.toMatchObject({ response: { error: 'LAST_ADMIN' } });
    });

    it('la baja cierra las sesiones y reactivar vuelve a habilitar', async () => {
      const { service, client, base } = build();
      client.user.findFirst.mockResolvedValue({ id: 'v', email: 'v@x.com', role: 'Ventas', isActive: true });
      await expect(service.deactivate('v')).resolves.toMatchObject({ isActive: false });
      expect(base.refreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'v' }, data: { isRevoked: true } });
      await expect(service.reactivate('v')).resolves.toMatchObject({ isActive: true });
    });
  });
});
