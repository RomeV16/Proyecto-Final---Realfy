import { z } from 'zod';

// ─── Provider Profile CRUD ──────────────────────────────

export const CreateProviderProfileSchema = z.object({
  personId: z.string().uuid(),
  rubros: z.array(z.string().min(1).max(200)).min(1),
  coverageZones: z.array(z.string().min(1).max(200)).min(1),
  notes: z.string().max(10000).optional().nullable(),
});

export const UpdateProviderProfileSchema = z.object({
  rubros: z.array(z.string().min(1).max(200)).min(1).optional(),
  coverageZones: z.array(z.string().min(1).max(200)).min(1).optional(),
  isActive: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
  notes: z.string().max(10000).optional().nullable(),
});

// ─── Provider Filtering ─────────────────────────────────

export const ProviderFilterSchema = z.object({
  rubro: z.string().optional(),
  zone: z.string().optional(),
  isActive: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
  search: z.string().max(200).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Assign Provider to Ticket ──────────────────────────

export const AssignProviderSchema = z.object({
  providerId: z.string().uuid(),
  providerNotes: z.string().max(10000).optional().nullable(),
});
