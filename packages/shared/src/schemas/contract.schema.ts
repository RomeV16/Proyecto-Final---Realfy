import { z } from 'zod';
import {
  ContractStatus,
  ContractType,
  AdjustmentType,
  AdjustmentPeriod,
  GuaranteeType,
  GuaranteeStatus,
  Currency,
  PersonRole,
} from '../enums';

// ─── Helpers ────────────────────────────────────────────

const decimalString = z.union([z.string(), z.number().transform(String)]).pipe(
  z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a valid decimal with up to 2 decimal places')
);

const decimalStringOptional = decimalString.optional();

const dateString = z.string().datetime({ offset: true }).or(z.coerce.date());

// ─── Contract Person (nested) ───────────────────────────

export const ContractPersonSchema = z.object({
  personId: z.string().uuid(),
  role: z.nativeEnum(PersonRole),
});

// ─── Contract Guarantee (nested) ────────────────────────

export const CreateGuaranteeSchema = z.object({
  type: z.nativeEnum(GuaranteeType),
  status: z.nativeEnum(GuaranteeStatus).optional().default(GuaranteeStatus.Vigente),
  description: z.string().max(1000).optional(),
  amount: decimalStringOptional,
  currency: z.nativeEnum(Currency).optional(),
  issuer: z.string().max(200).optional(),
  policyNumber: z.string().max(100).optional(),
  startDate: dateString.optional(),
  endDate: dateString.optional(),
});

// ─── Create Contract ────────────────────────────────────

export const CreateContractSchema = z
  .object({
    propertyId: z.string().uuid(),
    contractType: z.nativeEnum(ContractType),
    status: z.nativeEnum(ContractStatus).optional().default(ContractStatus.Borrador),
    startDate: dateString,
    endDate: dateString,
    rentAmount: decimalString,
    rentCurrency: z.nativeEnum(Currency).optional().default(Currency.ARS),
    depositAmount: decimalStringOptional,
    depositCurrency: z.nativeEnum(Currency).optional(),
    adjustmentType: z.nativeEnum(AdjustmentType),
    adjustmentPeriod: z.nativeEnum(AdjustmentPeriod),
    customAdjustmentPct: decimalStringOptional,
    notes: z.string().max(2000).optional(),
    persons: z.array(ContractPersonSchema).min(1, 'At least one person is required'),
    guarantees: z.array(CreateGuaranteeSchema).optional().default([]),
  })
  .refine(
    (data) => {
      if (data.adjustmentType === AdjustmentType.Custom && !data.customAdjustmentPct) {
        return false;
      }
      return true;
    },
    {
      message: 'customAdjustmentPct is required when adjustmentType is Custom',
      path: ['customAdjustmentPct'],
    },
  )
  .refine(
    (data) => {
      if (data.adjustmentType === AdjustmentType.FixedPercent && !data.customAdjustmentPct) {
        return false;
      }
      return true;
    },
    {
      message: 'customAdjustmentPct is required when adjustmentType is FixedPercent',
      path: ['customAdjustmentPct'],
    },
  );

// ─── Update Contract ────────────────────────────────────

export const UpdateContractSchema = z.object({
  status: z.nativeEnum(ContractStatus).optional(),
  endDate: dateString.optional(),
  rentAmount: decimalString.optional(),
  rentCurrency: z.nativeEnum(Currency).optional(),
  depositAmount: decimalStringOptional,
  depositCurrency: z.nativeEnum(Currency).optional(),
  adjustmentType: z.nativeEnum(AdjustmentType).optional(),
  adjustmentPeriod: z.nativeEnum(AdjustmentPeriod).optional(),
  customAdjustmentPct: decimalStringOptional,
  notes: z.string().max(2000).optional(),
});

// ─── Contract Filters ───────────────────────────────────

export const ContractFilterSchema = z.object({
  status: z.nativeEnum(ContractStatus).optional(),
  propertyId: z.string().uuid().optional(),
  personId: z.string().uuid().optional(),
  adjustmentType: z.nativeEnum(AdjustmentType).optional(),
  startDateFrom: dateString.optional(),
  startDateTo: dateString.optional(),
  endDateFrom: dateString.optional(),
  endDateTo: dateString.optional(),
  guaranteeExpiringWithinDays: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});
