import { Money, allocateLargestRemainder, round2, sumMoney } from '../money';
import { splitInstallments } from '../pending-charge';
import type { MoneyInput } from '../money';
import { calculateAdjustment } from '../adjustment-engine';
import { addMonthsClamped, periodToMonths } from '../date-utils';
import { AdjustmentBase, AdjustmentType, FeeKind, FeeVatMode } from '../enums';

/**
 * Motor de honorarios (D10): total del contrato, honorario con IVA, reparto
 * entre quienes pagan, cuotas, ajuste de las cuotas con el alquiler, coorretaje
 * y comisión del personal. Puro: no lee la base ni la hora local.
 */

// ─── Convenciones (valores por defecto de la inmobiliaria) ──

/** Qué se suma como "total del contrato" para el honorario de alta o de renovación. */
export enum ContractTotalMode {
  /** Alquiler inicial por la cantidad de meses. */
  AlquilerInicial = 'AlquilerInicial',
  /**
   * Alquileres del plazo con los ajustes que se conocen al firmar (porcentaje
   * fijo, personalizado o escalonado). Los ajustes por índice (IPC, ICL, CCP,
   * UVA) no se conocen: esos tramos quedan con el alquiler vigente.
   */
  ConAjustesConocidos = 'ConAjustesConocidos',
}

/** Sobre qué se calcula la comisión del personal. */
export enum StaffCommissionBase {
  /** Lo que le queda a la inmobiliaria: honorario sin IVA menos el coorretaje. */
  Neto = 'Neto',
  /** El honorario sin IVA, antes del coorretaje. */
  Bruto = 'Bruto',
}

/** Quién paga el honorario de un alquiler. */
export enum FeePayerChoice {
  Inquilino = 'Inquilino',
  Locador = 'Locador',
  Ambos = 'Ambos',
}

/** Si la venta es de una propiedad construida o de un lote (cambia el porcentaje por defecto). */
export enum SaleAsset {
  Construido = 'Construido',
  Lote = 'Lote',
}

export class FeeEngineError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'FeeEngineError';
  }
}

// ─── Total del contrato ─────────────────────────────────

/** Regla de alquiler conocida al firmar (la de la versión vigente al inicio del tramo). */
export interface FeeRentRule {
  adjustmentType: AdjustmentType | `${AdjustmentType}`;
  adjustmentPeriod: string;
  adjustmentBase?: AdjustmentBase | `${AdjustmentBase}` | null;
  fixedInitialMonths?: number | null;
  customPct?: MoneyInput | null;
  customSteps?: { fromMonth: number; pct: MoneyInput }[] | null;
}

export interface ContractTotalInput {
  startDate: Date;
  endDate: Date;
  initialRent: MoneyInput;
  rule: FeeRentRule;
  mode: ContractTotalMode | `${ContractTotalMode}`;
}

export interface ContractTotalResult {
  months: number;
  /** Alquiler de cada mes del plazo, en orden. */
  rents: Money[];
  total: Money;
  /** Algún mes lleva un ajuste proyectado. */
  projected: boolean;
  /** La regla es por índice: sus ajustes no se proyectan. */
  indexBased: boolean;
}

const KNOWN_AT_SIGNING: ReadonlySet<string> = new Set([
  AdjustmentType.FixedPercent,
  AdjustmentType.Custom,
  AdjustmentType.Escalonado,
]);

/**
 * Meses del plazo: meses completos entre el inicio y el día siguiente al fin
 * (1/1/2026 a 31/12/2027 son 24; 1/1/2026 a 1/1/2028 también). Mínimo 1.
 */
export function contractTermMonths(startDate: Date, endDate: Date): number {
  const after = new Date(endDate.getTime() + 86_400_000);
  let months = (after.getUTCFullYear() - startDate.getUTCFullYear()) * 12 + (after.getUTCMonth() - startDate.getUTCMonth());
  if (after.getUTCDate() < startDate.getUTCDate()) months--;
  return Math.max(1, months);
}

/**
 * Alquiler de un ajuste conocido al firmar, con el motor de ajustes (2.2): la
 * base es el alquiler vigente o el inicial del tramo según `adjustmentBase`.
 */
function projectStep(rule: FeeRentRule, monthsElapsed: number, current: Money, initial: Money): Money {
  const baseRent = rule.adjustmentBase === AdjustmentBase.Original ? initial : current;
  if (rule.adjustmentType === AdjustmentType.Escalonado) {
    const steps = (rule.customSteps ?? []).map((s) => ({ fromMonth: s.fromMonth, pct: new Money(s.pct) }));
    if (steps.length === 0) return current;
    return new Money(
      calculateAdjustment({ type: AdjustmentType.Escalonado, steps, monthsElapsed, baseRent }).newRent,
    );
  }
  if (rule.customPct === null || rule.customPct === undefined) return current;
  const type = rule.adjustmentType === AdjustmentType.Custom ? AdjustmentType.Custom : AdjustmentType.FixedPercent;
  return new Money(calculateAdjustment({ type, percentage: new Money(rule.customPct), baseRent }).newRent);
}

