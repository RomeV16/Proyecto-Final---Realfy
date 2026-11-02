import { ConfigService } from '@nestjs/config';

const send = jest.fn();
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send } })),
}));

import { CommonEmailService } from './common-email.service';

function config(values: Record<string, string>): ConfigService {
  return { get: (key: string) => values[key] } as unknown as ConfigService;
}

const MAIL = { to: 'persona@example.com', subject: 'Asunto', html: '<p>Hola</p>' };

describe('CommonEmailService', () => {
  beforeEach(() => send.mockReset());

  it('sin RESEND_API_KEY no manda y lo informa como salteado', async () => {
    const service = new CommonEmailService(config({}));
    expect(service.isConfigured()).toBe(false);
    expect(await service.send(MAIL)).toEqual({ status: 'skipped' });
    expect(send).not.toHaveBeenCalled();
  });

  it('un envío aceptado devuelve el id de Resend', async () => {
    send.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const service = new CommonEmailService(config({ RESEND_API_KEY: 're_test' }));
    expect(await service.send(MAIL)).toEqual({ status: 'sent', id: 'em_1' });
  });

  // DEF-65: el SDK de Resend no lanza ante un rechazo de la API; devuelve
  // `{ data: null, error }`. El envío rechazado se informaba como enviado.
  it('un rechazo de la API de Resend se informa como fallido, no como enviado (DEF-65)', async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'The from address is not verified' },
    });
    const service = new CommonEmailService(config({ RESEND_API_KEY: 're_test' }));
    expect(await service.send(MAIL)).toEqual({
      status: 'failed',
      error: 'validation_error: The from address is not verified',
    });
    expect(await service.sendEmail(MAIL)).toBeNull();
  });

  it('un error de red se informa como fallido', async () => {
    send.mockRejectedValue(new Error('socket hang up'));
    const service = new CommonEmailService(config({ RESEND_API_KEY: 're_test' }));
    expect(await service.send(MAIL)).toEqual({ status: 'failed', error: 'socket hang up' });
  });
});
