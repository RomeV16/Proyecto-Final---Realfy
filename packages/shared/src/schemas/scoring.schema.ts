import { z } from 'zod';

/**
 * Schema for updating tenant score config (factor weights).
 * All fields optional — only provided fields are updated.
 */
export const UpdateScoreConfigSchema = z.object({
  guaranteeWeight: z.number().int().min(0).max(100).optional(),
  jobStabilityWeight: z.number().int().min(0).max(100).optional(),
  referencesWeight: z.number().int().min(0).max(100).optional(),
  paymentHistoryWeight: z.number().int().min(0).max(100).optional(),
  manualRatingWeight: z.number().int().min(0).max(100).optional(),
});

/**
 * Schema for creating or updating a tenant score for a person.
 * All score fields required; notes optional.
 */
export const UpsertTenantScoreSchema = z.object({
  guaranteeScore: z.number().int().min(0).max(100),
  jobStabilityScore: z.number().int().min(0).max(100),
  referencesScore: z.number().int().min(0).max(100),
  paymentHistoryScore: z.number().int().min(0).max(100),
  manualRating: z.number().int().min(0).max(100),
  notes: z.string().optional(),
});
