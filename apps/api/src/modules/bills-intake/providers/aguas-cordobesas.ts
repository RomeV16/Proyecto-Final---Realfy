import { z } from 'zod';
import { BILL_PROVIDER_SERVICE_TYPES, BillChannel, type FetchedBillData, type ParsedBillLine } from '@realfy/shared';
import type { BillProviderDefinition } from './provider.types';
import {
  bill,
  digitsOf,
  normalizeText,
  parseAmount,
  parseDate,
  periodOf,
  pickDueDates,
  scoreConfidence,
} from './text-utils';

/** Unidad de Facturación (UF): 6 dígitos; si se tipeó sin ceros a la izquierda se completan. */
export function normalizeAguasAccount(raw: string): string | null {
  const digits = digitsOf(raw);
  return digits.length >= 1 && digits.length <= 6 ? digits.padStart(6, '0') : null;
}

const accountSchema = z.string().transform((value, ctx) => {
  const normalized = normalizeAguasAccount(value);
  if (!normalized) ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Invalid UF' });
  return normalized ?? '';
});

const UF_RE = /UNIDAD DE FACTURACI[OÓ]N\s*:?\s*(\d{6})\b/i;

/**
 * Resumen de cuenta ("Resumen de comprobantes vigentes"): una fila por comprobante
 * `FC-0000-00000000 MM/AAAA dd/mm/aaaa Descripción $histórico [$ajustado]`. El importe
 * de la boleta es el histórico; el ajustado ya lleva intereses.
 */
function statementLines(text: string): ParsedBillLine[] {
  const lines: ParsedBillLine[] = [];
  const row = /(FC-\d{4}-\d{8})\s+(\d{2})\/(\d{4})\s+(\d{2}\/\d{2}\/\d{4})\s+([^\n$]*?)\s*\$\s*([\d.,]+)/g;
  for (const m of text.matchAll(row)) {
    const period = periodOf(Number(m[3]), Number(m[2]));
    const amount = parseAmount(m[6]);
    if (period && amount) lines.push(bill({ period, amount, dueDate: parseDate(m[4]), paymentCode: m[1] }));
  }
  return lines;
}

/** Factura: total, período comercial, vencimientos y claves de pago. */
function invoiceLine(text: string): ParsedBillLine | null {
  const total = /(?:^|\n)\s*TOTAL\s+\$\s*([\d.]+,\d{2})/.exec(text);
  const periodMatch = /PER[IÍ]ODO\s*\n?\s*COMERCIAL\s+(\d{2})\/(\d{4})/i.exec(text);
  const amount = total ? parseAmount(total[1]) : null;
  const period = periodMatch ? periodOf(Number(periodMatch[2]), Number(periodMatch[1])) : null;
  if (!amount || !period) return null;
  const entries = [...text.matchAll(/(?:\d\s*°\s*)?VENCIMIENTO\s+(\d{2}\/\d{2}\/\d{2,4})\s+\$\s*([\d.]+,\d{2})/gi)].flatMap((m) => {
    const date = parseDate(m[1]);
    return date ? [{ date, amount: parseAmount(m[2]) }] : [];
  });
  const fechaVto = /Fecha Vto\.?\s*:?\s*(\d{2}\/\d{2}\/\d{4})/i.exec(text);
  if (entries.length === 0 && fechaVto) {
    const date = parseDate(fechaVto[1]);
    if (date) entries.push({ date, amount });
  }
  const due = pickDueDates(entries);
  const code = /Clave de Pago Banelco\s*(\d{4,12})/i.exec(text);
  return bill({
    period,
    amount,
    dueDate: due.dueDate,
    secondDueDate: due.secondDueDate,
    secondAmount: due.secondAmount,
    paymentCode: code ? code[1] : null,
  });
}

function parse(raw: string): FetchedBillData | null {
  const text = normalizeText(raw);
  const uf = UF_RE.exec(text) ?? /Fecha Vto\.?\s*:?\s*\d{2}\/\d{2}\/\d{4}\s*\n?\s*(\d{6})\b/i.exec(text);
  const accountNumber = uf ? normalizeAguasAccount(uf[1]) : null;
  const statement = statementLines(text);
  const invoice = statement.length === 0 ? invoiceLine(text) : null;
  const lines = statement.length > 0 ? statement : invoice ? [invoice] : [];
  if (lines.length === 0 && !accountNumber) return null;
  const warnings: string[] = [];
  if (!accountNumber) warnings.push('NO_ACCOUNT');
  if (lines.length === 0) warnings.push('NO_BILL_LINE');
  const first = lines[0];
  const issue = /Fecha de emisi[oó]n\s*:?\s*(\d{2}\/\d{2}\/\d{2,4})/i.exec(text);
  return {
    providerKey: 'aguas-cordobesas',
    accountNumbers: accountNumber ? [accountNumber] : [],
    issueDate: issue ? parseDate(issue[1]) : null,
    lines,
    confidence: scoreConfidence(
      { account: !!accountNumber, amount: !!first, dueDate: !!first?.dueDate, period: !!first },
      warnings.length,
    ),
    warnings,
  };
}

/** Aguas Cordobesas: factura de agua y resumen de cuenta (Espacio Clientes). */
export const aguasCordobesas: BillProviderDefinition = {
  key: 'aguas-cordobesas',
  name: 'Aguas Cordobesas',
  serviceTypes: BILL_PROVIDER_SERVICE_TYPES['aguas-cordobesas'],
  accountSchema,
  channels: [BillChannel.Archivo, BillChannel.Mail],
  signatures: [/Aguas\s+Cordobesas/i, /UNIDAD DE FACTURACI[OÓ]N/i, /Servicio de Agua/i],
  parse,
};
