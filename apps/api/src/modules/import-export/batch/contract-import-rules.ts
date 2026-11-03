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
import { ImportRowError, dayIso } from './import-types';

const CENT = 0.01;

/** Nota de los ajustes que crea la importación. */
export const IMPORTED_NOTE = 'Imported';

type HistoryRow = NonNullable<ImportContractRow['adjustmentsHistory']>[number];

/** Porcentaje del ajuste: sale del factor si lo trae, si no de los dos montos. */
export function adjustmentPercentage(h: Pick<HistoryRow, 'previousAmount' | 'newAmount' | 'factor'>): number {
  const raw = h.factor !== undefined ? (h.factor - 1) * 100 : h.previousAmount > 0 ? (h.newAmount / h.previousAmount - 1) * 100 : 0;
  return Math.round(raw * 10000) / 10000;
}

/**
 * Período del calendario de ajustes al que corresponde una fecha: los meses
 * calendario desde el inicio del contrato, divididos por la duración del
 * período. El día del mes no cuenta (un ajuste aplicado unos días tarde sigue
 * siendo del mismo período). Devuelve null si la fecha no cae en el calendario:
 * antes del primer ajuste o entre dos períodos.
 */
export function adjustmentPeriodFor(start: Date, date: Date, period: AdjustmentPeriod): number | null {
  const step = periodToMonths(period);
  const months = (date.getUTCFullYear() - start.getUTCFullYear()) * 12 + date.getUTCMonth() - start.getUTCMonth();
  return months >= step && months % step === 0 ? months / step : null;
}

/**
 * El historial se ordena por período, sin repetidos y encadenado: cada ajuste
 * parte de donde terminó el anterior. El período de cada ajuste se deriva de su
 * fecha (el `periodNumber` del lote es informativo): una fecha que no cae en el
 * calendario del contrato, o que todavía no llegó, se rechaza.
 */
export function checkAdjustmentHistory(row: ImportContractRow, today: Date = new Date()): HistoryRow[] {
  const start = new Date(row.startDate);
  const period = row.terms.adjustmentPeriod;
  const dated = (row.adjustmentsHistory ?? []).map((h, i) => {
    const appliedAt = new Date(h.appliedAt);
    const periodNumber = adjustmentPeriodFor(start, appliedAt, period);
    if (periodNumber === null || appliedAt.getTime() > today.getTime()) {
      const why = periodNumber === null ? `does not fall on a ${period} adjustment period of the contract` : 'is in the future';
      throw new ImportRowError('ADJUSTMENT_HISTORY_INVALID', `The adjustment dated ${h.appliedAt} ${why}`, `adjustmentsHistory[${i}]`);
    }
    return { ...h, periodNumber };
  });
  const history = dated.sort((a, b) => a.periodNumber - b.periodNumber);
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
export function assertContractRow(row: ImportContractRow, today: Date = new Date()): HistoryRow[] {
  const start = new Date(row.startDate);
  const end = new Date(row.endDate);
  if (end.getTime() < start.getTime()) {
    throw new ImportRowError('INVALID_DATES', 'endDate is before startDate', 'endDate');
  }
  if (row.actualEndDate && new Date(row.actualEndDate).getTime() < start.getTime()) {
    throw new ImportRowError('INVALID_DATES', 'actualEndDate is before startDate', 'actualEndDate');
  }

  const history = checkAdjustmentHistory(row, today);

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
 * tienen ajuste quedan aplicados. Los posteriores al último ajuste quedan
 * pendientes, también los ya vencidos: son ajustes atrasados que se pueden
 * calcular y aplicar. Los vencidos anteriores al último ajuste y sin historial
 * (un hueco) y todos los vencidos de un contrato sin historial (no se sabe si el
 * alquiler cargado ya los incluye) quedan salteados.
 */
export function importedSchedule(
  start: Date,
  end: Date,
  period: AdjustmentPeriod,
  appliedPeriods: Set<number>,
  today: Date,
): ScheduleEntry[] {
  const months = periodToMonths(period);
  const lastApplied = Math.max(0, ...appliedPeriods);
  const entries: ScheduleEntry[] = [];
  for (let k = 1; ; k++) {
    const date = addMonthsClamped(start, k * months);
    if (date > end) break;
    let status: ScheduleStatus = ScheduleStatus.Pending;
    if (appliedPeriods.has(k)) status = ScheduleStatus.Applied;
    else if (k < lastApplied || (lastApplied === 0 && date.getTime() <= today.getTime())) status = ScheduleStatus.Skipped;
    entries.push({ periodNumber: k, date, status });
  }
  return entries;
}

export interface ExistingScheduleRow {
  id: string;
  periodNumber: number;
  nextAdjustmentDate: Date;
  status: ScheduleStatus;
}

export interface SchedulePlan {
  create: ScheduleEntry[];
  update: Array<{ id: string; date: Date; status: ScheduleStatus }>;
  remove: string[];
}

/**
 * Qué cambiar en el cronograma guardado para que refleje el calendario que sale
 * del lote. Un período aplicado con ajuste que lo respalda no se toca; uno
 * calculado tampoco. Los pendientes y salteados se corrigen (fecha y estado) y
 * los pendientes que el calendario ya no tiene se quitan. Un "aplicado" sin
 * ajuste detrás es un resto de una carga anterior: vuelve al estado del
 * calendario, o se quita si el calendario ya no lo tiene.
 */
export function planScheduleSync(
  existing: ExistingScheduleRow[],
  desired: ScheduleEntry[],
  appliedPeriods: Set<number>,
): SchedulePlan {
  const byPeriod = new Map(existing.map((r) => [r.periodNumber, r]));
  const wanted = new Set(desired.map((e) => e.periodNumber));
  const plan: SchedulePlan = { create: [], update: [], remove: [] };

  for (const entry of desired) {
    const row = byPeriod.get(entry.periodNumber);
    if (!row) plan.create.push(entry);
    else if (row.status === ScheduleStatus.Calculated) continue;
    else if (row.status === ScheduleStatus.Applied && entry.status === ScheduleStatus.Applied) continue;
    else if (row.status !== entry.status || dayIso(row.nextAdjustmentDate) !== dayIso(entry.date)) {
      plan.update.push({ id: row.id, date: entry.date, status: entry.status });
    }
  }
  for (const row of existing) {
    if (wanted.has(row.periodNumber)) continue;
    const stale = row.status === ScheduleStatus.Pending || (row.status === ScheduleStatus.Applied && !appliedPeriods.has(row.periodNumber));
    if (stale) plan.remove.push(row.id);
  }
  return plan;
}

export interface ExistingAdjustmentRow {
  id: string;
  periodNumber: number;
  adjustmentDate: Date;
  notes: string | null;
  isProvisional: boolean;
}

/**
 * Ajustes cargados por una importación anterior con un número de período que no
 * corresponde a su fecha: el mismo ajuste (misma fecha) figura con otro período
 * que el que ahora se deriva. Se quitan para volver a crearlos en su período.
 */
export function misplacedImportedAdjustments(existing: ExistingAdjustmentRow[], history: HistoryRow[]): string[] {
  const periodByDay = new Map(history.map((h) => [dayIso(h.appliedAt), h.periodNumber]));
  return existing
    .filter((e) => !e.isProvisional && e.notes === IMPORTED_NOTE)
    .filter((e) => {
      const period = periodByDay.get(dayIso(e.adjustmentDate));
      return period !== undefined && period !== e.periodNumber;
    })
    .map((e) => e.id);
}
