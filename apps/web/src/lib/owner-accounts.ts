import {
  Currency,
  OpeningBalanceSchema,
  OWNER_PAYOUT_METHODS,
  OwnerPayoutSchema,
  OwnerStatementStatus,
  PAYOUT_ENTRY_TYPES,
} from '@realfy/shared';
import type { FormSchema } from '@/hooks/use-zod-form';
import { toDecimalString } from './index-values';
import { parsePositiveAmount } from './cash';

/* ──────────── Lo que devuelve la API ──────────── */

/** Saldo de un locador en una moneda (`GET /owners/balances`). */
export interface OwnerBalance {
  personId: string;
  name: string;
  currency: string;
  /** Positivo: la inmobiliaria le debe; negativo: le debe a la inmobiliaria. */
  balance: string;
  custody: string;
  /** Lo que falta pagarle fuera de la custodia. */
  payoutDue: string;
  lastMovement: string | null;
  lastStatement: { id: string; period: string; closing: string; status: string } | null;
}

export interface LedgerEntry {
  id: string;
  date: string;
  period: string;
  type: string;
  amount: string;
  /** Saldo después del movimiento. */
  balance: string;
  description: string;
  contractId: string | null;
  propertyId: string | null;
  property: string | null;
  sourceType: string;
  sourceId: string;
  statement: { id: string; period: string; status: string } | null;
}

/** Cuenta corriente de un locador en una moneda (`GET /owners/:personId/ledger`). */
export interface LedgerResponse {
  person: { id: string; name: string };
  currency: string;
  currencies: string[];
  opening: string;
  closing: string;
  custody: string;
  items: LedgerEntry[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface StatementSummary {
  id: string;
  personId: string;
  person: { id: string; name: string; cuit: string | null; dni: string | null };
  period: string;
  currency: string;
  status: string;
  opening: string;
  credits: string;
  debits: string;
  payouts: string;
  closing: string;
  issuedAt: string | null;
  sentAt: string | null;
  annulledAt: string | null;
  annulReason: string | null;
  createdAt: string;
}

export interface StatementLine {
  id: string;
  date: string;
  type: string;
  amount: string;
  description: string;
  propertyId: string | null;
  contractId: string | null;
  groupLabel: string | null;
  /** Cargo que todavía no se asentó: se descuenta al emitir. */
  provisional?: boolean;
}

export interface StatementGroup {
  propertyId: string | null;
  label: string | null;
  credits: string;
  debits: string;
  payouts: string;
  net: string;
  entries: StatementLine[];
}

export interface StatementDetail extends StatementSummary {
  from: string;
  to: string;
  totals: { opening: string; initial: string; credits: string; debits: string; payouts: string; closing: string };
  custody: string;
  groups: StatementGroup[];
}

export interface GenerateResult {
  period: string;
  created: number;
  updated: number;
  skipped: { personId: string; currency: string; reason: string }[];
  chargesPosted: number;
}

/* ──────────── Constantes ──────────── */

export const STATEMENT_STATUSES = Object.values(OwnerStatementStatus);
export const PAYOUT_METHODS: readonly string[] = OWNER_PAYOUT_METHODS;
export const OWNER_CURRENCIES = Object.values(Currency);

/* ──────────── Lectura de saldos ──────────── */

export type BalanceReading = 'agencyOwes' | 'ownerOwes' | 'settled';

/** Cómo se lee un saldo desde el punto de vista del locador. */
export function balanceReading(amount: string | number | null | undefined): BalanceReading {
  const value = Number(amount ?? 0);
  if (value > 0.004) return 'agencyOwes';
  if (value < -0.004) return 'ownerOwes';
  return 'settled';
}

/** `true` si el movimiento es dinero que ya le llegó al locador (pagos y cobros directos). */
export function isPayoutEntry(type: string): boolean {
  return (PAYOUT_ENTRY_TYPES as readonly string[]).includes(type);
}

/** Valor absoluto de un importe en texto, con dos decimales. */
export function absAmount(amount: string | number): string {
  return Math.abs(Number(amount)).toFixed(2);
}

/**
 * Lo que se propone pagarle al locador: su saldo a favor menos lo que ya está
 * separado en custodia (eso se entrega desde la caja). Vacío si no se le debe nada.
 */
export function suggestedPayout(closing: string | number, custody: string | number = 0): string {
  const due = Number(closing) - Math.max(Number(custody), 0);
  return due > 0.004 ? due.toFixed(2) : '';
}

/** "YYYY-MM" del mes actual. */
export function currentPeriod(now: Date = new Date()): string {
  return now.toISOString().slice(0, 7);
}

/** "YYYY-MM" de un período que llega como fecha. */
export function periodOf(value: string): string {
  return value.slice(0, 7);
}

/** Importe con signo y hasta 2 decimales (acepta coma decimal y cero), o null. */
export function parseSignedAmount(raw: string): string | null {
  const trimmed = (raw ?? '').trim();
  const negative = trimmed.startsWith('-');
  const text = toDecimalString(negative ? trimmed.slice(1) : trimmed);
  if (text === null || !/^\d+(\.\d{1,2})?$/.test(text)) return null;
  return negative && Number(text) !== 0 ? `-${text}` : text;
}

/* ──────────── Formularios ──────────── */

/** Esquema de formulario a partir de uno compartido: cada error va a su campo con la clave `ownerAccounts.errors.<campo>`. */
function formSchema(
  shared: { safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: { issues: { path: PropertyKey[] }[] } } },
  body: (values: Record<string, string>) => Record<string, unknown>,
  fallbackField: string,
): FormSchema<Record<string, unknown>> {
  return {
    safeParse(input) {
      const result = shared.safeParse(body(input as Record<string, string>));
      if (result.success) return { success: true, data: result.data as Record<string, unknown> };
      return {
        success: false,
        error: {
          issues: (result.error?.issues ?? []).map((issue) => {
            const field = String(issue.path[0] ?? fallbackField);
            return { path: [field], message: `ownerAccounts.errors.${field}` };
          }),
        },
      };
    },
  };
}

const orNull = (value: string | undefined): string | null => (value ?? '').trim() || null;

export interface OpeningBalanceFormValues {
  currency: string;
  amount: string;
  date: string;
  reason: string;
}

export const openingBalanceFormSchema = formSchema(
  OpeningBalanceSchema,
  (v) => ({
    currency: v.currency,
    amount: parseSignedAmount(v.amount) ?? (v.amount || 'x'),
    ...((v.date ?? '').trim() ? { date: v.date } : {}),
    reason: (v.reason ?? '').trim(),
  }),
  'amount',
);

export interface PayoutFormValues {
  accountId: string;
  method: string;
  amount: string;
  date: string;
  note: string;
}

export const payoutFormSchema = formSchema(
  OwnerPayoutSchema,
  (v) => ({
    accountId: v.accountId,
    method: v.method,
    amount: parsePositiveAmount(v.amount) ?? '',
    date: v.date,
    note: orNull(v.note),
  }),
  'accountId',
);
