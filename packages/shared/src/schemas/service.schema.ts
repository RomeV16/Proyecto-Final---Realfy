import { z } from 'zod';
import {
  AnnualRecovery,
  BillPaidBy,
  BillingFrequency,
  ChargePayer,
  ChargeSplitMode,
  Currency,
  ServiceBillStatus,
  ServicePaymentPlan,
  ServiceType,
} from '../enums';

// ─── Service CRUD ───────────────────────────────────────

export const CreateServiceSchema = z.object({
  propertyId: z.string().uuid(),
  serviceType: z.nativeEnum(ServiceType),
  providerName: z.string().max(200).optional().nullable(),
  accountNumber: z.string().max(100).optional().nullable(),
  amount: z.number().positive(),
  currency: z.nativeEnum(Currency).default(Currency.ARS),
  dueDay: z.number().int().min(1).max(31),
  billingFrequency: z.nativeEnum(BillingFrequency).default(BillingFrequency.Mensual),
  hasAnnualOption: z.boolean().default(false),
  notes: z.string().max(5000).optional().nullable(),
});

export const UpdateServiceSchema = CreateServiceSchema.partial().omit({
  propertyId: true,
});

// ─── Service Filtering ──────────────────────────────────

export const ServiceFilterSchema = z.object({
  propertyId: z.string().uuid().optional(),
  serviceType: z.nativeEnum(ServiceType).optional(),
  isActive: z.union([z.boolean(), z.string().transform((v) => v === 'true')]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

// ─── Service Payment ────────────────────────────────────

export const CreateServicePaymentSchema = z.object({
  amount: z.number().positive(),
  paymentDate: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  period: z.string().datetime().or(z.string().regex(/^\d{4}-\d{2}-\d{2}$/)),
  notes: z.string().max(5000).optional().nullable(),
});

// ─── Boletas y reglas de traslado ───────────────────────

const decimal = (digits: number) =>
  z
    .union([z.string(), z.number().transform(String)])
    .pipe(
      z
        .string()
        .regex(new RegExp(`^\\d+(\\.\\d{1,${digits}})?$`), `Must be a decimal with up to ${digits} places`),
    );

const dateOnly = z.union([
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  z.string().datetime({ offset: true }),
]);

/** Período de una boleta: "YYYY-MM" o una fecha del mes. */
const periodString = z.union([z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/), dateOnly]);

const shareFields = {
  payer: z.nativeEnum(ChargePayer),
  splitMode: z.nativeEnum(ChargeSplitMode),
  tenantSharePct: decimal(2).refine((v) => Number(v) <= 100, 'tenantSharePct must be between 0 and 100'),
  fixedAmount: decimal(2).nullable(),
  paymentPlan: z.nativeEnum(ServicePaymentPlan),
  annualRecovery: z.nativeEnum(AnnualRecovery),
  annualDiscountToTenant: z.boolean(),
  notes: z.string().max(2000).nullable(),
};

export const CreateChargeRuleSchema = z
  .object({
    serviceId: z.string().uuid(),
    payer: shareFields.payer,
    splitMode: shareFields.splitMode.default(ChargeSplitMode.Porcentaje),
    tenantSharePct: shareFields.tenantSharePct.default('100'),
    fixedAmount: shareFields.fixedAmount.optional(),
    paymentPlan: shareFields.paymentPlan.default(ServicePaymentPlan.Mensual),
    annualRecovery: shareFields.annualRecovery.default(AnnualRecovery.Prorrateado),
    annualDiscountToTenant: shareFields.annualDiscountToTenant.default(true),
    validFrom: dateOnly,
    validTo: dateOnly.nullable().optional(),
    agreementId: z.string().uuid().nullable().optional(),
    notes: shareFields.notes.optional(),
  })
  .strict()
  .refine((v) => v.splitMode !== ChargeSplitMode.Fijo || (v.fixedAmount != null && Number(v.fixedAmount) > 0), {
    message: 'fixedAmount is required for Fijo',
    path: ['fixedAmount'],
  })
  .refine((v) => !v.validTo || new Date(v.validTo).getTime() >= new Date(v.validFrom).getTime(), {
    message: 'validTo must not be before validFrom',
    path: ['validTo'],
  });

export const UpdateChargeRuleSchema = z
  .object({
    ...shareFields,
    validTo: dateOnly.nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const ChargeRuleFilterSchema = z.object({
  at: dateOnly.optional(),
  serviceId: z.string().uuid().optional(),
});

export const ServiceBillRowSchema = z
  .object({
    serviceId: z.string().uuid(),
    period: periodString,
    /** Cuota o bimestre de la boleta ("9/2026"); por defecto, mes/año del período. */
    installmentLabel: z.string().trim().min(1).max(40).optional(),
    amount: decimal(2),
    /** Importe sin descuento por pago anual. */
    nominalAmount: decimal(2).nullable().optional(),
    dueDate: dateOnly.nullable().optional(),
    consumption: decimal(3).nullable().optional(),
    /** Consumo de cada unidad cuando una boleta se reparte entre unidades. */
    unitConsumptions: z
      .array(z.object({ propertyId: z.string().uuid(), consumption: decimal(3) }).strict())
      .max(500)
      .nullable()
      .optional(),
    notes: z.string().max(2000).nullable().optional(),
  })
  .strict();

export const UpdateServiceBillSchema = z
  .object({
    amount: decimal(2),
    nominalAmount: decimal(2).nullable(),
    dueDate: dateOnly.nullable(),
    consumption: decimal(3).nullable(),
    unitConsumptions: ServiceBillRowSchema.shape.unitConsumptions,
    status: z.nativeEnum(ServiceBillStatus),
    paidBy: z.nativeEnum(BillPaidBy).nullable(),
    paidAt: dateOnly.nullable(),
    receiptUrl: z.string().url().max(500).nullable(),
    notes: z.string().max(2000).nullable(),
  })
  .partial()
  .strict()
  .refine((v) => Object.keys(v).length > 0, { message: 'At least one field is required' });

export const ServiceBillFilterSchema = z.object({
  period: periodString.optional(),
  propertyId: z.string().uuid().optional(),
  serviceId: z.string().uuid().optional(),
  status: z.nativeEnum(ServiceBillStatus).optional(),
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

export type ServiceBillRowInput = z.infer<typeof ServiceBillRowSchema>;
export type CreateChargeRuleInput = z.infer<typeof CreateChargeRuleSchema>;
