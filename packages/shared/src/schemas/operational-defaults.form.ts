import { z } from 'zod';
import {
  FirstDueMode,
  FixedDiscountProration,
  LateAdjustmentBilling,
  MidMonthAdjustmentMode,
  ProrationMode,
  SalesDepositHolder,
  SkippedAdjustmentsMode,
  UpfrontBasis,
} from '../enums';
import type { OperationalDefaults, OperationalDefaultsInput } from './operational-defaults.schema';
import { CompensationScope, LessorDirectOwes, PartialAllocation } from '../settlement-engine';
import { ReceiptSeriesMode } from '../cash';
import { LessorChargeTiming } from '../owner-ledger';
import { FeeVatMode } from '../enums';
import { LessorInvoiceScope, LessorInvoiceWhen, LESSOR_INVOICE_VAT_RATES } from '../lessor-invoicing';
import { ContractTotalMode, FeePayerChoice, StaffCommissionBase } from '../fee-engine';

// Esquema del formulario web de valores por defecto: todos los campos viajan
// como texto (lo que escribe la persona) y se convierten con
// `operationalDefaultsFromForm`. Los mensajes son claves i18n.

const numberText = (opts: { int?: boolean; min: number; max?: number }) =>
  z
    .string()
    .trim()
    .min(1, { message: 'validation.required' })
    .refine((v) => /^\d+([.,]\d+)?$/.test(v), { message: 'validation.invalidNumber' })
    .refine((v) => !opts.int || /^\d+$/.test(v), { message: 'validation.invalidNumber' })
    .refine((v) => Number(v.replace(',', '.')) >= opts.min, { message: 'validation.outOfRange' })
    .refine((v) => opts.max === undefined || Number(v.replace(',', '.')) <= opts.max, {
      message: 'validation.outOfRange',
    });

export const operationalDefaultsFormSchema = z
  .object({
    dueDay: numberText({ int: true, min: 1, max: 28 }),
    leadDays: numberText({ int: true, min: 0, max: 60 }),
    ipcLagMonths: numberText({ int: true, min: 0, max: 12 }),
    allowProvisional: z.boolean(),
    prorationMode: z.nativeEnum(ProrationMode),
    midMonthAdjustmentMode: z.nativeEnum(MidMonthAdjustmentMode),
    firstDueMode: z.nativeEnum(FirstDueMode),
    fixedDiscountProration: z.nativeEnum(FixedDiscountProration),
    lateAdjustmentBilling: z.nativeEnum(LateAdjustmentBilling),
    commissionPct: numberText({ min: 0, max: 100 }),
    feeAlta: numberText({ min: 0, max: 100 }),
    feeRenovacion: numberText({ min: 0, max: 100 }),
    feeVentaConstruido: numberText({ min: 0, max: 100 }),
    feeVentaLote: numberText({ min: 0, max: 100 }),
    feeInstallments: numberText({ int: true, min: 1, max: 60 }),
    feeAdjustInstallments: z.boolean(),
    feePayer: z.nativeEnum(FeePayerChoice),
    feeLessorSharePct: numberText({ min: 0, max: 100 }),
    feeContractTotalMode: z.nativeEnum(ContractTotalMode),
    feeVatMode: z.nativeEnum(FeeVatMode),
    feeVatPct: numberText({ min: 0, max: 100 }),
    feeStaffCommissionPct: numberText({ min: 0, max: 100 }),
    feeStaffCommissionBase: z.nativeEnum(StaffCommissionBase),
    valuationUsd: numberText({ min: 0 }),
    upfrontThresholdFees: numberText({ min: 0 }),
    upfrontBasis: z.nativeEnum(UpfrontBasis),
    skippedAdjustmentsMode: z.nativeEnum(SkippedAdjustmentsMode),
    firstReminderDays: numberText({ int: true, min: 0, max: 365 }),
    everyDays: numberText({ int: true, min: 1, max: 365 }),
    collectionsEnabled: z.boolean(),
    collectionsRepeatLastLevel: z.boolean(),
    collectionsMaxLevel: numberText({ int: true, min: 1, max: 3 }),
    collectionsLetterTermDays: numberText({ int: true, min: 1, max: 60 }),
    redDays: numberText({ int: true, min: 0, max: 365 }),
    yellowDays: numberText({ int: true, min: 0, max: 365 }),
    cashLessorDirectOwes: z.nativeEnum(LessorDirectOwes),
    cashPartialAllocation: z.nativeEnum(PartialAllocation),
    cashCustodyInAgencyBalance: z.boolean(),
    cashReceiptSeries: z.nativeEnum(ReceiptSeriesMode),
    cashReceiptWhenLessorReceives: z.boolean(),
    cashCompensationScope: z.nativeEnum(CompensationScope),
    /** Vacío = fin de mes. */
    ownerStatementCloseDay: z
      .string()
      .trim()
      .refine((v) => v === '' || (/^\d+$/.test(v) && Number(v) >= 1 && Number(v) <= 28), {
        message: 'validation.outOfRange',
      }),
    ownerLessorChargeTiming: z.nativeEnum(LessorChargeTiming),
    invoicingScope: z.nativeEnum(LessorInvoiceScope),
    invoicingWhen: z.nativeEnum(LessorInvoiceWhen),
    /** Una de las alícuotas de ARCA, como texto. */
    invoicingVatPct: z.string().refine((v) => (LESSOR_INVOICE_VAT_RATES as readonly number[]).includes(Number(v)), {
      message: 'validation.outOfRange',
    }),
    repairPreauthLimit: numberText({ min: 0 }),
    repairMgmtFeePct: numberText({ min: 0, max: 100 }),
    messagingFromHour: numberText({ int: true, min: 0, max: 23 }),
    messagingUntilHour: numberText({ int: true, min: 1, max: 24 }),

    salesReservationDays: numberText({ int: true, min: 1, max: 90 }),
    salesDefaultDepositHolder: z.nativeEnum(SalesDepositHolder),
    salesRequireDocsForBoleto: z.boolean(),
  })
  .refine((v) => Number(v.yellowDays) >= Number(v.redDays) || !/^\d+$/.test(v.yellowDays), {
    message: 'validation.outOfRange',
    path: ['yellowDays'],
  })
  .refine((v) => Number(v.messagingUntilHour) > Number(v.messagingFromHour) || !/^\d+$/.test(v.messagingUntilHour), {
    message: 'validation.outOfRange',
    path: ['messagingUntilHour'],
  });

