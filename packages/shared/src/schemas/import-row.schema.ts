import { z } from 'zod';
import {
  PropertyType,
  Currency,
  FiscalCondition,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  LiquidacionStatus,
  PaymentMethod,
} from '../enums';

/**
 * Relaxed import schemas — coerce strings to numbers (CSV values are always strings),
 * collect all errors via safeParse instead of throwing.
 */

/**
 * Normalizes a raw numeric string before z.coerce.number() sees it, so
 * Argentine/es-AR spreadsheet formats parse correctly:
 *   "150,5"      (comma decimal)              → "150.5"
 *   "1.234,56"   (dot thousands, comma decimal) → "1234.56"
 *   "1234.56"    (already dot decimal)          → left untouched
 * Non-string values (already numbers, undefined, null) pass through as-is.
 */
function normalizeNumericString(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const trimmed = value.trim();
  if (trimmed === '') return value;

  if (trimmed.includes(',')) {
    // Comma present: it's the decimal separator. Any dots before it are
    // thousands separators and get stripped.
    return trimmed.replace(/\./g, '').replace(',', '.');
  }
  return trimmed;
}

/** Wraps a numeric schema with the CSV number-format normalization above. */
const numeric = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(normalizeNumericString, schema);

/**
 * Property schema for import: title required, everything else optional.
 * Numbers are coerced from strings.
 */
export const PropertyImportRowSchema = z.object({
  title: z.string().min(1, 'Title is required').max(300),
  description: z.string().max(5000).optional().default(''),
  type: z.nativeEnum(PropertyType).optional(),
  street: z.string().max(300).optional().default(''),
  number: z.string().max(20).optional().default(''),
  floor: z.string().max(10).optional().default(''),
  apartment: z.string().max(10).optional().default(''),
  city: z.string().max(200).optional().default(''),
  province: z.string().max(200).optional().default(''),
  zipCode: z.string().max(20).optional().default(''),
  country: z.string().max(100).optional().default('Argentina'),
  latitude: numeric(z.coerce.number().min(-90).max(90).optional()),
  longitude: numeric(z.coerce.number().min(-180).max(180).optional()),
  area: numeric(z.coerce.number().positive().optional()),
  rooms: numeric(z.coerce.number().int().min(0).optional()),
  bedrooms: numeric(z.coerce.number().int().min(0).optional()),
  bathrooms: numeric(z.coerce.number().int().min(0).optional()),
  garages: numeric(z.coerce.number().int().min(0).optional()),
  age: numeric(z.coerce.number().int().min(0).optional()),
  orientation: z.string().max(50).optional().default(''),
  price: numeric(z.coerce.number().nonnegative().optional()),
  currency: z.nativeEnum(Currency).optional(),
});

/**
 * Person schema for import: firstName and lastName required.
 */
export const PersonImportRowSchema = z.object({
  firstName: z.string().min(1, 'First name is required').max(200),
  lastName: z.string().min(1, 'Last name is required').max(200),
  email: z.string().email().max(300).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  phone2: z.string().max(50).optional().nullable(),
  cuit: z.string().max(13).optional().nullable(),
  fiscalCondition: z.nativeEnum(FiscalCondition).optional().nullable(),
  bankName: z.string().max(200).optional().nullable(),
  cbu: z.string().regex(/^\d{22}$/, 'CBU must be exactly 22 digits').optional().nullable(),
  bankAlias: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

/**
 * Contract schema for import: propertyRef required as the linking reference,
 * everything else optional. Follows the same relaxed pattern as PropertyImportRowSchema.
 * Uses z.coerce.number() for decimal fields so CSV string values parse correctly.
 */
export const ContractImportRowSchema = z.object({
  propertyRef: z.string().min(1, 'Property reference is required').max(300),
  contractType: z.nativeEnum(ContractType).optional().nullable(),
  startDate: z.string().max(20).optional().nullable(),
  endDate: z.string().max(20).optional().nullable(),
  rentAmount: z.coerce.number().nonnegative().optional().nullable(),
  rentCurrency: z.nativeEnum(Currency).optional().nullable(),
  adjustmentType: z.nativeEnum(AdjustmentType).optional().nullable(),
  adjustmentPeriod: z.nativeEnum(AdjustmentPeriod).optional().nullable(),
  ownerRef: z.string().max(300).optional().nullable(),
  tenantRef: z.string().max(300).optional().nullable(),
  guarantorRef: z.string().max(300).optional().nullable(),
  status: z.nativeEnum(ContractStatus).optional().nullable(),
  depositAmount: z.coerce.number().nonnegative().optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

/**
 * Liquidacion schema for import: contractRef required as the linking reference.
 * Includes inline payment data fields for migration convenience.
 */
export const LiquidacionImportRowSchema = z.object({
  contractRef: z.string().min(1, 'Contract reference is required').max(300),
  period: z.string().max(20).optional().nullable(),
  amount: z.coerce.number().nonnegative().optional().nullable(),
  status: z.nativeEnum(LiquidacionStatus).optional().nullable(),
  dueDate: z.string().max(20).optional().nullable(),
  paymentDate: z.string().max(20).optional().nullable(),
  paymentMethod: z.nativeEnum(PaymentMethod).optional().nullable(),
  paymentAmount: z.coerce.number().nonnegative().optional().nullable(),
});
