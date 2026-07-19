import { z } from 'zod';
import {
  LiquidacionStatus,
  PaymentMethod,
  LineItemType,
  Currency,
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
});

export const UpdateLiquidacionLineItemSchema = CreateLiquidacionLineItemSchema.partial();

// ─── Transition Schema ──────────────────────────────────

export const TransitionLiquidacionSchema = z.object({
  status: z.nativeEnum(LiquidacionStatus),
});

// ─── Payment Schema ─────────────────────────────────────

export const CreatePaymentSchema = z.object({
  amount: decimalString,
  method: z.nativeEnum(PaymentMethod),
  reference: z.string().max(200).optional(),
  notes: z.string().max(1000).optional(),
  paidAt: dateString,
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
