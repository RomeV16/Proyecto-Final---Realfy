import { liquidacionMessageVars } from './liquidacion-message';
import { attachmentFilename, renderEmail } from '../../common/messaging/message-templates';

/**
 * CP-131 (DEF-11): el mes del asunto sale del período en UTC; en hora de
 * Buenos Aires el 1 de marzo a medianoche UTC es el 28 de febrero local.
 */
describe('mail de la liquidación: mes del período independiente de la zona horaria', () => {
  const previousTz = process.env.TZ;

  beforeAll(() => {
    process.env.TZ = 'America/Argentina/Buenos_Aires';
  });

  afterAll(() => {
    if (previousTz === undefined) delete process.env.TZ;
    else process.env.TZ = previousTz;
  });

  it('el asunto, el texto y el adjunto usan marzo para el período 2025-03-01', () => {
    const vars = liquidacionMessageVars({ period: new Date('2025-03-01T00:00:00.000Z'), total: '100000' }, 'Inmobiliaria Demo');
    expect(vars).toEqual({ period: 'marzo de 2025', periodShort: '03/2025', total: '100.000,00', agency: 'Inmobiliaria Demo' });
    const mail = renderEmail('liquidacion', vars);
    expect(mail.subject).toBe('Liquidación 03/2025 - Inmobiliaria Demo');
    expect(mail.html).toMatch(/marzo de 2025/i);
    expect(attachmentFilename('liquidacion', vars, 'x.pdf')).toBe('liquidacion-03-2025.pdf');
  });
});