/**
 * Total del contrato (o del período renovado) sobre el que se calcula el
 * honorario. Con `ConAjustesConocidos`, cada `adjustmentPeriod` meses (pasados
 * los `fixedInitialMonths`) el alquiler se ajusta con la regla pactada si se
 * conoce al firmar; con un índice, queda igual.
 */
export function contractTotal(input: ContractTotalInput): ContractTotalResult {
  const initial = round2(input.initialRent);
  if (initial.isNegative()) throw new FeeEngineError('INVALID_RENT', 'The rent cannot be negative');
  if (input.endDate.getTime() < input.startDate.getTime()) {
    throw new FeeEngineError('INVALID_TERM', 'The term ends before it starts');
  }
  const months = contractTermMonths(input.startDate, input.endDate);
  const indexBased = !KNOWN_AT_SIGNING.has(input.rule.adjustmentType);
  const project = input.mode === ContractTotalMode.ConAjustesConocidos && !indexBased;
  const every = project ? periodToMonths(input.rule.adjustmentPeriod) : 0;
  const fixed = input.rule.fixedInitialMonths ?? 0;

  const rents: Money[] = [];
  let current = initial;
  let projected = false;
  for (let m = 0; m < months; m++) {
    if (every > 0 && m % every === 0 && m >= fixed && m > 0) {
      const next = round2(projectStep(input.rule, m, current, initial));
      if (!next.eq(current)) projected = true;
      current = next;
    }
    rents.push(current);
  }
  return { months, rents, total: round2(sumMoney(rents)), projected, indexBased };
}

// ─── Honorario e IVA ────────────────────────────────────

export interface FeeAmounts {
  /** Honorario antes de impuestos (lo que reparten coorretaje y personal). */
  net: Money;
  vat: Money;
  /** Lo que paga quien paga. */
  total: Money;
}

/**
 * Honorario a partir de un importe bruto (base × porcentaje o monto fijo):
 * sin IVA, con el IVA incluido (se separa) o con el IVA sumado.
 */
export function feeAmounts(
  gross: MoneyInput,
  vatMode: FeeVatMode | `${FeeVatMode}`,
  vatPct: MoneyInput = 0,
): FeeAmounts {
  const g = round2(gross);
  if (g.isNegative()) throw new FeeEngineError('INVALID_AMOUNT', 'A fee cannot be negative');
  const rate = new Money(vatPct);
  if (vatMode === FeeVatMode.NoAplica || rate.isZero()) {
    return { net: g, vat: new Money(0), total: g };
  }
  if (vatMode === FeeVatMode.Incluido) {
    const net = round2(g.div(rate.div(100).plus(1)));
    return { net, vat: g.minus(net), total: g };
  }
  const vat = round2(g.times(rate).div(100));
  return { net: g, vat, total: g.plus(vat) };
}

/** Porcentaje de una base, redondeado al centavo. */
export function pctOf(base: MoneyInput, pct: MoneyInput): Money {
  return round2(new Money(base).times(pct).div(100));
}

/**
 * Reparte un honorario entre quienes lo pagan (inquilino y locador, por
 * ejemplo) según su parte, por mayor residuo: la suma da exacto.
 */
export function splitBetweenPayers(gross: MoneyInput, sharesPct: MoneyInput[]): Money[] {
  const total = sumMoney(sharesPct);
  if (!total.eq(100)) throw new FeeEngineError('PAYER_SHARES_NOT_100', 'The payer shares must add up to 100');
  if (round2(gross).isZero()) return sharesPct.map(() => new Money(0));
  return allocateLargestRemainder(gross, sharesPct);
}

// ─── Cuotas ─────────────────────────────────────────────

export interface FeeInstallmentDraft {
  n: number;
  dueDate: Date;
  amount: Money;
}

/**
 * Cuotas iguales, mensuales desde `firstDueDate`; los centavos que sobran van a
 * las primeras. Un honorario en cero no tiene cuotas.
 */
export function feeInstallments(total: MoneyInput, count: number, firstDueDate: Date): FeeInstallmentDraft[] {
  if (!Number.isInteger(count) || count < 1 || count > 60) {
    throw new FeeEngineError('INVALID_INSTALLMENTS', 'Installments must be between 1 and 60');
  }
  const t = round2(total);
  if (t.isZero()) return [];
  return splitInstallments(t, count).map((amount, i) => ({
    n: i + 1,
    dueDate: addMonthsClamped(firstDueDate, i),
    amount: new Money(amount),
  }));
}

