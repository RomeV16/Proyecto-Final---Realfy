import { z } from 'zod';
import { TicketStatus, TicketPriority, Currency } from '../enums';

// ─── Ticket CRUD ────────────────────────────────────────

export const CreateTicketSchema = z.object({
  propertyId: z.string().uuid(),
  categoryId: z.string().uuid().optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional().nullable(),
  priority: z.nativeEnum(TicketPriority).default(TicketPriority.Media),
});

export const UpdateTicketSchema = z.object({
  title: z.string().min(1).max(500).optional(),
  description: z.string().max(10000).optional().nullable(),
  priority: z.nativeEnum(TicketPriority).optional(),
  categoryId: z.string().uuid().optional().nullable(),
  assignedToUserId: z.string().uuid().optional().nullable(),
  costAmount: z.number().min(0).optional().nullable(),
  costCurrency: z.nativeEnum(Currency).optional().nullable(),
  costPayer: z.string().max(500).optional().nullable(),
  providerNotes: z.string().max(10000).optional().nullable(),
});

// ─── Ticket Filtering ───────────────────────────────────

export const TicketFilterSchema = z.object({
  status: z.nativeEnum(TicketStatus).optional(),
  priority: z.nativeEnum(TicketPriority).optional(),
  assignedToUserId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  categoryId: z.string().uuid().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Ticket State Transition ────────────────────────────

export const TransitionTicketStatusSchema = z.object({
  status: z.nativeEnum(TicketStatus),
});

// ─── Ticket Category CRUD ───────────────────────────────

export const CreateTicketCategorySchema = z.object({
  name: z.string().min(1).max(200),
  icon: z.string().max(100).optional().nullable(),
  color: z.string().max(50).optional().nullable(),
  sortOrder: z.number().int().min(0).default(0),
});

export const UpdateTicketCategorySchema = z.object({
  name: z.string().min(1).max(200).optional(),
  icon: z.string().max(100).optional().nullable(),
  color: z.string().max(50).optional().nullable(),
  sortOrder: z.number().int().min(0).optional(),
  isActive: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
});

// ─── Ticket Cost Update ─────────────────────────────────

export const UpdateTicketCostSchema = z.object({
  costAmount: z.number().min(0).optional().nullable(),
  costCurrency: z.nativeEnum(Currency).optional().nullable(),
  costPayer: z.string().max(500).optional().nullable(),
});

// ─── Ticket Comment ─────────────────────────────────────

export const CreateTicketCommentSchema = z.object({
  content: z.string().min(1).max(10000),
});

// ─── Portal Ticket Schemas ──────────────────────────────

export const CreatePortalTicketSchema = z.object({
  propertyId: z.string().uuid(),
  title: z.string().min(1).max(500),
  description: z.string().max(10000).optional().nullable(),
  categoryId: z.string().uuid().optional().nullable(),
});

export const CreatePortalTicketCommentSchema = z.object({
  content: z.string().min(1).max(10000),
});
