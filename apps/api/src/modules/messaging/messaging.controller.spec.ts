import { createHmac } from 'node:crypto';
import type { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@realfy/shared';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { ConsentsController, MessagingSettingsController, OutboxController } from './messaging.controller';
import { WebhooksController } from './webhooks.controller';
import { messageProvidersFactory } from './messaging.module';
import { FakeProvider } from './providers/fake.provider';
import { ResendEmailProvider } from './providers/resend-email.provider';
import { WhatsAppCloudProvider } from './providers/whatsapp-cloud.provider';

describe('OutboxController, MessagingSettingsController y ConsentsController', () => {
  const admin = { list: jest.fn(), retry: jest.fn(), cancel: jest.fn(), settings: jest.fn() };
  const documents = { send: jest.fn() };
  const dispatcher = { dispatchTenant: jest.fn() };
  const consents = { forPerson: jest.fn(), set: jest.fn() };
  const outbox = new OutboxController(admin as any, documents as any, dispatcher as any, { getTenantId: () => 't-1' } as any);

  it('delegan en sus servicios', async () => {
    await outbox.list({ status: 'Failed' });
    await outbox.send({ kind: 'Receipt' });
    await outbox.retry('m-1');
    await outbox.cancel('m-2');
    await new MessagingSettingsController(admin as any).settings();
    const c = new ConsentsController(consents as any);
    await c.list('p-1');
    await c.set('p-1', { channel: 'Email' });
    expect(admin.list).toHaveBeenCalledWith({ status: 'Failed' });
    expect(documents.send).toHaveBeenCalledWith({ kind: 'Receipt' });
    expect(admin.retry).toHaveBeenCalledWith('m-1');
    expect(admin.cancel).toHaveBeenCalledWith('m-2');
    expect(admin.settings).toHaveBeenCalled();
    expect(consents.forPerson).toHaveBeenCalledWith('p-1');
    expect(consents.set).toHaveBeenCalledWith('p-1', { channel: 'Email' });
  });

  it('_run-now despacha la inmobiliaria del pedido solo en modo prueba', async () => {
    await outbox.runNow();
    expect(dispatcher.dispatchTenant).toHaveBeenCalledWith('t-1');
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(outbox.runNow()).rejects.toMatchObject({ response: { error: 'TEST_ONLY' } });
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});

describe('WebhooksController', () => {
  const env: Record<string, string> = {
    WHATSAPP_APP_SECRET: 'secreto-app',
    WHATSAPP_VERIFY_TOKEN: 'token-verificacion',
    WHATSAPP_PHONE_NUMBER_ID: '1000000001',
  };
  const config = new MessagingConfigService({ get: (k: string) => env[k] } as unknown as ConfigService);
  const webhooks = { handleWhatsApp: jest.fn(), handleResend: jest.fn() };
  const controller = new WebhooksController(config, webhooks as any);
  const raw = Buffer.from('{"entry":[]}');

  beforeEach(() => jest.clearAllMocks());

  it('verifica la suscripción con el token y devuelve el desafío', () => {
    expect(controller.verifyWhatsApp('subscribe', 'token-verificacion', '12345')).toBe('12345');
    for (const [mode, token, challenge] of [
      ['subscribe', 'otro', '1'],
      ['unsubscribe', 'token-verificacion', '1'],
      ['subscribe', 'token-verificacion', ''],
      ['subscribe', '', '1'],
    ]) {
      expect(() => controller.verifyWhatsApp(mode, token, challenge)).toThrow();
    }
  });

  it('acepta un aviso de WhatsApp firmado y rechaza uno sin firma o con otra', async () => {
    const sig = `sha256=${createHmac('sha256', 'secreto-app').update(raw).digest('hex')}`;
    await expect(controller.whatsapp({ rawBody: raw } as any, sig, { entry: [] })).resolves.toEqual({ received: true });
    expect(webhooks.handleWhatsApp).toHaveBeenCalledWith({ entry: [] }, '1000000001');

    await expect(controller.whatsapp({ rawBody: raw } as any, undefined, {})).rejects.toMatchObject({
      response: { error: 'INVALID_SIGNATURE' },
    });
    await expect(controller.whatsapp({ rawBody: Buffer.from('{}') } as any, sig, {})).rejects.toMatchObject({ status: 401 });
    expect(webhooks.handleWhatsApp).toHaveBeenCalledTimes(1);
  });

  it('sin secreto de Resend rechaza todo; con la firma de svix lo procesa', async () => {
    await expect(controller.resend({ rawBody: raw } as any, 'msg_1', '1', 'v1,x', {})).rejects.toMatchObject({ status: 401 });

    const key = Buffer.from('clave-de-prueba-de-32-bytes!!!!!');
    env.RESEND_WEBHOOK_SECRET = `whsec_${key.toString('base64')}`;
    const ts = String(Math.floor(Date.now() / 1000));
    const sig = createHmac('sha256', key).update(`msg_1.${ts}.`).update(raw).digest('base64');
    const event = { type: 'email.delivered', data: { email_id: 'em_1' } };
    await expect(controller.resend({ rawBody: raw } as any, 'msg_1', ts, `v1,${sig}`, event)).resolves.toEqual({ received: true });
    expect(webhooks.handleResend).toHaveBeenCalledWith(event);
  });
});

describe('proveedores por ambiente', () => {
  const config = new MessagingConfigService({ get: () => undefined } as unknown as ConfigService);

  it('en test son proveedores de prueba: nada sale de la máquina', () => {
    const providers = messageProvidersFactory({} as any, config);
    expect(providers.every((p) => p instanceof FakeProvider)).toBe(true);
    expect(providers.map((p) => p.channel)).toEqual([MessageChannel.Email, MessageChannel.WhatsApp]);
  });

  it('fuera de test son Resend y la Cloud API de WhatsApp', () => {
    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const [email, whatsapp] = messageProvidersFactory({ isConfigured: () => false } as any, config);
      expect(email).toBeInstanceOf(ResendEmailProvider);
      expect(whatsapp).toBeInstanceOf(WhatsAppCloudProvider);
      expect(email.isConfigured()).toBe(false);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });
});
