import { z } from 'zod';
import { PipelineType } from '../enums';

// ─── Pipeline CRUD ──────────────────────────────────────

export const CreatePipelineSchema = z.object({
  type: z.nativeEnum(PipelineType),
  name: z.string().min(1).max(200),
});

export const UpdatePipelineSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  isActive: z.boolean().optional(),
});

// ─── Pipeline Stage CRUD ────────────────────────────────

export const CreatePipelineStageSchema = z.object({
  name: z.string().min(1).max(200),
  sortOrder: z.number().int().min(0),
  staleDays: z.number().int().min(1).nullable().optional(),
  isDefault: z.boolean().optional(),
});

export const UpdatePipelineStageSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  staleDays: z.number().int().min(1).nullable().optional(),
  isDefault: z.boolean().optional(),
});

// ─── Reorder ────────────────────────────────────────────

export const ReorderPipelineStagesSchema = z.object({
  stageIds: z
    .array(z.string().uuid())
    .min(1, 'At least one stage ID is required'),
});
