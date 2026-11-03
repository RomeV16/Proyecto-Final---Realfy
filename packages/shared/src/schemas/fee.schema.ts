import { z } from 'zod';
import { Currency, FeeBasis, FeeInstallmentStatus, FeeKind, FeePayerRole, FeeSettlement, FeeStatus, FeeVatMode, PaymentMethod } from '../enums';
import { SaleAsset } from '../fee-engine';

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Must be YYYY-MM-DD');
const period = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Must be YYYY-MM');
const uuid = z.string().uuid();
/** Importe con hasta 2 decimales, cero o positivo. */
const amount = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,2})?$/, 'Must be a decimal with up to 2 places'));
const positiveAmount = amount.refine((v) => Number(v) > 0, 'Amount must be positive');
/** Porcentaje de 0 a 100 con hasta 4 decimales. */
const pct = z
  .union([z.string(), z.number().transform(String)])
  .pipe(z.string().regex(/^\d+(\.\d{1,4})?$/, 'Must be a percentage with up to 4 places'))
  .refine((v) => Number(v) <= 100, 'Must be at most 100');
const notes = z.string().trim().max(2000).optional().nullable();
const page = {
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
};

/** Cómo pagan los que pagan: se reparten el honorario o cada uno paga el suyo (venta: cada parte). */
export enum FeePayerMode {
  Reparto = 'Reparto',
  CadaParte = 'CadaParte',
}

/** Propuesta de honorario con los valores por defecto de la inmobiliaria. */
export const FeePreviewSchema = z
  .object({
    kind: z.nativeEnum(FeeKind),
    contractId: uuid.optional(),
    contractPeriodId: uuid.optional(),
    propertyId: uuid.optional(),
    valuationId: uuid.optional(),
    saleAsset: z.nativeEnum(SaleAsset).optional(),
    /** Valor real de la venta. */
    baseAmount: amount.optional(),
    currency: z.nativeEnum(Currency).optional(),
  })
  .refine((v) => ![FeeKind.AltaAlquiler, FeeKind.Renovacion].includes(v.kind) || v.contractId || v.contractPeriodId, {
    message: 'A rental fee needs a contract or a contract period',
    path: ['contractId'],
  });

export const FeePayerInputSchema = z
  .object({
    role: z.nativeEnum(FeePayerRole),
    personId: uuid,
    /** Parte del honorario en un reparto (los que pagan suman 100). */
    sharePct: pct.optional(),
  })
  .strict();

export const FeeShareInputSchema = z
  .object({
    counterparty: z.string().trim().min(2).max(200),
    pct,
    notes,
  })
  .strict();

export const StaffCommissionInputSchema = z
  .object({
    userId: uuid.optional().nullable(),
    personId: uuid.optional().nullable(),
    pct,
    notes,
  })
  .strict()
  .refine((v) => Boolean(v.userId) !== Boolean(v.personId), {
    message: 'A staff commission goes to one user or one person',
    path: ['userId'],
  });

