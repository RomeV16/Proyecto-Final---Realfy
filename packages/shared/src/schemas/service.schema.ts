import { z } from 'zod';
import { ServiceType, Currency } from '../enums';

// ─── Service CRUD ───────────────────────────────────────

export const CreateServiceSchema = z.object({
  propertyId: z.string().uuid(),
  serviceType: z.nativeEnum(ServiceType),
  providerName: z.string().max(200).optional().nullable(),
  accountNumber: z.string().max(100).optional().nullable(),
  amount: z.number().positive(),
  currency: z.nativeEnum(Currency).default(Currency.ARS),
  dueDay: z.number().int().min(1).max(31),
  notes: z.string().max(5000).optional().nullable(),
});

export const UpdateServiceSchema = CreateServiceSchema.partial().omit({
  propertyId: true,
});

// ─── Service Filtering ──────────────────────────────────

export const ServiceFilterSchema = z.object({
  propertyId: z.string().uuid().optional(),
  serviceType: z.nativeEnum(ServiceType).optional(),
  isActive: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Service Payment ────────────────────────────────────

export const CreateServicePaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  period: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: z.string().max(5000).optional().nullable(),
});
