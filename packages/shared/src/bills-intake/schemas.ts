import { z } from 'zod';
import { BillChannel, BillDocumentStatus } from '../enums';
import { BillProviderKeySchema, SPECIFIC_BILL_PROVIDER_KEYS } from './providers';

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);
const periodString = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/);
const decimal = z.union([z.string(), z.number().transform(String)]).pipe(z.string().regex(/^\d+(\.\d{1,2})?$/));

/**
 * Obtención automática de boletas por consulta al proveedor (ADR-0018). De fábrica
 * está apagada: la inmobiliaria la prende y elige de qué proveedores se consulta.
 */
export const BillFetchingSettingsSchema = z
  .object({
    enabled: z.boolean().default(false),
    providers: z
      .array(z.enum(SPECIFIC_BILL_PROVIDER_KEYS))
      .max(SPECIFIC_BILL_PROVIDER_KEYS.length)
      .default([])
      .refine((list) => new Set(list).size === list.length, { message: 'providers must not repeat' }),
  })
  .strict();
export type BillFetchingSettings = z.infer<typeof BillFetchingSettingsSchema>;

export const BillDocumentFilterSchema = z
  .object({
    status: z.nativeEnum(BillDocumentStatus).optional(),
    channel: z.nativeEnum(BillChannel).optional(),
    providerKey: BillProviderKeySchema.optional(),
    page: z.coerce.number().int().min(1).default(1),
    limit: z.coerce.number().int().min(1).max(100).default(30),
  })
  .strict();
export type BillDocumentFilter = z.infer<typeof BillDocumentFilterSchema>;

/** Aceptar un documento en revisión, con las correcciones que haga falta. */
export const AcceptBillDocumentSchema = z
  .object({
    serviceId: uuid.optional(),
    period: periodString.optional(),
    installmentLabel: z.string().trim().min(1).max(40).optional(),
    amount: decimal.optional(),
    dueDate: dateOnly.nullable().optional(),
  })
  .strict();
export type AcceptBillDocumentInput = z.infer<typeof AcceptBillDocumentSchema>;

export const RejectBillDocumentSchema = z
  .object({ reason: z.string().trim().min(1).max(500) })
  .strict();

/**
 * Mail con boletas adjuntas reenviado por el servicio de recepción
 * (POST /bills-intake/email-ingest). La inmobiliaria sale de `tenantSlug` o de la
 * dirección de destino `boletas+<slug>@...`.
 */
export const BillMailIngestSchema = z
  .object({
    tenantSlug: z.string().trim().min(1).max(100).optional(),
    to: z.string().trim().max(320).optional(),
    messageId: z.string().trim().min(1).max(500),
    from: z.string().trim().min(3).max(320),
    subject: z.string().trim().max(300).optional(),
    receivedAt: z.coerce.date().optional(),
    attachments: z
      .array(
        z
          .object({
            filename: z.string().trim().max(300).default('boleta.pdf'),
            contentType: z.string().trim().max(100).optional(),
            contentBase64: z.string().min(1),
          })
          .strict(),
      )
      .max(10)
      .default([]),
  })
  .strict()
  .refine((v) => Boolean(v.tenantSlug) || Boolean(v.to), { message: 'tenantSlug or to is required', path: ['tenantSlug'] });
export type BillMailIngestInput = z.infer<typeof BillMailIngestSchema>;
