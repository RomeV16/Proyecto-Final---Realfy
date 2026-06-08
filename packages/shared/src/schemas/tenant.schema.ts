import { z } from 'zod';
import { Currency, Province, TenantTier } from '../enums';

export const CreateTenantSchema = z.object({
  name: z.string().min(2).max(200),
  cuit: z
    .string()
    .regex(/^\d{2}-\d{8}-\d$/, 'CUIT must be in format XX-XXXXXXXX-X'),
  province: z.nativeEnum(Province),
  timezone: z.string().default('America/Buenos_Aires'),
  currency: z.nativeEnum(Currency).default(Currency.ARS),
  tier: z.nativeEnum(TenantTier).default(TenantTier.Professional),
  brandPrimary: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  brandSecondary: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/)
    .optional(),
  logoUrl: z.string().url().optional(),
});

export const UpdateTenantSchema = CreateTenantSchema.partial().omit({
  cuit: true,
});
