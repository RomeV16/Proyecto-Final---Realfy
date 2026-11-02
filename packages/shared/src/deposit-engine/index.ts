import { addMonthsClamped } from '../date-utils';
import { DepositRefundRule, DepositStatus } from '../enums';
import { Money, round2, sumMoney } from '../money';
import type { MoneyInput } from '../money';
import { splitInstallments } from '../pending-charge';

const DAY_MS = 86_400_000;

const dayOf = (d: Date) => Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/** Alquiler vigente desde `date` (el primer escalón es el alquiler inicial). */
export interface RentStep {
  date: Date;
  amount: MoneyInput;
}

/** Alquiler vigente en `date`: el del último escalón que empezó hasta ese día (o el primero, si todos son posteriores). */
export function rentAt(steps: readonly RentStep[], date: Date): Money {
  if (steps.length === 0) throw new Error('Hace falta al menos un alquiler para actualizar el depósito');
  const sorted = [...steps].sort((a, b) => dayOf(a.date) - dayOf(b.date));
  let current = sorted[0];
  for (const step of sorted) {
    if (dayOf(step.date) <= dayOf(date)) current = step;
  }
  return new Money(current.amount);
}

/**
 * Factor de actualización del depósito entre dos fechas: alquiler vigente en
 * `to` sobre el vigente en `from`. Los escalones son los ajustes ya aplicados
 * del contrato (el motor de ajuste los calculó con el índice del contrato),
 * así el depósito sigue la misma regla que el alquiler.
 */
export function updatedDepositFactor(steps: readonly RentStep[], from: Date, to: Date): Money {
  const base = rentAt(steps, from);
  if (base.lte(0)) throw new Error('El alquiler de referencia debe ser positivo');
  return rentAt(steps, to).div(base);
}

export interface DepositRefundInput {
  amount: MoneyInput;
  refundRule: DepositRefundRule | `${DepositRefundRule}`;
  /** Escalones del alquiler; solo se usan con `PesosActualizado`. */
  rentSteps?: readonly RentStep[];
  /** Fecha en que se cobró el depósito (referencia del alquiler). */
  depositDate: Date;
  refundDate: Date;
}

/**
 * Importe a devolver: la misma moneda devuelve el nominal; pesos actualizado lo
 * lleva al alquiler vigente en la fecha de devolución. Nunca devuelve menos que
 * el nominal (un alquiler que bajó no achica el depósito).
 */
export function depositRefundAmount(input: DepositRefundInput): Money {
  const nominal = round2(input.amount);
  if (input.refundRule !== DepositRefundRule.PesosActualizado) return nominal;
  const factor = updatedDepositFactor(input.rentSteps ?? [], input.depositDate, input.refundDate);
  return Money.max(round2(nominal.times(factor)), nominal);
}

export interface DepositInstallmentRow {
  number: number;
  dueDate: Date;
  amount: string;
}

/** Cuotas mensuales del depósito: la primera vence en `firstDueDate`; la suma es exactamente el total. */
export function depositSchedule(total: MoneyInput, count: number, firstDueDate: Date): DepositInstallmentRow[] {
  return splitInstallments(total, count).map((amount, index) => ({
    number: index + 1,
    dueDate: addMonthsClamped(firstDueDate, index),
    amount,
  }));
}

/** Estado del depósito según lo cobrado y lo devuelto. */
export function depositStatusFor(input: {
  amount: MoneyInput;
  collected: MoneyInput;
  refundedAt?: Date | null;
}): DepositStatus {
  if (input.refundedAt) return DepositStatus.Devuelto;
  const collected = new Money(input.collected);
  if (collected.lte(0)) return DepositStatus.Pendiente;
  return collected.gte(new Money(input.amount)) ? DepositStatus.Cobrado : DepositStatus.Parcial;
}

/** Fecha límite de devolución: `days` días corridos desde el egreso. */
export function refundDueDate(moveOutDate: Date, days: number): Date {
  return new Date(dayOf(moveOutDate) + days * DAY_MS);
}

/** Cuotas de la devolución al inquilino: la primera a la fecha límite y las demás cada mes. */
export function refundSchedule(total: MoneyInput, count: number, firstDueDate: Date): DepositInstallmentRow[] {
  return depositSchedule(total, count, firstDueDate);
}

// ─── Liquidación de egreso ──────────────────────────────

/** Qué es cada renglón de la liquidación de egreso. */
export enum MoveOutItemKind {
  /** Alquiler (liquidación) que el inquilino todavía no pagó. */
  AlquilerPendiente = 'AlquilerPendiente',
  /** Parte del inquilino de una boleta de servicio que todavía no se facturó. */
  Servicio = 'Servicio',
  /** Cargo puntual pendiente a cargo del inquilino (expensa extraordinaria, otro). */
  Cargo = 'Cargo',
  Reparacion = 'Reparacion',
  /** Punitorio devengado hasta la fecha de egreso. */
  Punitorio = 'Punitorio',
  /** Descuento cargado a mano (pintura, faltantes, llaves). */
  Deduccion = 'Deduccion',
}

/**
 * Renglón de la liquidación. `amount` lleva signo: positivo es lo que el
 * inquilino debe, negativo un crédito a su favor. `included: false` lo deja
 * fuera del total (el equipo lo destildó).
 */
export interface MoveOutItem {
  kind: MoveOutItemKind | `${MoveOutItemKind}`;
  description: string;
  amount: string;
  included: boolean;
  /** Origen del renglón (liquidación, boleta, cargo) para imputarlo al confirmar. */
  sourceType?: string | null;
  sourceId?: string | null;
}

export interface MoveOutInput {
  items: readonly MoveOutItem[];
  /** Importe a devolver según la regla, en la moneda de la liquidación. */
  refundable: MoneyInput;
  /** Lo cobrado del depósito sobre lo pactado, de 0 a 1 (cuotas sin cobrar no se devuelven ni se retienen). */
  collectedShare?: MoneyInput;
}

export interface MoveOutResult {
  /** Suma de los renglones incluidos. */
  totalOwed: Money;
  /** Depósito disponible: lo que corresponde devolver de lo ya cobrado. */
  depositAvailable: Money;
  /** Retenido del depósito para cubrir lo adeudado. */
  retained: Money;
  /** Al inquilino se le devuelve. */
  refundToTenant: Money;
  /** El inquilino todavía debe, después de usar el depósito. */
  owedByTenant: Money;
  /** `depositAvailable - totalOwed`: positivo devuelve, negativo cobra. */
  net: Money;
}

/** Totales de la liquidación de egreso: lo adeudado contra el depósito disponible. */
export function computeMoveOut(input: MoveOutInput): MoveOutResult {
  const totalOwed = round2(sumMoney(input.items.filter((i) => i.included).map((i) => i.amount)));
  const share = Money.min(Money.max(new Money(input.collectedShare ?? 1), new Money(0)), new Money(1));
  const depositAvailable = round2(new Money(input.refundable).times(share));
  const net = depositAvailable.minus(totalOwed);
  const retained = Money.max(Money.min(totalOwed, depositAvailable), new Money(0));
  return {
    totalOwed,
    depositAvailable,
    retained,
    refundToTenant: Money.max(net, new Money(0)),
    owedByTenant: Money.max(net.negated(), new Money(0)),
    net,
  };
}
