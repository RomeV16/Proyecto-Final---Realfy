import { z } from 'zod';
import { ContractType } from '../enums';

// ─── Contract Template CRUD ─────────────────────────────

export const CreateContractTemplateSchema = z.object({
  name: z.string().min(1).max(200),
  contractType: z.nativeEnum(ContractType),
  body: z.string().min(1).max(200000),
  variables: z.array(z.string().min(1).max(100)).default([]),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});

export const UpdateContractTemplateSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  contractType: z.nativeEnum(ContractType).optional(),
  body: z.string().min(1).max(200000).optional(),
  variables: z.array(z.string().min(1).max(100)).optional(),
  isDefault: z.boolean().optional(),
  isActive: z.boolean().optional(),
});

// ─── Contract Template Filtering ────────────────────────

export const ContractTemplateFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  contractType: z.nativeEnum(ContractType).optional(),
  isActive: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .optional(),
  search: z.string().max(200).optional(),
});

// ─── Document Generation ────────────────────────────────

export const GenerateDocumentSchema = z.object({
  templateId: z.string().uuid(),
  format: z.enum(['pdf', 'docx']),
});
