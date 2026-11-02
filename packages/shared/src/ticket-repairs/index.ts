import { ChargeTarget, Currency, TicketStatus } from '../enums';
import { Money, round2, sumMoney, toAmountString, type MoneyInput } from '../money';

/**
 * Incidencias y reparaciones (puro, sin acceso a la base).
 *
 * El caso pasa por: preautorización del locador, presupuestos, aprobación de uno,
 * ejecución, pago al proveedor desde la inmobiliaria e imputación a quien paga
 * (inquilino, locador o inmobiliaria). El honorario por gestión de la reparación es
 * opcional, se carga como un gasto puntual aparte y nunca es comisión.
 */

/** Pasos del recorrido de una incidencia, en orden (los que muestra el avance en pantalla). */
export const TICKET_STEPS = [
  TicketStatus.Abierto,
  TicketStatus.PendienteAutorizacion,
  TicketStatus.Presupuestado,
  TicketStatus.PresupuestoAprobado,
  TicketStatus.EnProgreso,
  TicketStatus.Resuelto,
  TicketStatus.Cerrado,
] as const;

export type TicketStep = (typeof TICKET_STEPS)[number];

/** El paso del recorrido al que corresponde un estado (los estados de proveedor cuentan como ejecución). */
export function ticketStep(status: TicketStatus | `${TicketStatus}`): TicketStep | null {
  switch (status) {
    case TicketStatus.Abierto:
    case TicketStatus.Asignado:
    case TicketStatus.Reabierto:
      return TicketStatus.Abierto;
    case TicketStatus.ProveedorAsignado:
    case TicketStatus.ProveedorEnCamino:
    case TicketStatus.TrabajoRealizado:
    case TicketStatus.EnProgreso:
      return TicketStatus.EnProgreso;
    case TicketStatus.Cancelado:
      return null;
    default:
      return status as TicketStep;
  }
}

/** Posición (desde 0) del estado en el recorrido; -1 si la incidencia se canceló. */
export function ticketStepIndex(status: TicketStatus | `${TicketStatus}`): number {
  const step = ticketStep(status);
  return step === null ? -1 : TICKET_STEPS.indexOf(step);
}

/** Estados en los que ya se puede pagar al proveedor (un anticipo o el saldo): hay un presupuesto aprobado o un proveedor asignado. */
export const PROVIDER_PAYMENT_STATUSES: readonly TicketStatus[] = [
  TicketStatus.PresupuestoAprobado,
  TicketStatus.ProveedorAsignado,
  TicketStatus.ProveedorEnCamino,
  TicketStatus.EnProgreso,
  TicketStatus.TrabajoRealizado,
  TicketStatus.Resuelto,
  TicketStatus.Cerrado,
];

/** Estados en los que ya se puede imputar el gasto: el trabajo terminó. */
export const IMPUTATION_STATUSES: readonly TicketStatus[] = [
  TicketStatus.TrabajoRealizado,
  TicketStatus.Resuelto,
  TicketStatus.Cerrado,
];

/** Estados en los que se pueden cargar y corregir presupuestos. */
export const QUOTING_STATUSES: readonly TicketStatus[] = [
  TicketStatus.Abierto,
  TicketStatus.Asignado,
  TicketStatus.Reabierto,
  TicketStatus.Presupuestado,
];

export interface PreauthorizationCheck {
  /** Costo estimado del arreglo. */
  amount: MoneyInput;
  currency: Currency | `${Currency}`;
  /** Límite hasta el que la inmobiliaria actúa sin consultar (el del contrato o el valor por defecto). */
  limit: MoneyInput;
  /** Moneda del límite; sin indicarla, pesos. */
  limitCurrency?: Currency | `${Currency}`;
  /** Tope ya autorizado por el locador para este caso (pisa al límite); null si no lo hay. */
  preauthorizedAmount?: MoneyInput | null;
}

/**
 * ¿Hace falta que el locador autorice antes de presupuestar? Sí si el estimado supera
 * el tope que ya autorizó para el caso o, sin tope propio, el límite de la inmobiliaria.
 * El límite tiene su moneda: un estimado en otra moneda siempre se consulta. Un estimado
 * igual al límite no requiere autorización.
 */
export function requiresPreauthorization(check: PreauthorizationCheck): boolean {
  const amount = new Money(check.amount);
  if (check.preauthorizedAmount !== null && check.preauthorizedAmount !== undefined) {
    return amount.gt(new Money(check.preauthorizedAmount));
  }
  if (check.currency !== (check.limitCurrency ?? Currency.ARS)) return amount.gt(0);
  return amount.gt(new Money(check.limit));
}

export type RepairFeeMode = 'None' | 'Percent' | 'Fixed';

export interface RepairFeeInput {
  mode: RepairFeeMode;
  /** Porcentaje sobre lo pagado al proveedor (modo Percent). */
  pct?: MoneyInput | null;
  /** Importe fijo (modo Fixed). */
  amount?: MoneyInput | null;
}

/**
 * Honorario por gestión de una reparación: un porcentaje de lo pagado al proveedor o un
 * importe fijo, a 2 decimales. Null si no se cobra (modo None, o un resultado en cero).
 * No lleva IVA ni comisión: es el importe que se carga tal cual como gasto puntual.
 */
export function repairManagementFee(base: MoneyInput, fee: RepairFeeInput): string | null {
  if (fee.mode === 'None') return null;
  const value =
    fee.mode === 'Fixed'
      ? round2(fee.amount ?? 0)
      : round2(new Money(base).times(new Money(fee.pct ?? 0)).div(100));
  return value.gt(0) ? toAmountString(value) : null;
}

/** Suma de los pagos al proveedor, como texto con 2 decimales. */
export function totalPaid(amounts: MoneyInput[]): string {
  return toAmountString(sumMoney(amounts));
}

/** El honorario por gestión lo soporta quien paga la reparación, salvo la inmobiliaria (no se lo cobra a sí misma). */
export function feeApplies(payer: ChargeTarget | `${ChargeTarget}`): boolean {
  return payer !== ChargeTarget.Inmobiliaria;
}
