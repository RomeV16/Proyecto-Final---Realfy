import { z } from 'zod';
import { ConversationChannel } from '../enums';

/** Canales con autorrespuesta: por teléfono la consulta la registra una persona que ya atiende. */
export const AUTOREPLY_CHANNELS = [
  ConversationChannel.WhatsApp,
  ConversationChannel.Email,
  ConversationChannel.Web,
] as const;
export type AutoreplyChannel = (typeof AUTOREPLY_CHANNELS)[number];

const text = (max: number) => z.string().trim().min(1).max(max);

export const QuickReplySchema = z
  .object({
    id: z.string().trim().regex(/^[a-z0-9][a-z0-9-]{0,39}$/, { message: 'id must be lowercase letters, digits or dashes' }),
    title: text(60),
    body: text(1000),
  })
  .strict();
export type QuickReply = z.infer<typeof QuickReplySchema>;

export const DEFAULT_QUICK_REPLIES: QuickReply[] = [
  {
    id: 'visita',
    title: 'Coordinar una visita',
    body: 'Hola {name}, gracias por tu consulta. ¿Qué día y horario te quedan cómodos para ver la propiedad?',
  },
  {
    id: 'requisitos',
    title: 'Requisitos para alquilar',
    body: 'Hola {name}, te cuento los requisitos para alquilar: DNI, recibos de sueldo o constancia de ingresos y garantía propietaria o seguro de caución. Cualquier duda, escribinos.',
  },
  {
    id: 'sin-datos',
    title: 'Pedir más datos',
    body: 'Hola {name}, para ayudarte mejor, ¿podés contarnos qué zona, cantidad de ambientes y presupuesto estás buscando?',
  },
];

const BUSINESS_DAYS = z
  .array(z.number().int().min(0).max(6))
  .min(1)
  .max(7)
  .refine((d) => new Set(d).size === d.length, { message: 'days must be unique' });

/**
 * Bandeja de consultas de la inmobiliaria (dentro de Tenant.operationalDefaults.inbox).
 * El SLA es el tiempo para la primera respuesta de una persona; la autorrespuesta no lo
 * detiene. Con el horario de atención activo, el reloj sólo corre dentro de él (hora de
 * Buenos Aires; 0 = domingo).
 */
export const InboxSettingsSchema = z
  .object({
    slaMinutes: z.number().int().min(1).max(1440).default(15),
    businessHours: z
      .object({
        enabled: z.boolean().default(true),
        days: BUSINESS_DAYS.default([1, 2, 3, 4, 5]),
        fromHour: z.number().int().min(0).max(23).default(9),
        untilHour: z.number().int().min(1).max(24).default(18),
      })
      .strict()
      .default({})
      .refine((v) => v.untilHour > v.fromHour, { message: 'untilHour must be greater than fromHour', path: ['untilHour'] }),
    /** Horas desde el último mensaje durante las que un mensaje nuevo del mismo contacto sigue la misma consulta. */
    threadWindowHours: z.number().int().min(1).max(720).default(72),
    /** Responsable de una consulta que llega sin uno (null = queda sin asignar y se avisa a la administración). */
    defaultAssigneeUserId: z.string().uuid().nullable().default(null),
    autoreply: z
      .object({
        enabled: z.boolean().default(true),
        texts: z
          .object({
            WhatsApp: text(1000).default(
              'Hola {name}, gracias por escribirnos a {agency}. Recibimos tu consulta y te respondemos a la brevedad.',
            ),
            Email: text(1000).default(
              'Hola {name}, recibimos tu mensaje en {agency}. Una persona de nuestro equipo te responde a la brevedad.',
            ),
            Web: text(1000).default(
              'Hola {name}, recibimos tu consulta en {agency}. Una persona de nuestro equipo te responde a la brevedad.',
            ),
          })
          .strict()
          .default({}),
      })
      .strict()
      .default({}),
    quickReplies: z
      .array(QuickReplySchema)
      .max(30)
      .default(DEFAULT_QUICK_REPLIES)
      .refine((l) => new Set(l.map((q) => q.id)).size === l.length, { message: 'quick reply ids must be unique' }),
  })
  .strict();

export type InboxSettings = z.infer<typeof InboxSettingsSchema>;

export const DEFAULT_INBOX_SETTINGS: InboxSettings = InboxSettingsSchema.parse({});

/** Reemplaza {name} y {agency}; una variable desconocida se deja como está. */
export function renderInboxText(template: string, vars: { name?: string | null; agency?: string | null }): string {
  const name = (vars.name ?? '').trim();
  // Sin nombre, "Hola {name}," queda "Hola,".
  return template
    .replaceAll(' {name}', name ? ` ${name}` : '')
    .replaceAll('{name}', name)
    .replaceAll('{agency}', (vars.agency ?? '').trim());
}