export type OperationalDefaultsFormInput = z.infer<typeof operationalDefaultsFormSchema>;

const num = (v: string) => Number(v.replace(',', '.'));

/** Valores guardados -> texto de los campos. */
export function operationalDefaultsToForm(d: OperationalDefaults): OperationalDefaultsFormInput {
  return {
    dueDay: String(d.dueDay),
    leadDays: String(d.leadDays),
    ipcLagMonths: String(d.ipcLagMonths),
    allowProvisional: d.allowProvisional,
    prorationMode: d.prorationMode,
    midMonthAdjustmentMode: d.midMonthAdjustmentMode,
    firstDueMode: d.firstDueMode,
    fixedDiscountProration: d.fixedDiscountProration,
    lateAdjustmentBilling: d.lateAdjustmentBilling,
    commissionPct: String(d.commissionPct),
    feeAlta: String(d.fees.alta),
    feeRenovacion: String(d.fees.renovacion),
    feeVentaConstruido: String(d.fees.ventaConstruido),
    feeVentaLote: String(d.fees.ventaLote),
    feeInstallments: String(d.fees.installments),
    feeAdjustInstallments: d.fees.adjustInstallments,
    feePayer: d.fees.payer,
    feeLessorSharePct: String(d.fees.lessorSharePct),
    feeContractTotalMode: d.fees.contractTotalMode,
    feeVatMode: d.fees.vatMode,
    feeVatPct: String(d.fees.vatPct),
    feeStaffCommissionPct: String(d.fees.staffCommissionPct),
    feeStaffCommissionBase: d.fees.staffCommissionBase,
    valuationUsd: String(d.valuationUsd),
    upfrontThresholdFees: String(d.upfrontThresholdFees),
    upfrontBasis: d.upfrontBasis,
    skippedAdjustmentsMode: d.skippedAdjustmentsMode,
    firstReminderDays: String(d.collectionCadence.firstReminderDays),
    everyDays: String(d.collectionCadence.everyDays),
    collectionsEnabled: d.collections.enabled,
    collectionsRepeatLastLevel: d.collections.repeatLastLevel,
    collectionsMaxLevel: String(d.collections.maxLevel),
    collectionsLetterTermDays: String(d.collections.letterTermDays),
    redDays: String(d.expiryLight.redDays),
    yellowDays: String(d.expiryLight.yellowDays),
    cashLessorDirectOwes: d.cash.lessorDirectOwes,
    cashPartialAllocation: d.cash.partialAllocation,
    cashCustodyInAgencyBalance: d.cash.custodyInAgencyBalance,
    cashReceiptSeries: d.cash.receiptSeries,
    cashReceiptWhenLessorReceives: d.cash.receiptWhenLessorReceives,
    cashCompensationScope: d.cash.compensationScope,
    ownerStatementCloseDay: d.ownerAccounts.statementCloseDay === null ? '' : String(d.ownerAccounts.statementCloseDay),
    ownerLessorChargeTiming: d.ownerAccounts.lessorChargeTiming,
    invoicingScope: d.invoicing.scope,
    invoicingWhen: d.invoicing.when,
    invoicingVatPct: String(d.invoicing.vatPct),
    repairPreauthLimit: String(d.repairs.preauthLimit),
    repairMgmtFeePct: String(d.repairs.managementFeePct),
    messagingFromHour: String(d.messaging.fromHour),
    messagingUntilHour: String(d.messaging.untilHour),

    salesReservationDays: String(d.sales.reservationDays),
    salesDefaultDepositHolder: d.sales.defaultDepositHolder,
    salesRequireDocsForBoleto: d.sales.requireDocsForBoleto,
  };
}

