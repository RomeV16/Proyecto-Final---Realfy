import { z } from 'zod';
import { Currency, Province, TenantTier } from '../enums';
import { AR_TIME_ZONE } from '../date-utils';

export const CreateTenantSchema = z.object({
  name: z.string().min(2).max(200),
  slug: z
    .string()
    .min(3)
    .max(60)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'Slug must be lowercase letters, numbers and single hyphens')
    .optional(),
  cuit: z
    .string()
    .regex(/^\d{2}-\d{8}-\d$/, 'CUIT must be in format XX-XXXXXXXX-X'),
  province: z.nativeEnum(Province),
  timezone: z.string().default(AR_TIME_ZONE),
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
  /** Matrícula profesional de la inmobiliaria (sale en los contratos). */
  licenseNumber: z.string().trim().min(1).max(60).optional(),
  /** Domicilio de la inmobiliaria (sale en los contratos). */
  address: z.string().trim().min(1).max(300).optional(),
});

/** En la edición un campo vacío o nulo borra el dato. */
const clearable = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .nullish()
    .transform((v) => (v ? v : null));

export const UpdateTenantSchema = CreateTenantSchema.partial()
  .omit({
    cuit: true,
  })
  .extend({
    licenseNumber: clearable(60).optional(),
    address: clearable(300).optional(),
  });
