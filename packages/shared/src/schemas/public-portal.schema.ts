import { z } from 'zod';
import { PropertyOperationType, PropertyType } from '../enums';

// ─── Public Property Listing ────────────────────────────

export const PublicPropertyFilterSchema = z.object({
  operation: z.nativeEnum(PropertyOperationType).optional(),
  type: z.nativeEnum(PropertyType).optional(),
  /** Zona: se busca dentro del nombre de la ciudad o localidad. */
  city: z.string().trim().max(200).optional(),
  minPrice: z.coerce.number().min(0).optional(),
  maxPrice: z.coerce.number().min(0).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
});

// ─── Public Inquiry ──────────────────────────────────────

export const CreatePublicInquirySchema = z
  .object({
    firstName: z.string().min(1).max(200),
    lastName: z.string().min(1).max(200),
    email: z.string().email().optional(),
    phone: z.string().min(1).max(50).optional(),
    message: z.string().min(1).max(5000),
    propertyId: z.string().uuid().optional(),
    /** Señuelo anti-bots: un formulario real lo manda vacío. */
    website: z.string().max(200).optional(),
  })
  .refine((data) => !!data.email || !!data.phone, {
    message: 'Either email or phone is required',
    path: ['email'],
  });
