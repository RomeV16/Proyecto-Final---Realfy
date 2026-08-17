import { z } from 'zod';
import { ComprobanteType } from '../enums';

// ─── Helpers ────────────────────────────────────────────

const decimalString = z.union([z.string(), z.number().transform(String)]).pipe(
  z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal with up to 2 decimal places')
);

// ─── Emit Comprobante (Factura) ─────────────────────────

export const EmitComprobanteSchema = z.object({
  paymentId: z.string().uuid(),
  amount: decimalString,
  description: z.string().min(1).max(1000),
  ivaRate: z.number().min(0).max(100).default(21),
});

// ─── Emit Nota de Crédito ───────────────────────────────

export const EmitNotaCreditoSchema = z.object({
  comprobanteId: z.string().uuid(),
  amount: decimalString,
  description: z.string().min(1).max(1000),
});

// ─── Comprobante Filter (list/search) ───────────────────

export const ComprobanteFilterSchema = z.object({
  paymentId: z.string().uuid().optional(),
  type: z.nativeEnum(ComprobanteType).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});
