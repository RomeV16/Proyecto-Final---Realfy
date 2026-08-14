import { z } from 'zod';
import { LeadSource, LeadStatus, Currency, PersonRole } from '../enums';

// ─── Lead CRUD ──────────────────────────────────────────

export const CreateLeadSchema = z.object({
  // Person can be provided by ID or auto-created from contact info
  personId: z.string().uuid().optional(),
  // Fields for person auto-creation (used when personId is omitted)
  firstName: z.string().min(1).max(200).optional(),
  lastName: z.string().min(1).max(200).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(1).max(50).optional(),

  pipelineId: z.string().uuid(),
  currentStageId: z.string().uuid().optional(), // defaults to pipeline's default stage
  propertyId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(), // omit for round-robin auto-assignment
  source: z.nativeEnum(LeadSource),
  notes: z.string().max(5000).optional(),
  budget: z.number().positive().optional(),
  budgetCurrency: z.nativeEnum(Currency).optional(),
}).refine(
  (data) => data.personId || (data.firstName && data.lastName && (data.email || data.phone)),
  {
    message: 'Either personId or (firstName + lastName + email/phone) is required for person auto-creation',
    path: ['personId'],
  },
);

export const UpdateLeadSchema = z.object({
  notes: z.string().max(5000).optional(),
  budget: z.number().positive().nullable().optional(),
  budgetCurrency: z.nativeEnum(Currency).optional(),
  propertyId: z.string().uuid().nullable().optional(),
  source: z.nativeEnum(LeadSource).optional(),
});

// ─── Lead Stage Movement ────────────────────────────────

export const MoveLeadStageSchema = z.object({
  newStageId: z.string().uuid(),
});

// ─── Lead Assignment ────────────────────────────────────

export const AssignLeadSchema = z.object({
  assignedToUserId: z.string().uuid(),
});

// ─── Lead Conversion ────────────────────────────────────

export const ConvertLeadSchema = z.object({
  targetRole: z.enum([PersonRole.Inquilino, PersonRole.Comprador]),
});

// ─── Lead Lost ──────────────────────────────────────────

export const LoseLeadSchema = z.object({
  lostReason: z.string().min(1).max(1000),
});

// ─── Lead Filtering ─────────────────────────────────────

export const LeadFilterSchema = z.object({
  pipelineId: z.string().uuid().optional(),
  currentStageId: z.string().uuid().optional(),
  assignedToUserId: z.string().uuid().optional(),
  source: z.nativeEnum(LeadSource).optional(),
  status: z.nativeEnum(LeadStatus).optional(),
  search: z.string().max(200).optional(),
  isActive: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(20),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'status', 'source'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});
