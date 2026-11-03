import { MESSAGE_TEMPLATE_KEYS, MESSAGE_TEMPLATES, MessageChannel } from '@realfy/shared';
import { attachmentFilename, isTemplateKey, renderEmail, whatsappFreeText, whatsappParams } from './message-templates';
import { consentBlock } from './consent-policy';
import { MessagingConfigService } from './messaging-config.service';
import type { ConfigService } from '@nestjs/config';

describe('plantillas de la bandeja de salida', () => {
  it('cada plantilla del catálogo arma un mail con asunto y cuerpo', () => {
    for (const key of MESSAGE_TEMPLATE_KEYS) {
      const vars = Object.fromEntries(MESSAGE_TEMPLATES[key].vars.map((v) => [v, `valor-${v}`]));
      const mail = renderEmail(key, vars);
      expect(mail.subject.length).toBeGreaterThan(0);
      expect(mail.html.length).toBeGreaterThan(0);
    }
  });

  it('escapa el HTML de las variables (un nombre o un comentario no inyectan marcado)', () => {
    const mail = renderEmail('ticket_comment', {
      name: 'Iris <b>',
      ticket: 'Pérdida',
      comment: '<script>alert(1)</script>',
      agency: 'Inmo & Cía',
    });
    expect(mail.html).not.toContain('<script>');
    expect(mail.html).toContain('&lt;script&gt;');
    expect(mail.html).toContain('Inmo &amp; Cía');
  });

  it('la respuesta de la bandeja respeta los saltos de línea, escapa el HTML y firma con la inmobiliaria', () => {
    const mail = renderEmail('inbox_message', { subject: 'Re: depto', text: 'Hola <b>Iris</b>\nTe esperamos', agency: 'Inmo & Cía' });
    expect(mail.subject).toBe('Re: depto');
    expect(mail.html).toContain('Hola &lt;b&gt;Iris&lt;/b&gt;<br/>Te esperamos');
    expect(mail.html).toContain('Inmo &amp; Cía');
    expect(renderEmail('inbox_message', {}).subject).toBe('');
  });

  it('el texto libre de WhatsApp se recorta al tope de la API', () => {
    expect(whatsappFreeText({ text: '  hola  ' })).toBe('hola');
    expect(whatsappFreeText({})).toBe('');
    expect(whatsappFreeText({ text: 'x'.repeat(5000) })).toHaveLength(4096);
  });

  it('el recibo nombra número, monto y concepto', () => {
    const mail = renderEmail('receipt', {
      name: 'Iris',
      number: '00000012',
      amount: 'ARS 350.000,00',
      concept: 'alquiler de octubre de 2026',
      agency: 'Inmo Demo',
    });
    expect(mail.subject).toBe('Recibo de cobro Nº 00000012 - Inmo Demo');
    expect(mail.html).toContain('ARS 350.000,00');
  });

  it('los parámetros de WhatsApp siguen el orden del catálogo y no llevan saltos ni vacíos', () => {
    expect(
      whatsappParams('ticket_comment', { name: 'Iris', ticket: 'Pérdida', comment: 'línea 1\n\tlínea 2     fin', agency: '' }),
    ).toEqual(['Iris', 'Pérdida', 'línea 1 línea 2   fin', '-']);
  });

  it('una plantilla desconocida es un error de programación', () => {
    expect(isTemplateKey('nada')).toBe(false);
    expect(() => renderEmail('nada', {})).toThrow('Plantilla desconocida');
    expect(() => whatsappParams('nada', {})).toThrow('Plantilla desconocida');
  });

  it('el adjunto conserva su nombre salvo el de la liquidación', () => {
    expect(attachmentFilename('receipt', {}, 'recibo-00000012.pdf')).toBe('recibo-00000012.pdf');
    expect(attachmentFilename('liquidacion', { periodShort: '10/2026' }, 'x.pdf')).toBe('liquidacion-10-2026.pdf');
  });
});

describe('regla de consentimiento', () => {
  const optIn = { status: 'OptIn' as const };
  const optOut = { status: 'OptOut' as const };

  it('WhatsApp a la cartera necesita el alta; una baja corta todo', () => {
    expect(consentBlock(null, MessageChannel.WhatsApp, 'receipt')).toBe('NO_OPT_IN');
    expect(consentBlock(optIn as any, MessageChannel.WhatsApp, 'receipt')).toBeNull();
    // La respuesta a quien escribió primero no pide el alta, pero la baja se respeta.
    expect(consentBlock(null, MessageChannel.WhatsApp, 'inbox_message')).toBeNull();
    expect(consentBlock({ status: 'OptOut' } as any, MessageChannel.WhatsApp, 'inbox_message')).toBe('OPTED_OUT');
    expect(consentBlock({ status: 'OptOut' } as any, MessageChannel.Email, 'inbox_message')).toBe('OPTED_OUT');
    expect(consentBlock(optOut as any, MessageChannel.WhatsApp, 'receipt')).toBe('OPTED_OUT');
  });

  it('el mail a la cartera sale mientras no haya baja', () => {
    expect(consentBlock(null, MessageChannel.Email, 'receipt')).toBeNull();
    expect(consentBlock(optOut as any, MessageChannel.Email, 'owner_statement')).toBe('OPTED_OUT');
  });

  it('los mensajes al personal no dependen del consentimiento', () => {
    expect(consentBlock(optOut as any, MessageChannel.Email, 'user_invitation')).toBeNull();
    expect(consentBlock(optOut as any, MessageChannel.Email, 'staff_alert')).toBeNull();
  });
});

describe('MessagingConfigService', () => {
  const make = (env: Record<string, string>) =>
    new MessagingConfigService({ get: (k: string) => env[k] } as unknown as ConfigService);

  it('sin variables: modo off, nada permitido, proveedores sin credenciales', () => {
    const c = make({});
    expect(c.mode).toBe('off');
    expect(c.allowsAddress('iris@example.com')).toBe(false);
    expect(c.whatsappConfigured()).toBe(false);
    expect(c.resend.from).toBe('noreply@realfy.com.ar');
    expect(c.whatsapp.graphVersion).toBe('v21.0');
    expect(c.inbox).toEqual({ emailIngestSecret: undefined, whatsappTenantSlug: undefined });
  });

  it('allowlist deja pasar solo las direcciones de la lista; live deja pasar todas', () => {
    const c = make({ MESSAGING_MODE: 'allowlist', MESSAGING_ALLOWLIST: 'iris@example.com, +54 351 555 0101' });
    expect(c.allowsAddress('iris@example.com')).toBe(true);
    expect(c.allowsAddress('5493515550101')).toBe(true);
    expect(c.allowsAddress('otra@example.com')).toBe(false);
    expect(make({ MESSAGING_MODE: 'live' }).allowsAddress('otra@example.com')).toBe(true);
  });

  it('RESEND_FROM tiene prioridad sobre RESEND_FROM_ADDRESS; espacios vacíos no cuentan', () => {
    expect(make({ RESEND_FROM: 'a@x.example', RESEND_FROM_ADDRESS: 'b@x.example' }).resend.from).toBe('a@x.example');
    expect(make({ RESEND_FROM: '  ', RESEND_FROM_ADDRESS: 'b@x.example' }).resend.from).toBe('b@x.example');
    expect(make({ WHATSAPP_TOKEN: 't', WHATSAPP_PHONE_NUMBER_ID: '123' }).whatsappConfigured()).toBe(true);
  });
});
