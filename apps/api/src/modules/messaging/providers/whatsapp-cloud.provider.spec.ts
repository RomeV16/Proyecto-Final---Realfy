import type { ConfigService } from '@nestjs/config';
import { MessageChannel } from '@realfy/shared';
import { MessagingConfigService } from '../../../common/messaging/messaging-config.service';
import { WhatsAppCloudProvider } from './whatsapp-cloud.provider';
import type { OutgoingMessage } from './message-provider';

const ENV = { WHATSAPP_TOKEN: 'tok-prueba', WHATSAPP_PHONE_NUMBER_ID: '1000000001' };

function provider(http: jest.Mock, env: Record<string, string> = ENV) {
  const config = new MessagingConfigService({ get: (k: string) => env[k] } as unknown as ConfigService);
  return new WhatsAppCloudProvider(config, http as unknown as typeof fetch);
}

const reply = (status: number, body: unknown) =>
  ({ ok: status < 400, status, statusText: 'x', json: async () => body }) as unknown as Response;

const message = (over: Partial<OutgoingMessage> = {}): OutgoingMessage => ({
  id: 'm-1',
  channel: MessageChannel.WhatsApp,
  to: '5493515550101',
  templateKey: 'owner_statement',
  vars: { name: 'Ana', period: 'octubre de 2026', closing: 'ARS 120.000,00', agency: 'Inmo Demo' },
  idempotencyKey: 'OwnerStatement:s-1:WhatsApp',
  ...over,
});

