import {
  AdjustmentPeriod,
  ContractStatus,
  ContractType,
  ScheduleStatus,
  addMonthsClamped,
  findInvalidShareDates,
  periodToMonths,
} from '@realfy/shared';
import type { ImportContractRow } from '@realfy/shared';
import { ImportRowError } from './import-types';

const CENT = 0.01;

type HistoryRow = NonNullable<ImportContractRow['adjustmentsHistory']>[number];

/** Porcentaje del ajuste: sale del factor si lo trae, si no de los dos montos. */
export function adjustmentPercentage(h: Pick<HistoryRow, 'previousAmount' | 'newAmount' | 'factor'>): number {
  const raw = h.factor !== undefined ? (h.factor - 1) * 100 : h.previousAmount > 0 ? (h.newAmount / h.previousAmount - 1) * 100 : 0;
  return Math.round(raw * 10000) / 10000;
}

/** El historial se ordena por período, sin repetidos y encadenado: cada ajuste parte de donde terminó el anterior. */
export function checkAdjustmentHistory(row: ImportContractRow): HistoryRow[] {
  const history = [...(row.adjustmentsHistory ?? [])].sort((a, b) => a.periodNumber - b.periodNumber);
  if (history.length === 0) return history;

  const bad = (message: string, i: number) =>
    new ImportRowError('ADJUSTMENT_HISTORY_INVALID', message, `adjustmentsHistory[${i}]`);

  history.forEach((h, i) => {
    if (i > 0 && h.periodNumber === history[i - 1].periodNumber) {
      throw bad(`Period ${h.periodNumber} is repeated`, i);
    }
    if (i > 0 && Math.abs(h.previousAmount - history[i - 1].newAmount) > CENT) {
      throw bad(
        `Period ${h.periodNumber} starts from ${h.previousAmount} but the previous adjustment ended at ${history[i - 1].newAmount}`,
        i,
      );
    }
    if (Math.abs(adjustmentPercentage(h)) >= 10000) throw bad(`Period ${h.periodNumber} has an out-of-range percentage`, i);
  });

  if (row.initialRent !== undefined && Math.abs(history[0].previousAmount - row.initialRent) > CENT) {
    throw bad(`The first adjustment starts from ${history[0].previousAmount}, not from initialRent ${row.initialRent}`, 0);
  }
  const last = history[history.length - 1];
  if (Math.abs(last.newAmount - row.rentAmount) > CENT) {
    throw new ImportRowError(
      'RENT_MISMATCH',
      `The adjustment history ends at ${last.newAmount} but rentAmount is ${row.rentAmount}`,
      'rentAmount',
    );
  }
  return history;
}

/** Reglas de la fila que no necesitan la base. Devuelve el historial ordenado. */
export function assertContractRow(row: ImportContractRow): HistoryRow[] {
  const start = new Date(row.startDate);
  const end = new Date(row.endDate);
  if (end.getTime() < start.getTime()) {
    throw new ImportRowError('INVALID_DATES', 'endDate is before startDate', 'endDate');
  }
  if (row.actualEndDate && new Date(row.actualEndDate).getTime() < start.getTime()) {
    throw new ImportRowError('INVALID_DATES', 'actualEndDate is before startDate', 'actualEndDate');
  }

  const history = checkAdjustmentHistory(row);

  if (row.status === ContractStatus.Activo) {
    const invalid = findInvalidShareDates(
      (row.lessors ?? []).map((l) => ({ payoutPct: String(l.payoutPct), validFrom: start, validTo: null })),
      start,
      end,
    );
    if (invalid.length > 0) {
      throw new ImportRowError(
        'LESSOR_SHARES_INVALID',
        `Active contracts need lessors adding up to 100%; they add up to ${invalid[0].sum}%`,
        'lessors',
      );
    }
    if (row.contractType === ContractType.Alquiler && (row.tenants ?? []).length === 0) {
      throw new ImportRowError('MISSING_INQUILINO', 'An active rental needs at least one tenant', 'tenants');
    }
  }
  return history;
}

export interface ScheduleEntry {
  periodNumber: number;
  date: Date;
  status: ScheduleStatus;
}

/**
 * Calendario de ajustes del contrato: uno por período hasta el fin. Los que ya
 * figuran en el historial quedan aplicados; los vencidos sin historial, salteados
 * (no son pendientes de calcular); el resto, pendientes.
 */
export function importedSchedule(
  start: Date,
  end: Date,
  period: AdjustmentPeriod,
  appliedPeriods: Set<number>,
  today: Date,
): ScheduleEntry[] {
  const months = periodToMonths(period);
  const entries: ScheduleEntry[] = [];
  for (let k = 1; ; k++) {
    const date = addMonthsClamped(start, k * months);
    if (date > end) break;
    const status = appliedPeriods.has(k)
      ? ScheduleStatus.Applied
      : date.getTime() <= today.getTime()
        ? ScheduleStatus.Skipped
        : ScheduleStatus.Pending;
    entries.push({ periodNumber: k, date, status });
  }
  return entries;
}
