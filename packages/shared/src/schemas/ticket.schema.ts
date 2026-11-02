import { z } from 'zod';
import { ApprovalChannel, ChargeTarget, Currency, TicketPriority, TicketStatus } from '../enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/, 'Must be YYYY-MM');

/** Importe positivo, como texto decimal con hasta dos decimales. */
const positiveAmount = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'))
  .refine((v) => Number(v) > 0, 'Amount must be greater than zero');

// ─── Ticket CRUD ────────────────────────────────────────

export const CreateTicketSchema = z.object({
  propertyId: z.string().uuid(),
  categoryId: z.string().uuid().optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  /** Contrato al que se imputa el gasto; sin él se usa el único vigente de la propiedad, si lo hay. */
  contractId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional().nullable(),
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.Media),
});

export const UpdateTicketSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional().nullable(),
  priority: z.nativeEnum(TicketPriority).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  costAmount: z.number().min(0).optional().nullable(),
  costCurrency: z.nativeEnum(Currency).optional().nullable(),
  costPayer: z.nativeEnum(ChargeTarget).optional().nullable(),
  providerNotes: z.string().max(10000).optional().nullable(),
});

// ─── Ticket Filtering ───────────────────────────────────

export const TicketFilterSchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedToUserId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Ticket State Transition ────────────────────────────

export const TransitionTicketStatusSchema = z.object({
  status: z.nativeEnum(TicketStatus),
});

// ─── Ticket Category CRUD ───────────────────────────────

export const CreateTicketCategorySchema = z.object({
  name: z.string().min(1).max(200),
  icon: z.string().max(100).optional().nullable(),
  color: z.string().max(50).optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
});

export const UpdateTicketCategorySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  icon: z.string().max(100).optional().nullable(),
  color: z.string().max(50).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
});

// ─── Ticket Cost Update ─────────────────────────────────

export const UpdateTicketCostSchema = z.object({
  costAmount: z.number().min(0).optional().nullable(),
  costCurrency: z.nativeEnum(Currency).optional().nullable(),
  costPayer: z.nativeEnum(ChargeTarget).optional().nullable(),
});

// ─── Ticket Comment ─────────────────────────────────────

export const CreateTicketCommentSchema = z.object({
  content: z.string().min(1).max(10000),
});

// ─── Portal Ticket Schemas ──────────────────────────────

export const CreatePortalTicketSchema = z.object({
  propertyId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
});

export const CreatePortalTicketCommentSchema = z.object({
  content: z.string().min(1).max(10000),
});

// ─── Incidencias y reparaciones ─────────────────────────

/** Estimado de costo: decide si hace falta la preautorización del locador. */
export const EstimateTicketSchema = z
  .object({
    amount: positiveAmount,
    currency: z.nativeEnum(Currency).default(Currency.ARS),
  })
  .strict();

/** Preautorización del locador: hasta qué importe se puede actuar, quién la dio y por dónde. */
export const PreauthorizeTicketSchema = z
  .object({
    amount: positiveAmount,
    approvedByPersonId: z.string().uuid(),
    channel: z.nativeEnum(ApprovalChannel),
    note: z.string().max(2000).optional().nullable(),
  })
  .strict();

const quoteFields = {
  providerId: z.string().uuid(),
  amount: positiveAmount,
  currency: z.nativeEnum(Currency).default(Currency.ARS),
  documentUrl: z.string().url().max(2000).optional().nullable(),
  notes: z.string().max(2000).optional().nullable(),
};

export const CreateTicketQuoteSchema = z.object(quoteFields).strict();

/** Corrección de un presupuesto pendiente. */
export const UpdateTicketQuoteSchema = z
  .object({
    amount: quoteFields.amount,
    currency: z.nativeEnum(Currency),
    documentUrl: quoteFields.documentUrl,
    notes: quoteFields.notes,
  })
  .partial()
  .strict();

/** Aprobación de un presupuesto: quién lo aprobó (el locador o quien lo representa) y por qué canal. */
export const ApproveTicketQuoteSchema = z
  .object({
    approvedByPersonId: z.string().uuid(),
    channel: z.nativeEnum(ApprovalChannel),
    note: z.string().max(2000).optional().nullable(),
  })
  .strict();

/** Pago al proveedor desde una cuenta de la inmobiliaria. */
export const RegisterProviderPaymentSchema = z
  .object({
    accountId: z.string().uuid(),
    amount: positiveAmount,
    date: dateOnly.optional(),
    note: z.string().max(2000).optional().nullable(),
  })
  .strict();

/** Honorario por gestión de la reparación: ninguno, un porcentaje de lo pagado o un importe fijo. */
export const RepairFeeSchema = z
  .object({
    mode: z.enum(['None', 'Percent', 'Fixed']).default('None'),
    pct: z.number().min(0).max(100).optional().nullable(),
    amount: positiveAmount.optional().nullable(),
  })
  .strict()
  .refine((v) => v.mode !== 'Fixed' || !!v.amount, { message: 'A fixed fee needs an amount', path: ['amount'] });

/** Imputación del gasto a quien paga (por defecto el que quedó anotado en el ticket). */
export const ImputeTicketSchema = z
  .object({
    chargedTo: z.nativeEnum(ChargeTarget).optional(),
    /** Primer mes desde el que se imputa (YYYY-MM); sin mes, en la próxima liquidación o estado. */
    targetPeriod: period.optional().nullable(),
    managementFee: RepairFeeSchema.optional(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strict();
