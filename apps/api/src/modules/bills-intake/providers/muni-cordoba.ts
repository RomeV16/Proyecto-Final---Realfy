import { z } from 'zod';
import { BILL_PROVIDER_SERVICE_TYPES, BillChannel, type FetchedBillData, type ParsedBillLine } from '@realfy/shared';
import type { BillProviderDefinition } from './provider.types';
import {
  DATE_RE,
  bill,
  digitsOf,
  normalizeText,
  parseAmount,
  parseDate,
  periodOf,
  pickDueDates,
  scoreConfidence,
} from './text-utils';

/**
 * Identificador de un inmueble en la Municipalidad de Córdoba: el objeto del portal
 * tributario ("I" y 5 a 9 dígitos, como en `Part.Muni.`) o la identificación tributaria
 * de 15 dígitos (nomenclatura catastral de 10 más 5 de unidad funcional; con el dígito
 * verificador pegado son 16, y con sólo la nomenclatura se completa con ceros).
 */
export function normalizeMuniAccount(raw: string): string | null {
  const text = raw.trim().toUpperCase();
  if (/^I\d{5,9}$/.test(text)) return text;
  const digits = digitsOf(text);
  if (digits.length === 10) return `${digits}00000`;
  if (digits.length === 15) return digits;
  if (digits.length === 16) return digits.slice(0, 15);
  return null;
}

const accountSchema = z
  .string()
  .transform((value, ctx) => {
    const normalized = normalizeMuniAccount(value);
    if (!normalized) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid municipal account' });
    return normalized ?? '';
  });

/** Cada importe "Venc. 14/02/2025 $6.254,00" (o "Venc. 06/10/2026 0.00 34,499.00": descuento e importe). */
const VENC_RE = new RegExp(String.raw`Venc\.?\s*(${DATE_RE})([^\n]*)`, 'gi');

/** Cedulones viejos: "PERIODO ... 2019/007 $ 1.710,00 ...". */
const OLD_PERIOD_RE = /(?<![\d/])(20\d{2})\/(0\d{2}|1\d{2})(?![\d/])/g;

function accounts(text: string): string[] {
  const found: string[] = [];
  const add = (raw: string | undefined) => {
    const normalized = raw ? normalizeMuniAccount(raw) : null;
    if (normalized && !found.includes(normalized)) found.push(normalized);
  };
  for (const m of text.matchAll(/(?:Part\.?\s*Muni\.?|Objeto|Inmueble)\s*:?\s*(I\d{5,9})\b/gi)) add(m[1]);
  for (const m of text.matchAll(/Identificador\s*:?\s*(\d{15,16})\b/gi)) add(m[1]);
  for (const m of text.matchAll(/\b\d\.\d{2}\.\d{2}\.\d{2}\s+(\d{15})\b/g)) add(m[1]);
  for (const m of text.matchAll(/\bNC\s*:\s*(\d{12,16})\b/g)) add(m[1]);
  for (const m of text.matchAll(/Ident\.?\s*Tributaria\s*:?\s*(\d{15})\b/gi)) add(m[1]);
  for (const m of text.matchAll(/\bNomenclatura\s*:\s*(\d{12,16})\b/gi)) add(m[1]);
  return found;
}

function paymentCode(text: string): string | null {
  const m = /C[OÓ]DIGO\s+(?:DE PAGO ELECTR[OÓ]NICO|LINK|BANELCO\S*)\s*:?\s*(\d{10,22})/i.exec(text);
  return m ? m[1] : null;
}

function issueDate(text: string): string | null {
  const m = new RegExp(String.raw`(?:Fecha\s+)?Emisi[oó]n\s*:?\s*(${DATE_RE})`, 'i').exec(text);
  return m ? parseDate(m[1]) : null;
}

