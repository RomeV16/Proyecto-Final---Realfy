import { z } from 'zod';
import { RendicionStatus, RendicionLineItemType, Currency } from '../enums';

// ─── Helpers ────────────────────────────────────────────

const decimalString = z
  .string()
  .regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal with up to 2 decimal places');

// ─── Generate Rendicion Schema ──────────────────────────

export const GenerateRendicionSchema = z.object({
  contractId: z.string().uuid(),
  month: z.coerce.number().int().min(1).max(12),
  year: z.coerce.number().int().min(2020).max(2100),
});

// ─── Transition Rendicion Schema ────────────────────────

export const TransitionRendicionSchema = z.object({
  status: z.nativeEnum(RendicionStatus),
});

// ─── Rendicion Filter Schema ────────────────────────────

export const RendicionFilterSchema = z.object({
  status: z.nativeEnum(RendicionStatus).optional(),
  contractId: z.string().uuid().optional(),
  ownerId: z.string().uuid().optional(),
  month: z.coerce.number().int().min(1).max(12).optional(),
  year: z.coerce.number().int().min(2020).max(2100).optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

// ─── Create Rendicion Line Item Schema ──────────────────

export const CreateRendicionLineItemSchema = z.object({
  type: z.nativeEnum(RendicionLineItemType),
  description: z.string().min(1).max(500),
  amount: decimalString,
  isDebit: z.boolean().optional(),
  currency: z.nativeEnum(Currency).optional(),
});

// ─── Update Rendicion Notes Schema ──────────────────────

export const UpdateRendicionNotesSchema = z.object({
  notes: z.string().max(2000),
});
