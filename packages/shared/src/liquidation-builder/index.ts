import { Money, round2, toAmountString, type MoneyInput } from '../money';
import {
  ContractStatus,
  FirstDueMode,
  FixedDiscountProration,
  LineBeneficiary,
  LineItemType,
  LiquidacionKind,
  MidMonthAdjustmentMode,
  ProrationMode,
} from '../enums';
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
 * Reglas (las cuatro convenciones marcadas son pactables por contrato, con valor
 * por defecto de la inmobiliaria; ADR-0010):
 * - Solo hay liquidación del mes si el contrato rige en él. Un contrato Activo
 *   sigue liquidando pasado su fin pactado mientras no se registre un fin real
 *   (D-3). Un contrato que ya no está Activo solo liquida hasta su fin real.
 * - Prorrateo (`prorationMode`) solo en el primer mes (si empieza después del
 *   día 1) y en el último (si hay fin real antes del último día del mes), con
 *   el alquiler del mes x días cubiertos / días base, redondeado al centavo,
 *   mitad hacia arriba (el redondeo no es pactable). DiasReales: días del mes,
 *   el día de inicio cuenta. Mes30: mes comercial de 30 días (el día 31 cuenta
 *   como 30). SinProrrateo: mes completo. El fin pactado sin fin real no prorratea.
 * - Ajuste a mitad de mes (`midMonthAdjustmentMode`): DesdePeriodoSiguiente lo
 *   ignora hasta el mes siguiente; DesdeEsePeriodo cobra el mes entero con el
 *   alquiler nuevo; Prorrateado parte el mes en dos renglones (días a alquiler
 *   viejo y días a alquiler nuevo) con el conteo de días del prorrateo
 *   (con SinProrrateo se cuentan días reales).
 * - Primer mes (`firstDueMode`): DiaDeInicio vence el día de inicio si es
 *   posterior al vencimiento; VencimientoMesSiguiente no liquida ese mes (si el
 *   contrato empieza pasado el vencimiento) y suma su alquiler prorrateado como
 *   renglón de la liquidación del mes siguiente; AlFirmar no liquida el primer
 *   mes (se cobra al firmar, fuera del sistema).
 * - Vencimiento: el día `dueDay` del mes del período.
 * - Descuentos: porcentaje sobre el alquiler del mes y/o monto fijo mensual
 *   (`fixedDiscountProration`: Proporcional se prorratea como el alquiler,
 *   Completo no), sin superar el alquiler.
 * - Comisión: solo los renglones `commissionable` (alquiler, ajustes,
 *   punitorios, descuentos); nunca reparaciones, impuestos ni servicios.
 * - Provisional: si el alquiler usó un ajuste provisional, la liquidación lo
 *   es y se emite como pago a cuenta.
 */

export type LiquidationSkipReason =
  | 'NotActive'
  | 'BeforeStart'
  | 'AfterEnd'
  /** El primer mes se cobra al firmar (convención AlFirmar). */
  | 'ChargedAtSigning'
  /** El primer mes se cobra con el período siguiente (convención VencimientoMesSiguiente). */
  | 'DeferredToNextPeriod';

/** Las cuatro convenciones de liquidación ya resueltas (defecto -> contrato -> acuerdo). */
export interface LiquidationConventionsInput {
  prorationMode: ProrationMode | `${ProrationMode}`;
  midMonthAdjustmentMode: MidMonthAdjustmentMode | `${MidMonthAdjustmentMode}`;
  firstDueMode: FirstDueMode | `${FirstDueMode}`;
  fixedDiscountProration: FixedDiscountProration | `${FixedDiscountProration}`;
}

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
  rent: {
    monthlyAmount: MoneyInput;
    isProvisional?: boolean;
    /** Cambio de alquiler dentro del mes (después del día 1); lo usa `midMonthAdjustmentMode`. */
    midMonthChange?: { effectiveDate: Date; newAmount: MoneyInput; isProvisional?: boolean } | null;
  };
  conventions: LiquidationConventionsInput;
  /**
   * Alquiler mensual del mes de inicio del contrato; solo hace falta en el mes
   * siguiente con VencimientoMesSiguiente. `alreadyBilled` evita cobrarlo dos
   * veces si ese mes ya tiene su liquidación.
   */
  firstMonth?: { monthlyAmount: MoneyInput; alreadyBilled?: boolean } | null;
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
  /** Días cubiertos y días base (del mes o 30) cuando el alquiler se prorrateó; si no, null. */
  proration: { coveredDays: number; monthDays: number } | null;
  /** Si el mes se partió por un ajuste a mitad de mes: día de vigencia y días a cada alquiler. */
  midMonthSplit: { effectiveDay: number; oldDays: number; newDays: number } | null;
  /** Si el período incluye el primer mes que se cobra con este (VencimientoMesSiguiente). */
  includesDeferredFirstMonth: boolean;
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

