import { ConfigService } from '@nestjs/config';

const send = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send } })),
}));

import { MessageChannel } from '@realfy/shared';
import { CommonEmailService } from '../../../src/common/email/common-email.service';
import { ResendEmailProvider } from '../../../src/modules/messaging/providers/resend-email.provider';
import { liquidacionMessageVars } from '../../../src/modules/liquidaciones/liquidacion-message';
import type { OutgoingMessage } from '../../../src/modules/messaging/providers/message-provider';

/**
 * Caracterización de los mails: asunto, cuerpo, adjuntos y destinatario que
 * llegan a Resend. Desde la bandeja de salida (ADR-0013) los mails de la
 * liquidación y de los avisos al personal se arman con las plantillas
 * `liquidacion` y `staff_alert` y los manda el proveedor de Resend: el
 * contenido es el mismo que antes. El remitente depende del entorno y no se
 * fija acá.
 */
function config(values: Record<string, string> = { RESEND_API_KEY: 're_test' }): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const provider = (values?: Record<string, string>) => new ResendEmailProvider(new CommonEmailService(config(values)));

function message(templateKey: string, to: string, vars: Record<string, string>, attachment?: Buffer): OutgoingMessage {
  return {
    id: 'm-1',
    channel: MessageChannel.Email,
    to,
    templateKey,
    vars,
    idempotencyKey: `${templateKey}:1`,
    attachment: attachment ? { filename: 'documento.pdf', content: attachment, mimeType: 'application/pdf' } : undefined,
  };
}

const liquidacion = (agency = 'Inmobiliaria Demo', total = '152500.5') =>
  message(
    'liquidacion',
    'inquilino@example.com',
    liquidacionMessageVars({ period: new Date('2025-03-01T00:00:00.000Z'), total }, agency),
    Buffer.from('pdf'),
  );

const notificacion = message('staff_alert', 'usuario@example.com', {
  subject: 'Aviso',
  title: 'Título',
  message: 'Mensaje',
  agency: 'Inmobiliaria Demo',
});

/** Lo que Resend recibe, sin el remitente. */
function sentPayload() {
  const { from: _from, ...rest } = send.mock.calls[0][0];
  return rest;
}

describe('Caracterización de mails', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ data: { id: 'email-1' }, error: null });
  });

  it('liquidación', async () => {
    const result = await provider().send(liquidacion());
    expect(result).toEqual({ ok: true, providerMsgId: 'email-1' });
    expect(sentPayload()).toMatchSnapshot();
    // La clave de idempotencia del mensaje viaja como Idempotency-Key.
    expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: 'liquidacion:1' });
  });

  it('notificación', async () => {
    await provider().send(notificacion);
    expect(sentPayload()).toMatchSnapshot();
  });

  it('sin RESEND_API_KEY el proveedor no está configurado y no envía nada', async () => {
    const p = provider({});
    expect(p.isConfigured()).toBe(false);
    const result = await p.send(liquidacion('Demo', '1'));
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'PROVIDER_NOT_CONFIGURED', retryable: true });
  });

  it('un fallo de red se informa como reintentable, sin lanzar', async () => {
    send.mockRejectedValue(new Error('resend caído'));
    expect(await provider().send(liquidacion('Demo', '1'))).toEqual({ ok: false, error: 'resend caído', retryable: true });
  });

  it('un rechazo de datos de Resend no se reintenta', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'validation_error', message: 'Invalid `to` field' } });
    expect(await provider().send(notificacion)).toEqual({
      ok: false,
      error: 'validation_error: Invalid `to` field',
      retryable: false,
    });
  });

  it('un límite de envío de Resend se reintenta', async () => {
    send.mockResolvedValue({ data: null, error: { name: 'rate_limit_exceeded', message: 'Too many requests' } });
    expect((await provider().send(notificacion)).ok).toBe(false);
    expect(await provider().send(notificacion)).toMatchObject({ retryable: true });
  });
});
