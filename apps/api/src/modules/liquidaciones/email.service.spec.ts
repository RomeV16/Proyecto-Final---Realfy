import { ConfigService } from '@nestjs/config';

const send = jest.fn().mockResolvedValue({ data: { id: 'email-1' } });
jest.mock('resend', () => ({
  Resend: jest.fn().mockImplementation(() => ({ emails: { send } })),
}));

import { EmailService } from './email.service';
import { CommonEmailService } from '../../common/email/common-email.service';

/**
 * CP-131 (DEF-11): el mes del asunto sale del período en UTC; en hora de
 * Buenos Aires el 1 de marzo a medianoche UTC es el 28 de febrero local.
 */
describe('EmailService: mes del período independiente de la zona horaria', () => {
  const previousTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
  });

  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  it('el asunto y el adjunto usan marzo para el período 2025-03-01', async () => {
    const config = { get: (key: string) => (key === 'RESEND_API_KEY' ? 're_test' : undefined) };
    const service = new EmailService(new CommonEmailService(config as unknown as ConfigService));

    await service.sendLiquidacionEmail(
      'inquilino@example.com',
      { id: 'l-1', period: new Date('2025-03-01T00:00:00.000Z'), total: '100000' },
      Buffer.from('pdf'),
      'Inmobiliaria Demo',
    );

    const args = send.mock.calls[0][0];
    expect(args.subject).toBe('Liquidación 03/2025 - Inmobiliaria Demo');
    expect(args.attachments[0].filename).toBe('liquidacion-03-2025.pdf');
    expect(args.html).toMatch(/marzo de 2025/i);
  });
});
