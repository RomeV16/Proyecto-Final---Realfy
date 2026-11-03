import { z } from 'zod';
import {
  AdjustmentBase,
  AdjustmentPeriod,
  AdjustmentType,
  ContractAgreementKind,
  Currency,
  FirstDueMode,
  FixedDiscountProration,
  LateAdjustmentBilling,
  MidMonthAdjustmentMode,
  PaymentFlow,
  ProrationMode,
  UpfrontBasis,
  SkippedAdjustmentsMode,
} from '../enums';
import { LessorDirectOwes } from '../settlement-engine';
import { PenaltyConfigSchema } from './penalty-config.schema';

const decimal = (digits: number) =>
  z
    .union([z.string(), z.number().transform(String)])
    .pipe(
      z
        .string()
        .regex(new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`), `Must be a decimal with up to ${digits} places`),
    );

const dateString = z.string().datetime({ offset: true }).or(z.coerce.date());

/** Un escalón del ajuste escalonado: desde el mes N del contrato rige el porcentaje. */
export const CustomStepSchema = z
  .object({
    fromMonth: z.number().int().min(1).max(600),
    pct: decimal(2),
  })
  .strict();

export const CustomStepsSchema = z
  .array(CustomStepSchema)
  .min(1)
  .max(60)
  .refine((steps) => steps.every((s, i) => i === 0 || s.fromMonth > steps[i - 1].fromMonth), {
    message: 'fromMonth must be strictly increasing',
  });

/** Convenciones de liquidación de un contrato (todas pactables). */
const liquidationConventionFields = {
  prorationMode: z.nativeEnum(ProrationMode),
  midMonthAdjustmentMode: z.nativeEnum(MidMonthAdjustmentMode),
  firstDueMode: z.nativeEnum(FirstDueMode),
  fixedDiscountProration: z.nativeEnum(FixedDiscountProration),
  upfrontBasis: z.nativeEnum(UpfrontBasis),
  lateAdjustmentBilling: z.nativeEnum(LateAdjustmentBilling),
  skippedAdjustmentsMode: z.nativeEnum(SkippedAdjustmentsMode),
};

/** Umbral de anticipo del centro de carga, en comisiones mensuales; null vuelve al valor por defecto de la inmobiliaria. */
const upfrontThresholdField = { upfrontThresholdFees: z.number().int().min(0).max(24).nullable() };

/**
 * Qué le debe el locador a la inmobiliaria cuando el inquilino le paga
 * directamente; null vuelve al valor por defecto de la inmobiliaria.
 */
const lessorDirectOwesField = { lessorDirectOwes: z.nativeEnum(LessorDirectOwes).nullable() };

/**
 * Límite de reparaciones sin consultar al locador pactado en el contrato (importe y moneda); null en
 * ambos vuelve al valor por defecto de la inmobiliaria. Un importe sin moneda se toma en pesos.
 */
const repairPreauthLimitFields = {
  repairPreauthLimitAmount: decimal(2).nullable(),
  repairPreauthLimitCurrency: z.nativeEnum(Currency).nullable(),
};

/** Las cuatro convenciones al crear o corregir un contrato; lo omitido toma el valor por defecto de la inmobiliaria. */
export const LiquidationConventionsSchema = z
  .object({ ...liquidationConventionFields, ...upfrontThresholdField, ...lessorDirectOwesField, ...repairPreauthLimitFields })
  .partial()
  .strict();
export type LiquidationConventions = z.infer<typeof LiquidationConventionsSchema>;

/** Campos de las reglas de un contrato que un acuerdo puede cambiar. */
export const TermsPatchSchema = z
  .object({
    adjustmentType: z.nativeEnum(AdjustmentType),
    adjustmentPeriod: z.nativeEnum(AdjustmentPeriod),
    adjustmentBase: z.nativeEnum(AdjustmentBase),
    indexLagMonths: z.number().int().min(0).max(12),
    fixedInitialMonths: z.number().int().min(0).max(120),
    customPct: decimal(2).nullable(),
    customSteps: CustomStepsSchema.nullable(),
    rentOverride: decimal(2).nullable(),
    discountPct: decimal(2).nullable(),
    discountAmount: decimal(2).nullable(),
    dueDay: z.number().int().min(1).max(28),
    paymentFlow: z.nativeEnum(PaymentFlow),
    penaltyConfig: PenaltyConfigSchema.nullable(),
    ...liquidationConventionFields,
    ...upfrontThresholdField,
    ...lessorDirectOwesField,
    ...repairPreauthLimitFields,
  })
  .partial()
  .strict();

/** Tipos de convenio que cambian las reglas y por eso exigen `termsPatch`. */
export const RULE_CHANGING_AGREEMENT_KINDS: readonly ContractAgreementKind[] = [
  ContractAgreementKind.CambioRegla,
  ContractAgreementKind.Renegociacion,
  ContractAgreementKind.Rebaja,
  ContractAgreementKind.Bonificacion,
  ContractAgreementKind.Renovacion,
];

export const CreateContractAgreementSchema = z
  .object({
    kind: z.nativeEnum(ContractAgreementKind),
    effectiveFrom: dateString,
    effectiveTo: dateString.optional().nullable(),
    documentUrl: z.string().url().max(500).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
    termsPatch: TermsPatchSchema.optional(),
  })
  .strict()
  .refine(
    (v) => !v.effectiveTo || new Date(v.effectiveTo).getTime() > new Date(v.effectiveFrom).getTime(),
    { message: 'effectiveTo must be after effectiveFrom', path: ['effectiveTo'] },
  )
  .refine(
    (v) =>
      !RULE_CHANGING_AGREEMENT_KINDS.includes(v.kind) ||
      (v.termsPatch !== undefined && Object.keys(v.termsPatch).length > 0),
    { message: 'termsPatch is required for this kind of agreement', path: ['termsPatch'] },
  )
  .refine((v) => RULE_CHANGING_AGREEMENT_KINDS.includes(v.kind) || v.termsPatch === undefined, {
    message: 'termsPatch only applies to agreements that change the rules',
    path: ['termsPatch'],
  });

export const UpdateContractAgreementSchema = z
  .object({
    effectiveTo: dateString.optional().nullable(),
    documentUrl: z.string().url().max(500).optional().nullable(),
    notes: z.string().max(2000).optional().nullable(),
  })
  .strict();

export type TermsPatch = z.infer<typeof TermsPatchSchema>;
export type CreateContractAgreementInput = z.infer<typeof CreateContractAgreementSchema>;
