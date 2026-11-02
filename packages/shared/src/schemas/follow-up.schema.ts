import { z } from 'zod';
import { AdjustmentPeriod, AdjustmentType, Currency, FollowUpKind, FollowUpOutcome, FollowUpStatus } from '../enums';
import { ExpirationLight } from '../follow-up';
import { CustomStepsSchema } from './contract-rules.schema';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
/** Importe positivo con hasta 2 decimales. */
const positiveAmount = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'))
  .refine((v) => Number(v) > 0, 'Amount must be positive');
const pct = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'));

export const FollowUpFilterSchema = z
  .object({
    light: z.nativeEnum(ExpirationLight).optional(),
    kind: z.nativeEnum(FollowUpKind).optional(),
    status: z.nativeEnum(FollowUpStatus).optional(),
    assigneeId: z.string().uuid().optional(),
    contractId: z.string().uuid().optional(),
    page: z.coerce.number().int().positive().optional().default(1),
    limit: z.coerce.number().int().positive().max(100).optional().default(20),
  })
  .strict();

/** Asignar, cambiar el tipo, anotar o cerrar un seguimiento. */
export const UpdateFollowUpSchema = z
  .object({
    assigneeId: z.string().uuid().nullable().optional(),
    kind: z.nativeEnum(FollowUpKind).optional(),
    outcome: z.nativeEnum(FollowUpOutcome).optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
  })
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });

export const ToggleFollowUpTaskSchema = z
  .object({
    done: z.boolean(),
    dueDate: dateOnly.nullable().optional(),
  })
  .strict();

/** Prórroga de palabra: hasta cuándo sigue el inquilino, sin cambiar el fin pactado. */
export const OralExtensionSchema = z
  .object({
    until: dateOnly,
    note: z.string().trim().min(1).max(1000),
  })
  .strict();

/** Regla de ajuste del período renovado; lo omitido sigue como estaba. */
export const RenewalRuleSchema = z
  .object({
    adjustmentType: z.nativeEnum(AdjustmentType),
    adjustmentPeriod: z.nativeEnum(AdjustmentPeriod),
    customPct: pct.nullable(),
    customSteps: CustomStepsSchema.nullable(),
  })
  .partial()
  .strict();

/** Renovación como período del mismo contrato (4.3). */
export const RenewContractSchema = z
  .object({
    start: dateOnly,
    end: dateOnly,
    rent: positiveAmount,
    adjustment: RenewalRuleSchema.optional(),
    guarantorPersonIds: z.array(z.string().uuid()).max(10).optional(),
    fee: z.object({ amount: positiveAmount, currency: z.nativeEnum(Currency) }).strict().optional(),
    signedAt: dateOnly.optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .strict()
  .refine((v) => v.end > v.start, { message: 'end must be after start', path: ['end'] });

export type FollowUpFilterInput = z.infer<typeof FollowUpFilterSchema>;
export type UpdateFollowUpInput = z.infer<typeof UpdateFollowUpSchema>;
export type OralExtensionInput = z.infer<typeof OralExtensionSchema>;
export type RenewContractInput = z.infer<typeof RenewContractSchema>;
