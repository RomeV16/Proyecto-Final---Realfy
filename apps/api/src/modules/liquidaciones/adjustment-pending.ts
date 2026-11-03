import { LiquidacionStatus, MidMonthAdjustmentMode } from '@realfy/shared';

/** Advertencia bloqueante: un ajuste que cambia el alquiler del período sigue sin aplicar (DEF-132). */
export const ADJUSTMENT_PENDING = 'ADJUSTMENT_PENDING';

export interface LiquidacionWarning {
  code: typeof ADJUSTMENT_PENDING;
  /** Fecha (`YYYY-MM-DD`) del ajuste pendiente más antiguo que afecta al período. */
  adjustmentDate: string;
  scheduleId: string;
}

/** Una liquidación todavía se puede rehacer: no se aprobó ni tiene número de recibo. */
export function isEditableStatus(status: string): boolean {
  return status === LiquidacionStatus.Borrador || status === LiquidacionStatus.Revision;
}

/** Último instante del mes del período (las fechas sin hora se guardan a medianoche UTC). */
export function lastInstantOfMonth(period: Date): Date {
  return new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() + 1, 1) - 1);
}

/**
 * Fechas de ajuste que empiezan a regir en el período (DEF-132): `after` exclusivo y
 * `until` inclusivo. Con `DesdePeriodoSiguiente` un ajuste a mitad de mes rige recién
 * el mes que viene: cuentan los del mes anterior posteriores a su día 1 y el del día 1
 * del período. Con las otras convenciones, cualquiera del mes (prorrateado o todo el
 * mes al alquiler nuevo). Un ajuste atrasado de meses anteriores no bloquea el período:
 * lo informa el proceso diario de ajustes.
 */
export function adjustmentWindow(period: Date, midMonthMode: string): { after: Date; until: Date } {
  if (midMonthMode === MidMonthAdjustmentMode.DesdePeriodoSiguiente) {
    return { after: new Date(Date.UTC(period.getUTCFullYear(), period.getUTCMonth() - 1, 1)), until: period };
  }
  return { after: new Date(period.getTime() - 1), until: lastInstantOfMonth(period) };
}

/**
 * El ajuste pendiente más antiguo del contrato que empieza a regir en la ventana, o
 * null. `schedules` va ordenado por fecha.
 */
export function pendingAdjustmentWarning(
  schedules: { id: string; contractId: string; nextAdjustmentDate: Date }[],
  contractId: string,
  window: { after: Date; until: Date },
): LiquidacionWarning | null {
  const first = schedules.find(
    (s) =>
      s.contractId === contractId &&
      s.nextAdjustmentDate.getTime() > window.after.getTime() &&
      s.nextAdjustmentDate.getTime() <= window.until.getTime(),
  );
  return first
    ? {
        code: ADJUSTMENT_PENDING,
        adjustmentDate: first.nextAdjustmentDate.toISOString().slice(0, 10),
        scheduleId: first.id,
      }
    : null;
}
