import { Logger } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@realfy/shared';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { makeTenantCron } from '../../common/scheduler/tenant-cron.testing';
import { FakeProvider } from './providers/fake.provider';
import { MAX_ATTEMPTS, OutboxDispatcherService, STALE_SENDING_MS } from './outbox-dispatcher.service';

/** 15:00 de Buenos Aires: adentro del horario permitido (9 a 20). */
const NOON = new Date('2026-11-02T18:00:00Z');
/** 22:30 de Buenos Aires: afuera. */
const NIGHT = new Date('2026-11-03T01:30:00Z');

type Row = Record<string, any>;

function message(over: Row = {}): Row {
  return {
    id: 'm-1',
    tenantId: 't-1',
    channel: 'Email',
    personId: 'p-1',
    to: 'iris@example.com',
    templateKey: 'receipt',
    vars: { name: 'Iris', number: '00000001', amount: 'ARS 1,00', concept: 'alquiler', agency: 'Inmo' },
    status: 'Pending',
    statusReason: null,
    attempts: 0,
    nextAttemptAt: null,
    scheduledAt: new Date('2026-11-02T17:00:00Z'),
    relatedType: 'Receipt',
    relatedId: 'r-1',
    idempotencyKey: 'Receipt:r-1:Email',
    updatedAt: new Date('2026-11-02T17:00:00Z'),
    ...over,
  };
}

function build(opts: { env?: Record<string, string>; rows?: Row[]; consents?: Row[]; window?: { fromHour: number; untilHour: number } } = {}) {
  const rows = opts.rows ?? [message()];
  const consents = opts.consents ?? [];
  const statements: Row[] = [{ id: 's-1', status: 'Emitido', sentAt: null }];
  const client: any = {
    messageOutbox: {
      findMany: jest.fn(async () => rows.filter((r) => r.status === 'Pending')),
      update: jest.fn(async ({ where, data }: any) => Object.assign(rows.find((r) => r.id === where.id)!, data)),
      updateMany: jest.fn(async ({ where, data }: any) => {
        let count = 0;
        for (const r of rows) {
          if (where.id && r.id !== where.id) continue;
          if (typeof where.status === 'string' && r.status !== where.status) continue;
          if (where.status?.in && !where.status.in.includes(r.status)) continue;
          if (where.updatedAt && !(r.updatedAt < where.updatedAt.lt)) continue;
          if (where.OR && r.statusReason === 'MESSAGING_OFF') continue;
          const { attempts, ...rest } = data;
          Object.assign(r, rest);
          if (attempts?.increment) r.attempts += attempts.increment;
          count++;
        }
        return { count };
      }),
    },
    contactConsent: {
      findFirst: jest.fn(async ({ where }: any) =>
        consents
          .filter((c) => c.channel === where.channel && (where.personId ? c.personId === where.personId : c.address === where.address))
          .sort((a, b) => b.at.getTime() - a.at.getTime())[0] ?? null,
      ),
    },
    ownerStatement: {
      updateMany: jest.fn(async ({ where, data }: any) => {
        const s = statements.find((x) => x.id === where.id && x.status === where.status);
        if (s) Object.assign(s, data);
        return { count: s ? 1 : 0 };
      }),
    },
  };
  const baseClient = {
    tenant: { findMany: jest.fn().mockResolvedValue([{ id: 't-1', name: 'Inmo' }]) },
    user: { findMany: jest.fn().mockResolvedValue([{ id: 'u-admin' }]) },
  };
  const { tenantCron, prisma } = makeTenantCron([], { client, baseClient } as any);
  const env = opts.env ?? { MESSAGING_MODE: 'live' };
  const config = new MessagingConfigService({ get: (k: string) => env[k] } as unknown as ConfigService);
  const defaults = { get: jest.fn().mockResolvedValue({ messaging: opts.window ?? { fromHour: 9, untilHour: 20 } }) };
  const attachments = {
    kindFor: jest.fn((key: string): string | undefined => (key === 'receipt' ? 'Receipt' : undefined)),
    resolve: jest.fn().mockResolvedValue({ filename: 'recibo-00000001.pdf', content: Buffer.from('%PDF'), mimeType: 'application/pdf' }),
  };
  const notifications = { createNotification: jest.fn().mockResolvedValue({ id: 'n-1' }) };
  const email = new FakeProvider(MessageChannel.Email);
  const whatsapp = new FakeProvider(MessageChannel.WhatsApp);
  const dispatcher = new OutboxDispatcherService(
    prisma as any,
    tenantCron,
    config,
    defaults as any,
    attachments as any,
    notifications as any,
    [email, whatsapp],
  );
  return { dispatcher, rows, email, whatsapp, attachments, notifications, statements, client };
}

