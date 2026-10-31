import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PasswordResetService } from './password-reset.service';
import { hashToken } from '../../common/auth/one-time-token';

function build(opts: { mailConfigured?: boolean; userId?: string | undefined } = {}) {
  const resetModel = {
    updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    create: jest.fn().mockImplementation(async ({ data }) => ({ id: 'r1', ...data })),
    findUnique: jest.fn(),
  };
  const client = {
    user: { findFirst: jest.fn().mockResolvedValue(null) },
    passwordResetToken: resetModel,
  };
  const base = {
    user: { findFirst: jest.fn().mockResolvedValue(null) },
    passwordResetToken: resetModel,
    $transaction: jest.fn().mockResolvedValue([]),
  };
  const prisma: any = { client, baseClient: base };
  const tenantContext: any = {
    getUserId: () => ('userId' in opts ? opts.userId : 'admin'),
  };
  const config: any = { get: (k: string) => (k === 'WEB_BASE_URL' ? 'https://app.example.com' : undefined) };
  const email: any = {
    isConfigured: jest.fn().mockReturnValue(opts.mailConfigured ?? false),
    sendEmail: jest.fn().mockResolvedValue({ id: 'm' }),
  };
  return { service: new PasswordResetService(prisma, tenantContext, config, email), client, base, email, resetModel };
}

describe('PasswordResetService', () => {
  describe('requestByEmail', () => {
    it('no hace nada ni falla si la cuenta no existe', async () => {
      const { service, email, resetModel } = build({ mailConfigured: true });
      await expect(service.requestByEmail({ email: 'ghost@example.com' })).resolves.toBeUndefined();
      expect(email.sendEmail).not.toHaveBeenCalled();
      expect(resetModel.create).not.toHaveBeenCalled();
    });

    it('sin servicio de correo no crea token ni envía', async () => {
      const { service, base, email } = build({ mailConfigured: false });
      base.user.findFirst.mockResolvedValue({ id: 'u', tenantId: 't', firstName: 'Ana' });
      await service.requestByEmail({ email: 'ana@example.com' });
      expect(email.sendEmail).not.toHaveBeenCalled();
      expect(base.$transaction).not.toHaveBeenCalled();
    });

    it('con correo configurado guarda el hash y manda el enlace', async () => {
      const { service, base, email, resetModel } = build({ mailConfigured: true });
      base.user.findFirst.mockResolvedValue({ id: 'u', tenantId: 't', firstName: '<Ana>' });
      await service.requestByEmail({ email: 'ana@example.com' });
      const created = resetModel.create.mock.calls[0][0].data;
      const mail = email.sendEmail.mock.calls[0][0];
      const token = decodeURIComponent(/token=([^"<]+)/.exec(mail.html)![1]);
      expect(created.tokenHash).toBe(hashToken(token));
      expect(mail.html).toContain('&lt;Ana&gt;');
      expect(mail.html).toContain('https://app.example.com/auth/password-reset?token=');
    });

    it('valida el correo', async () => {
      const { service } = build();
      await expect(service.requestByEmail({ email: 'nope' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('createLinkForUser', () => {
    it('devuelve el enlace una vez y guarda solo el hash', async () => {
      const { service, client, resetModel } = build();
      client.user.findFirst.mockResolvedValue({ id: 'u', tenantId: 't', email: 'u@example.com', isActive: true });
      const res = await service.createLinkForUser('u');
      const created = resetModel.create.mock.calls[0][0].data;
      expect(created.tokenHash).toBe(hashToken(res.token));
      expect(created.createdById).toBe('admin');
      expect(res.link).toContain(encodeURIComponent(res.token));
      expect(new Date(res.expiresAt).getTime()).toBeLessThanOrEqual(Date.now() + 3600_000);
      expect(resetModel.updateMany).toHaveBeenCalled();
    });

    it('404 para otra inmobiliaria, 400 para un usuario dado de baja, 403 sin contexto', async () => {
      const a = build();
      await expect(a.service.createLinkForUser('x')).rejects.toThrow(NotFoundException);

      const b = build();
      b.client.user.findFirst.mockResolvedValue({ id: 'u', isActive: false });
      await expect(b.service.createLinkForUser('u')).rejects.toMatchObject({ response: { error: 'USER_INACTIVE' } });

      const c = build({ userId: undefined });
      await expect(c.service.createLinkForUser('u')).rejects.toThrow(ForbiddenException);
    });
  });

  describe('confirm', () => {
    const body = { token: 'tok', newPassword: 'NewPassword1!' };
    const live = (over: Record<string, unknown> = {}) => ({
      id: 'r', userId: 'u', usedAt: null, expiresAt: new Date(Date.now() + 1e6), user: { id: 'u', isActive: true }, ...over,
    });

    it('rechaza token inexistente, usado y vencido', async () => {
      const { service, resetModel } = build();
      resetModel.findUnique.mockResolvedValueOnce(null);
      await expect(service.confirm(body)).rejects.toMatchObject({ response: { error: 'PASSWORD_RESET_INVALID' } });
      expect(resetModel.findUnique).toHaveBeenCalledWith(expect.objectContaining({ where: { tokenHash: hashToken('tok') } }));

      resetModel.findUnique.mockResolvedValueOnce(live({ usedAt: new Date() }));
      await expect(service.confirm(body)).rejects.toMatchObject({ response: { error: 'PASSWORD_RESET_USED' } });

      resetModel.findUnique.mockResolvedValueOnce(live({ expiresAt: new Date('2020-01-01') }));
      await expect(service.confirm(body)).rejects.toMatchObject({ response: { error: 'PASSWORD_RESET_EXPIRED' } });

      resetModel.findUnique.mockResolvedValueOnce(live({ user: { id: 'u', isActive: false } }));
      await expect(service.confirm(body)).rejects.toMatchObject({ response: { error: 'PASSWORD_RESET_INVALID' } });
    });

    it('cambia la contraseña, consume el token y revoca las sesiones', async () => {
      const { service, resetModel, base } = build();
      resetModel.findUnique.mockResolvedValue(live());
      const tx = {
        passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 1 }) },
        user: { update: jest.fn() },
        refreshToken: { updateMany: jest.fn() },
      };
      base.$transaction.mockImplementation((fn: any) => fn(tx));
      await service.confirm(body);
      expect(tx.user.update.mock.calls[0][0].data.passwordHash).not.toBe(body.newPassword);
      expect(tx.refreshToken.updateMany).toHaveBeenCalledWith({ where: { userId: 'u' }, data: { isRevoked: true } });
    });

    it('si otro pedido ganó la carrera, no cambia la contraseña', async () => {
      const { service, resetModel, base } = build();
      resetModel.findUnique.mockResolvedValue(live());
      const tx = {
        passwordResetToken: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },
        user: { update: jest.fn() },
        refreshToken: { updateMany: jest.fn() },
      };
      base.$transaction.mockImplementation((fn: any) => fn(tx));
      await expect(service.confirm(body)).rejects.toMatchObject({ response: { error: 'PASSWORD_RESET_USED' } });
      expect(tx.user.update).not.toHaveBeenCalled();
    });

    it('exige contraseña de al menos 8 caracteres', async () => {
      const { service } = build();
      await expect(service.confirm({ token: 't', newPassword: 'short' })).rejects.toThrow(BadRequestException);
    });
  });
});
