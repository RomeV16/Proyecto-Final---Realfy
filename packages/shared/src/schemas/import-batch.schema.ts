import { z } from 'zod';
import {
  AdjustmentBase,
  AnnualDiscountBeneficiary,
  AnnualRecovery,
  BillingFrequency,
  ChargePayer,
  ChargeSplitMode,
  AdjustmentPeriod,
  AdjustmentType,
  CommissionType,
  ContractStatus,
  ContractType,
  Currency,
  FiscalCondition,
  ImportEntity,
  ImportRowAction,
  LessorCapacity,
  PayoutMethod,
  PaymentFlow,
  PersonRole,
  PersonType,
  PropertyType,
  RemainingInstallmentsOnEnd,
  ServicePaymentPlan,
  ServiceType,
} from '../enums';
import { externalRefSchema, validateCuit } from './person.schema';

/**
 * Contrato JSON del importador desde el sistema anterior. Cada fila se valida
 * por separado (un error de fila no aborta el lote), así que el pedido sólo
 * exige la forma de los arreglos y cada esquema de fila se aplica uno a uno.
 */

/** Códigos de error por fila, estables: es lo que los scripts y la pantalla leen. */
export const IMPORT_ERROR_CODES = [
  'VALIDATION_ERROR',
  'REFERENCE_NOT_FOUND',
  'DUPLICATE_IN_BATCH',
  'DUPLICATE_KEY',
  'INVALID_DATES',
  'LESSOR_SHARES_INVALID',
  'MISSING_INQUILINO',
  'OVERLAPPING_ACTIVE_CONTRACT',
  'ADJUSTMENT_HISTORY_INVALID',
  'MISSING_ADJUSTMENT_PCT',
  'RENT_MISMATCH',
  'PROPERTY_STATE_CONFLICT',
  'SERVICE_NOT_APPLICABLE',
  'CHARGE_RULE_IN_USE',
  'INTERNAL_ERROR',
] as const;
const MISSING_ADJUSTMENT_PCT = 'MISSING_ADJUSTMENT_PCT' satisfies (typeof IMPORT_ERROR_CODES)[number];
export type ImportErrorCode = (typeof IMPORT_ERROR_CODES)[number];

export interface ImportRowErrorDetail {
  code: ImportErrorCode;
  message: string;
  field?: string;
}

/** Fecha `YYYY-MM-DD` o ISO con hora; se guarda en UTC. */
const importDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}(T[\d:.]+(Z|[+-]\d{2}:?\d{2})?)?$/, 'Date must be YYYY-MM-DD or ISO 8601')
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'Invalid date');

const text = (max: number) => z.string().trim().min(1).max(max);
const money = z.number().finite().min(0).max(1e13);
const pct = z.number().finite().min(0).max(100);

export const ImportBankAccountSchema = z
  .object({
    currency: z.nativeEnum(Currency).default(Currency.ARS),
    bank: text(200).optional(),
    cbu: z.string().regex(/^\d{22}$/, 'CBU must be exactly 22 digits').optional(),
    alias: text(200).optional(),
    holder: text(200).optional(),
    isDefault: z.boolean().optional(),
  })
  .strict()
  .refine((a) => !!a.cbu || !!a.alias, { message: 'A bank account needs a cbu or an alias' });

export const ImportPersonSchema = z
  .object({
    externalRef: externalRefSchema,
    personType: z.nativeEnum(PersonType).default(PersonType.Fisica),
    firstName: text(200).optional(),
    lastName: text(200).optional(),
    businessName: text(200).optional(),
    dni: text(20).optional(),
    cuit: z
      .string()
      .max(13)
      .refine(validateCuit, { message: 'Invalid CUIT/CUIL check digit' })
      .optional(),
    fiscalCondition: z.nativeEnum(FiscalCondition).optional(),
    email: z.string().email().max(300).optional(),
    phone: text(50).optional(),
    phone2: text(50).optional(),
    address: text(500).optional(),
    maritalStatus: text(50).optional(),
    nationality: text(100).optional(),
    payoutMethod: z.nativeEnum(PayoutMethod).optional(),
    notes: text(5000).optional(),
    roles: z.array(z.nativeEnum(PersonRole)).optional(),
    bankAccounts: z.array(ImportBankAccountSchema).optional(),
  })
  .strict()
  .superRefine((p, ctx) => {
    if (p.personType === PersonType.Juridica) {
      if (!p.businessName) {
        ctx.addIssue({ code: 'custom', path: ['businessName'], message: 'businessName is required for a legal entity' });
      }
    } else if (!p.firstName) {
      ctx.addIssue({ code: 'custom', path: ['firstName'], message: 'firstName is required for an individual' });
    }
  });

