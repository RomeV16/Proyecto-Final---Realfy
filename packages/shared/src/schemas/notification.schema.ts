import { z } from 'zod';

export const NotificationFilterSchema = z.object({
  isRead: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
  type: z.string().optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});
