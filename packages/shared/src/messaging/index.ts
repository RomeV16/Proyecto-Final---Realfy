import { AR_TIME_ZONE } from '../date-utils';
import { MessageChannel } from '../enums';

/**
 * Mensajería saliente (ADR-0013): modos de envío, catálogo de plantillas,
 * direcciones normalizadas y horario permitido. Puro: no lee la base ni el
 * entorno; la API y la web lo usan igual.
 */

// ─── Modo del ambiente ──────────────────────────────────

/**
 * Qué hace el despacho en un ambiente (variable MESSAGING_MODE):
 * - `off`: los mensajes se encolan y nunca se mandan (valor por defecto).
 * - `allowlist`: solo se mandan a las direcciones de MESSAGING_ALLOWLIST; el
 *   resto queda bloqueado.
 * - `live`: se mandan a quien corresponda, respetando el consentimiento.
 */
export const MESSAGING_MODES = ['off', 'allowlist', 'live'] as const;
export type MessagingMode = (typeof MESSAGING_MODES)[number];

/** Lee el modo; cualquier valor desconocido o vacío es `off` (falla cerrado). */
export function parseMessagingMode(raw: string | null | undefined): MessagingMode {
  const value = (raw ?? '').trim().toLowerCase();
  return (MESSAGING_MODES as readonly string[]).includes(value) ? (value as MessagingMode) : 'off';
}

// ─── Direcciones ────────────────────────────────────────

/** Mail en minúsculas y sin espacios; null si no parece un mail. */
export function normalizeEmail(raw: string | null | undefined): string | null {
  const value = (raw ?? '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) ? value : null;
}

/**
 * Teléfono en el formato que usa WhatsApp: solo dígitos, con código de país y
 * sin el "+". Un número argentino de 10 dígitos (característica + número, sin
 * 0 ni 15) se toma como celular y se le antepone 549; el 0 de larga distancia y
 * el 15 del celular local se quitan; uno que ya trae 54 sin el 9 de celular lo
 * recibe. Devuelve null si no alcanza para un número.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  let digits = (raw ?? '').replace(/\D/g, '');
  if (digits.startsWith('00')) digits = digits.slice(2);
  else if (digits.startsWith('0')) digits = digits.slice(1);
  if (digits.length === 12 && !digits.startsWith('54')) digits = withoutLocal15(digits);
  if (digits.length === 10) digits = `549${digits}`;
  if (digits.length === 12 && digits.startsWith('54') && !digits.startsWith('549')) {
    digits = `549${digits.slice(2)}`;
  }
  return digits.length >= 11 && digits.length <= 15 ? digits : null;
}

/**
 * Característica (2 a 4 dígitos: 11, 351, 2944) + 15 + número: quita el 15.
 * La de 2 dígitos es solo la 11 (Buenos Aires).
 */
function withoutLocal15(digits: string): string {
  for (const areaLength of [2, 3, 4]) {
    if (areaLength === 2 && !digits.startsWith('11')) continue;
    if (digits.slice(areaLength, areaLength + 2) === '15') {
      return digits.slice(0, areaLength) + digits.slice(areaLength + 2);
    }
  }
  return digits;
}

/** Dirección normalizada según el canal. */
export function normalizeAddress(channel: MessageChannel, raw: string | null | undefined): string | null {
  return channel === MessageChannel.Email ? normalizeEmail(raw) : normalizePhone(raw);
}

/**
 * Lista de direcciones permitidas (MESSAGING_ALLOWLIST): separadas por coma,
 * punto y coma o salto de línea; cada una se normaliza como mail o como teléfono.
 */
export function parseAllowlist(raw: string | null | undefined): Set<string> {
  const out = new Set<string>();
  for (const item of (raw ?? '').split(/[,;\n]+/)) {
    const address = item.includes('@') ? normalizeEmail(item) : normalizePhone(item);
    if (address) out.add(address);
  }
  return out;
}

// ─── Horario permitido ──────────────────────────────────

export interface SendingWindow {
  /** Hora de Buenos Aires desde la que se manda (inclusive). */
  fromHour: number;
  /** Hora de Buenos Aires hasta la que se manda (exclusive). */
  untilHour: number;
}

export const DEFAULT_SENDING_WINDOW: SendingWindow = { fromHour: 9, untilHour: 20 };

function arParts(now: Date) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TIME_ZONE,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return { year: get('year'), month: get('month'), day: get('day'), hour: get('hour'), minute: get('minute'), second: get('second') };
}

