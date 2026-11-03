import type { ConfigService } from '@nestjs/config';
import { MESSAGE_TEMPLATE_KEYS, MessageChannel } from '@realfy/shared';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { FakeProvider } from './providers/fake.provider';
import { OutboxAdminService, toItem } from './outbox-admin.service';

const T0 = new Date('2026-11-02T15:00:00Z');

function row(over: Record<string, any> = {}) {
  return {
    id: 'm-1',
    channel: 'Email',
    personId: 'p-1',
    person: { firstName: 'Iris', lastName: 'Inquilina' },
    to: 'iris@example.com',
    templateKey: 'receipt',
    vars: { number: '00000001' },
    status: 'Failed',
    statusReason: null,
    error: 'validation_error: x',
    attempts: 5,
    nextAttemptAt: null,
    scheduledAt: T0,
    sentAt: null,
    deliveredAt: null,
    relatedType: 'Receipt',
    relatedId: 'r-1',
    createdAt: T0,
    ...over,
  };
}

function build(rows: any[] = [row()], env: Record<string, string> = { MESSAGING_MODE: 'live' }) {
  const client: any = {
    messageOutbox: {
      findMany: jest.fn().mockResolvedValue(rows),
      count: jest.fn().mockResolvedValue(rows.length),
      findFirst: jest.fn(async ({ where }: any) => rows.find((r) => r.id === where.id) ?? null),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id), data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        const r = rows.find((x) => x.id === where.id && where.status.in.includes(x.status));
        if (r) Object.assign(r, data);
        return { count: r ? 1 : 0 };
      }),
    },
  };
  const config = new MessagingConfigService({ get: (k: string) => env[k] } as unknown as ConfigService);
  const defaults = { get: jest.fn().mockResolvedValue({ messaging: { fromHour: 9, untilHour: 20 } }) };
  const email = new FakeProvider(MessageChannel.Email);
  const whatsapp = new FakeProvider(MessageChannel.WhatsApp);
  whatsapp.configured = false;
  const service = new OutboxAdminService(
    { client } as any,
    { getTenantId: () => 't-1' } as any,
    config,
    defaults as any,
    [email, whatsapp],
  );
  return { service, client, rows };
}

describe('OutboxAdminService', () => {
  it('lista con filtros, orden estable y sin secretos', async () => {
    const { service, client } = build([
      row({ templateKey: 'user_invitation', vars: { link: 'https://x/t?token=abc' }, personId: null, person: null }),
    ]);
    const page = await service.list({ status: 'Failed', channel: 'Email', relatedType: 'UserInvitation', page: '1', limit: '10' });
    expect(client.messageOutbox.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { status: 'Failed', channel: 'Email', relatedType: 'UserInvitation' },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: 0,
        take: 10,
      }),
    );
    expect(page).toMatchObject({ total: 1, page: 1, limit: 10, totalPages: 1 });
    expect(page.items[0]).toMatchObject({ vars: { link: '[oculto]' }, personName: null, scheduledAt: T0.toISOString() });
  });

  it('un filtro inválido es VALIDATION_ERROR', async () => {
    await expect(build().service.list({ status: 'Nada' })).rejects.toMatchObject({ response: { error: 'VALIDATION_ERROR' } });
  });

  describe('reintentar', () => {
    it('vuelve a encolar un fallido desde cero', async () => {
      const { service, rows } = build();
      const item = await service.retry('m-1');
      expect(item).toMatchObject({ status: 'Pending', attempts: 0, error: null, statusReason: null, personName: 'Iris Inquilina' });
      expect(rows[0].scheduledAt).not.toBe(T0);
    });

    it('con el modo apagado queda con el motivo a la vista', async () => {
      const { service } = build([row({ status: 'Blocked' })], {});
      expect((await service.retry('m-1')).statusReason).toBe('MESSAGING_OFF');
    });

    it('uno enviado o pendiente no se reintenta', async () => {
      await expect(build([row({ status: 'Sent' })]).service.retry('m-1')).rejects.toMatchObject({
        response: { error: 'MESSAGE_NOT_RETRYABLE', status: 'Sent' },
      });
    });

    it('una invitación con el enlace ya borrado no se reintenta: se reenvía la invitación', async () => {
      const { service } = build([row({ templateKey: 'user_invitation', vars: { link: '[oculto]' } })]);
      await expect(service.retry('m-1')).rejects.toMatchObject({ response: { error: 'MESSAGE_EXPIRED' } });
      const empty = build([row({ templateKey: 'user_invitation', vars: {}, status: 'Cancelled' })]);
      await expect(empty.service.retry('m-1')).rejects.toMatchObject({ response: { error: 'MESSAGE_EXPIRED' } });
    });

    it('uno de otra inmobiliaria (o inexistente) es 404', async () => {
      await expect(build([]).service.retry('m-x')).rejects.toMatchObject({ response: { error: 'MESSAGE_NOT_FOUND' } });
    });
  });

  describe('cancelar', () => {
    it('cancela uno pendiente y borra sus secretos', async () => {
      const { service, rows } = build([row({ status: 'Pending', templateKey: 'user_invitation', vars: { link: 'https://x' } })]);
      const item = await service.cancel('m-1');
      expect(item.status).toBe('Cancelled');
      expect(rows[0].vars).toEqual({ link: '[oculto]' });
    });

    it('uno que ya salió no se cancela', async () => {
      await expect(build([row({ status: 'Delivered' })]).service.cancel('m-1')).rejects.toMatchObject({
        response: { error: 'MESSAGE_NOT_CANCELLABLE' },
      });
    });

    it('uno que el despacho tomó entre medio no se cancela', async () => {
      const { service, client } = build([row({ status: 'Pending' })]);
      client.messageOutbox.updateMany.mockResolvedValueOnce({ count: 0 });
      await expect(service.cancel('m-1')).rejects.toMatchObject({ response: { error: 'MESSAGE_NOT_CANCELLABLE' } });
    });
  });

  it('la configuración muestra el modo, los proveedores, el horario y las plantillas, sin secretos', async () => {
    const { service } = build([], {
      MESSAGING_MODE: 'allowlist',
      MESSAGING_ALLOWLIST: 'a@example.com, b@example.com',
      RESEND_FROM: 'avisos@inmo.example',
      RESEND_WEBHOOK_SECRET: 'whsec_x',
      WHATSAPP_TOKEN: 'secreto',
    });
    const s = await service.settings();
    expect(s).toMatchObject({
      mode: 'allowlist',
      allowlistCount: 2,
      providers: {
        email: { configured: true, from: 'avisos@inmo.example', webhook: true },
        whatsapp: { configured: false, webhook: false },
      },
      sendingWindow: { fromHour: 9, untilHour: 20 },
    });
    expect(s.templates.map((t) => t.key)).toEqual([...MESSAGE_TEMPLATE_KEYS]);
    expect(JSON.stringify(s)).not.toContain('secreto');
  });

  it('en modo live o off no informa la lista', async () => {
    expect((await build([], { MESSAGING_MODE: 'live', MESSAGING_ALLOWLIST: 'a@example.com' }).service.settings()).allowlistCount).toBe(0);
  });

  it('toItem convierte fechas a ISO', () => {
    const item = toItem(row({ sentAt: T0, deliveredAt: T0, nextAttemptAt: T0 }));
    expect(item).toMatchObject({ sentAt: T0.toISOString(), deliveredAt: T0.toISOString(), nextAttemptAt: T0.toISOString() });
  });
});