describe('WhatsAppCloudProvider (Graph API simulada)', () => {
  it('sin token o sin número no está configurado', () => {
    expect(provider(jest.fn(), {}).isConfigured()).toBe(false);
    expect(provider(jest.fn()).isConfigured()).toBe(true);
  });

  it('manda la plantilla de utilidad por nombre e idioma, con los parámetros en orden', async () => {
    const http = jest.fn().mockResolvedValue(reply(200, { messages: [{ id: 'wamid.A1' }] }));
    const res = await provider(http).send(message());
    expect(res).toEqual({ ok: true, providerMsgId: 'wamid.A1' });

    const [url, init] = http.mock.calls[0];
    expect(url).toBe('https://graph.facebook.com/v21.0/1000000001/messages');
    expect(init.headers.Authorization).toBe('Bearer tok-prueba');
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      messaging_product: 'whatsapp',
      to: '5493515550101',
      type: 'template',
      template: { name: 'estado_de_cuenta', language: { code: 'es_AR' } },
    });
    expect(body.template.components).toEqual([
      {
        type: 'body',
        parameters: ['Ana', 'octubre de 2026', 'ARS 120.000,00', 'Inmo Demo'].map((text) => ({ type: 'text', text })),
      },
    ]);
  });

  it('con PDF primero lo sube a /media y lo manda como documento del encabezado', async () => {
    const http = jest
      .fn()
      .mockResolvedValueOnce(reply(200, { id: 'media-9' }))
      .mockResolvedValueOnce(reply(200, { messages: [{ id: 'wamid.B2' }] }));
    const res = await provider(http).send(
      message({ attachment: { filename: 'estado.pdf', content: Buffer.from('%PDF'), mimeType: 'application/pdf' } }),
    );
    expect(res).toEqual({ ok: true, providerMsgId: 'wamid.B2' });
    expect(http.mock.calls[0][0]).toBe('https://graph.facebook.com/v21.0/1000000001/media');
    const form = http.mock.calls[0][1].body as FormData;
    expect(form.get('messaging_product')).toBe('whatsapp');
    expect(form.get('type')).toBe('application/pdf');
    expect((form.get('file') as File).name).toBe('estado.pdf');
    const sent = JSON.parse(http.mock.calls[1][1].body);
    expect(sent.template.components[0]).toEqual({
      type: 'header',
      parameters: [{ type: 'document', document: { id: 'media-9', filename: 'estado.pdf' } }],
    });
  });

  it('si la subida falla no manda el mensaje', async () => {
    const http = jest.fn().mockResolvedValueOnce(reply(400, { error: { message: 'Bad file', code: 100 } }));
    const res = await provider(http).send(
      message({ attachment: { filename: 'x.pdf', content: Buffer.from('x'), mimeType: 'application/pdf' } }),
    );
    expect(res).toEqual({ ok: false, error: 'WHATSAPP_400_100: Bad file', retryable: false });
    expect(http).toHaveBeenCalledTimes(1);
  });

  it('un rechazo de datos no se reintenta; un 5xx, un 429 o un límite de Meta sí', async () => {
    const send = (status: number, body: unknown) => provider(jest.fn().mockResolvedValue(reply(status, body))).send(message());
    expect(await send(400, { error: { message: 'Template name does not exist', code: 132001 } })).toEqual({
      ok: false,
      error: 'WHATSAPP_400_132001: Template name does not exist',
      retryable: false,
    });
    expect(await send(503, {})).toMatchObject({ ok: false, retryable: true });
    expect(await send(429, {})).toMatchObject({ ok: false, retryable: true });
    expect(await send(400, { error: { message: 'Rate limit hit', code: 130429 } })).toMatchObject({ retryable: true });
  });

  it('un error de red se reintenta', async () => {
    const res = await provider(jest.fn().mockRejectedValue(new Error('ECONNRESET'))).send(message());
    expect(res).toEqual({ ok: false, error: 'NETWORK: ECONNRESET', retryable: true });
  });

  it('una respuesta sin id se reintenta', async () => {
    const res = await provider(jest.fn().mockResolvedValue(reply(200, {}))).send(message());
    expect(res).toMatchObject({ ok: false, retryable: true });
  });

  it('una plantilla sin versión de WhatsApp (la liquidación) no se manda', async () => {
    const http = jest.fn();
    const res = await provider(http).send(message({ templateKey: 'liquidacion' }));
    expect(res).toEqual({ ok: false, error: 'WHATSAPP_TEMPLATE_MISSING: liquidacion', retryable: false });
    expect(http).not.toHaveBeenCalled();
  });

  describe('texto libre de la bandeja de consultas', () => {
    const free = (over: Partial<OutgoingMessage> = {}) =>
      message({ templateKey: 'inbox_message', vars: { subject: 'Re: algo', text: ' Hola Iris\nSí, está disponible. ', agency: 'Inmo Demo' }, ...over });

    it('se manda como mensaje de texto, sin plantilla, conservando los saltos de línea', async () => {
      const http = jest.fn().mockResolvedValue(reply(200, { messages: [{ id: 'wamid.T1' }] }));
      await expect(provider(http).send(free())).resolves.toEqual({ ok: true, providerMsgId: 'wamid.T1' });
      const [url, init] = http.mock.calls[0];
      expect(url).toBe('https://graph.facebook.com/v21.0/1000000001/messages');
      expect(JSON.parse(init.body)).toEqual({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: '5493515550101',
        type: 'text',
        text: { preview_url: false, body: 'Hola Iris\nSí, está disponible.' },
      });
    });

    it('fuera de la ventana de 24 horas Meta lo rechaza (131047) y no se reintenta', async () => {
      const http = jest.fn().mockResolvedValue(reply(400, { error: { message: 'Re-engagement message', code: 131047 } }));
      await expect(provider(http).send(free())).resolves.toEqual({
        ok: false,
        error: 'WHATSAPP_400_131047: Re-engagement message',
        retryable: false,
      });
    });

    it('un error de red se reintenta y una respuesta sin id también', async () => {
      await expect(provider(jest.fn().mockRejectedValue(new Error('ECONNRESET'))).send(free())).resolves.toEqual({
        ok: false,
        error: 'NETWORK: ECONNRESET',
        retryable: true,
      });
      await expect(provider(jest.fn().mockResolvedValue(reply(200, {}))).send(free())).resolves.toMatchObject({ ok: false, retryable: true });
    });
  });
});
