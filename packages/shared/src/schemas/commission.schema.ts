import { z } from 'zod';
import { CommissionType, Currency } from '../enums';

// ─── Helpers ────────────────────────────────────────────

const decimalString = z.union([z.string(), z.number().transform(String)]).pipe(
  z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal with up to 2 decimal places')
);

const percentageString = z
  .string()
  .regex(/^\d{1,3}(\.\d{1,2})?$/, 'Must be a valid percentage (0-100) with up to 2 decimal places');

// ─── Create Commission Schema ───────────────────────────

export const CreateCommissionSchema = z
  .object({
    type: z.nativeEnum(CommissionType),
    percentage: percentageString.optional(),
    fixedAmount: decimalString.optional(),
    adminFee: decimalString.optional(),
    currency: z.nativeEnum(Currency).optional(),
    notes: z.string().max(1000).optional(),
  })
  .superRefine((data, ctx) => {
    // percentage required for FixedPercent and Mixed
    if (
      (data.type === CommissionType.FixedPercent || data.type === CommissionType.Mixed) &&
      !data.percentage
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Percentage is required for FixedPercent and Mixed commission types',
        path: ['percentage'],
      });
    }

    // fixedAmount required for FixedAmount and Mixed
    if (
      (data.type === CommissionType.FixedAmount || data.type === CommissionType.Mixed) &&
      !data.fixedAmount
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Fixed amount is required for FixedAmount and Mixed commission types',
        path: ['fixedAmount'],
      });
    }
  });

// ─── Update Commission Schema ───────────────────────────

export const UpdateCommissionSchema = z
  .object({
    type: z.nativeEnum(CommissionType).optional(),
    percentage: percentageString.optional(),
    fixedAmount: decimalString.optional(),
    adminFee: decimalString.optional(),
    currency: z.nativeEnum(Currency).optional(),
    notes: z.string().max(1000).optional(),
  });
