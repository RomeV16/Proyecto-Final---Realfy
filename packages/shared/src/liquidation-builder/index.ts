import { Money, round2, toAmountString, type MoneyInput } from '../money';
import { ContractStatus, LineBeneficiary, LineItemType, LiquidacionKind } from '../enums';
import {
  calculateLineItemsTotal,
  defaultBeneficiary,
  defaultCommissionable,
} from '../liquidacion-engine';

/**
 * Generador de liquidaciones (puro).
 *
 * Arma los renglones de la liquidación de un contrato para un mes a partir de
 * las reglas vigentes en ese mes. No lee la base: quien lo llama le da el
 * alquiler a la fecha del período (no el vigente hoy), las reglas de esa
 * fecha y los renglones que aportan otros módulos (cargos, boletas,
 * punitorios y correcciones).
 *
 * Reglas:
 * - Solo hay liquidación del mes si el contrato rige en él. Un contrato Activo
 *   sigue liquidando pasado su fin pactado mientras no se registre un fin real
 *   (D-3). Un contrato que ya no está Activo solo liquida hasta su fin real.
 * - Prorrateo por días corridos, solo en el primer mes (si empieza después del
 *   día 1) y en el último (si hay fin real antes del último día del mes):
 *   alquiler del mes x días cubiertos / días del mes, redondeado al centavo,
 *   mitad hacia arriba. El fin pactado sin fin real no prorratea.
 * - Vencimiento: el día `dueDay` del mes del período; si el contrato empieza
 *   después de ese día, vence el día de inicio.
 * - Descuentos: porcentaje y/o monto fijo mensual, prorrateados igual que el
 *   alquiler y sin superarlo.
 * - Comisión: solo los renglones `commissionable` (alquiler, ajustes,
 *   punitorios, descuentos); nunca reparaciones, impuestos ni servicios.
 * - Provisional: si el alquiler usó un ajuste provisional, la liquidación lo
 *   es y se emite como pago a cuenta.
 */

export type LiquidationSkipReason = 'NotActive' | 'BeforeStart' | 'AfterEnd';