export const ImportPropertySchema = z
  .object({
    externalRef: externalRefSchema,
    type: z.nativeEnum(PropertyType),
    title: text(300).optional(),
    street: text(300).optional(),
    number: text(20).optional(),
    floor: text(10).optional(),
    unit: text(10).optional(),
    city: text(200).optional(),
    province: text(200).optional(),
    zipCode: text(20).optional(),
    cadastralId: text(100).optional(),
    parentExternalRef: externalRefSchema.optional(),
    owners: z
      .array(z.object({ personExternalRef: externalRefSchema, sharePct: pct.optional() }).strict())
      .optional(),
  })
  .strict();

const ImportLessorSchema = z
  .object({
    personExternalRef: externalRefSchema,
    capacity: z.nativeEnum(LessorCapacity).default(LessorCapacity.Propietario),
    payoutPct: pct,
    payeeExternalRef: externalRefSchema.optional(),
    bankAccountCbu: z.string().regex(/^\d{22}$/).optional(),
    needsReview: z.boolean().optional(),
  })
  .strict();

const ImportTermsSchema = z
  .object({
    adjustmentType: z.nativeEnum(AdjustmentType),
    adjustmentPeriod: z.nativeEnum(AdjustmentPeriod),
    adjustmentBase: z.nativeEnum(AdjustmentBase).default(AdjustmentBase.Vigente),
    indexLagMonths: z.number().int().min(0).max(12).optional(),
    fixedInitialMonths: z.number().int().min(0).max(120).default(0),
    dueDay: z.number().int().min(1).max(28).optional(),
    paymentFlow: z.nativeEnum(PaymentFlow).default(PaymentFlow.Partido),
    customPct: z.number().finite().min(0).max(999).optional(),
  })
  .strict()
  .superRefine((terms, ctx) => {
    // Un ajuste por porcentaje sin el porcentaje entra al lote y falla recién al calcular el ajuste.
    const needsPct = terms.adjustmentType === AdjustmentType.Custom || terms.adjustmentType === AdjustmentType.FixedPercent;
    if (needsPct && terms.customPct === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['customPct'],
        message: `customPct is required when adjustmentType is ${terms.adjustmentType}`,
        params: { code: MISSING_ADJUSTMENT_PCT },
      });
    }
  });

const ImportCommissionSchema = z
  .object({
    type: z.nativeEnum(CommissionType).default(CommissionType.FixedPercent),
    percentage: pct.optional(),
    fixedAmount: money.optional(),
    adminFee: money.optional(),
  })
  .strict();

const ImportAdjustmentSchema = z
  .object({
    periodNumber: z.number().int().min(1),
    appliedAt: importDate,
    previousAmount: money,
    newAmount: money,
    factor: z.number().finite().positive().optional(),
  })
  .strict();

export const ImportContractSchema = z
  .object({
    externalRef: externalRefSchema,
    propertyExternalRef: externalRefSchema,
    contractType: z.nativeEnum(ContractType).default(ContractType.Alquiler),
    status: z.nativeEnum(ContractStatus),
    startDate: importDate,
    endDate: importDate,
    actualEndDate: importDate.optional(),
    rentAmount: money,
    currency: z.nativeEnum(Currency).default(Currency.ARS),
    initialRent: money.optional(),
    depositAmount: money.optional(),
    notes: text(5000).optional(),
    tenants: z.array(externalRefSchema).optional(),
    guarantors: z.array(externalRefSchema).optional(),
    lessors: z.array(ImportLessorSchema).optional(),
    terms: ImportTermsSchema,
    commission: ImportCommissionSchema.optional(),
    adjustmentsHistory: z.array(ImportAdjustmentSchema).optional(),
    /** Locador que se autoadministra: cobra directo y sólo paga la comisión inicial. */
    selfManaged: z.boolean().default(false),
  })
  .strict();

