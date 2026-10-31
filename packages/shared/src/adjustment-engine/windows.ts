import { addMonthsClamped, periodKey } from '../date-utils';
import { AdjustmentBase } from '../enums';

/**
 * Ventana de índices de un ajuste. Las series mensuales (IPC, CVS, CER) están
 * fechadas el primer día de cada mes a medianoche UTC; una fecha de la ventana
 * incluye ese mes si el instante cae dentro.
 */
export interface IndexWindow {
  from: Date;
  until: Date;
  /** La fecha `from` queda afuera (es la de un ajuste anterior, cuyo mes ya entró). */
  startExclusive: boolean;
}

/**
 * Corre la ventana `lagMonths` meses hacia atrás: el ajuste del período P usa
 * los índices de los meses que terminan en P menos el rezago. Con rezago 0 la
 * ventana no cambia.
 */
export function shiftWindowByLag(window: IndexWindow, lagMonths: number): IndexWindow {
  if (lagMonths === 0) return window;
  return {
    from: addMonthsClamped(window.from, -lagMonths),
    until: addMonthsClamped(window.until, -lagMonths),
    startExclusive: window.startExclusive,
  };
}

/** Meses ('YYYY-MM') de una serie mensual que la ventana debe cubrir, en orden. */
export function expectedMonthlyPeriods(window: IndexWindow): string[] {
  const out: string[] = [];
  let year = window.from.getUTCFullYear();
  let month = window.from.getUTCMonth();
  for (;;) {
    const instant = new Date(Date.UTC(year, month, 1));
    if (instant.getTime() > window.until.getTime()) break;
    const inside = window.startExclusive
      ? instant.getTime() > window.from.getTime()
      : instant.getTime() >= window.from.getTime();
    if (inside) out.push(periodKey(instant));
    month++;
    if (month > 11) {
      month = 0;
      year++;
    }
  }
  return out;
}

/** Meses completos entre dos fechas (a, b): descuenta el mes si b no llegó al día de a. */
export function monthsBetween(a: Date, b: Date): number {
  let months = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
  if (b.getUTCDate() < a.getUTCDate()) months--;
  return Math.max(0, months);
}

/**
 * Un ajuste que cae antes de cumplirse los `fixedInitialMonths` del tramo no se
 * aplica: el alquiler rige fijo durante ese tiempo.
 */
export function isWithinFixedInitialPeriod(
  periodStart: Date,
  adjustmentDate: Date,
  fixedInitialMonths: number,
): boolean {
  if (fixedInitialMonths <= 0) return false;
  return adjustmentDate.getTime() < addMonthsClamped(periodStart, fixedInitialMonths).getTime();
}

export interface AdjustmentBasisInput {
  base: AdjustmentBase | `${AdjustmentBase}`;
  /** Alquiler inicial del tramo vigente (el de `ContractPeriod`). */
  initialRent: string;
  /** Alquiler vigente hoy, con los ajustes anteriores incluidos. */
  currentRent: string;
  /** Inicio del tramo vigente. */
  periodStart: Date;
  /** Ventana que daría el criterio `Vigente`: desde el último ajuste aplicado. */
  vigenteWindow: IndexWindow;
}

/**
 * Base del ajuste. `Vigente` aplica el índice del período al alquiler de hoy.
 * `Original` aplica el factor acumulado desde el inicio del tramo al alquiler
 * inicial, de modo que la ventana arranca en el inicio del tramo.
 */
export function resolveAdjustmentBasis(input: AdjustmentBasisInput): {
  baseRent: string;
  window: IndexWindow;
} {
  if (input.base === AdjustmentBase.Original) {
    return {
      baseRent: input.initialRent,
      window: { from: input.periodStart, until: input.vigenteWindow.until, startExclusive: false },
    };
  }
  return { baseRent: input.currentRent, window: input.vigenteWindow };
}