/**
 * Días cubiertos y días base de un tramo [firstDay, lastDay] de un mes de
 * `monthDays` días. Mes30 lleva todo a un mes comercial de 30 días: el día 31
 * cuenta como 30 y el último día del mes real es el 30.
 */
function dayCount(
  mode: ProrationMode | `${ProrationMode}`,
  firstDay: number,
  lastDay: number,
  monthDays: number,
): { covered: number; base: number } {
  if (mode === ProrationMode.SinProrrateo) return { covered: monthDays, base: monthDays };
  if (mode === ProrationMode.Mes30) {
    const f = Math.min(firstDay, 30);
    const l = lastDay === monthDays ? 30 : Math.min(lastDay, 30);
    return { covered: l - f + 1, base: 30 };
  }
  return { covered: lastDay - firstDay + 1, base: monthDays };
}

function proratedAmount(monthly: MoneyInput, covered: number, base: number): Money {
  return covered < base ? round2(new Money(monthly).times(covered).div(base)) : round2(monthly);
}

type DraftLine = Omit<BuiltLine, 'sortOrder'>;

const rentLine = (description: string, amount: Money, sourceType: string | null = null): DraftLine => ({
  type: LineItemType.Alquiler,
  description,
  amount: amount.toFixed(2),
  commissionable: true,
  beneficiary: LineBeneficiary.Locador,
  sourceType,
  sourceId: null,
});