export const ImportServiceSchema = z
  .object({
    externalRef: externalRefSchema,
    /** `externalRef` de la propiedad (o del edificio) a la que pertenece el servicio. */
    propertyRef: externalRefSchema,
    serviceType: z.nativeEnum(ServiceType),
    providerName: text(200).nullable().optional(),
    accountNumber: text(100).nullable().optional(),
    amount: money,
    currency: z.nativeEnum(Currency).default(Currency.ARS),
    dueDay: z.number().int().min(1).max(31),
    billingFrequency: z.nativeEnum(BillingFrequency).default(BillingFrequency.Mensual),
    hasAnnualOption: z.boolean().default(false),
    isActive: z.boolean().default(true),
    notes: text(5000).nullable().optional(),
  })
  .strict();

/** Fecha de calendario `YYYY-MM-DD` que existe (rechaza el 30 de febrero). */
const calendarDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD')
  .refine((v) => {
    const d = new Date(`${v}T00:00:00.000Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(v);
  }, 'Invalid date');

export const ImportChargeRuleSchema = z
  .object({
    /** `externalRef` del contrato. */
    contractRef: externalRefSchema,
    /** `externalRef` del servicio (del mismo lote o de uno anterior). */
    serviceRef: externalRefSchema,
    payer: z.nativeEnum(ChargePayer),
    splitMode: z.nativeEnum(ChargeSplitMode).default(ChargeSplitMode.Porcentaje),
    tenantSharePct: pct.default(100),
    fixedAmount: money.nullable().optional(),
    paymentPlan: z.nativeEnum(ServicePaymentPlan).default(ServicePaymentPlan.Mensual),
    annualRecovery: z.nativeEnum(AnnualRecovery).default(AnnualRecovery.Prorrateado),
    annualInstallments: z.number().int().min(1).max(12).default(12),
    annualDiscountBeneficiary: z
      .nativeEnum(AnnualDiscountBeneficiary)
      .default(AnnualDiscountBeneficiary.Inquilino),
    remainingInstallmentsOnEnd: z
      .nativeEnum(RemainingInstallmentsOnEnd)
      .default(RemainingInstallmentsOnEnd.CobrarEnLiquidacionFinal),
    validFrom: calendarDate,
    notes: text(2000).nullable().optional(),
  })
  .strict()
  .refine((r) => r.splitMode !== ChargeSplitMode.Fijo || (r.fixedAmount != null && r.fixedAmount > 0), {
    message: 'fixedAmount is required for Fijo',
    path: ['fixedAmount'],
  });

/**
 * Pedido de un lote. Las filas llegan como `unknown` a propósito: se validan
 * una a una con los esquemas de arriba y el error queda en el registro de su fila.
 */
export const ImportBatchRequestSchema = z
  .object({
    dryRun: z.boolean(),
    atomic: z.boolean().default(false),
    kind: text(60).default('SistemaAnterior'),
    persons: z.array(z.unknown()).default([]),
    properties: z.array(z.unknown()).default([]),
    contracts: z.array(z.unknown()).default([]),
    services: z.array(z.unknown()).default([]),
    chargeRules: z.array(z.unknown()).default([]),
  })
  .strict();

export const ImportBatchRowsQuerySchema = z.object({
  action: z.nativeEnum(ImportRowAction).optional(),
  entity: z.nativeEnum(ImportEntity).optional(),
});

export type ImportPersonRow = z.infer<typeof ImportPersonSchema>;
export type ImportPropertyRow = z.infer<typeof ImportPropertySchema>;
export type ImportContractRow = z.infer<typeof ImportContractSchema>;
export type ImportServiceRow = z.infer<typeof ImportServiceSchema>;
export type ImportChargeRuleRow = z.infer<typeof ImportChargeRuleSchema>;
export type ImportBatchRequest = z.infer<typeof ImportBatchRequestSchema>;

export type ImportBatchCounts = {
  total: number;
  errors: number;
  byEntity: Record<string, Record<string, number>>;
};
