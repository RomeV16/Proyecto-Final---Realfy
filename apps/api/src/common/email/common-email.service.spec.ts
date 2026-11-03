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
/** Lo manda el despacho de la bandeja de salida, que ya aplicó el modo. */
const OUTBOX = { purpose: 'outbox' } as const;

describe('CommonEmailService', () => {
  beforeEach(() => send.mockReset());

  it('sin RESEND_API_KEY no manda y lo informa como salteado', async () => {
    const service = new CommonEmailService(config({}));
    expect(service.isConfigured()).toBe(false);
    expect(await service.send(MAIL, OUTBOX)).toEqual({ status: 'skipped' });
    expect(send).not.toHaveBeenCalled();
  });

  it('un envío aceptado devuelve el id de Resend', async () => {
    send.mockResolvedValue({ data: { id: 'em_1' }, error: null });
    const service = new CommonEmailService(config({ RESEND_API_KEY: 're_test' }));
    expect(await service.send(MAIL, OUTBOX)).toEqual({ status: 'sent', id: 'em_1' });
  });

  // DEF-65: el SDK de Resend no lanza ante un rechazo de la API; devuelve
  // `{ data: null, error }`. El envío rechazado se informaba como enviado.
  it('un rechazo de la API de Resend se informa como fallido, no como enviado (DEF-65)', async () => {
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: 'The from address is not verified' },
    });
    const service = new CommonEmailService(config({ RESEND_API_KEY: 're_test' }));
    expect(await service.send(MAIL, OUTBOX)).toEqual({
      status: 'failed',
      error: 'validation_error: The from address is not verified',
    });
    expect(await service.sendEmail(MAIL, OUTBOX)).toBeNull();
  });

  it('un error de red se informa como fallido', async () => {
    send.mockRejectedValue(new Error('socket hang up'));
    const service = new CommonEmailService(config({ RESEND_API_KEY: 're_test' }));
    expect(await service.send(MAIL, OUTBOX)).toEqual({ status: 'failed', error: 'socket hang up' });
  });

  describe('modo de mensajería en los mails directos (ADR-0013)', () => {
    const KEY = { RESEND_API_KEY: 're_test' };

    beforeEach(() => send.mockResolvedValue({ data: { id: 'em_2' }, error: null }));

    it('sin MESSAGING_MODE (off) un mail directo no sale', async () => {
      const service = new CommonEmailService(config(KEY));
      expect(await service.send(MAIL)).toEqual({ status: 'skipped', reason: 'MESSAGING_OFF' });
      expect(send).not.toHaveBeenCalled();
    });

    it('con allowlist sale solo a las direcciones de la lista', async () => {
      const service = new CommonEmailService(
        config({ ...KEY, MESSAGING_MODE: 'allowlist', MESSAGING_ALLOWLIST: 'Persona@Example.com' }),
      );
      expect(await service.send(MAIL)).toEqual({ status: 'sent', id: 'em_2' });
      expect(await service.send({ ...MAIL, to: 'otra@example.com' })).toEqual({
        status: 'skipped',
        reason: 'NOT_IN_ALLOWLIST',
      });
      expect(send).toHaveBeenCalledTimes(1);
    });

    it('con live sale y con transactional sale aunque el modo esté apagado', async () => {
      expect(await new CommonEmailService(config({ ...KEY, MESSAGING_MODE: 'live' })).send(MAIL)).toEqual({
        status: 'sent',
        id: 'em_2',
      });
      expect(await new CommonEmailService(config(KEY)).send(MAIL, { purpose: 'transactional' })).toEqual({
        status: 'sent',
        id: 'em_2',
      });
    });

    it('pasa la clave de idempotencia a Resend y toma el remitente de RESEND_FROM', async () => {
      const service = new CommonEmailService(config({ ...KEY, RESEND_FROM: 'avisos@inmo.example' }));
      await service.send(MAIL, { purpose: 'outbox', idempotencyKey: 'Receipt:r1:Email' });
      expect(send.mock.calls[0][0].from).toBe('avisos@inmo.example');
      expect(send.mock.calls[0][1]).toEqual({ idempotencyKey: 'Receipt:r1:Email' });
    });
  });
});
