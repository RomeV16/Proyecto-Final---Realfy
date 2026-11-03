import type { BillProviderKey, FetchedBillData } from '@realfy/shared';
import {
  DATE_RE,
  bill,
  normalizeText,
  parseAmount,
  parseDate,
  periodOf,
  periodOfDate,
  scoreConfidence,
  valueAfter,
} from './text-utils';

export interface LabelledReaderOptions {
  providerKey: BillProviderKey;
  /** Etiquetas del identificador de cuenta ("Contrato", "N° de cuenta"). */
  accountLabel: RegExp;
  /** Valor que sigue a la etiqueta de cuenta. */
  accountValue: RegExp;
  normalizeAccount: (raw: string) => string | null;
  /** Tope de confianza: una lectura basada en etiquetas supuestas no da de alta sola. */
  maxConfidence: number;
}

const TOTAL_LABEL = /(?:TOTAL A PAGAR|IMPORTE A PAGAR|TOTAL FACTURA|IMPORTE TOTAL|TOTAL DE LA FACTURA|TOTAL)\s*:?/i;
const DUE_LABEL = /(?:1\s*[°ºer.]*\s*)?(?:VENCIMIENTO|VTO\.?|VENCE)\s*:?/i;

/** Período: "05/2026", "2026/05", "Período: dd/mm/aaaa al dd/mm/aaaa" (mes de la fecha final) o, sin él, el mes de la emisión. */
function periodOfText(text: string, issueDate: string | null): string | null {
  const range = new RegExp(String.raw`PER[IÍ]ODO[^\n\d]{0,40}(${DATE_RE})\s*(?:al|a|-)\s*(${DATE_RE})`, 'i').exec(text);
  if (range) return periodOfDate(parseDate(range[2]));
  const monthYear = /(?:PER[IÍ]ODO|MES|BIMESTRE)[^\n\d]{0,40}(0[1-9]|1[0-2])\/(20\d{2})\b/i.exec(text);
  if (monthYear) return periodOf(Number(monthYear[2]), Number(monthYear[1]));
  const yearMonth = /(?:PER[IÍ]ODO|MES)[^\n\d]{0,40}(20\d{2})\/(0[1-9]|1[0-2])\b/i.exec(text);
  if (yearMonth) return periodOf(Number(yearMonth[1]), Number(yearMonth[2]));
  return periodOfDate(issueDate);
}

/**
 * Lector basado en etiquetas ("Total a pagar", "Vencimiento", "Período") para los
 * documentos de los que todavía no hay una boleta real a la vista y para el lector
 * genérico. Cada campo se busca por su etiqueta; lo que no aparece baja la confianza.
 */
export function readLabelled(raw: string, options: LabelledReaderOptions): FetchedBillData | null {
  const text = normalizeText(raw);
  const warnings: string[] = [];

  const accountRaw = valueAfter(text, options.accountLabel, options.accountValue, 40);
  const account = accountRaw ? options.normalizeAccount(accountRaw) : null;
  const totalRaw = valueAfter(text, TOTAL_LABEL, /\$\s*([\d.,]*\d)/, 40);
  const amount = totalRaw ? parseAmount(totalRaw) : null;
  const dueRaw = valueAfter(text, DUE_LABEL, new RegExp(`(${DATE_RE})`), 40);
  const dueDate = dueRaw ? parseDate(dueRaw) : null;
  const issueRaw = valueAfter(text, /(?:FECHA DE )?EMISI[OÓ]N\s*:?/i, new RegExp(`(${DATE_RE})`), 30);
  const issueDate = issueRaw ? parseDate(issueRaw) : null;
  const period = periodOfText(text, issueDate);

  if (!account && !amount) return null;
  if (!account) warnings.push('NO_ACCOUNT');
  if (!amount) warnings.push('NO_AMOUNT');
  if (!period) warnings.push('NO_PERIOD');
  if (!dueDate) warnings.push('NO_DUE_DATE');

  const lines = amount && period ? [bill({ period, amount, dueDate })] : [];
  return {
    providerKey: options.providerKey,
    accountNumbers: account ? [account] : [],
    issueDate,
    lines,
    confidence: scoreConfidence(
      { account: !!account, amount: !!amount, dueDate: !!dueDate, period: !!period },
      0,
      options.maxConfidence,
    ),
    warnings,
  };
}
