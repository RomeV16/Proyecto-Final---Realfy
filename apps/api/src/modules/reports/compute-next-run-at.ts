/**
 * Próxima ejecución de un reporte programado, siempre a las 12:00 UTC:
 *   daily   → mañana
 *   weekly  → el próximo lunes
 *   monthly → el 1 del mes siguiente
 * Cualquier otro valor se trata como diario. `now` permite fijar el instante.
 */
export function computeNextRunAt(frequency: string, now: Date = new Date()): Date {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth();
  const day = now.getUTCDate();
  switch (frequency) {
    case 'weekly': {
      const dayOfWeek = now.getUTCDay();
      const daysUntilMon = dayOfWeek === 0 ? 1 : dayOfWeek === 1 ? 7 : 8 - dayOfWeek;
      return new Date(Date.UTC(year, month, day + daysUntilMon, 12));
    }
    case 'monthly':
      return new Date(Date.UTC(year, month + 1, 1, 12));
    case 'daily':
    default:
      return new Date(Date.UTC(year, month, day + 1, 12));
  }
}
