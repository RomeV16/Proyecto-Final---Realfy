import {
  CreateFeeSchema,
  distributeFee,
  FeeBasis,
  feeAmounts,
  FeeInstallmentStatus,
  FeeKind,
  FeePayerMode,
  FeePayerRole,
  FeeSettlement,
  FeeStatus,
  FeeVatMode,
  formatReceiptNumber,
  PayFeeInstallmentSchema,
  PaymentMethod,
  PayStaffCommissionSchema,
  pctOf,
  splitBetweenPayers,
  StaffCommissionBase,
  sumMoney,
  type CreateFeeInput,
} from '@realfy/shared';
import { parsePositiveAmount } from './cash';
import { sharedFormSchema } from './form-schema';
import { toDecimalString } from './index-values';

/* ──────────── Lo que devuelve la API ──────────── */

interface PlaceRef {
  id?: string;
  title: string;
}

export interface FeeInstallment {
  id: string;
  n: number;
  dueDate: string;
  amount: string;
  adjustedAmount: string | null;
  status: string;
  paidAt: string | null;
  paidAmount: string | null;
  settlement: string | null;
  receiptId: string | null;
  receipt: { id: string; series: string; number: number; label?: string } | null;
  /** Lo que hay que cobrar hoy (con el ajuste si corresponde), con 2 decimales. */
  dueAmount: string;
}

export interface FeeShare {
  id: string;
  counterparty: string;
  pct: string;
  amount: string;
  currency: string;
}

export interface FeeStaffCommission {
  id: string;
  userId: string | null;
  personId: string | null;
  pct: string;
  baseAmount: string;
  amount: string;
  currency: string;
  paidAt: string | null;
  beneficiaryName: string;
}

export interface Fee {
  id: string;
  kind: string;
  status: string;
  groupId: string | null;
  contractId: string | null;
  contractPeriodId: string | null;
  propertyId: string | null;
  payerPersonId: string;
  payerRole: string;
  payerName: string;
  basis: string;
  pct: string | null;
  baseAmount: string;
  vatMode: string;
  vatPct: string;
  netAmount: string;
  vatAmount: string;
  total: string;
  currency: string;
  installments: number;
  adjustInstallments: boolean;
  notes: string | null;
  cancelReason: string | null;
  createdAt: string;
  contract: { id: string; property: PlaceRef | null } | null;
  property: PlaceRef | null;
  installmentRows: FeeInstallment[];
  shares: FeeShare[];
  staffCommissions: FeeStaffCommission[];
}

/** Una cuota del listado de cobro, con su honorario (sin las otras cuotas). */
export interface InstallmentItem extends FeeInstallment {
  fee: Omit<Fee, 'installmentRows' | 'shares' | 'staffCommissions'>;
}

export interface StaffCommissionItem {
  id: string;
  feeId: string;
  pct: string;
  baseAmount: string;
  amount: string;
  currency: string;
  paidAt: string | null;
  beneficiaryName: string;
  fee: {
    id: string;
    kind: string;
    status: string;
    total: string;
    currency: string;
    payerName: string;
    contract: { property: PlaceRef | null } | null;
    property: PlaceRef | null;
  };
}

export interface SuggestedPayer {
  role: string;
  personId: string;
  name: string;
  sharePct: string;
}

/** Propuesta de `GET /fees/preview`: los valores por defecto de la inmobiliaria para la operación. */
export interface FeePreview {
  kind: string;
  basis: string;
  baseAmount: string;
  pct: string | null;
  currency: string;
  payerMode: string;
  payerChoice?: string;
  payers: SuggestedPayer[];
  firstDueDate: string;
  installments: number;
  adjustInstallments: boolean;
  vatMode: string;
  vatPct: string;
  staffCommissionPct: string;
  staffCommissionBase: string;
  contractId?: string | null;
  contractPeriodId?: string | null;
  propertyId?: string | null;
  valuationId?: string | null;
  saleAsset?: string;
  contractTotal?: {
    mode: string;
    months: number;
    projected: boolean;
    indexBased: boolean;
    initialRent: string;
    start: string;
    end: string;
  };
  estimate: string[];
}

/* ──────────── Constantes ──────────── */

export const FEE_KINDS = Object.values(FeeKind);
export const FEE_STATUSES = Object.values(FeeStatus);
export const FEE_INSTALLMENT_STATUSES = Object.values(FeeInstallmentStatus);
export const FEE_PAYER_ROLES = Object.values(FeePayerRole);
export const FEE_VAT_MODES = Object.values(FeeVatMode);
export const FEE_PAYER_MODES = Object.values(FeePayerMode);
export const FEE_SETTLEMENTS = Object.values(FeeSettlement);
export const PAYMENT_METHODS = Object.values(PaymentMethod);

const RENTAL_KINDS: readonly string[] = [FeeKind.AltaAlquiler, FeeKind.Renovacion];

/** Alta o renovación: el honorario sale del contrato. */
export const isRentalKind = (kind: string): boolean => RENTAL_KINDS.includes(kind);

/* ──────────── Lectura ──────────── */