/** Cedulón nuevo (portal tributario): "Año Cuota" con el año y el número de cuota debajo. */
function currentFormat(text: string): ParsedBillLine[] {
  const m = /A[ñn]o\s+Cuota\s*\n?\s*(20\d{2})\s+(\d{1,2})\b/i.exec(text);
  if (!m) return [];
  const period = periodOf(Number(m[1]), Number(m[2]));
  if (!period) return [];
  const entries = [...text.matchAll(VENC_RE)]
    .map((v) => {
      const date = parseDate(v[1]);
      const amounts = [...v[2].matchAll(/-?\d[\d.,]*\d/g)].map((a) => parseAmount(a[0]));
      return { date, amount: amounts.length > 0 ? amounts[amounts.length - 1] : null };
    })
    .filter((v): v is { date: string; amount: string | null } => v.date !== null && v.amount !== null);
  const due = pickDueDates(entries);
  if (!due.firstAmount) return [];
  return [
    bill({
      period,
      amount: due.firstAmount,
      dueDate: due.dueDate,
      secondDueDate: due.secondDueDate,
      secondAmount: due.secondAmount,
      paymentCode: paymentCode(text),
    }),
  ];
}

/** Cedulón anterior: tabla de períodos, y "EMISION", "VENCIMIENTO" y "TOTAL" con su valor. */
function legacyFormat(text: string): { lines: ParsedBillLine[]; multiple: boolean } {
  const periods = [...new Set([...text.matchAll(OLD_PERIOD_RE)].map((p) => `${p[1]}/${p[2]}`))];
  const due =
    new RegExp(String.raw`VENCIMIENTO\s*:?\s*(${DATE_RE})`, 'i').exec(text) ??
    // "EMISION VENCIMIENTO TOTAL A PAGAR $ x" y debajo las dos fechas, la de emisión y la de vencimiento.
    new RegExp(String.raw`EMISI[OÓ]N\s*VENCIMIENTO\s*TOTAL A PAGAR\s*\$\s*[\d.,]+\s*(?:${DATE_RE})\s*(${DATE_RE})`, 'i').exec(text);
  const total = /\bTOTAL(?: A PAGAR)?\s*:?\s*\$\s*([\d.,]+\d)/i.exec(text);
  const amount = total ? parseAmount(total[1]) : null;
  if (periods.length === 0 || !amount) return { lines: [], multiple: false };
  const [year, cuota] = periods[0].split('/');
  const period = periodOf(Number(year), Number(cuota));
  if (!period) return { lines: [], multiple: false };
  const line = bill({ period, amount, dueDate: due ? parseDate(due[1]) : null });
  return { lines: [line], multiple: periods.length > 1 };
}

function parse(raw: string): FetchedBillData | null {
  const text = normalizeText(raw);
  const warnings: string[] = [];
  let lines = currentFormat(text);
  if (lines.length === 0) {
    const legacy = legacyFormat(text);
    lines = legacy.lines;
    if (legacy.multiple) warnings.push('MULTIPLE_PERIODS');
  }
  const accountNumbers = accounts(text);
  if (lines.length === 0 && accountNumbers.length === 0) return null;
  const first = lines[0];
  if (accountNumbers.length === 0) warnings.push('NO_ACCOUNT');
  if (lines.length === 0) warnings.push('NO_BILL_LINE');
  return {
    providerKey: 'muni-cordoba',
    accountNumbers,
    issueDate: issueDate(text),
    lines,
    // Varias cuotas en un cedulón (deuda): el total no es el de una boleta, lo mira una persona.
    confidence: scoreConfidence(
      { account: accountNumbers.length > 0, amount: !!first, dueDate: !!first?.dueDate, period: !!first },
      warnings.length,
      warnings.includes('MULTIPLE_PERIODS') ? 0.5 : 1,
    ),
    warnings,
  };
}

/** Municipalidad de Córdoba: cedulón de la Contribución que incide sobre los Inmuebles. */
export const muniCordoba: BillProviderDefinition = {
  key: 'muni-cordoba',
  name: 'Municipalidad de Córdoba',
  serviceTypes: BILL_PROVIDER_SERVICE_TYPES['muni-cordoba'],
  accountSchema,
  channels: [BillChannel.Archivo, BillChannel.Mail, BillChannel.Consulta],
  // Sólo el cedulón de la Contribución: las pantallas de datos, informes de deuda y planos de la
  // Municipalidad no son boletas y van al lector genérico (queda para revisión).
  signatures: [/Contribuci[oó]n\s+sobre\s+(?:los\s+)?Inmuebles/i],
  parse,
};
