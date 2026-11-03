import { ConfigService } from '@nestjs/config';

const send = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send } })),
}));

import { MessageChannel } from '@realfy/shared';
import { CommonEmailService } from '../../../src/common/email/common-email.service';
import { ResendEmailProvider } from '../../../src/modules/messaging/providers/resend-email.provider';
import type { OutgoingMessage } from '../../../src/modules/messaging/providers/message-provider';

/**
 * Caracterización de los mails: asunto, cuerpo, adjuntos y destinatario que
 * llegan a Resend. Desde la bandeja de salida (ADR-0013) los mails de los
 * avisos al personal se arman con la plantilla `staff_alert` y los manda el
 * proveedor de Resend: el contenido es el mismo que antes. El remitente depende del entorno y no se
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

  it('notificación', async () => {
    await provider().send(notificacion);
    expect(sentPayload()).toMatchSnapshot();
  });

  it('sin RESEND_API_KEY el proveedor no está configurado y no envía nada', async () => {
    const p = provider({});
    expect(p.isConfigured()).toBe(false);
    const result = await p.send(notificacion);
    expect(send).not.toHaveBeenCalled();
    expect(result).toEqual({ ok: false, error: 'PROVIDER_NOT_CONFIGURED', retryable: true });
  });

  it('un fallo de red se informa como reintentable, sin lanzar', async () => {
    send.mockRejectedValue(new Error('resend caído'));
    expect(await provider().send(notificacion)).toEqual({ ok: false, error: 'resend caído', retryable: true });
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