export const CreateFeeSchema = z
  .object({
    kind: z.nativeEnum(FeeKind),
    contractId: uuid.optional().nullable(),
    contractPeriodId: uuid.optional().nullable(),
    propertyId: uuid.optional().nullable(),
    valuationId: uuid.optional().nullable(),
    /** Operación de venta a la que pertenece el honorario (solo `Venta`). */
    salesOpId: uuid.optional().nullable(),
    basis: z.nativeEnum(FeeBasis),
    /** Base del porcentaje (total del contrato, valor real) o el monto fijo. */
    baseAmount: amount,
    /** Porcentaje sobre la base; sin porcentaje en un monto fijo. */
    pct: pct.optional().nullable(),
    currency: z.nativeEnum(Currency),
    payers: z.array(FeePayerInputSchema).min(1).max(4),
    payerMode: z.nativeEnum(FeePayerMode).default(FeePayerMode.Reparto),
    vatMode: z.nativeEnum(FeeVatMode).default(FeeVatMode.NoAplica),
    vatPct: pct.default('0'),
    installments: z.number().int().min(1).max(60).default(1),
    firstDueDate: dateOnly,
    adjustInstallments: z.boolean().default(false),
    shares: z.array(FeeShareInputSchema).max(5).default([]),
    staff: z.array(StaffCommissionInputSchema).max(10).default([]),
    notes,
  })
  .strict()
  .refine((v) => v.basis === FeeBasis.MontoFijo || (v.pct !== undefined && v.pct !== null), {
    message: 'A percentage fee needs pct',
    path: ['pct'],
  })
  .refine((v) => v.basis !== FeeBasis.TotalContrato || v.contractId || v.contractPeriodId, {
    message: 'A fee on the contract total needs a contract',
    path: ['contractId'],
  })
  .refine(
    (v) =>
      v.payerMode === FeePayerMode.CadaParte ||
      v.payers.length === 1 ||
      Math.abs(v.payers.reduce((acc, p) => acc + Number(p.sharePct ?? 0), 0) - 100) < 1e-9,
    { message: 'The payer shares must add up to 100', path: ['payers'] },
  )
  .refine((v) => new Set(v.payers.map((p) => `${p.role}:${p.personId}`)).size === v.payers.length, {
    message: 'A payer appears twice',
    path: ['payers'],
  })
  .refine((v) => !v.adjustInstallments || v.contractId || v.contractPeriodId, {
    message: 'Only a rental fee follows the rent adjustments',
    path: ['adjustInstallments'],
  });

export const UpdateFeeSchema = z.object({ notes }).strict();

export const CancelFeeSchema = z.object({ reason: z.string().trim().min(3).max(1000) }).strict();

export const FeeFilterSchema = z.object({
  kind: z.nativeEnum(FeeKind).optional(),
  status: z.nativeEnum(FeeStatus).optional(),
  payerRole: z.nativeEnum(FeePayerRole).optional(),
  payerPersonId: uuid.optional(),
  contractId: uuid.optional(),
  propertyId: uuid.optional(),
  /** Honorarios con alguna cuota que vence en el mes. */
  period: period.optional(),
  ...page,
});

export const FeeInstallmentFilterSchema = z.object({
  kind: z.nativeEnum(FeeKind).optional(),
  status: z.nativeEnum(FeeInstallmentStatus).optional(),
  payerRole: z.nativeEnum(FeePayerRole).optional(),
  contractId: uuid.optional(),
  /** Cuotas que vencen en el mes. */
  period: period.optional(),
  ...page,
});

/**
 * Cobro de una cuota: entra a una cuenta de la inmobiliaria (`Caja`, con recibo)
 * o, si paga el locador, se descuenta de su cuenta corriente (`CuentaLocador`).
 */
export const PayFeeInstallmentSchema = z
  .object({
    settlement: z.nativeEnum(FeeSettlement).default(FeeSettlement.Caja),
    accountId: uuid.optional().nullable(),
    method: z.nativeEnum(PaymentMethod).default(PaymentMethod.Efectivo),
    date: dateOnly,
    /** Importe cobrado; por defecto, el de la cuota (ajustado si corresponde). */
    amount: positiveAmount.optional(),
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .strict()
  .refine((v) => v.settlement === FeeSettlement.Caja || !v.accountId, {
    message: 'A lessor account deduction does not use a cash account',
    path: ['accountId'],
  });

export const StaffCommissionFilterSchema = z.object({
  paid: z.enum(['true', 'false']).optional(),
  userId: uuid.optional(),
  personId: uuid.optional(),
  feeId: uuid.optional(),
  ...page,
});

export const PayStaffCommissionSchema = z
  .object({
    accountId: uuid,
    date: dateOnly,
    note: z.string().trim().max(1000).optional().nullable(),
  })
  .strict();

export type FeePreviewInput = z.infer<typeof FeePreviewSchema>;
export type CreateFeeInput = z.infer<typeof CreateFeeSchema>;
export type CreateFeeFormInput = z.input<typeof CreateFeeSchema>;
export type PayFeeInstallmentInput = z.infer<typeof PayFeeInstallmentSchema>;
export type StaffCommissionInput = z.infer<typeof StaffCommissionInputSchema>;
export type FeeShareInput = z.infer<typeof FeeShareInputSchema>;
