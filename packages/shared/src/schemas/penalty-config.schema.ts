import { z } from 'zod';

export const PenaltyModeEnum = z.enum(['daily_fixed', 'daily_percent', 'compound_percent']);

/** Decimal como texto, sin signo: dígitos y parte decimal opcional. */
const decimalString = (message: string) => z.string().regex(/^\d+(\.\d+)?$/, { message });

/**
 * Configuración de punitorios de una inmobiliaria. `value` y `maxMultiplier`
 * viajan como decimales en texto para no perder precisión en el JSON.
 */
export const PenaltyConfigSchema = z
  .object({
    mode: PenaltyModeEnum,
    value: decimalString('value must be a non-negative decimal string (e.g. "0.001")'),
    graceDays: z.number().int().min(0),
    maxMultiplier: decimalString('maxMultiplier must be a non-negative decimal string (e.g. "2.0")'),
  })
  .strict();

export const PreviewPenaltySchema = z
  .object({
    debt: decimalString('debt must be a non-negative decimal string'),
    daysOverdue: z.number().int().min(0),
    config: PenaltyConfigSchema,
  })
  .strict();

export type PenaltyMode = z.infer<typeof PenaltyModeEnum>;
export type PenaltyConfig = z.infer<typeof PenaltyConfigSchema>;
export type PreviewPenaltyInput = z.infer<typeof PreviewPenaltySchema>;
