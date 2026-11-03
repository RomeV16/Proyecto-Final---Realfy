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
 * Último instante en que un ajuste todavía cambia el alquiler del período. Con
 * `DesdePeriodoSiguiente` un ajuste a mitad de mes rige recién el mes que viene:
 * solo cuentan los que caen hasta el día 1. Con las otras convenciones cuenta
 * cualquiera del mes (prorrateado o todo el mes al alquiler nuevo).
 */
export function adjustmentHorizon(period: Date, midMonthMode: string): Date {
  return midMonthMode === MidMonthAdjustmentMode.DesdePeriodoSiguiente ? period : lastInstantOfMonth(period);
}

/**
 * El ajuste pendiente más antiguo del contrato que afecta al período, o null.
 * `schedules` va ordenado por fecha.
 */
export function pendingAdjustmentWarning(
  schedules: { id: string; contractId: string; nextAdjustmentDate: Date }[],
  contractId: string,
  horizon: Date,
): LiquidacionWarning | null {
  const first = schedules.find(
    (s) => s.contractId === contractId && s.nextAdjustmentDate.getTime() <= horizon.getTime(),
  );
  return first
    ? {
        code: ADJUSTMENT_PENDING,
        adjustmentDate: first.nextAdjustmentDate.toISOString().slice(0, 10),
        scheduleId: first.id,
      }
    : null;
}
