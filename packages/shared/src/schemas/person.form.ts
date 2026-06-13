import { z } from 'zod';

// Web-form schema for person create/edit.
// Error messages are i18n keys — translate client-side via t(message).

export const personFormSchema = z.object({
  firstName: z
    .string()
    .min(1, { message: 'validation.required' })
    .max(200, { message: 'validation.maxLength' }),
  lastName: z
    .string()
    .min(1, { message: 'validation.required' })
    .max(200, { message: 'validation.maxLength' }),
  email: z
    .string()
    .email({ message: 'validation.email.invalid' })
    .max(300, { message: 'validation.maxLength' })
    .optional()
    .or(z.literal('')),
  phone: z.string().max(50, { message: 'validation.maxLength' }).optional(),
  phone2: z.string().max(50, { message: 'validation.maxLength' }).optional(),
  cuit: z
    .string()
    .max(13, { message: 'validation.maxLength' })
    .optional()
    .or(z.literal('')),
  fiscalCondition: z.string().optional(),
  bankName: z.string().max(200, { message: 'validation.maxLength' }).optional(),
  cbu: z
    .string()
    .refine((v) => !v || /^\d{22}$/.test(v), { message: 'validation.cbu.invalid' })
    .optional()
    .or(z.literal('')),
  bankAlias: z.string().max(200, { message: 'validation.maxLength' }).optional(),
  notes: z.string().max(5000, { message: 'validation.maxLength' }).optional(),
});

export type PersonFormInput = z.infer<typeof personFormSchema>;