/** Alquiler del contrato desde una fecha (un ajuste aplicado, ya calculado por el motor 2.2). */
export interface RentChange {
  date: Date;
  rent: MoneyInput;
}

/** Alquiler vigente a una fecha: el del último cambio con fecha anterior o igual, o el de referencia. */
function rentAt(changes: RentChange[], date: Date, fallback: Money): Money {
  let best: RentChange | null = null;
  for (const c of changes) {
    if (c.date.getTime() > date.getTime()) continue;
    if (!best || c.date.getTime() >= best.date.getTime()) best = c;
  }
  return best ? new Money(best.rent) : fallback;
}

/**
 * Cuotas con ajuste: una cuota que vence después de un ajuste del alquiler se
 * ajusta en la misma proporción que el alquiler (misma regla, mismo índice):
 * importe × alquiler a su vencimiento / alquiler a la fecha de referencia.
 * Devuelve el importe ajustado de cada cuota, redondeado al centavo.
 */
export function adjustInstallments(
  installments: { n: number; dueDate: Date; amount: MoneyInput }[],
  ctx: { referenceDate: Date; referenceRent: MoneyInput; changes: RentChange[] },
): { n: number; adjustedAmount: Money; factor: Money }[] {
  const reference = rentAt(ctx.changes, ctx.referenceDate, new Money(ctx.referenceRent));
  if (!reference.gt(0)) throw new FeeEngineError('INVALID_RENT', 'The reference rent must be positive');
  const later = ctx.changes.filter((c) => c.date.getTime() > ctx.referenceDate.getTime());
  return installments.map((i) => {
    const factor = rentAt(later, i.dueDate, reference).div(reference);
    return { n: i.n, adjustedAmount: round2(new Money(i.amount).times(factor)), factor };
  });
}

// ─── Coorretaje y comisión del personal ─────────────────

export interface FeeDistributionInput {
  /** Honorario sin IVA. */
  net: MoneyInput;
  /** Coorretaje: porcentaje del honorario sin IVA para cada inmobiliaria con la que se comparte. */
  sharesPct: MoneyInput[];
  /** Comisión de cada persona del personal, en porcentaje. */
  staffPct: MoneyInput[];
  staffBase: StaffCommissionBase | `${StaffCommissionBase}`;
}

export interface FeeDistribution {
  shares: Money[];
  /** Lo que le queda a la inmobiliaria después del coorretaje. */
  agencyNet: Money;
  /** Sobre qué se calcularon las comisiones. */
  staffBase: Money;
  staff: Money[];
  /** Lo que le queda a la inmobiliaria después del coorretaje y las comisiones. */
  agencyKeeps: Money;
}

/**
 * Reparte el honorario: primero el coorretaje (cada parte, porcentaje del
 * honorario sin IVA) y después la comisión de cada persona del personal, sobre
 * el neto de la inmobiliaria o sobre el honorario, según la convención.
 */
export function distributeFee(input: FeeDistributionInput): FeeDistribution {
  const net = round2(input.net);
  const sharePctTotal = sumMoney(input.sharesPct);
  if (input.sharesPct.some((p) => new Money(p).isNegative()) || sharePctTotal.gt(100)) {
    throw new FeeEngineError('INVALID_SHARES', 'Co-brokerage shares must be between 0 and 100 in total');
  }
  const shares = input.sharesPct.map((p) => pctOf(net, p));
  const agencyNet = net.minus(sumMoney(shares));
  const staffBase = input.staffBase === StaffCommissionBase.Bruto ? net : agencyNet;
  if (input.staffPct.some((p) => new Money(p).isNegative()) || sumMoney(input.staffPct).gt(100)) {
    throw new FeeEngineError('INVALID_STAFF_COMMISSION', 'Staff commissions must be between 0 and 100 in total');
  }
  const staff = input.staffPct.map((p) => pctOf(staffBase, p));
  return { shares, agencyNet, staffBase, staff, agencyKeeps: agencyNet.minus(sumMoney(staff)) };
}

// ─── Porcentaje por defecto ─────────────────────────────

export interface FeeDefaultsLike {
  fees: { alta: number; renovacion: number; ventaConstruido: number; ventaLote: number };
  valuationUsd: number;
}

/** Porcentaje por defecto de la inmobiliaria para cada operación (null: monto fijo). */
export function defaultFeePct(
  kind: FeeKind | `${FeeKind}`,
  defaults: FeeDefaultsLike,
  saleAsset: SaleAsset | `${SaleAsset}` = SaleAsset.Construido,
): number | null {
  switch (kind) {
    case FeeKind.AltaAlquiler:
      return defaults.fees.alta;
    case FeeKind.Renovacion:
      return defaults.fees.renovacion;
    case FeeKind.Venta:
      return saleAsset === SaleAsset.Lote ? defaults.fees.ventaLote : defaults.fees.ventaConstruido;
    default:
      return null;
  }
}
