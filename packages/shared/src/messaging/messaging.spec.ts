import {
  DEFAULT_SENDING_WINDOW,
  MESSAGE_TEMPLATES,
  MESSAGE_TEMPLATE_KEYS,
  REDACTED,
  isInsideSendingWindow,
  nextSendingWindowStart,
  normalizeAddress,
  normalizeEmail,
  normalizePhone,
  parseAllowlist,
  parseMessagingMode,
  redactMessageVars,
  requiresOptIn,
} from './index';
import { MessageChannel } from '../enums';

describe('modo de mensajería', () => {
  it('acepta los tres modos sin importar mayúsculas ni espacios', () => {
    expect(parseMessagingMode('off')).toBe('off');
    expect(parseMessagingMode(' Allowlist ')).toBe('allowlist');
    expect(parseMessagingMode('LIVE')).toBe('live');
  });

  it('un valor vacío o desconocido es off: falla cerrado', () => {
    expect(parseMessagingMode(undefined)).toBe('off');
    expect(parseMessagingMode('')).toBe('off');
    expect(parseMessagingMode('on')).toBe('off');
    expect(parseMessagingMode('true')).toBe('off');
  });
});

describe('direcciones', () => {
  it('normaliza mails a minúsculas y rechaza lo que no es un mail', () => {
    expect(normalizeEmail('  Ana.Perez@Example.COM ')).toBe('ana.perez@example.com');
    expect(normalizeEmail('sin-arroba')).toBeNull();
    expect(normalizeEmail(null)).toBeNull();
  });

  it('lleva los celulares argentinos al formato de WhatsApp (549 + característica + número)', () => {
    expect(normalizePhone('351 555-0101')).toBe('5493515550101');
    expect(normalizePhone('0351 5550101')).toBe('5493515550101');
    expect(normalizePhone('+54 351 555 0101')).toBe('5493515550101');
    expect(normalizePhone('+54 9 351 555 0101')).toBe('5493515550101');
    expect(normalizePhone('0054 9 351 555 0101')).toBe('5493515550101');
  });

  it('quita el 0 de larga distancia y el 15 del celular local', () => {
    expect(normalizePhone('0351 15 555-0101')).toBe('5493515550101');
    expect(normalizePhone('011 15 5555-0101')).toBe('5491155550101');
    expect(normalizePhone('02944 15 55-0101')).toBe('5492944550101');
    expect(normalizePhone('11 5555-0101')).toBe('5491155550101');
  });

  it('deja como está un número de otro país y rechaza uno corto', () => {
    expect(normalizePhone('+1 202 555 0143')).toBe('12025550143');
    expect(normalizePhone('5550101')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });

  it('normaliza según el canal', () => {
    expect(normalizeAddress(MessageChannel.Email, 'A@B.COM')).toBe('a@b.com');
    expect(normalizeAddress(MessageChannel.WhatsApp, '3515550101')).toBe('5493515550101');
  });

  it('arma la lista permitida con mails y teléfonos normalizados', () => {
    const list = parseAllowlist('Prueba@Example.com, +54 351 555 0101; basura;\n otra@example.com');
    expect([...list].sort((a, b) => a.localeCompare(b))).toEqual([
      '5493515550101',
      'otra@example.com',
      'prueba@example.com',
    ]);
    expect(parseAllowlist(undefined).size).toBe(0);
  });
});

describe('horario permitido (hora de Buenos Aires, UTC-3)', () => {
  const w = DEFAULT_SENDING_WINDOW;

  it('de 9 a 20 inclusive al abrir y exclusive al cerrar', () => {
    expect(isInsideSendingWindow(new Date('2026-11-02T12:00:00Z'), w)).toBe(true); // 09:00
    expect(isInsideSendingWindow(new Date('2026-11-02T11:59:00Z'), w)).toBe(false); // 08:59
    expect(isInsideSendingWindow(new Date('2026-11-02T22:59:00Z'), w)).toBe(true); // 19:59
    expect(isInsideSendingWindow(new Date('2026-11-02T23:00:00Z'), w)).toBe(false); // 20:00
  });

  it('antes de abrir, el próximo inicio es hoy a las 9', () => {
    expect(nextSendingWindowStart(new Date('2026-11-02T10:30:00Z'), w).toISOString()).toBe('2026-11-02T12:00:00.000Z');
  });

  it('después de cerrar, el próximo inicio es mañana a las 9 (aunque en UTC ya sea otro día)', () => {
    expect(nextSendingWindowStart(new Date('2026-11-02T23:30:00Z'), w).toISOString()).toBe('2026-11-03T12:00:00.000Z');
    expect(nextSendingWindowStart(new Date('2026-11-03T01:15:00Z'), w).toISOString()).toBe('2026-11-03T12:00:00.000Z');
  });

  it('adentro del horario devuelve el mismo instante', () => {
    const now = new Date('2026-11-02T15:00:00Z');
    expect(nextSendingWindowStart(now, w)).toBe(now);
  });
});

describe('plantillas', () => {
  it('cada clave del catálogo tiene su plantilla, y cada plantilla de WhatsApp su texto con un parámetro por variable', () => {
    for (const key of MESSAGE_TEMPLATE_KEYS) {
      const t = MESSAGE_TEMPLATES[key];
      expect(t.key).toBe(key);
      if (t.channels.includes(MessageChannel.WhatsApp)) {
        expect(t.whatsapp?.name).toMatch(/^[a-z0-9_]+$/);
        const params = t.whatsappText?.match(/\{\{\d+\}\}/g) ?? [];
        expect(params).toHaveLength(t.vars.length);
      }
    }
  });

  it('las plantillas del personal van solo por mail', () => {
    for (const t of Object.values(MESSAGE_TEMPLATES)) {
      if (t.audience === 'staff') expect(t.channels).toEqual([MessageChannel.Email]);
    }
  });

  it('oculta las variables secretas (el enlace de una invitación)', () => {
    expect(redactMessageVars('user_invitation', { link: 'https://x/t/abc' })).toEqual({ link: REDACTED });
    expect(redactMessageVars('receipt', { number: '0001-00000001' })).toEqual({ number: '0001-00000001' });
    expect(redactMessageVars('desconocida', null)).toEqual({});
  });

  it('WhatsApp a la cartera necesita el alta; el mail y los avisos al personal no', () => {
    expect(requiresOptIn(MessageChannel.WhatsApp, 'receipt')).toBe(true);
    expect(requiresOptIn(MessageChannel.Email, 'receipt')).toBe(false);
    expect(requiresOptIn(MessageChannel.WhatsApp, 'staff_alert')).toBe(false);
  });
});