/** Si el instante cae dentro del horario permitido, en hora de Buenos Aires. */
export function isInsideSendingWindow(now: Date, window: SendingWindow): boolean {
  const { hour } = arParts(now);
  return hour >= window.fromHour && hour < window.untilHour;
}

/**
 * Próximo instante en que abre el horario permitido: hoy a `fromHour` si
 * todavía no abrió, o mañana a esa hora. Si `now` ya está adentro, devuelve `now`.
 */
export function nextSendingWindowStart(now: Date, window: SendingWindow): Date {
  if (isInsideSendingWindow(now, window)) return now;
  const p = arParts(now);
  // Diferencia entre la hora local de Buenos Aires y UTC en este instante.
  const localAsUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const offsetMs = localAsUtc - Math.floor(now.getTime() / 1000) * 1000;
  const dayShift = p.hour >= window.untilHour ? 1 : 0;
  const startLocal = Date.UTC(p.year, p.month - 1, p.day + dayShift, window.fromHour, 0, 0);
  return new Date(startLocal - offsetMs);
}

// ─── Plantillas ─────────────────────────────────────────

/** Documento que se adjunta, resuelto al despachar por `relatedType`/`relatedId`. */
export type MessageAttachmentKind = 'Receipt' | 'OwnerStatement' | 'Liquidacion';

export interface MessageTemplateInfo {
  key: MessageTemplateKey;
  /** Canales en que existe la plantilla. */
  channels: MessageChannel[];
  /**
   * `client`: va a una persona de la cartera; respeta el horario permitido y el
   * consentimiento. `staff`: va al personal o a quien se invita; solo mail y sin
   * horario.
   */
  audience: 'client' | 'staff';
  /** Variables que la plantilla usa, en el orden de los parámetros de WhatsApp. */
  vars: string[];
  /** Variables con secretos (un enlace de un solo uso): no se muestran y se borran al terminar. */
  secretVars?: string[];
  attachment?: MessageAttachmentKind;
  /** Plantilla de utilidad aprobada en WhatsApp Business (nombre e idioma). */
  whatsapp?: { name: string; language: string };
  /** Texto propuesto para la plantilla de WhatsApp, con {{n}} en el orden de `vars`. */
  whatsappText?: string;
}

export const MESSAGE_TEMPLATE_KEYS = [
  'receipt',
  'owner_statement',
  'liquidacion',
  'ticket_status',
  'ticket_comment',
  'payment_reminder_1',
  'payment_reminder_2',
  'payment_reminder_3',
  'user_invitation',
  'staff_alert',
] as const;
export type MessageTemplateKey = (typeof MESSAGE_TEMPLATE_KEYS)[number];

const BOTH = [MessageChannel.Email, MessageChannel.WhatsApp];
const WA_LANGUAGE = 'es_AR';

