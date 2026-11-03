import { escapeHtml, MESSAGE_TEMPLATES, type MessageTemplateKey } from '@realfy/shared';

/**
 * Cuerpo de cada plantilla de la bandeja de salida (ADR-0013). Las variables
 * se guardan ya formateadas (montos, períodos) al encolar, así el mensaje
 * dice lo mismo aunque se despache horas después; acá solo se arma el texto y
 * se escapa el HTML.
 */
export type MessageVars = Record<string, string>;

export interface RenderedEmail {
  subject: string;
  html: string;
}

const v = (vars: MessageVars, key: string) => escapeHtml(vars[key] ?? '');

const EMAIL: Record<MessageTemplateKey, (vars: MessageVars) => RenderedEmail> = {
  receipt: (x) => ({
    subject: `Recibo de cobro Nº ${x.number ?? ''} - ${x.agency ?? ''}`,
    html:
      `<p>Hola ${v(x, 'name')},</p>` +
      `<p>Te enviamos el recibo de cobro <strong>Nº ${v(x, 'number')}</strong> por <strong>${v(x, 'amount')}</strong> en concepto de ${v(x, 'concept')}.</p>` +
      `<p>Lo adjuntamos en PDF.</p>` +
      `<p>Saludos cordiales,<br/>${v(x, 'agency')}</p>`,
  }),
  owner_statement: (x) => ({
    subject: `Estado de cuenta ${x.period ?? ''} - ${x.agency ?? ''}`,
    html:
      `<p>Hola ${v(x, 'name')},</p>` +
      `<p>Te enviamos tu estado de cuenta de <strong>${v(x, 'period')}</strong>. Saldo al cierre: <strong>${v(x, 'closing')}</strong>.</p>` +
      `<p>El detalle por unidad va en el PDF adjunto.</p>` +
      `<p>Saludos cordiales,<br/>${v(x, 'agency')}</p>`,
  }),
  // Mismo texto que mandaba la transición a Enviada antes de la bandeja de salida.
  liquidacion: (x) => ({
    subject: `Liquidación ${x.periodShort ?? ''} - ${x.agency ?? ''}`,
    html: `
          <h2>Liquidación de ${v(x, 'period')}</h2>
          <p>Estimado/a,</p>
          <p>Adjuntamos la liquidación correspondiente al período <strong>${v(x, 'period')}</strong>.</p>
          <p><strong>Total: $ ${v(x, 'total')}</strong></p>
          <p>Por favor revise el documento adjunto para ver el detalle completo.</p>
          <br/>
          <p>Saludos cordiales,<br/>${v(x, 'agency')}</p>
        `,
  }),
  ticket_status: (x) => ({
    subject: `Tu reclamo "${x.ticket ?? ''}": ${x.status ?? ''}`,
    html:
      `<p>Hola ${v(x, 'name')},</p>` +
      `<p>Tu reclamo <strong>${v(x, 'ticket')}</strong> cambió de estado: <strong>${v(x, 'status')}</strong>.</p>` +
      `<p>Podés seguirlo desde el portal.</p>` +
      `<p>Saludos cordiales,<br/>${v(x, 'agency')}</p>`,
  }),
  ticket_comment: (x) => ({
    subject: `Respuesta en tu reclamo "${x.ticket ?? ''}"`,
    html:
      `<p>Hola ${v(x, 'name')},</p>` +
      `<p>Hay una respuesta en tu reclamo <strong>${v(x, 'ticket')}</strong>:</p>` +
      `<blockquote>${v(x, 'comment')}</blockquote>` +
      `<p>Podés responder desde el portal.</p>` +
      `<p>Saludos cordiales,<br/>${v(x, 'agency')}</p>`,
  }),
  // Mismo texto que mandaba la invitación antes de la bandeja de salida.
  user_invitation: (x) => ({
    subject: 'Te invitaron a Realfy',
    html:
      `<p>Te invitaron a sumarte a una inmobiliaria en Realfy.</p>` +
      `<p>Creá tu cuenta desde este enlace. Sirve una sola vez y vence en 7 días:</p>` +
      `<p><a href="${v(x, 'link')}">${v(x, 'link')}</a></p>`,
  }),
  // Mismo texto que mandaban los avisos al personal antes de la bandeja de salida.
  staff_alert: (x) => ({
    subject: x.subject ?? '',
    html: `
          <h2>${v(x, 'title')}</h2>
          <p>${v(x, 'message')}</p>
          <br/>
          <p>Saludos cordiales,<br/>${v(x, 'agency')}</p>
        `,
  }),
};

export function isTemplateKey(key: string): key is MessageTemplateKey {
  return Object.prototype.hasOwnProperty.call(MESSAGE_TEMPLATES, key);
}

/** Asunto y cuerpo HTML del mail de una plantilla. */
export function renderEmail(templateKey: string, vars: MessageVars): RenderedEmail {
  if (!isTemplateKey(templateKey)) throw new Error(`Plantilla desconocida: ${templateKey}`);
  return EMAIL[templateKey](vars);
}

/**
 * Parámetros del cuerpo de la plantilla de WhatsApp, en el orden de `vars` del
 * catálogo. WhatsApp no acepta saltos de línea, tabulaciones ni más de cuatro
 * espacios seguidos en un parámetro, ni uno vacío.
 */
export function whatsappParams(templateKey: string, vars: MessageVars): string[] {
  if (!isTemplateKey(templateKey)) throw new Error(`Plantilla desconocida: ${templateKey}`);
  return MESSAGE_TEMPLATES[templateKey].vars.map((key) => {
    const text = (vars[key] ?? '').replace(/[\r\n\t]+/g, ' ').replace(/ {4,}/g, '   ').trim();
    return text || '-';
  });
}

/** Nombre del PDF adjunto; el de la liquidación conserva el que tenía. */
export function attachmentFilename(templateKey: string, vars: MessageVars, fallback: string): string {
  if (templateKey === 'liquidacion' && vars.periodShort) {
    return `liquidacion-${vars.periodShort.replace('/', '-')}.pdf`;
  }
  return fallback;
}
