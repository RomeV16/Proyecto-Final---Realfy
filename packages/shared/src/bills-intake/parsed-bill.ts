import type { BillProviderKey } from './providers';

/** Una boleta leída de un documento. Importes como decimal en texto ("1234.50"), fechas "AAAA-MM-DD". */
export interface ParsedBillLine {
  /** Primer día del mes de la boleta ("AAAA-MM-01"). */
  period: string;
  /** Cuota o bimestre tal como lo imprime el proveedor ("05/2026"); por defecto, mes/año del período. */
  installmentLabel: string | null;
  amount: string;
  /** Importe sin el descuento por pago anual, si el documento lo muestra. */
  nominalAmount: string | null;
  /** Primer vencimiento. */
  dueDate: string | null;
  /** Segundo vencimiento (con recargo), si lo hay. */
  secondDueDate: string | null;
  secondAmount: string | null;
  /** Código de pago electrónico (Banelco, Link) o referencia del comprobante. */
  paymentCode: string | null;
  consumption: string | null;
}

/** Lo que un lector sacó de un documento. */
export interface FetchedBillData {
  providerKey: BillProviderKey;
  /** Identificadores de cuenta leídos, ya normalizados; el primero es el principal. */
  accountNumbers: string[];
  issueDate: string | null;
  lines: ParsedBillLine[];
  /** 0 a 1: cuánto se confía en la lectura. */
  confidence: number;
  /** Avisos de la lectura (campos que no se encontraron, valores dudosos). */
  warnings: string[];
}

/** Confianza mínima para dar de alta una boleta sin pasar por una persona. */
export const BILL_AUTO_CONFIDENCE = 0.8;

/** Códigos de motivo por los que un documento queda para revisión. */
export const BILL_REVIEW_REASONS = [
  'NO_ATTACHMENT',
  'UNREADABLE',
  'UNKNOWN_PROVIDER',
  'NO_ACCOUNT',
  'NO_MATCHING_SERVICE',
  'AMBIGUOUS_SERVICE',
  'LOW_CONFIDENCE',
  'INVALID_AMOUNT',
  'PERIOD_OUT_OF_RANGE',
  'DUE_DATE_INCONSISTENT',
  'BILL_EXISTS_DIFFERENT_AMOUNT',
] as const;
export type BillReviewReason = (typeof BILL_REVIEW_REASONS)[number];