/** Propiedad del honorario: la del contrato o la de la operación. */
export function feePlace(fee: { contract?: { property: PlaceRef | null } | null; property?: PlaceRef | null }): string {
  return fee.contract?.property?.title ?? fee.property?.title ?? '';
}

/** Cuotas cobradas de un honorario. */
export function paidInstallments(fee: Pick<Fee, 'installmentRows'>): number {
  return fee.installmentRows.filter((row) => row.status === FeeInstallmentStatus.Pagada).length;
}

/** La cuota sigue al alquiler y hoy vale otra cosa que al crearla. */
export function isAdjusted(row: Pick<FeeInstallment, 'amount' | 'dueAmount'>): boolean {
  return Number(row.dueAmount) !== Number(row.amount);
}

/** Se puede cobrar: la cuota está pendiente y el honorario no se anuló. */
export function canPayInstallment(row: Pick<FeeInstallment, 'status'>, fee: Pick<Fee, 'status'>): boolean {
  return row.status === FeeInstallmentStatus.Pendiente && fee.status !== FeeStatus.Anulado;
}

/** Descontar de la cuenta corriente solo vale si paga el locador. */
export const canSettleToLessor = (payerRole: string): boolean => payerRole === FeePayerRole.Locador;

/** Se puede anular: sin cuotas cobradas ni comisiones pagadas (la API lo vuelve a verificar). */
export function canCancelFee(fee: Pick<Fee, 'status' | 'installmentRows' | 'staffCommissions'>): boolean {
  return (
    fee.status !== FeeStatus.Anulado &&
    paidInstallments(fee) === 0 &&
    !fee.staffCommissions.some((commission) => commission.paidAt)
  );
}

/** Número del recibo de la cuota `n`, o null si se descontó de la cuenta del locador o no se cobró. */
export function installmentReceipt(fee: Pick<Fee, 'installmentRows'>, n: number): string | null {
  const receipt = fee.installmentRows.find((row) => row.n === n)?.receipt;
  return receipt ? (receipt.label ?? formatReceiptNumber(receipt.number)) : null;
}

/* ──────────── Alta: la propuesta editable ──────────── */

export interface DraftPayer {
  role: string;
  personId: string;
  name: string;
  sharePct: string;
}

/** Identifica una fila del formulario mientras se edita. */
let rowSeq = 0;
export const newRowKey = (): string => `row-${++rowSeq}`;

export interface DraftShare {
  key: string;
  counterparty: string;
  pct: string;
}

export interface DraftStaff {
  key: string;
  userId: string;
  pct: string;
}

/** Los valores del formulario de alta, como texto (lo que escribe la persona). */
export interface FeeDraft {
  kind: string;
  contractId: string;
  contractPeriodId: string;
  propertyId: string;
  valuationId: string;
  basis: string;
  baseAmount: string;
  pct: string;
  currency: string;
  payerMode: string;
  payers: DraftPayer[];
  vatMode: string;
  vatPct: string;
  installments: string;
  firstDueDate: string;
  adjustInstallments: boolean;
  shares: DraftShare[];
  staff: DraftStaff[];
  notes: string;
  /** Sobre qué calcula la API la comisión del personal (solo para la estimación). */
  staffCommissionBase: string;
  /** Porcentaje de comisión del personal de la inmobiliaria (para una fila nueva). */
  staffCommissionPct: string;
}

/** Formulario de alta con la propuesta de la API; `keep` conserva lo ya escrito (el valor de una venta). */
export function draftFromPreview(preview: FeePreview, keep: Partial<FeeDraft> = {}): FeeDraft {
  return {
    kind: preview.kind,
    contractId: preview.contractId ?? '',
    contractPeriodId: preview.contractPeriodId ?? '',
    propertyId: preview.propertyId ?? '',
    valuationId: preview.valuationId ?? '',
    basis: preview.basis,
    baseAmount: preview.baseAmount,
    pct: preview.pct ?? '',
    currency: preview.currency,
    payerMode: preview.payerMode,
    payers: preview.payers.map((p) => ({ ...p })),
    vatMode: preview.vatMode,
    vatPct: preview.vatPct,
    installments: String(preview.installments),
    firstDueDate: preview.firstDueDate,
    adjustInstallments: preview.adjustInstallments,
    shares: [],
    staff: [],
    notes: '',
    staffCommissionBase: preview.staffCommissionBase,
    staffCommissionPct: preview.staffCommissionPct,
    ...keep,
  };
}

const orNull = (value: string): string | null => value.trim() || null;
const decimal = (raw: string): string => toDecimalString(raw ?? '') ?? raw;

/** Con más de uno que paga y en reparto, cada uno lleva su parte. */
const splitsShares = (draft: Pick<FeeDraft, 'payerMode' | 'payers'>): boolean =>
  draft.payerMode === FeePayerMode.Reparto && draft.payers.length > 1;

