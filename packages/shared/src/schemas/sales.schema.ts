import { z } from 'zod';
import {
  Currency,
  KeyHolder,
  PaymentMethod,
  SalesDepositHolder,
  SalesDepositKind,
  SalesDepositStatus,
  SalesOperationStatus,
  SalesPartyRole,
} from '../enums';

const uuid = z.string().uuid();
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const amount = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'))
  .refine((v) => Number(v) > 0, 'Amount must be positive');
const pct = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a percentage with up to 4 places'))
  .refine((v) => Number(v) > 0 && Number(v) <= 100, 'Must be between 0 and 100');
const notes = z.string().trim().max(2000).nullish();
const page = {
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
};

// ─── Operación ──────────────────────────────────────────

export const SalesPartyInputSchema = z
  .object({
    role: z.nativeEnum(SalesPartyRole),
    personId: uuid,
    /** Parte del lado (comprador o vendedor) que le corresponde, en porcentaje. */
    sharePct: pct.default('100'),
  })
  .strict();

/** Cada lado con partes reparte el 100 %, y una persona no figura dos veces en el mismo lado. */
function checkParties(parties: Array<{ role: SalesPartyRole; personId: string; sharePct: string }>, ctx: z.RefinementCtx) {
  for (const role of Object.values(SalesPartyRole)) {
    const side = parties.filter((p) => p.role === role);
    if (side.length === 0) continue;
    const cents = side.reduce((sum, p) => sum + Math.round(Number(p.sharePct) * 10000), 0);
    if (cents !== 1_000_000) {
      ctx.addIssue({ code: 'custom', path: ['parties'], message: `The ${role} shares must add up to 100` });
    }
    if (new Set(side.map((p) => p.personId)).size !== side.length) {
      ctx.addIssue({ code: 'custom', path: ['parties'], message: `A person appears twice as ${role}` });
    }
  }
}

export const CreateSalesOperationSchema = z
  .object({
    propertyId: uuid,
    /** Arranca en captación o ya publicada. */
    status: z.enum([SalesOperationStatus.Captacion, SalesOperationStatus.Publicada]).default(SalesOperationStatus.Captacion),
    exclusive: z.boolean().default(false),
    price: amount.nullish(),
    currency: z.nativeEnum(Currency).default(Currency.USD),
    agentUserId: uuid.nullish(),
    parties: z.array(SalesPartyInputSchema).max(12).default([]),
    notes,
  })
  .strict()
  .superRefine((v, ctx) => checkParties(v.parties, ctx));

export const UpdateSalesOperationSchema = z
  .object({
    exclusive: z.boolean().optional(),
    price: amount.nullish(),
    agreedPrice: amount.nullish(),
    currency: z.nativeEnum(Currency).optional(),
    agentUserId: uuid.nullish(),
    notes,
  })
  .strict();

export const SetSalesPartiesSchema = z
  .object({ parties: z.array(SalesPartyInputSchema).max(12) })
  .strict()
  .superRefine((v, ctx) => checkParties(v.parties, ctx));

export const SalesFilterSchema = z
  .object({
    status: z.nativeEnum(SalesOperationStatus).optional(),
    /** Solo las operaciones abiertas (ni escrituradas ni canceladas). */
    open: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    propertyId: uuid.optional(),
    personId: uuid.optional(),
    exclusive: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    ...page,
  })
  .strict();

export const TransitionSalesSchema = z
  .object({
    to: z.nativeEnum(SalesOperationStatus),
    /** Motivo; obligatorio al cancelar. */
    reason: z.string().trim().min(1).max(500).optional(),
    /** Boleto: fecha de firma. */
    boletoDate: dateOnly.optional(),
    /** Escritura: fecha en que se escrituró (no puede ser futura). */
    escrituraDate: dateOnly.optional(),
    /** Precio pactado (reserva, seña o boleto). */
    agreedPrice: amount.optional(),
    /** Pasar a boleto sin toda la documentación obligatoria exige dejar el motivo. */
    docsOverrideReason: z.string().trim().min(1).max(500).optional(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.to === SalesOperationStatus.Cancelada && !v.reason) {
      ctx.addIssue({ code: 'custom', path: ['reason'], message: 'A reason is required to cancel' });
    }
    if (v.to === SalesOperationStatus.Boleto && !v.boletoDate) {
      ctx.addIssue({ code: 'custom', path: ['boletoDate'], message: 'The boleto date is required' });
    }
    if (v.to === SalesOperationStatus.Escriturada && !v.escrituraDate) {
      ctx.addIssue({ code: 'custom', path: ['escrituraDate'], message: 'The escritura date is required' });
    }
  });

// ─── Reservas y señas ───────────────────────────────────

export const CreateSalesDepositSchema = z
  .object({
    kind: z.nativeEnum(SalesDepositKind),
    amount,
    currency: z.nativeEnum(Currency).optional(),
    holder: z.nativeEnum(SalesDepositHolder).optional(),
    /** Vendedor o escribano que guarda el dinero, si es una persona cargada. */
    holderPersonId: uuid.nullish(),
    /** Comprador que entrega el dinero. */
    payerPersonId: uuid.nullish(),
    /** Vencimiento de una reserva; sin fecha rige el plazo por defecto de la inmobiliaria. */
    expiresAt: dateOnly.nullish(),
    notes,
  })
  .strict();

