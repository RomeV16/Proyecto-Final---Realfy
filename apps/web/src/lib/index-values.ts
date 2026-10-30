import { IndexType } from '@realfy/shared';

/**
 * Reglas de carga de índices que comparten el formulario y el pegado masivo.
 *
 * IPC, CVS y CER se guardan como variación mensual en porcentaje (es lo que
 * encadena el motor de ajustes); ICL y UVA, como nivel diario. Por eso el
 * período de los primeros es un mes y el de los segundos, un día.
 */

export const INDEX_TYPES: IndexType[] = [
  IndexType.IPC,
  IndexType.ICL,
  IndexType.UVA,
  IndexType.CVS,
  IndexType.CER,
];

/** Identificador con el que el scraper guarda los valores públicos. */
export const SYSTEM_TENANT_ID = '__system__';

export type Granularity = 'month' | 'day';

export function granularityOf(type: IndexType): Granularity {
  return type === IndexType.ICL || type === IndexType.UVA ? 'day' : 'month';
}

/** Variación mensual en % (IPC, CVS, CER) o nivel del índice (ICL, UVA). */
export function isPercent(type: IndexType): boolean {
  return granularityOf(type) === 'month';
}

export interface IndexDataRow {
  id: string;
  tenantId: string;
  indexType: IndexType;
  period: string;
  value: string | number;
  source: string | null;
}

export interface LatestEntry {
  indexType: IndexType;
  latest: IndexDataRow;
  history: IndexDataRow[];
}

export interface IndexDataPage {
  items: IndexDataRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/** Cuerpo de POST /index-data. */
export interface IndexValueInput {
  indexType: IndexType;
  period: string;
  value: string;
  source: string;
}

export const MANUAL_SOURCE = 'manual';

const MONTH = /^(\d{4})-(\d{1,2})$/;
const MONTH_AR = /^(\d{1,2})\/(\d{4})$/;
const DAY = /^(\d{4})-(\d{1,2})-(\d{1,2})$/;
const DAY_AR = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

function validMonth(month: number): boolean {
  return month >= 1 && month <= 12;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/**
 * Período escrito por la persona → fecha ISO en UTC, como la guarda el
 * scraper: el día 1 para los mensuales, la fecha exacta para los diarios.
 * Acepta `2026-09` o `09/2026` para meses y `2026-09-15` o `15/09/2026`
 * para días. Devuelve `null` si no es una fecha válida para ese índice.
 */
export function toPeriodIso(raw: string, granularity: Granularity): string | null {
  const text = raw.trim();
  if (granularity === 'month') {
    let year: number;
    let month: number;
    let m = MONTH.exec(text);
    if (m) {
      year = Number(m[1]);
      month = Number(m[2]);
    } else if ((m = MONTH_AR.exec(text))) {
      year = Number(m[2]);
      month = Number(m[1]);
    } else {
      return null;
    }
    if (!validMonth(month)) return null;
    return `${year}-${pad(month)}-01T00:00:00.000Z`;
  }

  let year: number;
  let month: number;
  let day: number;
  let m = DAY.exec(text);
  if (m) {
    year = Number(m[1]);
    month = Number(m[2]);
    day = Number(m[3]);
  } else if ((m = DAY_AR.exec(text))) {
    year = Number(m[3]);
    month = Number(m[2]);
    day = Number(m[1]);
  } else {
    return null;
  }
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) {
    return null;
  }
  return date.toISOString();
}

/**
 * Valor escrito por la persona → decimal con punto y hasta seis decimales,
 * como lo pide la API. Acepta coma decimal (`1,9`) y un `%` al final.
 * No acepta separador de miles: `2.176,21` es ambiguo y se rechaza.
 */
export function toDecimalString(raw: string): string | null {
  const text = raw.trim().replace(/%$/, '').trim().replace(',', '.');
  if (!/^-?\d+(\.\d{1,6})?$/.test(text)) return null;
  return text;
}

export type BulkLineError = 'format' | 'period' | 'value' | 'duplicate';

export interface BulkParseResult {
  rows: IndexValueInput[];
  errors: { line: number; text: string; reason: BulkLineError }[];
}

/**
 * Período, un separador (coma, punto y coma, tabulación o espacios) y el
 * valor. El valor puede usar coma decimal aunque el separador sea coma:
 * `2026-09,1,9` se lee como septiembre de 2026 con 1,9 %.
 */
const LINE = /^\s*([^\s,;]+)\s*(?:[;\t]|,|\s)\s*(-?\d+(?:[.,]\d+)?\s*%?)\s*$/;

/** Lee el texto pegado, una línea por período. Las líneas vacías se ignoran. */
export function parseBulk(text: string, type: IndexType): BulkParseResult {
  const granularity = granularityOf(type);
  const rows: IndexValueInput[] = [];
  const errors: BulkParseResult['errors'] = [];
  const seen = new Set<string>();

  text.split(/\r?\n/).forEach((original, index) => {
    if (original.trim() === '') return;
    const line = index + 1;
    const match = LINE.exec(original);
    if (!match) {
      errors.push({ line, text: original, reason: 'format' });
      return;
    }
    const period = toPeriodIso(match[1], granularity);
    if (!period) {
      errors.push({ line, text: original, reason: 'period' });
      return;
    }
    const value = toDecimalString(match[2]);
    if (value === null) {
      errors.push({ line, text: original, reason: 'value' });
      return;
    }
    if (seen.has(period)) {
      errors.push({ line, text: original, reason: 'duplicate' });
      return;
    }
    seen.add(period);
    rows.push({ indexType: type, period, value, source: MANUAL_SOURCE });
  });

  return { rows, errors };
}

/** Fecha guardada → texto del período en el idioma de la interfaz. */
export function formatPeriod(iso: string, type: IndexType, locale: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return granularityOf(type) === 'month'
    ? date.toLocaleDateString(locale, { month: 'short', year: 'numeric', timeZone: 'UTC' })
    : date.toLocaleDateString(locale, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' });
}

/** Valor guardado → texto con los decimales que tienen sentido para el índice. */
export function formatValue(value: string | number, type: IndexType, locale: string): string {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return String(value);
  return n.toLocaleString(locale, {
    minimumFractionDigits: isPercent(type) ? 1 : 2,
    maximumFractionDigits: isPercent(type) ? 4 : 6,
  });
}

/** Fecha guardada → valor para el input del formulario (`month` o `date`). */
export function toInputPeriod(iso: string, type: IndexType): string {
  return granularityOf(type) === 'month' ? iso.slice(0, 7) : iso.slice(0, 10);
}

/** Origen visible de una fila: carga propia o fuente pública. */
export type RowOrigin = 'manual' | 'indec' | 'bcra' | 'system';

export function originOf(row: Pick<IndexDataRow, 'tenantId' | 'source'>): RowOrigin {
  if (row.tenantId !== SYSTEM_TENANT_ID) return 'manual';
  const source = row.source ?? '';
  if (source.startsWith('indec')) return 'indec';
  if (source.startsWith('bcra')) return 'bcra';
  return 'system';
}