export const MESSAGE_TEMPLATES: Record<MessageTemplateKey, MessageTemplateInfo> = {
  receipt: {
    key: 'receipt',
    channels: BOTH,
    audience: 'client',
    vars: ['name', 'number', 'amount', 'concept', 'agency'],
    attachment: 'Receipt',
    whatsapp: { name: 'recibo_de_cobro', language: WA_LANGUAGE },
    whatsappText:
      'Hola {{1}}, te enviamos el recibo de cobro Nº {{2}} por {{3}} en concepto de {{4}}. Lo adjuntamos en PDF. {{5}}',
  },
  owner_statement: {
    key: 'owner_statement',
    channels: BOTH,
    audience: 'client',
    vars: ['name', 'period', 'closing', 'agency'],
    attachment: 'OwnerStatement',
    whatsapp: { name: 'estado_de_cuenta', language: WA_LANGUAGE },
    whatsappText:
      'Hola {{1}}, te enviamos tu estado de cuenta de {{2}}. Saldo al cierre: {{3}}. El detalle va en el PDF adjunto. {{4}}',
  },
  liquidacion: {
    key: 'liquidacion',
    channels: [MessageChannel.Email],
    audience: 'client',
    vars: ['period', 'periodShort', 'total', 'agency'],
    attachment: 'Liquidacion',
  },
  ticket_status: {
    key: 'ticket_status',
    channels: BOTH,
    audience: 'client',
    vars: ['name', 'ticket', 'status', 'agency'],
    whatsapp: { name: 'incidencia_estado', language: WA_LANGUAGE },
    whatsappText: 'Hola {{1}}, tu reclamo "{{2}}" cambió de estado: {{3}}. {{4}}',
  },
  ticket_comment: {
    key: 'ticket_comment',
    channels: BOTH,
    audience: 'client',
    vars: ['name', 'ticket', 'comment', 'agency'],
    whatsapp: { name: 'incidencia_respuesta', language: WA_LANGUAGE },
    whatsappText: 'Hola {{1}}, hay una respuesta en tu reclamo "{{2}}": {{3}}. {{4}}',
  },
  // Cobranza escalonada (ADR-0013): tres niveles de tono, del amable al firme. Ninguno amenaza ni
  // cita plazos legales; el importe es el exacto de hoy (saldo más punitorios).
  payment_reminder_1: {
    key: 'payment_reminder_1',
    channels: BOTH,
    audience: 'client',
    vars: ['name', 'amount', 'periods', 'agency'],
    whatsapp: { name: 'recordatorio_de_pago_n1', language: WA_LANGUAGE },
    whatsappText:
      'Hola {{1}}, te escribimos para recordarte que figura pendiente el pago del alquiler de {{3}}. El importe al día de hoy es {{2}}. Si ya lo abonaste, ignorá este mensaje; si tenés alguna dificultad, respondé y lo vemos juntos. {{4}}',
  },
  payment_reminder_2: {
    key: 'payment_reminder_2',
    channels: BOTH,
    audience: 'client',
    vars: ['name', 'amount', 'periods', 'agency'],
    whatsapp: { name: 'recordatorio_de_pago_n2', language: WA_LANGUAGE },
    whatsappText:
      'Hola {{1}}, volvemos a comunicarnos: el alquiler de {{3}} sigue sin acreditarse. El importe actualizado al día de hoy es {{2}}. Te pedimos regularizarlo a la brevedad o comunicarte con nosotros para acordar una forma de pago. {{4}}',
  },
  payment_reminder_3: {
    key: 'payment_reminder_3',
    channels: BOTH,
    audience: 'client',
    vars: ['name', 'amount', 'periods', 'agency'],
    whatsapp: { name: 'recordatorio_de_pago_n3', language: WA_LANGUAGE },
    whatsappText:
      'Hola {{1}}, este es un nuevo aviso: el alquiler de {{3}} continúa pendiente por {{2}} al día de hoy. Necesitamos que lo regularices o te comuniques con nosotros esta semana para acordar el pago. Si no recibimos novedades, seguiremos con las gestiones de cobranza que prevé el contrato. {{4}}',
  },
  user_invitation: {
    key: 'user_invitation',
    channels: [MessageChannel.Email],
    audience: 'staff',
    vars: ['link'],
    secretVars: ['link'],
  },
  staff_alert: {
    key: 'staff_alert',
    channels: [MessageChannel.Email],
    audience: 'staff',
    vars: ['subject', 'title', 'message', 'agency'],
  },
};

/** Variables visibles de un mensaje: las secretas se reemplazan. */
export function redactMessageVars(
  templateKey: string,
  vars: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const info = MESSAGE_TEMPLATES[templateKey as MessageTemplateKey];
  const out: Record<string, unknown> = { ...(vars ?? {}) };
  for (const key of info?.secretVars ?? []) {
    if (key in out) out[key] = REDACTED;
  }
  return out;
}

export const REDACTED = '[oculto]';

/** Si un mensaje de una persona necesita su alta explícita: WhatsApp a la cartera, sí. */
export function requiresOptIn(channel: MessageChannel, templateKey: string): boolean {
  const info = MESSAGE_TEMPLATES[templateKey as MessageTemplateKey];
  return channel === MessageChannel.WhatsApp && info?.audience === 'client';
}
