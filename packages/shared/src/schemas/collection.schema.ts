import { z } from 'zod';
import { CollectionActionKind, CollectionActionStatus, CollectionStage, Currency, MessageChannel, MessageStatus } from '../enums';
import type { CollectionPlanStatus, LetterFields } from '../collection-engine';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const amount = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'))
  .refine((v) => Number(v) > 0, 'Amount must be positive');
const note = z.string().trim().min(1).max(2000);

/** Filtros de `GET /collection-cases`. Sin `stage`, solo los casos abiertos. */
export const CollectionCaseFilterSchema = z.object({
  stage: z.nativeEnum(CollectionStage).optional(),
  /** Días de mora mínimos del vencimiento impago más viejo. */
  minDays: z.coerce.number().int().min(0).max(3650).optional(),
  assigneeId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
export type CollectionCaseFilter = z.infer<typeof CollectionCaseFilterSchema>;

/** `POST /collection-cases/:id/notes`. */
export const AddCollectionNoteSchema = z.object({ note }).strict();

/** `POST /collection-cases/:id/agreement`: promesa de pago hasta `payOn`; pausa los avisos hasta esa fecha. */
export const CollectionAgreementSchema = z
  .object({ payOn: dateOnly, amount: amount.optional(), note: note.optional() })
  .strict();
export type CollectionAgreementInput = z.infer<typeof CollectionAgreementSchema>;

/** `POST /collection-cases/:id/actions/:actionId/sent`: la carta documento se mandó en papel el día `sentOn`. */
export const ConfirmLetterSentSchema = z.object({ sentOn: dateOnly, note: note.optional() }).strict();

/** `PATCH /collection-cases/:id/actions/:actionId`: campos editables del borrador de la carta documento. */
export const UpdateLetterSchema = z
  .object({
    recipientName: z.string().trim().min(1).max(200),
    recipientAddress: z.string().trim().max(300),
    propertyAddress: z.string().trim().max(300),
    periods: z.string().trim().max(200),
    amount: z.string().trim().max(60),
    termDays: z.number().int().min(1).max(60),
    extraText: z.string().trim().max(2000),
  })
  .partial()
  .strict();
export type UpdateLetterInput = z.infer<typeof UpdateLetterSchema>;

/** `POST /collection-cases/:id/derive`. */
export const DeriveToLawyerSchema = z
  .object({ lawyer: z.string().trim().min(1).max(200).optional(), note: note.optional() })
  .strict();

/** `POST /collection-cases/:id/judicial` y `POST /collection-cases/:id/close`. */
export const CollectionNoteBodySchema = z.object({ note: note.optional() }).strict();
export const CloseCollectionCaseSchema = z.object({ note }).strict();

/** `PATCH /collection-cases/:id`: quién lo lleva. */
export const AssignCollectionCaseSchema = z.object({ assigneeId: z.string().uuid().nullable() }).strict();

/** Un renglón de la deuda de un caso, con lo que se debe hoy. */
export interface CollectionDebtLine {
  liquidacionId: string;
  period: string;
  dueDate: string;
  daysOverdue: number;
  balance: string;
  penalty: string;
  total: string;
}

export interface CollectionActionItem {
  id: string;
  kind: CollectionActionKind;
  status: CollectionActionStatus;
  level: number | null;
  channel: MessageChannel | null;
  outboxMessageId: string | null;
  /** Estado del mensaje encolado, si lo hay. */
  messageStatus: MessageStatus | null;
  messageStatusReason: string | null;
  amount: string | null;
  /** Fecha propia de la acción: promesa de pago del acuerdo o envío de la carta. */
  onDate: string | null;
  note: string | null;
  /** Campos del borrador de la carta documento. */
  letter: LetterFields | null;
  createdByName: string | null;
  at: string;
}

export interface CollectionCaseItem {
  id: string;
  contractId: string;
  propertyLabel: string;
  tenantNames: string;
  stage: CollectionStage;
  currency: Currency;
  overdueSince: string;
  daysOverdue: number;
  /** Saldo impago vencido y lo que se debe hoy (saldo más punitorios). */
  balance: string;
  payoffToday: string;
  nextAction: CollectionActionKind | null;
  nextActionAt: string | null;
  planStatus: CollectionPlanStatus;
  pausedUntil: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
  openedAt: string;
  closedAt: string | null;
}

export interface CollectionCasePage {
  items: CollectionCaseItem[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface CollectionCaseDetail extends CollectionCaseItem {
  debt: CollectionDebtLine[];
  actions: CollectionActionItem[];
  /** La próxima acción necesita que una persona la haga (confirmar la carta, derivar). */
  nextActionManual: boolean;
  closeReason: string | null;
}
