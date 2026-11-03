import { z } from 'zod';
import { ConversationChannel, ConversationStatus } from '../enums';

const uuid = z.string().uuid();

const TRUE_WORDS = new Set(['true', '1']);
const FALSE_WORDS = new Set(['false', '0']);

/** Un booleano de query string: "true"/"1" es verdadero, "false"/"0" falso (z.coerce.boolean() tomaría "false" como verdadero). */
const queryBool = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  if (TRUE_WORDS.has(v)) return true;
  return FALSE_WORDS.has(v) ? false : v;
}, z.boolean());

export const ConversationFilterSchema = z
  .object({
    status: z.nativeEnum(ConversationStatus).optional(),
    /** Sólo las que siguen abiertas (ni resueltas ni archivadas). */
    open: queryBool.optional(),
    channel: z.nativeEnum(ConversationChannel).optional(),
    /** `me` para las propias, `none` para las sin responsable, o el id de un usuario. */
    assignee: z.union([z.literal('me'), z.literal('none'), uuid]).optional(),
    slaBreached: queryBool.optional(),
    search: z.string().trim().max(100).optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type ConversationFilter = z.infer<typeof ConversationFilterSchema>;

export const ReplyConversationSchema = z
  .object({
    body: z.string().trim().min(1).max(4000),
    /** Asunto del mail (sólo para respuestas por mail); por defecto "Re: <asunto>". */
    subject: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export const AssignConversationSchema = z.object({ assigneeUserId: uuid.nullable() }).strict();

export const ChangeConversationStatusSchema = z.object({ status: z.nativeEnum(ConversationStatus) }).strict();

/** Tipos de registro a los que se puede referir una consulta. */
export const CONVERSATION_RELATED_TYPES = ['Property', 'Contract'] as const;
export type ConversationRelatedType = (typeof CONVERSATION_RELATED_TYPES)[number];

/** Vínculos de la consulta; un campo en null desvincula, uno ausente no se toca. */
export const LinkConversationSchema = z
  .object({
    personId: uuid.nullable().optional(),
    leadId: uuid.nullable().optional(),
    related: z.object({ type: z.enum(CONVERSATION_RELATED_TYPES), id: uuid }).strict().nullable().optional(),
  })
  .strict()
  .refine((v) => Object.values(v).some((x) => x !== undefined), { message: 'at least one link is required' });

/** "Registrar llamada": alguien atendió un llamado y lo deja anotado. */
export const RegisterCallSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    phone: z.string().trim().min(6).max(50),
    summary: z.string().trim().min(1).max(4000),
    propertyId: uuid.optional(),
    /** Si ya se atendió en el momento, la consulta nace con primera respuesta (sin SLA). */
    answered: z.boolean().default(true),
  })
  .strict();

/** Mail reenviado a la bandeja por el servicio de recepción (POST /inbox/email-ingest). */
export const EmailIngestSchema = z
  .object({
    tenantSlug: z.string().trim().min(1).max(100),
    messageId: z.string().trim().min(1).max(500),
    from: z.string().trim().min(3).max(320),
    fromName: z.string().trim().max(200).optional(),
    subject: z.string().trim().max(300).optional(),
    text: z.string().max(20000),
    receivedAt: z.coerce.date().optional(),
    /** Cabecera Auto-Submitted / Precedence: los mails automáticos no abren una consulta. */
    automatic: z.boolean().default(false),
  })
  .strict();
export type EmailIngestInput = z.infer<typeof EmailIngestSchema>;
