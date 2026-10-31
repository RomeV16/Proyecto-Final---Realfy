/**
 * Reparto del cobro entre los locadores de un contrato. Los porcentajes se
 * manejan en diezmilésimas (100 % = 1 000 000) para comparar sin error de
 * punto flotante.
 */

export const FULL_SHARE_UNITS = 1_000_000;

export interface LessorShareRow {
  payoutPct: string | number;
  validFrom: Date;
  /** Fin exclusivo: el locador deja de cobrar a partir de esta fecha. */
  validTo: Date | null;
}

export interface InvalidShareDate {
  date: Date;
  /** Suma vigente ese día, en porcentaje con 4 decimales. */
  sum: string;
}

export function pctToUnits(pct: string | number): number {
  return Math.round(Number(pct) * 10_000);
}

export function unitsToPct(units: number): string {
  return (units / 10_000).toFixed(4);
}

export function isLessorActiveAt(
  row: Pick<LessorShareRow, 'validFrom' | 'validTo'>,
  date: Date,
): boolean {
  return (
    row.validFrom.getTime() <= date.getTime() &&
    (row.validTo === null || row.validTo.getTime() > date.getTime())
  );
}

/** Reparte 100 % en `count` partes iguales; la última lleva el resto. */
export function splitEqualPct(count: number): string[] {
  if (!Number.isInteger(count) || count < 1) throw new Error('count must be a positive integer');
  const each = Math.round(FULL_SHARE_UNITS / count);
  const parts = Array.from({ length: count }, () => each);
  parts[count - 1] = FULL_SHARE_UNITS - each * (count - 1);
  return parts.map(unitsToPct);
}

/**
 * Días de la ventana [from, to) en los que los locadores vigentes no suman
 * exactamente 100 %. Solo hace falta mirar el inicio y cada día en que alguien
 * entra o sale: entre dos de esos días la suma no cambia.
 */
export function findInvalidShareDates(
  rows: LessorShareRow[],
  from: Date,
  to: Date,
): InvalidShareDate[] {
  const points = new Map<number, Date>([[from.getTime(), from]]);
  for (const row of rows) {
    for (const d of [row.validFrom, row.validTo]) {
      if (d && d.getTime() > from.getTime() && d.getTime() < to.getTime()) {
        points.set(d.getTime(), d);
      }
    }
  }
  const invalid: InvalidShareDate[] = [];
  for (const date of [...points.values()].sort((a, b) => a.getTime() - b.getTime())) {
    const sum = rows
      .filter((r) => isLessorActiveAt(r, date))
      .reduce((acc, r) => acc + pctToUnits(r.payoutPct), 0);
    if (sum !== FULL_SHARE_UNITS) invalid.push({ date, sum: unitsToPct(sum) });
  }
  return invalid;
}
