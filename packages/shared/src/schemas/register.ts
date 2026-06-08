import { z } from 'zod';

// Error messages are i18n keys — translate client-side via t(message).

export const registerSchema = z
  .object({
    firstName: z
      .string()
      .min(1, { message: 'validation.required' })
      .max(100, { message: 'validation.maxLength' }),
    lastName: z
      .string()
      .min(1, { message: 'validation.required' })
      .max(100, { message: 'validation.maxLength' }),
    email: z
      .string()
      .min(1, { message: 'validation.required' })
      .email({ message: 'validation.email.invalid' }),
    password: z
      .string()
      .min(8, { message: 'validation.minLength' })
      .max(128, { message: 'validation.maxLength' }),
    confirmPassword: z.string().min(1, { message: 'validation.required' }),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'validation.passwordMismatch',
    path: ['confirmPassword'],
  });

export type RegisterFormInput = z.infer<typeof registerSchema>;
