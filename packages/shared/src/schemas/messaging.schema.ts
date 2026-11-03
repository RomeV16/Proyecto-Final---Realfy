import { z } from 'zod';
import { ConsentSource, ConsentStatus, MessageChannel, MessageStatus } from '../enums';
import type { MessageTemplateInfo, MessagingMode, SendingWindow } from '../messaging';

/** Filtros de `GET /outbox`. */
export const OutboxFilterSchema = z.object({
  status: z.nativeEnum(MessageStatus).optional(),
  channel: z.nativeEnum(MessageChannel).optional(),
  personId: z.string().uuid().optional(),
  relatedType: z.string().min(1).max(40).optional(),
  relatedId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type OutboxFilter = z.infer<typeof OutboxFilterSchema>;

/** Documentos que se pueden mandar desde su pantalla. */
export const SENDABLE_DOCUMENTS = ['Receipt', 'OwnerStatement'] as const;
export type SendableDocument = (typeof SENDABLE_DOCUMENTS)[number];

/** Cuerpo de `POST /outbox/send`: manda un recibo o un estado de cuenta a su destinatario. */
export const SendDocumentSchema = z
  .object({
    kind: z.enum(SENDABLE_DOCUMENTS),
    id: z.string().uuid(),
    channel: z.nativeEnum(MessageChannel),
  })
  .strict();
export type SendDocumentInput = z.infer<typeof SendDocumentSchema>;

/** Cuerpo de `PUT /persons/:id/consents`: un registro nuevo del historial. */
export const SetConsentSchema = z
  .object({
    channel: z.nativeEnum(MessageChannel),
    status: z.nativeEnum(ConsentStatus),
    note: z.string().trim().max(500).optional(),
  })
  .strict();
export type SetConsentInput = z.infer<typeof SetConsentSchema>;

/** Un mensaje de la bandeja de salida tal como lo devuelve la API (sin secretos). */
export interface OutboxItem {
  id: string;
  channel: MessageChannel;
  personId: string | null;
  personName: string | null;
  to: string;
  templateKey: string;
  vars: Record<string, unknown>;
  status: MessageStatus;
  statusReason: string | null;
  error: string | null;
  attempts: number;
  nextAttemptAt: string | null;
  scheduledAt: string;
  sentAt: string | null;
  deliveredAt: string | null;
  relatedType: string | null;
  relatedId: string | null;
  createdAt: string;
}

export interface OutboxPage {
  items: OutboxItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Consentimiento vigente de una persona en un canal, con su historial. */
export interface ChannelConsent {
  channel: MessageChannel;
  /** Último registro; null si nunca se registró nada. */
  status: ConsentStatus | null;
  source: ConsentSource | null;
  at: string | null;
  note: string | null;
  /** Dirección actual de la persona en el canal (normalizada), si tiene. */
  address: string | null;
  history: { status: ConsentStatus; source: ConsentSource; at: string; note: string | null; address: string | null }[];
}

export interface PersonConsents {
  personId: string;
  channels: ChannelConsent[];
}

/** `GET /messaging/settings`: lo que se ve en Configuración → Mensajería. */
export interface MessagingSettings {
  mode: MessagingMode;
  /** Direcciones permitidas cuando el modo es `allowlist` (solo la cantidad). */
  allowlistCount: number;
  providers: {
    email: { configured: boolean; from: string | null; webhook: boolean };
    whatsapp: { configured: boolean; webhook: boolean };
  };
  sendingWindow: SendingWindow;
  templates: MessageTemplateInfo[];
}
