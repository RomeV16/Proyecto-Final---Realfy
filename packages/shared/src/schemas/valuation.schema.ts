import { z } from 'zod';
import { Currency, ValuationMethod } from '../enums';

// ─── Valuation CRUD ─────────────────────────────────────

export const CreateValuationSchema = z.object({
  propertyId: z.string().uuid(),
  valuationDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  value: z.number().positive(),
  currency: z.nativeEnum(Currency).default(Currency.ARS),
  method: z.nativeEnum(ValuationMethod),
  appraiser: z.string().max(300).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const UpdateValuationSchema = CreateValuationSchema.partial().omit({
  propertyId: true,
});

// ─── Valuation Filtering ────────────────────────────────

export const ValuationFilterSchema = z.object({
  propertyId: z.string().uuid().optional(),
  method: z.nativeEnum(ValuationMethod).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