export const UpdateSalesDepositSchema = z
  .object({ expiresAt: dateOnly.nullish(), notes })
  .strict();

export const ReceiveSalesDepositSchema = z
  .object({
    receivedAt: dateOnly.optional(),
    method: z.nativeEnum(PaymentMethod).default(PaymentMethod.Efectivo),
    accountId: uuid.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const RefundSalesDepositSchema = z
  .object({
    at: dateOnly.optional(),
    /** Importe devuelto; por defecto el recibido completo. */
    amount: amount.optional(),
    method: z.nativeEnum(PaymentMethod).default(PaymentMethod.Efectivo),
    accountId: uuid.optional(),
    note: z.string().trim().max(500).optional(),
  })
  .strict();

export const ForfeitSalesDepositSchema = z
  .object({
    at: dateOnly.optional(),
    /** Importe retenido; por defecto el recibido completo. */
    amount: amount.optional(),
    /** Motivo y fundamento: se registra, no se calcula. */
    note: z.string().trim().min(1).max(500),
  })
  .strict();

export const SalesPendingDepositsFilterSchema = z
  .object({
    holder: z.nativeEnum(SalesDepositHolder).optional(),
    status: z.nativeEnum(SalesDepositStatus).optional(),
    ...page,
  })
  .strict();

// ─── Documentación y honorarios ─────────────────────────

export const UpdateSalesDocCheckSchema = z
  .object({ done: z.boolean().optional(), notes })
  .strict()
  .refine((v) => v.done !== undefined || v.notes !== undefined, { message: 'Nothing to change' });

export const CreateSalesFeeSchema = z
  .object({
    /** Porcentaje por parte; sin él rige el de la inmobiliaria según el tipo de inmueble (3 % construido, 5 % lote). */
    pct: pct.optional(),
    baseAmount: amount.optional(),
    installments: z.number().int().min(1).max(60).optional(),
    firstDueDate: dateOnly.optional(),
    /** Quién paga; por defecto la parte principal de cada lado. */
    payers: z
      .array(z.object({ role: z.enum([SalesPartyRole.Comprador, SalesPartyRole.Vendedor]), personId: uuid }).strict())
      .min(1)
      .max(4)
      .optional(),
    notes,
  })
  .strict();

// ─── Llaves ─────────────────────────────────────────────

const holderFields = {
  holder: z.nativeEnum(KeyHolder),
  holderPersonId: uuid.nullish(),
  holderUserId: uuid.nullish(),
  /** Nombre libre de quien las tiene (un escribano, un plomero) cuando no es una persona ni un usuario cargado. */
  holderName: z.string().trim().min(1).max(120).nullish(),
};

/** Quien las tiene, si no es la oficina, se identifica. */
function checkHolder(v: { holder: KeyHolder; holderPersonId?: string | null; holderUserId?: string | null; holderName?: string | null }, ctx: z.RefinementCtx) {
  if (v.holder === KeyHolder.Oficina) return;
  if (!v.holderPersonId && !v.holderUserId && !v.holderName) {
    ctx.addIssue({ code: 'custom', path: ['holderName'], message: 'Say who has the keys' });
  }
}

export const CreateKeySetSchema = z
  .object({
    label: z.string().trim().min(1).max(80),
    copies: z.number().int().min(1).max(50).default(1),
    location: z.string().trim().max(120).nullish(),
    ...holderFields,
    holder: holderFields.holder.default(KeyHolder.Oficina),
    notes,
  })
  .strict()
  .superRefine(checkHolder);

export const UpdateKeySetSchema = z
  .object({
    label: z.string().trim().min(1).max(80).optional(),
    copies: z.number().int().min(1).max(50).optional(),
    location: z.string().trim().max(120).nullish(),
    notes,
    isActive: z.boolean().optional(),
  })
  .strict();

export const KeyCheckOutSchema = z
  .object({
    ...holderFields,
    reason: z.string().trim().max(200).nullish(),
    outAt: dateOnly.optional(),
    /** Fecha en que deberían volver; pasada esa fecha figuran como atrasadas. */
    expectedReturnAt: dateOnly.nullish(),
    notes,
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.holder === KeyHolder.Oficina) {
      ctx.addIssue({ code: 'custom', path: ['holder'], message: 'Keys are checked out to someone other than the office' });
    }
    checkHolder(v, ctx);
  });

export const KeyCheckInSchema = z
  .object({
    returnedAt: dateOnly.optional(),
    /** Dónde quedan guardadas al volver. */
    location: z.string().trim().max(120).nullish(),
    notes,
  })
  .strict();

export const KeysOutFilterSchema = z
  .object({
    holder: z.nativeEnum(KeyHolder).optional(),
    propertyId: uuid.optional(),
    overdue: z
      .enum(['true', 'false'])
      .transform((v) => v === 'true')
      .optional(),
    ...page,
  })
  .strict();

export type CreateSalesOperationInput = z.infer<typeof CreateSalesOperationSchema>;
export type TransitionSalesInput = z.infer<typeof TransitionSalesSchema>;
export type CreateSalesDepositInput = z.infer<typeof CreateSalesDepositSchema>;
export type CreateKeySetInput = z.infer<typeof CreateKeySetSchema>;
export type KeyCheckOutInput = z.infer<typeof KeyCheckOutSchema>;
