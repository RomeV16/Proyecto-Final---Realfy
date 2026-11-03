import { z } from 'zod';
import { BILL_PROVIDER_SERVICE_TYPES, BillChannel, type FetchedBillData } from '@realfy/shared';
import type { BillProviderDefinition } from './provider.types';
import { bill, digitsOf, normalizeText, parseAmount, parseDate, periodOf, scoreConfidence, valueAfter } from './text-utils';

/** Cuenta del inmueble en Rentas de Córdoba: 12 dígitos, a veces escritos "NNNN-NNNNNNNN". */
export function normalizeRentasAccount(raw: string): string | null {
  const digits = digitsOf(raw);
  return /^\d{12}$/.test(digits) ? digits : null;
}

const accountSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeRentasAccount(value);
  if (!normalized) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid Rentas account' });
  return normalized ?? '';
});

function accounts(text: string): string[] {
  const found: string[] = [];
  const add = (raw: string | undefined) => {
    const normalized = raw ? normalizeRentasAccount(raw) : null;
    if (normalized && !found.includes(normalized)) found.push(normalized);
  };
  // "Número de cuenta 000000000000" (cedulón nuevo), "Cuenta en Rentas ..." y "N 000000000000 Total:" (cedulón anterior).
  for (const m of text.matchAll(/N[úu]mero de cuenta\s*:?\s*(\d{4}-?\d{8})\b/gi)) add(m[1]);
  for (const m of text.matchAll(/Cuenta(?: en Rentas| n[úu]mero)?\s*:?\s*(\d{4}-?\d{8})\b/gi)) add(m[1]);
  for (const m of text.matchAll(/(?:^|\n)\s*N[°º]?\s+(\d{12})\s+Total\s*:/gi)) add(m[1]);
  return found;
}

function amountOf(text: string): string | null {
  const labelled =
    valueAfter(text, /Total de impuestos provinciales/i, /\$\s*([\d.,]+)/, 20) ??
    valueAfter(text, /TOTAL A PAGAR/i, /\$\s*([\d.,]+)/, 20) ??
    valueAfter(text, /IMPORTE A COBRAR\s*:?/i, /\$\s*([\d.,]+)/, 20);
  return labelled ? parseAmount(labelled) : null;
}

function dueDateOf(text: string): string | null {
  // Cedulón nuevo: el encabezado "Fecha de vencimiento" y, en la fila de abajo, la fecha al final.
  const header = /Fecha de vencimiento[^\n]*\n[^\n]*?(\d{2}\/\d{2}\/\d{4})\s*(?:\n|$)/i.exec(text);
  if (header) return parseDate(header[1]);
  // Cedulón anterior: "VENCIMIENTO:" y la fecha unas líneas después.
  const old = valueAfter(text, /VENCIMIENTO\s*:/i, /(\d{2}\/\d{2}\/\d{4})/, 160);
  return old ? parseDate(old) : null;
}

function parse(raw: string): FetchedBillData | null {
  const text = normalizeText(raw);
  const periods = [...new Set([...text.matchAll(/(?<![\d/])(20\d{2})\/(0[1-9]|1[0-2])(?![\d/])/g)].map((m) => `${m[1]}/${m[2]}`))];
  const amount = amountOf(text);
  const accountNumbers = accounts(text);
  if (periods.length === 0 && !amount && accountNumbers.length === 0) return null;
  const warnings: string[] = [];
  if (accountNumbers.length === 0) warnings.push('NO_ACCOUNT');
  if (periods.length > 1) warnings.push('MULTIPLE_PERIODS');
  const [year, month] = (periods[0] ?? '').split('/').map(Number);
  const period = periods.length > 0 ? periodOf(year, month) : null;
  const code = /C[oó]digo de Pago Electr[oó]nico\s*:?\s*(\d{10,22})/i.exec(text);
  const dueDate = dueDateOf(text);
  const lines = period && amount ? [bill({ period, amount, dueDate, paymentCode: code ? code[1] : null })] : [];
  if (lines.length === 0) warnings.push('NO_BILL_LINE');
  return {
    providerKey: 'rentas-cordoba',
    accountNumbers,
    issueDate: parseDate(/Fecha de emisi[oó]n\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text)?.[1] ?? ''),
    lines,
    // Varias cuotas (liquidación de deuda): el total no es el de una boleta, lo mira una persona.
    confidence: scoreConfidence(
      { account: accountNumbers.length > 0, amount: !!amount, dueDate: !!dueDate, period: !!period },
      warnings.length,
      periods.length > 1 ? 0.5 : 1,
    ),
    warnings,
  };
}

/** Rentas de Córdoba: cedulón del Impuesto Inmobiliario provincial (formulario F-1010). */
export const rentasCordoba: BillProviderDefinition = {
  key: 'rentas-cordoba',
  name: 'Rentas de Córdoba',
  serviceTypes: BILL_PROVIDER_SERVICE_TYPES['rentas-cordoba'],
  accountSchema,
  channels: [BillChannel.Archivo, BillChannel.Mail],
  signatures: [/F-1010/i, /Rentas\s*C[oó]rdoba/i, /Impuestos?\s+provinciales?/i, /INMOBILIARIO\s*\|/i, /Mis Impuestos/i],
  parse,
};
