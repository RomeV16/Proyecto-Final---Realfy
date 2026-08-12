import { z } from 'zod';

// Web-form schema for penalty config update, aligned with the UpdatePenaltyConfigDto API contract.
// Error messages are i18n keys — translate client-side via t(message).

export const PenaltyModeEnum = z.enum([
  'daily_fixed',
  'daily_percent',
  'compound_percent',
]);

const decimalPattern = /^\d+(\.\d+)?$/;

export const penaltyConfigFormSchema = z.object({
  mode: PenaltyModeEnum,
  value: z
    .number({ invalid_type_error: 'validation.invalidNumber' })
    .nonnegative({ message: 'validation.mustBePositive' }),
  graceDays: z
    .number({ invalid_type_error: 'validation.invalidNumber' })
    .int({ message: 'validation.invalidNumber' })
    .min(0, { message: 'validation.mustBePositive' }),
  maxMultiplier: z
    .number({ invalid_type_error: 'validation.invalidNumber' })
    .min(1, { message: 'validation.mustBePositive' }),
});

/** String-based variant matching the API DTO (value/maxMultiplier as decimal strings). */
export const penaltyConfigStringFormSchema = z.object({
  mode: PenaltyModeEnum,
  value: z
    .string()
    .min(1, { message: 'validation.required' })
    .regex(decimalPattern, { message: 'validation.invalidNumber' }),
  graceDays: z
    .number({ invalid_type_error: 'validation.invalidNumber' })
    .int({ message: 'validation.invalidNumber' })
    .min(0, { message: 'validation.mustBePositive' }),
  maxMultiplier: z
    .string()
    .min(1, { message: 'validation.required' })
    .regex(decimalPattern, { message: 'validation.invalidNumber' }),
});

export type PenaltyConfigFormInput = z.infer<typeof penaltyConfigFormSchema>;
export type PenaltyConfigStringFormInput = z.infer<typeof penaltyConfigStringFormSchema>;
