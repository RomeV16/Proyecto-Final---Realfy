import { z } from 'zod';
import { Currency, DepositHolder, DepositRefundRule, PaymentMethod } from '../enums';
import { MoveOutItemKind } from '../deposit-engine';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const amount = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'))
  .refine((v) => Number(v) > 0, 'Amount must be positive');
const signedAmount = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'));
const rate = z.string().regex(/^\d+(\.\d{1,6})?$/, 'Must be a decimal with up to 6 places');

/** Alta o cambio del depósito de un contrato. */
export const UpsertDepositSchema = z
  .object({
    amount,
    currency: z.nativeEnum(Currency),
    heldBy: z.nativeEnum(DepositHolder),
    /** Locador dueño del dinero (obligatorio si lo guarda el locador; opcional si lo guarda la inmobiliaria en custodia). */
    heldByPersonId: z.string().uuid().nullish(),
    installments: z.number().int().min(1).max(24).default(1),
    refundRule: z.nativeEnum(DepositRefundRule),
    refundInstallments: z.number().int().min(1).max(24).default(1),
    refundDueDays: z.number().int().min(0).max(365).optional(),
    /** Vencimiento de la primera cuota (por defecto, el inicio del contrato). */
    firstDueDate: dateOnly.optional(),
    notes: z.string().max(2000).nullish(),
  })
  .strict()
  .superRefine((v, ctx) => {
    if (v.heldBy === DepositHolder.Locador && !v.heldByPersonId) {
      ctx.addIssue({ code: 'custom', path: ['heldByPersonId'], message: 'The lessor who holds the deposit is required' });
    }
    if (v.refundRule === DepositRefundRule.PesosActualizado && v.currency !== Currency.ARS) {
      ctx.addIssue({ code: 'custom', path: ['refundRule'], message: 'Updated pesos only applies to a deposit in ARS' });
    }
  });

/** Cobro de una cuota del depósito. */
export const CollectDepositInstallmentSchema = z
  .object({
    paidAt: dateOnly.optional(),
    method: z.nativeEnum(PaymentMethod).default(PaymentMethod.Efectivo),
    accountId: z.string().uuid().optional(),
    note: z.string().max(500).optional(),
  })
  .strict();

export const MoveOutItemSchema = z
  .object({
    kind: z.nativeEnum(MoveOutItemKind),
    description: z.string().min(1).max(300),
    amount: signedAmount,
    included: z.boolean().default(true),
    sourceType: z.string().max(60).nullish(),
    sourceId: z.string().max(80).nullish(),
  })
  .strict();

export const MoveOutPreviewQuerySchema = z
  .object({
    date: dateOnly.optional(),
    /** Cambio para pasar a la moneda del depósito los renglones en otra moneda: unidades de la moneda del depósito por unidad de la del renglón. */
    rate: rate.optional(),
  })
  .strict();

/** Crea o reemplaza el borrador de la liquidación de egreso. */
export const CreateMoveOutSchema = z
  .object({
    date: dateOnly,
    rate: rate.optional(),
    items: z.array(MoveOutItemSchema).max(200),
    notes: z.string().max(2000).nullish(),
  })
  .strict();

export const ConfirmMoveOutSchema = z
  .object({
    accountId: z.string().uuid().optional(),
    method: z.nativeEnum(PaymentMethod).default(PaymentMethod.Efectivo),
    note: z.string().max(500).optional(),
    /** El locador dio su conformidad a los descuentos (si la inmobiliaria la exige). */
    lessorApproved: z.boolean().optional(),
  })
  .strict();

export type UpsertDepositInput = z.infer<typeof UpsertDepositSchema>;
export type CreateMoveOutInput = z.infer<typeof CreateMoveOutSchema>;