export function buildLiquidation(input: LiquidationBuilderInput): BuilderResult {
  const { period, contract, terms, conventions } = input;
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
  const isStartMonth = sameMonth(contract.startDate, period);
  const firstDay = isStartMonth ? contract.startDate.getUTCDate() : 1;
  const lastDay = actualEnd && sameMonth(actualEnd, period) ? actualEnd.getUTCDate() : monthDays;
  if (lastDay - firstDay + 1 <= 0) return { skipped: 'AfterEnd' };

  const dueOfMonthDay = Math.min(terms.dueDay, monthDays);
  const startsAfterDue = isStartMonth && firstDay > dueOfMonthDay;
  const endsInStartMonth = actualEnd !== null && sameMonth(actualEnd, contract.startDate);

  // Primer mes: se cobra al firmar o con el período siguiente.
  if (isStartMonth && conventions.firstDueMode === FirstDueMode.AlFirmar) {
    return { skipped: 'ChargedAtSigning' };
  }
  if (
    isStartMonth &&
    conventions.firstDueMode === FirstDueMode.VencimientoMesSiguiente &&
    startsAfterDue &&
    !endsInStartMonth
  ) {
    return { skipped: 'DeferredToNextPeriod' };
  }

  const { covered, base } = dayCount(conventions.prorationMode, firstDay, lastDay, monthDays);
  const prorated = covered < base;
  const label = monthLabel(period);
  const proratedText = `proporcional: ${covered} de ${base} días`;
  const plainRentDescription = prorated ? `Alquiler ${label} (${proratedText})` : `Alquiler ${label}`;

  // Alquiler del mes (uno o dos renglones) y si usó un ajuste provisional.
  const lines: DraftLine[] = [];
  let rentTotal = new Money(0);
  let usedProvisional = input.rent.isProvisional ?? false;
  let midMonthSplit: BuiltLiquidation['midMonthSplit'] = null;

  const change = input.rent.midMonthChange ?? null;
  const changeDay =
    change && sameMonth(change.effectiveDate, period) ? change.effectiveDate.getUTCDate() : null;
  const midMode = conventions.midMonthAdjustmentMode;
  const activeChange = change && changeDay !== null && changeDay > 1 && changeDay <= lastDay ? change : null;

  if (activeChange && midMode === MidMonthAdjustmentMode.DesdeEsePeriodo) {
    const amount = proratedAmount(activeChange.newAmount, covered, base);
    lines.push(rentLine(plainRentDescription, amount));
    rentTotal = amount;
    usedProvisional = activeChange.isProvisional ?? false;
  } else if (
    activeChange &&
    midMode === MidMonthAdjustmentMode.Prorrateado &&
    (changeDay as number) > firstDay
  ) {
    // El conteo de días del prorrateo; sin prorrateo se parten por días reales.
    const splitMode =
      conventions.prorationMode === ProrationMode.SinProrrateo
        ? ProrationMode.DiasReales
        : conventions.prorationMode;
    const day = changeDay as number;
    const whole = dayCount(splitMode, firstDay, lastDay, monthDays);
    const oldDays = dayCount(splitMode, firstDay, day - 1, monthDays).covered;
    const newDays = whole.covered - oldDays;
    const oldAmount = proratedAmount(input.rent.monthlyAmount, oldDays, whole.base);
    const newAmount = proratedAmount(activeChange.newAmount, newDays, whole.base);
    lines.push(rentLine(`Alquiler ${label} (días ${firstDay} a ${day - 1})`, oldAmount));
    lines.push(rentLine(`Alquiler ${label} (días ${day} a ${lastDay}, alquiler ajustado)`, newAmount));
    rentTotal = oldAmount.plus(newAmount);
    usedProvisional = usedProvisional || (activeChange.isProvisional ?? false);
    midMonthSplit = { effectiveDay: day, oldDays, newDays };
  } else {
    // Sin cambio a mitad de mes, o con DesdePeriodoSiguiente (rige el mes que viene).
    // Con Prorrateado y el cambio en o antes del primer día cubierto, todo el tramo es a alquiler nuevo.
    const useNew = activeChange !== null && midMode === MidMonthAdjustmentMode.Prorrateado;
    const monthly = useNew && activeChange ? activeChange.newAmount : input.rent.monthlyAmount;
    if (useNew && activeChange) usedProvisional = activeChange.isProvisional ?? false;
    const amount = proratedAmount(monthly, covered, base);
    lines.push(rentLine(plainRentDescription, amount));
    rentTotal = amount;
  }

  // Primer mes que se cobra con este período (VencimientoMesSiguiente).
  const startMonthIndex = contract.startDate.getUTCFullYear() * 12 + contract.startDate.getUTCMonth();
  const startMonthDays = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const deferredFirstMonth =
    conventions.firstDueMode === FirstDueMode.VencimientoMesSiguiente &&
    year * 12 + month === startMonthIndex + 1 &&
    contract.startDate.getUTCDate() > Math.min(terms.dueDay, startMonthDays) &&
    !endsInStartMonth &&
    !!input.firstMonth &&
    !input.firstMonth.alreadyBilled;
  if (deferredFirstMonth && input.firstMonth) {
    const startDay = contract.startDate.getUTCDate();
    const first = dayCount(conventions.prorationMode, startDay, startMonthDays, startMonthDays);
    const startPeriod = new Date(Date.UTC(year, month - 1, 1));
    const amount = proratedAmount(input.firstMonth.monthlyAmount, first.covered, first.base);
    const detail = first.covered < first.base ? `proporcional: ${first.covered} de ${first.base} días; ` : '';
    lines.push(
      rentLine(`Alquiler ${monthLabel(startPeriod)} (${detail}cobrado con este período)`, amount, 'DeferredFirstMonth'),
    );
  }

  // Descuentos de las reglas: porcentaje y monto fijo, sin superar el alquiler del mes.
  let discount = new Money(0);
  const pct = terms.discountPct != null ? new Money(terms.discountPct) : null;
  if (pct && pct.gt(0)) {
    const d = round2(rentTotal.times(pct).div(100));
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
    const fixedFull = conventions.fixedDiscountProration === FixedDiscountProration.Completo;
    const wanted = fixedFull ? round2(fixed) : proratedAmount(fixed, covered, base);
    const d = Money.min(wanted, rentTotal.minus(discount));
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
  const dueOfMonth = new Date(Date.UTC(year, month, dueOfMonthDay));
  const dueDate =
    isStartMonth && contract.startDate.getTime() > dueOfMonth.getTime()
      ? new Date(contract.startDate.getTime())
      : dueOfMonth;

  return {
    skipped: null,
    kind: usedProvisional ? LiquidacionKind.PagoACuenta : LiquidacionKind.Mensual,
    isProvisional: usedProvisional,
    dueDate,
    lines: lines.map((l, sortOrder) => ({ ...l, sortOrder })),
    subtotal: totals.subtotal.toFixed(2),
    total: totals.total.toFixed(2),
    proration: prorated ? { coveredDays: covered, monthDays: base } : null,
    midMonthSplit,
    includesDeferredFirstMonth: deferredFirstMonth,
    onBehalfOf: onBehalfOfText((input.lessors ?? []).map((l) => l.name)),
  };
}
