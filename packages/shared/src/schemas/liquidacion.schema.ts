import { z } from 'zod';
import {
  LiquidacionStatus,
  PaymentMethod,
  LineItemType,
  LineBeneficiary,
  Currency,
  PaymentReceiver,
} from '../enums';

// ─── Helpers ────────────────────────────────────────────

const decimalString = z.union([z.string(), z.number().transform(String)]).pipe(
  z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal with up to 2 decimal places')
);

const dateString = z.string().datetime({ offset: true }).or(z.coerce.date());

// ─── Generate Liquidaciones (batch) ─────────────────────

export const GenerateLiquidacionesSchema = z.object({
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2020).max(2100),
});

// ─── Line Item Schemas ──────────────────────────────────

export const CreateLiquidacionLineItemSchema = z.object({
  type: z.nativeEnum(LineItemType),
  description: z.string().min(1).max(500),
  amount: decimalString,
  currency: z.nativeEnum(Currency).optional(),
  /** Si no se indica, rige el valor por defecto del tipo (`defaultCommissionable`). */
  commissionable: z.boolean().optional(),
  /** Si no se indica, rige el destino por defecto del tipo (`defaultBeneficiary`). */
  beneficiary: z.nativeEnum(LineBeneficiary).optional(),
});

export const UpdateLiquidacionLineItemSchema = CreateLiquidacionLineItemSchema.partial();

// ─── Transition Schema ──────────────────────────────────

export const TransitionLiquidacionSchema = z.object({
  status: z.nativeEnum(LiquidacionStatus),
});

// ─── Payment Schema ─────────────────────────────────────

export const CreatePaymentSchema = z
  .object({
    amount: decimalString,
    method: z.nativeEnum(PaymentMethod),
    reference: z.string().max(200).optional(),
    notes: z.string().max(1000).optional(),
    paidAt: dateString,
    /**
     * Cobrar junto con los punitorios devengados a la fecha del pago: se agregan
     * a la liquidación como un renglón Multa y el pago tiene que cubrir el total.
     */
    settlePenalties: z.boolean().optional(),
    /** Quién recibió el dinero; sin valor, según el flujo de pago del contrato. */
    receivedBy: z.nativeEnum(PaymentReceiver).optional(),
    /** Cuenta de la inmobiliaria donde entró; sin valor, la caja (efectivo) o el banco de la moneda. */
    accountId: z.string().uuid().optional().nullable(),
    /** La parte de los locadores queda en custodia de la inmobiliaria hasta entregarla. */
    inCustody: z.boolean().optional(),
    /** Referencia del sistema anterior o del banco; única por inmobiliaria. */
    externalRef: z.string().trim().min(1).max(100).optional(),
  })
  .refine((v) => v.receivedBy !== PaymentReceiver.Locador || (!v.accountId && !v.inCustody), {
    message: 'A payment received by the lessor has no agency account nor custody',
    path: ['receivedBy'],
  });

// ─── Filter Schema ──────────────────────────────────────

export const LiquidacionFilterSchema = z.object({
  status: z.nativeEnum(LiquidacionStatus).optional(),
  contractId: z.string().uuid().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});
