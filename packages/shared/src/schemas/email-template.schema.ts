import { z } from 'zod';

// ─── Email Template CRUD ────────────────────────────────

export const CreateEmailTemplateSchema = z.object({
  name: z.string().min(1).max(100),
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50000),
  variables: z.array(z.string().min(1).max(100)).default([]),
  isActive: z.boolean().default(true),
});

export const UpdateEmailTemplateSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(50000).optional(),
  variables: z.array(z.string().min(1).max(100)).optional(),
  isActive: z.boolean().optional(),
});

// ─── Email Template Filtering ───────────────────────────

export const EmailTemplateFilterSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  isActive: z
    .union([z.boolean(), z.string().transform((v) => v === 'true')])
    .optional(),
  search: z.string().max(200).optional(),
});

// ─── Preview & Send ─────────────────────────────────────

export const PreviewEmailTemplateSchema = z.object({
  subject: z.string().min(1).max(500),
  body: z.string().min(1).max(50000),
  variables: z.record(z.string(), z.string()).default({}),
});

export const SendEmailSchema = z.object({
  templateId: z.string().uuid(),
  leadId: z.string().uuid(),
  to: z.string().email(),
  variables: z.record(z.string(), z.string()).default({}),
  subject: z.string().min(1).max(500).optional(),
  body: z.string().min(1).max(50000).optional(),
});
