import { AdjustmentPeriod } from '../enums';

/** Zona horaria de negocio: los días calendario se cuentan en Buenos Aires. */
export const AR_TIME_ZONE = 'America/Argentina/Buenos_Aires';

/**
 * Nombres viejos de la zona de Buenos Aires que quedaron guardados en la
 * configuración de algunas inmobiliarias. Se siguen leyendo, pero se
 * normalizan al nombre canónico al escribir.
 */
const LEGACY_AR_TIME_ZONES = new Set(['America/Buenos_Aires', 'America/Argentina/Buenos_Aires']);

/** Devuelve el nombre canónico de la zona; las zonas ajenas a Buenos Aires pasan tal cual. */
export function normalizeTimeZone(timeZone: string | null | undefined): string {
  if (!timeZone || LEGACY_AR_TIME_ZONES.has(timeZone)) return AR_TIME_ZONE;
  return timeZone;
}

/**
 * Meses que dura cada período de ajuste. Lanza ante un valor desconocido en
 * lugar de elegir uno en silencio: un período mal leído desplazaría todo el
 * cronograma del contrato.
 */
export function periodToMonths(period: AdjustmentPeriod | string): number {
  switch (period) {
    case AdjustmentPeriod.Mensual:
      return 1;
    case AdjustmentPeriod.Bimestral:
      return 2;
    case AdjustmentPeriod.Trimestral:
      return 3;
    case AdjustmentPeriod.Cuatrimestral:
      return 4;
    case AdjustmentPeriod.Semestral:
      return 6;
    case AdjustmentPeriod.Anual:
      return 12;
    default:
      throw new Error(`Período de ajuste desconocido: ${String(period)}`);
  }
}

/**
 * Suma meses en UTC recortando al último día del mes destino: 31 de enero más
 * un mes es 28 (o 29) de febrero, no 3 de marzo. Acepta meses negativos.
 * Conserva la hora UTC de la fecha original.
 */
export function addMonthsClamped(date: Date, months: number): Date {
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth() + months;
  const lastDayOfTarget = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      year,
      month,
      Math.min(date.getUTCDate(), lastDayOfTarget),
      date.getUTCHours(),
      date.getUTCMinutes(),
      date.getUTCSeconds(),
      date.getUTCMilliseconds(),
    ),
  );
}

/** Primer instante del mes en UTC. `month` es 1 a 12. */
export function monthStartUTC(year: number, month: number): Date {
  return new Date(Date.UTC(year, month - 1, 1));
}

/**
 * Filtro `{ gte, lt }` de Prisma para un período en UTC. Solo año: el año
 * completo. Año y mes: ese mes. Sin año: `undefined` (sin filtro). Un mes sin
 * año se ignora.
 */
export function periodFilter(
  year?: number | null,
  month?: number | null,
): { gte: Date; lt: Date } | undefined {
  if (year == null) return undefined;
  if (month == null) {
    return { gte: monthStartUTC(year, 1), lt: monthStartUTC(year + 1, 1) };
  }
  return { gte: monthStartUTC(year, month), lt: monthStartUTC(year, month + 1) };
}

/** Clave 'YYYY-MM' del mes UTC de la fecha. */
export function periodKey(date: Date): string {
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}`;
}

/**
 * Día calendario de hoy en Buenos Aires como una fecha a medianoche UTC, que
 * es como se guardan las fechas sin hora. `now` permite fijar el instante.
 */
export function todayInAR(now: Date = new Date()): Date {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: AR_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return new Date(Date.UTC(get('year'), get('month') - 1, get('day')));
}

/**
 * Formatea una fecha sin hora (medianoche UTC) como dd/mm/aaaa. Usa
 * `timeZone: 'UTC'` para que el día no retroceda en una zona al oeste.
 */
export function formatDateAR(date: Date | string): string {
  return new Intl.DateTimeFormat('es-AR', {
    timeZone: 'UTC',
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(typeof date === 'string' ? new Date(date) : date);
}
