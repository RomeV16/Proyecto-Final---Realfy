import { z } from 'zod';
import { InteractionType, VisitStatus, VisitOutcome } from '../enums';

// ─── Interaction CRUD ───────────────────────────────────

export const CreateInteractionSchema = z.object({
  type: z.nativeEnum(InteractionType),
  notes: z.string().max(5000).optional(),
  contactedBy: z.string().uuid().optional(),
  occurredAt: z.coerce.date().optional(),
});

// ─── Visit CRUD ─────────────────────────────────────────

export const CreateVisitSchema = z.object({
  scheduledAt: z.coerce.date(),
  propertyId: z.string().uuid().optional(),
  notes: z.string().max(5000).optional(),
  conductedBy: z.string().uuid().optional(),
});

export const UpdateVisitSchema = z.object({
  status: z.nativeEnum(VisitStatus).optional(),
  outcome: z.nativeEnum(VisitOutcome).optional(),
  completedAt: z.coerce.date().optional(),
  notes: z.string().max(5000).optional(),
});

// ─── Interaction Filtering ──────────────────────────────

export const InteractionFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
