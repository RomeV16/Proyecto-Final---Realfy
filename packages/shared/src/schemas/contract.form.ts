import { z } from 'zod';

// Web-form schema for contract create/edit.
// Error messages are i18n keys — translate client-side via t(message).

const decimalString = z
  .string()
  .refine((v) => !v || /^\d+(\.\d{1,2})?$/.test(v), {
    message: 'validation.invalidNumber',
  });

const decimalStringRequired = z.string().min(1, { message: 'validation.required' }).refine(
  (v) => /^\d+(\.\d{1,2})?$/.test(v),
  { message: 'validation.invalidNumber' },
);

export const contractFormSchema = z
  .object({
    propertyId: z.string().min(1, { message: 'validation.required' }),
    contractType: z.string().min(1, { message: 'validation.required' }),
    startDate: z.string().min(1, { message: 'validation.required' }),
    endDate: z.string().min(1, { message: 'validation.required' }),
    rentAmount: decimalStringRequired,
    currency: z.string().min(1, { message: 'validation.required' }),
    depositAmount: decimalString.optional(),
    adjustmentType: z.string().min(1, { message: 'validation.required' }),
    adjustmentPeriod: z.string().min(1, { message: 'validation.required' }),
    customAdjustmentPct: decimalString.optional(),
    notes: z.string().max(2000, { message: 'validation.maxLength' }).optional(),
    persons: z.array(
      z.object({
        personId: z.string().min(1, { message: 'validation.required' }),
        role: z.string().min(1, { message: 'validation.required' }),
      }),
    ).min(1, { message: 'validation.required' }),
    guarantees: z.array(z.any()).default([]),
  })
  .refine(
    (data) => {
      if (['Custom', 'FixedPercent'].includes(data.adjustmentType) && !data.customAdjustmentPct) {
        return false;
      }
      return true;
    },
    {
      message: 'validation.required',
      path: ['customAdjustmentPct'],
    },
  );

export type ContractFormInput = z.infer<typeof contractFormSchema>;
