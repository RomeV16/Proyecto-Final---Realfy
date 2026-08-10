import { z } from 'zod';

// Web-form schema for ticket create/edit.
// Error messages are i18n keys — translate client-side via t(message).

export const ticketFormSchema = z.object({
  title: z
    .string()
    .min(1, { message: 'validation.required' })
    .max(500, { message: 'validation.maxLength' }),
  description: z.string().max(10000, { message: 'validation.maxLength' }).optional(),
  propertyId: z.string().optional(),
  categoryId: z.string().optional(),
  priority: z.string().min(1, { message: 'validation.required' }),
  assignedToId: z.string().optional(),
});

export type TicketFormInput = z.infer<typeof ticketFormSchema>;
