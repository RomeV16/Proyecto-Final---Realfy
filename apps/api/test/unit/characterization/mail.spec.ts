import { ConfigService } from '@nestjs/config';

const send = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send } })),
}));

import { EmailService } from '../../../src/modules/liquidaciones/email.service';
import { RenditionEmailService } from '../../../src/modules/renditions/rendition-email.service';
import { NotificationEmailService } from '../../../src/modules/notifications/notification-email.service';

/**
 * Caracterización de los mails: asunto, cuerpo, adjuntos y destinatario que
 * llegan a Resend. El remitente depende del entorno y no se fija acá.
 */
function config(values: Record<string, string> = { RESEND_API_KEY: 're_test' }): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

function build() {
  const cfg = config();
  return {
    liquidaciones: new EmailService(cfg),
    renditions: new RenditionEmailService(cfg),
    notifications: new NotificationEmailService(cfg),
  };
}

/** Lo que Resend recibe, sin el remitente. */
function sentPayload() {
  const { from: _from, ...rest } = send.mock.calls[0][0];
  return rest;
}

describe('Caracterización de mails', () => {
  beforeEach(() => {
    send.mockReset();
    send.mockResolvedValue({ data: { id: 'email-1' } });
  });

  it('liquidación', async () => {
    const result = await build().liquidaciones.sendLiquidacionEmail(
      'inquilino@example.com',
      { id: 'l-1', period: new Date('2025-03-01T00:00:00.000Z'), total: '152500.5' },
      Buffer.from('pdf'),
      'Inmobiliaria Demo',
    );
    expect(result).toEqual({ id: 'email-1' });
    expect(sentPayload()).toMatchSnapshot();
  });

  it('rendición', async () => {
    const result = await build().renditions.sendRendicionEmail(
      'dueno@example.com',
      {
        id: 'r-1',
        period: new Date('2025-03-01T00:00:00.000Z'),
        netDeposit: '140999.75',
        owner: { firstName: 'Ana', lastName: 'Pérez' },
      },
      Buffer.from('pdf'),
      'Inmobiliaria Demo',
    );
    expect(result).toEqual({ id: 'email-1' });
    expect(sentPayload()).toMatchSnapshot();
  });

  it('rendición sin propietario', async () => {
    await build().renditions.sendRendicionEmail(
      'dueno@example.com',
      { id: 'r-2', period: new Date('2025-04-01T00:00:00.000Z'), netDeposit: 0 },
      Buffer.from('pdf'),
      'Inmobiliaria Demo',
    );
    expect(sentPayload()).toMatchSnapshot();
  });

  it('notificación', async () => {
    await build().notifications.sendNotificationEmail({
      to: 'usuario@example.com',
      subject: 'Aviso',
      title: 'Título',
      message: 'Mensaje',
      tenantName: 'Inmobiliaria Demo',
    });
    expect(sentPayload()).toMatchSnapshot();
  });

  it('sin RESEND_API_KEY no envía nada', async () => {
    const result = await new EmailService(config({})).sendLiquidacionEmail(
      'a@example.com',
      { id: 'l-1', period: new Date('2025-03-01T00:00:00.000Z'), total: 1 },
      Buffer.from('pdf'),
      'Demo',
    );
    expect(send).not.toHaveBeenCalled();
    expect(result).toBeNull();
  });

  it('un fallo de Resend en la liquidación se propaga', async () => {
    send.mockRejectedValue(new Error('resend caído'));
    await expect(
      build().liquidaciones.sendLiquidacionEmail(
        'a@example.com',
        { id: 'l-1', period: new Date('2025-03-01T00:00:00.000Z'), total: 1 },
        Buffer.from('pdf'),
        'Demo',
      ),
    ).rejects.toThrow('resend caído');
  });

  it('un fallo de Resend en la notificación no lanza', async () => {
    send.mockRejectedValue(new Error('resend caído'));
    const result = await build().notifications.sendNotificationEmail({
      to: 'usuario@example.com',
      subject: 'Aviso',
      title: 'Título',
      message: 'Mensaje',
      tenantName: 'Demo',
    });
    expect(result).toBeNull();
  });
});
