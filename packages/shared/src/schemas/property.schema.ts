import { z } from 'zod';
import {
  PropertyType,
  PropertyOperationType,
  PropertyState,
  Currency,
} from '../enums';

// ─── Property CRUD ──────────────────────────────────────

export const CreatePropertySchema = z.object({
  title: z.string().min(1).max(300),
  description: z.string().max(5000).optional(),
  type: z.nativeEnum(PropertyType),

  // Address
  street: z.string().max(300).optional(),
  number: z.string().max(20).optional(),
  floor: z.string().max(10).optional(),
  apartment: z.string().max(10).optional(),
  city: z.string().max(200).optional(),
  province: z.string().max(200).optional(),
  zipCode: z.string().max(20).optional(),
  country: z.string().max(100).default('Argentina'),

  // Geolocation
  latitude: z.number().min(-90).max(90).optional(),
  longitude: z.number().min(-180).max(180).optional(),

  // Characteristics
  area: z.number().positive().optional(),
  rooms: z.number().int().min(0).optional(),
  bedrooms: z.number().int().min(0).optional(),
  bathrooms: z.number().int().min(0).optional(),
  garages: z.number().int().min(0).optional(),
  age: z.number().int().min(0).optional(),
  orientation: z.string().max(50).optional(),
  amenities: z.array(z.string().max(100)).default([]),

  // Pricing
  price: z.number().nonnegative().optional(),
  currency: z.nativeEnum(Currency).default(Currency.ARS),
});

export const UpdatePropertySchema = CreatePropertySchema.partial();

// ─── Property Filtering ─────────────────────────────────

export const PropertyFilterSchema = z.object({
  type: z.nativeEnum(PropertyType).optional(),
  operationType: z.nativeEnum(PropertyOperationType).optional(),
  state: z.nativeEnum(PropertyState).optional(),
  city: z.string().optional(),
  province: z.string().optional(),
  minPrice: z.number().nonnegative().optional(),
  maxPrice: z.number().nonnegative().optional(),
  currency: z.nativeEnum(Currency).optional(),
  minArea: z.number().positive().optional(),
  maxArea: z.number().positive().optional(),
  minRooms: z.number().int().min(0).optional(),
  bedrooms: z.number().int().min(0).optional(),
  isActive: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
  search: z.string().max(300).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'price', 'area', 'title'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ─── Property Operation ─────────────────────────────────

export const CreatePropertyOperationSchema = z.object({
  propertyId: z.string().uuid(),
  operationType: z.nativeEnum(PropertyOperationType),
  state: z.nativeEnum(PropertyState).optional(),
  price: z.number().nonnegative().optional(),
  currency: z.nativeEnum(Currency).default(Currency.ARS),
});

export const TransitionPropertyStateSchema = z.object({
  operationId: z.string().uuid(),
  toState: z.nativeEnum(PropertyState),
});
