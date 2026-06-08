import { z } from 'zod';

// Web-form schema for property create/edit.
// Error messages are i18n keys — translate client-side via t(message).

export const propertyFormSchema = z.object({
  title: z
    .string()
    .min(1, { message: 'validation.required' })
    .max(300, { message: 'validation.maxLength' }),
  description: z.string().max(5000, { message: 'validation.maxLength' }).optional(),
  type: z.string().min(1, { message: 'validation.required' }),

  // Address
  street: z.string().max(300, { message: 'validation.maxLength' }).optional(),
  number: z.string().max(20, { message: 'validation.maxLength' }).optional(),
  floor: z.string().max(10, { message: 'validation.maxLength' }).optional(),
  apartment: z.string().max(10, { message: 'validation.maxLength' }).optional(),
  city: z.string().max(200, { message: 'validation.maxLength' }).optional(),
  province: z.string().max(200, { message: 'validation.maxLength' }).optional(),
  postalCode: z.string().max(20, { message: 'validation.maxLength' }).optional(),

  // Characteristics (stored as strings in the form, coerced for display)
  totalArea: z
    .string()
    .refine((v) => !v || !isNaN(Number(v)), { message: 'validation.invalidNumber' })
    .optional(),
  coveredArea: z
    .string()
    .refine((v) => !v || !isNaN(Number(v)), { message: 'validation.invalidNumber' })
    .optional(),
  rooms: z
    .string()
    .refine((v) => !v || !isNaN(Number(v)), { message: 'validation.invalidNumber' })
    .optional(),
  bedrooms: z
    .string()
    .refine((v) => !v || !isNaN(Number(v)), { message: 'validation.invalidNumber' })
    .optional(),
  bathrooms: z
    .string()
    .refine((v) => !v || !isNaN(Number(v)), { message: 'validation.invalidNumber' })
    .optional(),
  garages: z
    .string()
    .refine((v) => !v || !isNaN(Number(v)), { message: 'validation.invalidNumber' })
    .optional(),
  age: z
    .string()
    .refine((v) => !v || !isNaN(Number(v)), { message: 'validation.invalidNumber' })
    .optional(),
  orientation: z.string().max(50, { message: 'validation.maxLength' }).optional(),

  // Pricing
  price: z
    .string()
    .refine((v) => !v || (!isNaN(Number(v)) && Number(v) >= 0), {
      message: 'validation.mustBePositive',
    })
    .optional(),
  currency: z.string().min(1, { message: 'validation.required' }),

  amenities: z.array(z.string()).default([]),
});

export type PropertyFormInput = z.infer<typeof propertyFormSchema>;
