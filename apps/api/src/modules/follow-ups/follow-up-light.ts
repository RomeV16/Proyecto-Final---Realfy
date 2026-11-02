import { ExpirationLight } from '@realfy/shared';
import type { ExpirationThresholds } from '@realfy/shared';

const DAY_MS = 86_400_000;

/** Rango de fines efectivos (fechas, medianoche UTC) que corresponde a un color del semáforo. */
export interface EndRange {
  gt?: Date;
  gte?: Date;
  lt?: Date;
  lte?: Date;
}

const plusDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/**
 * Fines efectivos que dan cada color hoy: vencido antes de hoy, rojo hasta
 * `redDays` después, amarillo hasta `yellowDays` y verde más allá. Es el mismo
 * criterio que `expirationLight`, pero escrito como filtro de base de datos.
 */
export function lightRange(light: ExpirationLight, today: Date, t: ExpirationThresholds): EndRange {
  switch (light) {
    case ExpirationLight.Expired:
      return { lt: today };
    case ExpirationLight.Red:
      return { gte: today, lte: plusDays(today, t.redDays) };
    case ExpirationLight.Yellow:
      return { gt: plusDays(today, t.redDays), lte: plusDays(today, t.yellowDays) };
    default:
      return { gt: plusDays(today, t.yellowDays) };
  }
}

/** Filtro de Prisma sobre el fin efectivo: el fin real si existe y si no el pactado. */
export function effectiveEndWhere(range: EndRange) {
  return { OR: [{ actualEndDate: range }, { actualEndDate: null, endDate: range }] };
}
