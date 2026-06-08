import { z } from 'zod';
import { PersonRole, FiscalCondition } from '../enums';

// ─── CUIT/CUIL Validation ───────────────────────────────

/**
 * Argentine CUIT/CUIL check-digit validation.
 * Format: XX-XXXXXXXX-X where the last digit is a check digit.
 *
 * Algorithm:
 * 1. Strip dashes → 11 digits
 * 2. Multiply each of the first 10 digits by weights [5,4,3,2,7,6,5,4,3,2]
 * 3. Sum products, mod 11 → remainder
 * 4. Check digit = 11 - remainder (with special cases: 11→0, 10→invalid for most prefixes)
 */
export function validateCuit(cuit: string): boolean {
  // Accept with or without dashes
  const clean = cuit.replace(/-/g, '');
  if (!/^\d{11}$/.test(clean)) return false;

  const weights = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const digits = clean.split('').map(Number);

  let sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += digits[i] * weights[i];
  }

  const remainder = sum % 11;
  const checkDigit = 11 - remainder;

  // Special cases
  if (checkDigit === 11) return digits[10] === 0;
  if (checkDigit === 10) return false; // invalid CUIT
  return digits[10] === checkDigit;
}

// ─── Person CRUD ────────────────────────────────────────

export const CreatePersonSchema = z.object({
  firstName: z.string().min(1).max(200),
  lastName: z.string().min(1).max(200),
  email: z.string().email().max(300).optional().nullable(),
  phone: z.string().max(50).optional().nullable(),
  phone2: z.string().max(50).optional().nullable(),
  cuit: z
    .string()
    .max(13)
    .optional()
    .nullable()
    .refine(
      (val) => !val || validateCuit(val),
      { message: 'Invalid CUIT/CUIL check digit' },
    ),
  fiscalCondition: z.nativeEnum(FiscalCondition).optional().nullable(),
  bankName: z.string().max(200).optional().nullable(),
  cbu: z
    .string()
    .regex(/^\d{22}$/, 'CBU must be exactly 22 digits')
    .optional()
    .nullable(),
  bankAlias: z.string().max(200).optional().nullable(),
  notes: z.string().max(5000).optional().nullable(),
});

export const UpdatePersonSchema = CreatePersonSchema.partial();

// ─── Person Filtering ───────────────────────────────────

export const PersonFilterSchema = z.object({
  search: z.string().max(300).optional(),
  role: z.nativeEnum(PersonRole).optional(),
  fiscalCondition: z.nativeEnum(FiscalCondition).optional(),
  isActive: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  sortBy: z
    .enum(['createdAt', 'updatedAt', 'firstName', 'lastName'])
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).default('desc'),
});

// ─── Role Assignment ────────────────────────────────────

export const AssignPersonRoleSchema = z.object({
  role: z.nativeEnum(PersonRole),
});
