import type { ParsedBillLine } from '@realfy/shared';

/**
 * Texto de un PDF listo para leerlo con expresiones regulares: guiones tipográficos
 * como guion común, espacios duros y repetidos como uno solo (los saltos de línea se
 * conservan, porque muchas etiquetas traen su valor en la línea siguiente).
 */
export function normalizeText(text: string): string {
  return text
    .replace(/[−–—]/g, '-')
    .replace(/[ \t ]+/g, ' ')
    .replace(/ ?\r?\n ?/g, '\n');
}

/**
 * Importe con formato argentino ("$ 1.234,56", "1234.56", "34,499.00", "$1.273,60.-")
 * a decimal en texto con dos decimales. El último separador es el decimal si le siguen
 * uno o dos dígitos; si le siguen tres es de miles. `null` si no es un importe.
 */
export function parseAmount(raw: string): string | null {
  const cleaned = raw.replace(/[$\s]/g, '').replace(/[.,-]+$/, '');
  if (!/^-?\d[\d.,]*$/.test(cleaned)) return null;
  const negative = cleaned.startsWith('-');
  const body = negative ? cleaned.slice(1) : cleaned;
  const lastSep = Math.max(body.lastIndexOf('.'), body.lastIndexOf(','));
  let intPart = body;
  let decPart = '';
  if (lastSep >= 0 && body.length - lastSep - 1 <= 2) {
    intPart = body.slice(0, lastSep);
    decPart = body.slice(lastSep + 1);
  }
  const digits = intPart.replace(/[.,]/g, '');
  if (digits === '' || !/^\d+$/.test(digits)) return null;
  const value = `${negative ? '-' : ''}${digits.replace(/^0+(?=\d)/, '')}.${decPart.padEnd(2, '0')}`;
  return Number.isFinite(Number(value)) ? value : null;
}

const pad = (n: number | string, width = 2) => String(n).padStart(width, '0');

function validDate(year: number, month: number, day: number): string | null {
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) return null;
  return `${year}-${pad(month)}-${pad(day)}`;
}

/** Fecha "dd/mm/aaaa", "dd/mm/aa" o "aaaa/mm/dd" a "AAAA-MM-DD"; `null` si no es una fecha de calendario. */
export function parseDate(raw: string): string | null {
  const ymd = /^(\d{4})[/-](\d{1,2})[/-](\d{1,2})$/.exec(raw.trim());
  if (ymd) return validDate(Number(ymd[1]), Number(ymd[2]), Number(ymd[3]));
  const dmy = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2}|\d{4})$/.exec(raw.trim());
  if (!dmy) return null;
  const year = dmy[3].length === 2 ? 2000 + Number(dmy[3]) : Number(dmy[3]);
  return validDate(year, Number(dmy[2]), Number(dmy[1]));
}

/** Primer día del mes ("AAAA-MM-01"); `null` si el mes no existe. */
export function periodOf(year: number, month: number): string | null {
  if (!Number.isInteger(year) || year < 2000 || year > 2100 || month < 1 || month > 12) return null;
  return `${year}-${pad(month)}-01`;
}

/** Primer día del mes de una fecha "AAAA-MM-DD". */
export function periodOfDate(date: string | null): string | null {
  return date ? `${date.slice(0, 7)}-01` : null;
}

export const DATE_RE = String.raw`\d{1,2}/\d{1,2}/\d{2,4}|\d{4}/\d{1,2}/\d{1,2}`;

/** Primer valor que sigue a una etiqueta, a lo sumo a `gap` caracteres (saltos de línea incluidos). */
export function valueAfter(text: string, label: RegExp, value: RegExp, gap = 80): string | null {
  const source = String.raw`(?:${label.source})[\s\S]{0,${gap}}?(?:${value.source})`;
  const m = new RegExp(source, label.flags.replace('g', '')).exec(text);
  return m ? (m[m.length - 1] ?? null) : null;
}

/** Cuenta de dígitos de una cadena. */
export const digitsOf = (value: string): string => value.replace(/\D/g, '');

export interface ConfidenceInput {
  account: boolean;
  amount: boolean;
  dueDate: boolean;
  period: boolean;
}

/**
 * Confianza de una lectura según lo que se encontró (cuenta 0,25; importe 0,30;
 * vencimiento 0,25; período 0,20), con un descuento por cada aviso y un tope por lector.
 */
export function scoreConfidence(found: ConfidenceInput, warnings: number, cap = 1): number {
  const base =
    (found.account ? 0.25 : 0) + (found.amount ? 0.3 : 0) + (found.dueDate ? 0.25 : 0) + (found.period ? 0.2 : 0);
  const value = Math.max(0, base - 0.1 * warnings);
  return Math.round(Math.min(value, cap) * 1000) / 1000;
}

/** Una línea de boleta con los campos que el lector no lee en nulo. */
export function bill(line: Partial<ParsedBillLine> & Pick<ParsedBillLine, 'period' | 'amount'>): ParsedBillLine {
  return {
    installmentLabel: null,
    nominalAmount: null,
    dueDate: null,
    secondDueDate: null,
    secondAmount: null,
    paymentCode: null,
    consumption: null,
    ...line,
  };
}

/** Vencimientos distintos, del más próximo al más lejano: el primero y el segundo con su importe. */
export function pickDueDates(
  entries: { date: string; amount: string | null }[],
): Pick<ParsedBillLine, 'dueDate' | 'secondDueDate' | 'secondAmount'> & { firstAmount: string | null } {
  const unique = new Map<string, { date: string; amount: string | null }>();
  for (const e of entries) if (!unique.has(e.date)) unique.set(e.date, e);
  const sorted = [...unique.values()].sort((a, b) => a.date.localeCompare(b.date));
  return {
    dueDate: sorted[0]?.date ?? null,
    firstAmount: sorted[0]?.amount ?? null,
    secondDueDate: sorted[1]?.date ?? null,
    secondAmount: sorted[1]?.amount ?? null,
  };
}