describe('OutboxDispatcherService', () => {
  beforeEach(() => {
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe('modo del ambiente', () => {
    it('off (por defecto): no manda nada y deja el motivo a la vista', async () => {
      const { dispatcher, rows, email } = build({ env: {} });
      const s = await dispatcher.dispatchTenant('t-1', NOON);
      expect(s.held).toBe(1);
      expect(rows[0]).toMatchObject({ status: 'Pending', statusReason: 'MESSAGING_OFF' });
      expect(email.sent).toHaveLength(0);
    });

    it('allowlist: manda a las direcciones de la lista y bloquea el resto', async () => {
      const rows = [message(), message({ id: 'm-2', to: 'otra@example.com', idempotencyKey: 'k2' })];
      const { dispatcher, email } = build({
        env: { MESSAGING_MODE: 'allowlist', MESSAGING_ALLOWLIST: 'iris@example.com' },
        rows,
      });
      const s = await dispatcher.dispatchTenant('t-1', NOON);
      expect(s).toMatchObject({ sent: 1, blocked: 1 });
      expect(email.sent.map((m) => m.to)).toEqual(['iris@example.com']);
      expect(rows[1]).toMatchObject({ status: 'Blocked', statusReason: 'NOT_IN_ALLOWLIST' });
    });

    it('live: manda con el PDF del documento y la clave de idempotencia', async () => {
      const { dispatcher, rows, email, attachments } = build();
      const s = await dispatcher.dispatchTenant('t-1', NOON);
      expect(s.sent).toBe(1);
      expect(attachments.resolve).toHaveBeenCalledWith('Receipt', 'r-1');
      expect(email.sent[0]).toMatchObject({
        to: 'iris@example.com',
        templateKey: 'receipt',
        idempotencyKey: 'Receipt:r-1:Email',
        attachment: { filename: 'recibo-00000001.pdf' },
      });
      expect(rows[0]).toMatchObject({ status: 'Sent', attempts: 1, sentAt: NOON, error: null });
      expect(rows[0].providerMsgId).toMatch(/^fake-email-/);
    });
  });

  it('sin proveedor configurado el mensaje queda pendiente con el motivo y se avisa a la gerencia', async () => {
    const { dispatcher, rows, email, notifications } = build();
    email.configured = false;
    const s = await dispatcher.dispatchTenant('t-1', NOON);
    expect(s.held).toBe(1);
    expect(rows[0]).toMatchObject({ status: 'Pending', statusReason: 'PROVIDER_NOT_CONFIGURED', attempts: 0 });
    expect(rows[0].nextAttemptAt.getTime()).toBeGreaterThan(NOON.getTime());
    expect(notifications.createNotification).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'SystemAlert', entityId: 'provider-Email', userId: 'u-admin' }),
    );
  });

  describe('consentimiento', () => {
    it('WhatsApp sin alta se bloquea; con alta sale', async () => {
      const wa = message({ channel: 'WhatsApp', to: '5493515550101', idempotencyKey: 'k-wa' });
      const blocked = build({ rows: [wa] });
      await blocked.dispatcher.dispatchTenant('t-1', NOON);
      expect(blocked.rows[0]).toMatchObject({ status: 'Blocked', statusReason: 'NO_OPT_IN' });

      const allowed = build({
        rows: [message({ channel: 'WhatsApp', to: '5493515550101', idempotencyKey: 'k-wa' })],
        consents: [{ personId: 'p-1', channel: 'WhatsApp', status: 'OptIn', at: new Date('2026-10-01') }],
      });
      await allowed.dispatcher.dispatchTenant('t-1', NOON);
      expect(allowed.whatsapp.sent).toHaveLength(1);
    });

    it('una baja posterior, aunque sea de la dirección, se respeta', async () => {
      const { dispatcher, rows, email } = build({
        consents: [{ address: 'iris@example.com', channel: 'Email', status: 'OptOut', at: new Date('2026-10-05') }],
      });
      await dispatcher.dispatchTenant('t-1', NOON);
      expect(rows[0]).toMatchObject({ status: 'Blocked', statusReason: 'OPTED_OUT' });
      expect(email.sent).toHaveLength(0);
    });
  });

  describe('horario permitido', () => {
    it('fuera de horario un mensaje a la cartera espera a que abra', async () => {
      const { dispatcher, rows, email } = build();
      const s = await dispatcher.dispatchTenant('t-1', NIGHT);
      expect(s.held).toBe(1);
      expect(rows[0]).toMatchObject({ status: 'Pending', statusReason: 'QUIET_HOURS' });
      expect(rows[0].nextAttemptAt.toISOString()).toBe('2026-11-03T12:00:00.000Z');
      expect(email.sent).toHaveLength(0);
    });

    it('un aviso al personal sale a cualquier hora', async () => {
      const { dispatcher, email } = build({
        rows: [message({ templateKey: 'staff_alert', personId: null, relatedType: 'Notification', relatedId: 'n-1' })],
      });
      await dispatcher.dispatchTenant('t-1', NIGHT);
      expect(email.sent).toHaveLength(1);
    });
  });

  describe('reintentos', () => {
    it('un error transitorio se reintenta con espera creciente', async () => {
      const { dispatcher, rows, email } = build();
      email.failNext('NETWORK: ECONNRESET', true);
      const s = await dispatcher.dispatchTenant('t-1', NOON);
      expect(s.retried).toBe(1);
      expect(rows[0]).toMatchObject({ status: 'Pending', attempts: 1, error: 'NETWORK: ECONNRESET' });
      expect(rows[0].nextAttemptAt.getTime() - NOON.getTime()).toBe(60_000);

      email.failNext('NETWORK: ECONNRESET', true);
      await dispatcher.dispatchTenant('t-1', NOON);
      expect(rows[0].nextAttemptAt.getTime() - NOON.getTime()).toBe(5 * 60_000);
    });

    it('agotados los intentos queda fallido, borra los secretos y avisa a la gerencia', async () => {
      const { dispatcher, rows, email, notifications } = build({
        rows: [
          message({
            templateKey: 'user_invitation',
            vars: { link: 'https://app.example.com/auth/accept-invitation?token=abc' },
            attempts: MAX_ATTEMPTS - 1,
            relatedType: 'UserInvitation',
          }),
        ],
      });
      email.failNext('application_error: boom', true);
      const s = await dispatcher.dispatchTenant('t-1', NOON);
      expect(s.failed).toBe(1);
      expect(rows[0]).toMatchObject({ status: 'Failed', attempts: MAX_ATTEMPTS, vars: { link: '[oculto]' } });
      expect(notifications.createNotification).toHaveBeenCalledWith(
        expect.objectContaining({ type: 'MessageFailed', entityType: 'MessageOutbox', entityId: 'm-1' }),
      );
    });

    it('un rechazo del proveedor no se reintenta', async () => {
      const { dispatcher, rows, email } = build();
      email.failNext('validation_error: invalid to', false);
      await dispatcher.dispatchTenant('t-1', NOON);
      expect(rows[0]).toMatchObject({ status: 'Failed', attempts: 1, error: 'validation_error: invalid to' });
    });

    it('si el PDF no se puede generar falla sin reintentar', async () => {
      const { dispatcher, rows, attachments, email } = build();
      attachments.resolve.mockRejectedValue(new Error('Receipt not found'));
      await dispatcher.dispatchTenant('t-1', NOON);
      expect(rows[0]).toMatchObject({ status: 'Failed', error: 'ATTACHMENT_UNAVAILABLE: Receipt not found' });
      expect(email.sent).toHaveLength(0);
    });

    it('un mensaje que otra vuelta ya tomó no se manda dos veces', async () => {
      const { dispatcher, rows, email, client } = build();
      client.messageOutbox.findMany.mockResolvedValueOnce([{ ...rows[0] }]);
      rows[0].status = 'Sending';
      const s = await dispatcher.dispatchTenant('t-1', NOON);
      expect(s.held).toBe(1);
      expect(email.sent).toHaveLength(0);
    });

    it('uno que quedó enviándose por un corte pasa a fallido para reintentarlo a mano', async () => {
      const stale = message({ status: 'Sending', updatedAt: new Date(NOON.getTime() - STALE_SENDING_MS - 1) });
      const { dispatcher, rows } = build({ rows: [stale] });
      await dispatcher.dispatchTenant('t-1', NOON);
      expect(rows[0]).toMatchObject({ status: 'Failed' });
      expect(rows[0].error).toMatch(/^INTERRUPTED/);
    });
  });

  it('un estado de cuenta emitido pasa a Enviado cuando el mensaje sale', async () => {
    const { dispatcher, statements, attachments } = build({
      rows: [message({ templateKey: 'owner_statement', relatedType: 'OwnerStatement', relatedId: 's-1', idempotencyKey: 'k-s' })],
    });
    attachments.kindFor.mockReturnValue('OwnerStatement');
    await dispatcher.dispatchTenant('t-1', NOON);
    expect(statements[0]).toMatchObject({ status: 'Enviado', sentAt: NOON });
  });

  it('sin mensajes pendientes no consulta los valores por defecto', async () => {
    const { dispatcher } = build({ rows: [] });
    expect(await dispatcher.dispatchTenant('t-1', NOON)).toEqual({ sent: 0, retried: 0, failed: 0, blocked: 0, held: 0 });
  });

  it('el proceso programado corre en hora de Buenos Aires y no corre en test', async () => {
    const { dispatcher, email } = build();
    const options = Reflect.getMetadata('SCHEDULE_CRON_OPTIONS', OutboxDispatcherService.prototype.handleDispatch);
    expect(options.timeZone).toBe('America/Argentina/Buenos_Aires');
    await dispatcher.handleDispatch();
    expect(email.sent).toHaveLength(0);
  });

  it('fuera de test recorre las inmobiliarias activas', async () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const { dispatcher, email } = build({ rows: [message({ templateKey: 'staff_alert' })] });
      await dispatcher.handleDispatch();
      expect(email.sent).toHaveLength(1);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