/** Renglón que aportan otros módulos (cargos, boletas, punitorios, correcciones). */
export interface LiquidationExtraLine {
  type: LineItemType;
  description: string;
  amount: MoneyInput;
  /** Por defecto, según el tipo (`defaultCommissionable`). */
  commissionable?: boolean;
  /** Por defecto, según el tipo (`defaultBeneficiary`). */
  beneficiary?: LineBeneficiary;
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface LiquidationBuilderInput {
  /** Primer día del mes a liquidar, a medianoche UTC. */
  period: Date;
  currency: string;
  contract: {
    startDate: Date;
    endDate: Date;
    actualEndDate?: Date | null;
    status: string;
  };
  /** Alquiler mensual completo a la fecha del período. */
  rent: { monthlyAmount: MoneyInput; isProvisional?: boolean };
  terms: {
    dueDay: number;
    discountPct?: MoneyInput | null;
    discountAmount?: MoneyInput | null;
  };
  /** Nombres de los locadores, solo para el texto "por cuenta y orden". */
  lessors?: { name: string }[];
  pendingCharges?: LiquidationExtraLine[];
  serviceAllocations?: LiquidationExtraLine[];
  penalties?: LiquidationExtraLine[];
  trueUps?: LiquidationExtraLine[];
}

export interface BuiltLine {
  type: LineItemType;
  description: string;
  /** Importe positivo con dos decimales. */
  amount: string;
  commissionable: boolean;
  beneficiary: LineBeneficiary;
  sourceType: string | null;
  sourceId: string | null;
  sortOrder: number;
}

export interface BuiltLiquidation {
  skipped: null;
  kind: LiquidacionKind;
  isProvisional: boolean;
  dueDate: Date;
  lines: BuiltLine[];
  subtotal: string;
  total: string;
  /** Días cubiertos y días del mes cuando el alquiler se prorrateó; si no, null. */
  proration: { coveredDays: number; monthDays: number } | null;
  onBehalfOf: string;
}

export type BuilderResult = BuiltLiquidation | { skipped: LiquidationSkipReason };

/** "Cobrado por cuenta y orden de A, B y C." (vacío si no hay locadores). */
export function onBehalfOfText(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return '';
  const list =
    clean.length === 1
      ? clean[0]
      : `${clean.slice(0, -1).join(', ')} y ${clean[clean.length - 1]}`;
  return `Cobrado por cuenta y orden de ${list}.`;
}

function monthLabel(period: Date): string {
  return `${String(period.getUTCMonth() + 1).padStart(2, '0')}/${period.getUTCFullYear()}`;
}

function sameMonth(a: Date, period: Date): boolean {
  return a.getUTCFullYear() === period.getUTCFullYear() && a.getUTCMonth() === period.getUTCMonth();
}

export function buildLiquidation(input: LiquidationBuilderInput): BuilderResult {
  const { period, contract, terms } = input;
  const year = period.getUTCFullYear();
  const month = period.getUTCMonth();
  const monthDays = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const monthEnd = new Date(Date.UTC(year, month, monthDays));

  const isActive = contract.status === ContractStatus.Activo;
  const actualEnd = contract.actualEndDate ?? null;

  if (!isActive && !actualEnd) return { skipped: 'NotActive' };
  if (contract.status === ContractStatus.Borrador) return { skipped: 'NotActive' };
  if (contract.startDate.getTime() > monthEnd.getTime()) return { skipped: 'BeforeStart' };
  if (actualEnd && actualEnd.getTime() < period.getTime()) return { skipped: 'AfterEnd' };

  // Días cubiertos por el contrato dentro del mes.
  const firstDay = sameMonth(contract.startDate, period) ? contract.startDate.getUTCDate() : 1;
  const lastDay = actualEnd && sameMonth(actualEnd, period) ? actualEnd.getUTCDate() : monthDays;
  const coveredDays = lastDay - firstDay + 1;
  if (coveredDays <= 0) return { skipped: 'AfterEnd' };
  const prorated = coveredDays < monthDays;

  const monthly = new Money(input.rent.monthlyAmount);
  const factor = (value: MoneyInput) =>
    prorated ? round2(new Money(value).times(coveredDays).div(monthDays)) : round2(value);

  const label = monthLabel(period);
  const rentAmount = factor(monthly);
  const lines: Omit<BuiltLine, 'sortOrder'>[] = [
    {
      type: LineItemType.Alquiler,
      description: prorated
        ? `Alquiler ${label} (proporcional: ${coveredDays} de ${monthDays} días)`
        : `Alquiler ${label}`,
      amount: rentAmount.toFixed(2),
      commissionable: true,
      beneficiary: LineBeneficiary.Locador,
      sourceType: null,
      sourceId: null,
    },
  ];

  // Descuentos de las reglas: porcentaje y monto fijo, sin superar el alquiler.
  let discount = new Money(0);
  const pct = terms.discountPct != null ? new Money(terms.discountPct) : null;
  if (pct && pct.gt(0)) {
    const d = round2(rentAmount.times(pct).div(100));
    discount = discount.plus(d);
    lines.push({
      type: LineItemType.Descuento,
      description: `Bonificación ${pct.toString()} %`,
      amount: d.toFixed(2),
      commissionable: true,
      beneficiary: LineBeneficiary.Locador,
      sourceType: 'ContractTermsVersion',
      sourceId: null,
    });
  }
  const fixed = terms.discountAmount != null ? new Money(terms.discountAmount) : null;
  if (fixed && fixed.gt(0)) {
    const room = rentAmount.minus(discount);
    const d = Money.min(factor(fixed), room);
    if (d.gt(0)) {
      discount = discount.plus(d);
      lines.push({
        type: LineItemType.Descuento,
        description: 'Bonificación',
        amount: d.toFixed(2),
        commissionable: true,
        beneficiary: LineBeneficiary.Locador,
        sourceType: 'ContractTermsVersion',
        sourceId: null,
      });
    }
  }

  const extras: LiquidationExtraLine[] = [
    ...(input.trueUps ?? []),
    ...(input.penalties ?? []),
    ...(input.pendingCharges ?? []),
    ...(input.serviceAllocations ?? []),
  ];
  for (const extra of extras) {
    lines.push({
      type: extra.type,
      description: extra.description,
      amount: toAmountString(extra.amount),
      commissionable: extra.commissionable ?? defaultCommissionable(extra.type),
      beneficiary: extra.beneficiary ?? defaultBeneficiary(extra.type),
      sourceType: extra.sourceType ?? null,
      sourceId: extra.sourceId ?? null,
    });
  }

  const totals = calculateLineItemsTotal(lines.map((l) => ({ type: l.type, amount: l.amount })));

  // Vencimiento: el día `dueDay` del mes (como máximo el último día), o el día
  // de inicio si el contrato empieza después.
  const dueOfMonth = new Date(Date.UTC(year, month, Math.min(terms.dueDay, monthDays)));
  const dueDate =
    sameMonth(contract.startDate, period) && contract.startDate.getTime() > dueOfMonth.getTime()
      ? new Date(contract.startDate.getTime())
      : dueOfMonth;

  const isProvisional = input.rent.isProvisional ?? false;

  return {
    skipped: null,
    kind: isProvisional ? LiquidacionKind.PagoACuenta : LiquidacionKind.Mensual,
    isProvisional,
    dueDate,
    lines: lines.map((l, sortOrder) => ({ ...l, sortOrder })),
    subtotal: totals.subtotal.toFixed(2),
    total: totals.total.toFixed(2),
    proration: prorated ? { coveredDays, monthDays } : null,
    onBehalfOf: onBehalfOfText((input.lessors ?? []).map((l) => l.name)),
  };
}