/** Texto de los campos (ya validado) -> cuerpo de `PUT /tenants/me/operational-defaults`. */
export function operationalDefaultsFromForm(f: OperationalDefaultsFormInput): OperationalDefaultsInput {
  return {
    dueDay: num(f.dueDay),
    leadDays: num(f.leadDays),
    ipcLagMonths: num(f.ipcLagMonths),
    allowProvisional: f.allowProvisional,
    prorationMode: f.prorationMode,
    midMonthAdjustmentMode: f.midMonthAdjustmentMode,
    firstDueMode: f.firstDueMode,
    fixedDiscountProration: f.fixedDiscountProration,
    lateAdjustmentBilling: f.lateAdjustmentBilling,
    commissionPct: num(f.commissionPct),
    fees: {
      alta: num(f.feeAlta),
      renovacion: num(f.feeRenovacion),
      ventaConstruido: num(f.feeVentaConstruido),
      ventaLote: num(f.feeVentaLote),
      installments: num(f.feeInstallments),
      adjustInstallments: f.feeAdjustInstallments,
      payer: f.feePayer,
      lessorSharePct: num(f.feeLessorSharePct),
      contractTotalMode: f.feeContractTotalMode,
      vatMode: f.feeVatMode,
      vatPct: num(f.feeVatPct),
      staffCommissionPct: num(f.feeStaffCommissionPct),
      staffCommissionBase: f.feeStaffCommissionBase,
    },
    valuationUsd: num(f.valuationUsd),
    upfrontThresholdFees: num(f.upfrontThresholdFees),
    upfrontBasis: f.upfrontBasis,
    skippedAdjustmentsMode: f.skippedAdjustmentsMode,
    collectionCadence: { firstReminderDays: num(f.firstReminderDays), everyDays: num(f.everyDays) },
    collections: {
      enabled: f.collectionsEnabled,
      maxLevel: num(f.collectionsMaxLevel),
      repeatLastLevel: f.collectionsRepeatLastLevel,
      letterTermDays: num(f.collectionsLetterTermDays),
    },
    expiryLight: { redDays: num(f.redDays), yellowDays: num(f.yellowDays) },
    cash: {
      lessorDirectOwes: f.cashLessorDirectOwes,
      partialAllocation: f.cashPartialAllocation,
      custodyInAgencyBalance: f.cashCustodyInAgencyBalance,
      receiptSeries: f.cashReceiptSeries,
      receiptWhenLessorReceives: f.cashReceiptWhenLessorReceives,
      compensationScope: f.cashCompensationScope,
    },
    ownerAccounts: {
      statementCloseDay: f.ownerStatementCloseDay.trim() === '' ? null : num(f.ownerStatementCloseDay),
      lessorChargeTiming: f.ownerLessorChargeTiming,
    },
    invoicing: { scope: f.invoicingScope, when: f.invoicingWhen, vatPct: num(f.invoicingVatPct) },
    repairs: { preauthLimit: num(f.repairPreauthLimit), managementFeePct: num(f.repairMgmtFeePct) },
    messaging: { fromHour: num(f.messagingFromHour), untilHour: num(f.messagingUntilHour) },

    sales: {
      reservationDays: num(f.salesReservationDays),
      defaultDepositHolder: f.salesDefaultDepositHolder,
      requireDocsForBoleto: f.salesRequireDocsForBoleto,
    },
  };
}
