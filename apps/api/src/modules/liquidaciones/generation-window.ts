/**
 * Mes que el proceso diario debe tener generado: el mes siguiente cuando hoy
 * está a `leadDays` días o menos de su primer día. Devuelve null si todavía
 * falta más (o si esa fecha cae en el mes actual).
 *
 * `today` es el día calendario de Buenos Aires a medianoche UTC.
 */
export function scheduledPeriod(
  today: Date,
  leadDays: number,
): { year: number; month: number } | null {
  const horizon = new Date(today.getTime() + leadDays * 24 * 60 * 60 * 1000);
  const sameMonth =
    horizon.getUTCFullYear() === today.getUTCFullYear() && horizon.getUTCMonth() === today.getUTCMonth();
  if (sameMonth) {
    // El día 1 el mes que empieza ya está a 0 días: sin anticipación, hoy es el día.
    return today.getUTCDate() === 1
      ? { year: today.getUTCFullYear(), month: today.getUTCMonth() + 1 }
      : null;
  }
  return { year: horizon.getUTCFullYear(), month: horizon.getUTCMonth() + 1 };
}
