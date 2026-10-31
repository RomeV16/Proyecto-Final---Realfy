import Decimal from 'decimal.js';
import { Money } from '../money';

/** Un valor de índice leído de la base. `period` es 'YYYY-MM' (mensual) o 'YYYY-MM-DD' (diario). */
export interface IndexObservation {
  period: string;
  value: Decimal;
  isEstimate: boolean;
}

export interface Coverage {
  /** Valores en el orden de los meses esperados, con el oficial donde lo hay y el estimado donde no. */
  values: Decimal[];
  /** Meses cubiertos con un estimado (el ajuste es provisorio). */
  estimatedPeriods: string[];
  /** Meses sin oficial ni estimado: el ajuste no se puede calcular. */
  missingPeriods: string[];
}

/**
 * Cruza los meses que la ventana exige con lo publicado. Un mes con valor
 * oficial usa el oficial; sin oficial pero con estimado usa el estimado y lo
 * informa; sin ninguno queda faltante. Nunca se rellena con 0 %.
 */
export function assessCoverage(expected: string[], observations: IndexObservation[]): Coverage {
  const byPeriod = new Map<string, IndexObservation>();
  for (const o of observations) {
    const current = byPeriod.get(o.period);
    if (!current || (current.isEstimate && !o.isEstimate)) byPeriod.set(o.period, o);
  }
  const values: Decimal[] = [];
  const estimatedPeriods: string[] = [];
  const missingPeriods: string[] = [];
  for (const period of expected) {
    const found = byPeriod.get(period);
    if (!found) {
      missingPeriods.push(period);
      continue;
    }
    values.push(found.value);
    if (found.isEstimate) estimatedPeriods.push(period);
  }
  return { values, estimatedPeriods, missingPeriods };
}

export interface TrueUpInput {
  /** Alquiler con que se facturó desde el ajuste (el provisorio). */
  provisionalRent: Decimal;
  /** Alquiler que da el índice oficial. */
  officialRent: Decimal;
  /** Primer mes ('YYYY-MM') facturado con el alquiler provisorio. */
  fromPeriod: string;
  /** Último mes ('YYYY-MM') a corregir, inclusive (normalmente el mes en curso). */
  toPeriod: string;
}

export interface TrueUpResult {
  /** Diferencia mensual: oficial menos provisorio (negativa si el estimado se pasó). */
  monthlyDelta: Decimal;
  months: { period: string; delta: Decimal }[];
  total: Decimal;
}

/** Meses 'YYYY-MM' de `from` a `to`, ambos inclusive. Vacío si `to` es anterior. */
export function monthsInRange(from: string, to: string): string[] {
  const [fy, fm] = from.split('-').map(Number);
  const [ty, tm] = to.split('-').map(Number);
  const out: string[] = [];
  let y = fy;
  let m = fm;
  while (y < ty || (y === ty && m <= tm)) {
    out.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return out;
}

/**
 * Corrección de un ajuste provisorio: cuánto se cobró de menos o de más por
 * cada mes facturado con el alquiler provisorio, y el total retroactivo.
 */
export function calculateTrueUp(input: TrueUpInput): TrueUpResult {
  const monthlyDelta = input.officialRent.minus(input.provisionalRent).toDecimalPlaces(2);
  const months = monthsInRange(input.fromPeriod, input.toPeriod).map((period) => ({
    period,
    delta: monthlyDelta,
  }));
  const total = months.reduce((acc, m) => acc.plus(m.delta), new Money(0));
  return { monthlyDelta, months, total };
}
