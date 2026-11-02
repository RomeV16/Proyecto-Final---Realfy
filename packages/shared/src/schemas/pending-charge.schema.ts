import { z } from 'zod';
import { ChargeTarget, Currency, LineBeneficiary, PendingChargeKind, PendingChargeStatus } from '../enums';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])(-\d{2})?$/, 'Must be YYYY-MM');

const amount = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^-?\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'))
  .refine((v) => Number(v) !== 0, 'Amount must not be zero');

const chargeFields = {
  propertyId: z.string().uuid().optional(),
  contractId: z.string().uuid().optional().nullable(),
  chargedTo: z.nativeEnum(ChargeTarget),
  lessorPersonId: z.string().uuid().optional().nullable(),
  kind: z.nativeEnum(PendingChargeKind),
  description: z.string().trim().min(1).max(500),
  amount,
  currency: z.nativeEnum(Currency).default(Currency.ARS),
  /** A quién llega el dinero; por defecto el locador (el honorario por gestión siempre es de la inmobiliaria). */
  beneficiary: z.nativeEnum(LineBeneficiary).default(LineBeneficiary.Locador),
  incurredAt: dateOnly,
  /** Primer mes desde el que se imputa (YYYY-MM); sin mes, en la próxima liquidación. */
  targetPeriod: period.optional().nullable(),
  /** Cantidad de cuotas mensuales; con más de una se crea un cargo por cuota. */
  installments: z.number().int().min(1).max(36).default(1),
  notes: z.string().max(2000).optional().nullable(),
  sourceType: z.string().max(100).optional().nullable(),
  sourceId: z.string().max(100).optional().nullable(),
};

/** Cargo nuevo; los de planilla (carga masiva) usan la misma forma. */
export const CreatePendingChargeSchema = z
  .object(chargeFields)
  .strict()
  .refine((v) => v.propertyId || v.contractId, {
    message: 'propertyId or contractId is required',
    path: ['propertyId'],
  })
  .refine((v) => v.chargedTo !== ChargeTarget.Inquilino || !!v.contractId, {
    message: 'A charge to the tenant needs a contract',
    path: ['contractId'],
  });

export const BulkPendingChargesSchema = z
  .object({ rows: z.array(z.record(z.string(), z.unknown())).min(1).max(200) })
  .strict();

/** Corrección de un cargo pendiente; `requiresUpfront: false` lo fuerza a imputarse en la liquidación. */
export const UpdatePendingChargeSchema = z
  .object({
    description: chargeFields.description,
    amount: chargeFields.amount,
    beneficiary: chargeFields.beneficiary,
    incurredAt: chargeFields.incurredAt,
    targetPeriod: chargeFields.targetPeriod,
    notes: chargeFields.notes,
    requiresUpfront: z.boolean(),
  })
  .partial()
  .strict();

export const PendingChargeFilterSchema = z.object({
  contractId: z.string().uuid().optional(),
  propertyId: z.string().uuid().optional(),
  status: z.nativeEnum(PendingChargeStatus).optional(),
  chargedTo: z.nativeEnum(ChargeTarget).optional(),
  /** YYYY-MM: cargos con ese mes de imputación o, sin él, ese mes de gasto. */
  period: period.optional(),
  requiresUpfront: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
});

export type CreatePendingChargeInput = z.infer<typeof CreatePendingChargeSchema>;
export type UpdatePendingChargeInput = z.infer<typeof UpdatePendingChargeSchema>;
