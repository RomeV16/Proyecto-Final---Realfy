import type { InboxSettings } from './settings';

/**
 * Argentina no tiene horario de verano desde 2009: UTC-3 todo el año. Se usa el
 * corrimiento fijo para que el cálculo sea puro y determinista.
 */
const AR_OFFSET_MS = -3 * 3_600_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const MINUTE_MS = 60_000;
const MAX_DAYS_SCANNED = 15;

type BusinessHours = InboxSettings['businessHours'];

/**
 * Instante en que vence el plazo de `minutes` minutos contados desde `from`. Sin horario
 * de atención corre el reloj de pared; con horario, sólo los minutos dentro de los días y
 * las horas de atención (hora de Buenos Aires).
 */
export function computeSlaDueAt(from: Date, minutes: number, hours: BusinessHours): Date {
  const wall = new Date(from.getTime() + minutes * MINUTE_MS);
  if (!hours.enabled) return wall;

  let cursor = from.getTime();
  let remaining = minutes * MINUTE_MS;
  for (let i = 0; i < MAX_DAYS_SCANNED; i++) {
    const local = cursor + AR_OFFSET_MS;
    const dayStartLocal = Math.floor(local / DAY_MS) * DAY_MS;
    const weekday = new Date(dayStartLocal).getUTCDay();
    if (hours.days.includes(weekday)) {
      const opens = dayStartLocal + hours.fromHour * HOUR_MS - AR_OFFSET_MS;
      const closes = dayStartLocal + hours.untilHour * HOUR_MS - AR_OFFSET_MS;
      const start = Math.max(cursor, opens);
      if (start < closes) {
        const available = closes - start;
        if (remaining <= available) return new Date(start + remaining);
        remaining -= available;
      }
    }
    cursor = dayStartLocal + DAY_MS - AR_OFFSET_MS;
  }
  return wall;
}

export type SlaState = 'none' | 'ok' | 'warning' | 'breached' | 'met';

/**
 * Estado del plazo de una consulta: `met` si ya se contestó; `none` si no hay plazo
 * (cerrada o sin vencimiento); `breached` si venció; `warning` en el último tercio.
 */
export function slaState(
  c: { slaDueAt: Date | string | null; firstResponseAt: Date | string | null; status: string },
  slaMinutes: number,
  now: Date,
): SlaState {
  if (c.firstResponseAt) return 'met';
  if (!c.slaDueAt || c.status === 'Resuelta' || c.status === 'Archivada') return 'none';
  const left = new Date(c.slaDueAt).getTime() - now.getTime();
  if (left <= 0) return 'breached';
  return left <= (slaMinutes * MINUTE_MS) / 3 ? 'warning' : 'ok';
}