/** Cuerpo de `POST /fees` con los valores del formulario. */
export function feeBody(draft: FeeDraft): Record<string, unknown> {
  const rental = Boolean(draft.contractId || draft.contractPeriodId);
  const split = splitsShares(draft);
  return {
    kind: draft.kind,
    contractId: orNull(draft.contractId),
    contractPeriodId: orNull(draft.contractPeriodId),
    propertyId: orNull(draft.propertyId),
    valuationId: orNull(draft.valuationId),
    basis: draft.basis,
    baseAmount: decimal(draft.baseAmount),
    pct: draft.basis === FeeBasis.MontoFijo ? null : decimal(draft.pct),
    currency: draft.currency,
    payers: draft.payers.map((p) => ({
      role: p.role,
      personId: p.personId,
      ...(split ? { sharePct: decimal(p.sharePct) } : {}),
    })),
    payerMode: draft.payerMode,
    vatMode: draft.vatMode,
    vatPct: draft.vatMode === FeeVatMode.NoAplica ? '0' : decimal(draft.vatPct),
    installments: Number(draft.installments),
    firstDueDate: draft.firstDueDate,
    adjustInstallments: rental && draft.adjustInstallments,
    shares: draft.shares.map((s) => ({ counterparty: s.counterparty.trim(), pct: decimal(s.pct) })),
    staff: draft.staff.map((s) => ({ userId: s.userId || null, pct: decimal(s.pct) })),
    notes: orNull(draft.notes),
  };
}

export type DraftCheck = { ok: true; body: CreateFeeInput } | { ok: false; field: string };

/** Valida el formulario con el esquema compartido; si falla, el primer campo con error. */
export function checkDraft(draft: FeeDraft): DraftCheck {
  const result = CreateFeeSchema.safeParse(feeBody(draft));
  if (result.success) return { ok: true, body: result.data };
  return { ok: false, field: String(result.error.issues[0]?.path[0] ?? 'form') };
}

export interface DraftEstimate {
  /** Total (con IVA) y cuota de cada uno que paga. */
  payers: { total: string; installment: string }[];
  /** Honorario sin IVA de todos los que pagan. */
  net: string;
  /** Coorretaje y comisiones del personal, en el orden de las filas. */
  shares: string[];
  staff: string[];
}

/** Estimación en vivo del honorario; null mientras falte un número o no cierre el reparto. */
export function draftEstimate(draft: FeeDraft): DraftEstimate | null {
  const base = toDecimalString(draft.baseAmount ?? '');
  const pct = toDecimalString(draft.pct ?? '');
  const vat = draft.vatMode === FeeVatMode.NoAplica ? '0' : toDecimalString(draft.vatPct ?? '');
  const count = Number(draft.installments);
  const fixed = draft.basis === FeeBasis.MontoFijo;
  if (base === null || vat === null || (!fixed && pct === null)) return null;
  if (!Number.isInteger(count) || count < 1 || count > 60) return null;
  try {
    const gross = fixed ? base : pctOf(base, pct!).toFixed(2);
    const payerCount = Math.max(draft.payers.length, 1);
    const grosses = splitsShares(draft)
      ? splitBetweenPayers(gross, draft.payers.map((p) => toDecimalString(p.sharePct) ?? '0')).map((g) => g.toFixed(2))
      : Array.from({ length: payerCount }, () => gross);
    const amounts = grosses.map((g) => feeAmounts(g, draft.vatMode as FeeVatMode, vat));
    const net = sumMoney(amounts.map((a) => a.net));
    const dist = distributeFee({
      net,
      sharesPct: draft.shares.map((s) => toDecimalString(s.pct) ?? '0'),
      staffPct: draft.staff.map((s) => toDecimalString(s.pct) ?? '0'),
      staffBase: draft.staffCommissionBase as StaffCommissionBase,
    });
    return {
      payers: amounts.map((a) => ({ total: a.total.toFixed(2), installment: a.total.div(count).toFixed(2) })),
      net: net.toFixed(2),
      shares: dist.shares.map((s) => s.toFixed(2)),
      staff: dist.staff.map((s) => s.toFixed(2)),
    };
  } catch {
    return null;
  }
}

/* ──────────── Cobro de una cuota y pago de una comisión ──────────── */

export interface PayInstallmentFormValues {
  settlement: string;
  accountId: string;
  method: string;
  date: string;
  amount: string;
  note: string;
}

/** Cobro de una cuota: a la caja (cuenta elegida o la de la moneda) o descontado de la cuenta del locador. */
export const payInstallmentFormSchema = sharedFormSchema(
  'fees',
  PayFeeInstallmentSchema,
  (v) => {
    const toLessor = v.settlement === FeeSettlement.CuentaLocador;
    const amount = (v.amount ?? '').trim();
    return {
      settlement: v.settlement,
      accountId: toLessor ? null : orNull(v.accountId ?? ''),
      method: v.method,
      date: v.date,
      ...(amount === '' ? {} : { amount: parsePositiveAmount(amount) ?? amount }),
      note: orNull(v.note ?? ''),
    };
  },
  'amount',
);

export interface PayCommissionFormValues {
  accountId: string;
  date: string;
  note: string;
}

export const payCommissionFormSchema = sharedFormSchema(
  'fees',
  PayStaffCommissionSchema,
  (v) => ({ accountId: v.accountId, date: v.date, note: orNull(v.note ?? '') }),
  'accountId',
);
