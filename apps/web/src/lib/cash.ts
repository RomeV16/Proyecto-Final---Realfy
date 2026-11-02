import {
  CashCategory,
  CashDirection,
  convertAmount,
  CreateCashMovementSchema,
  CreateCompensationSchema,
  CreateConversionSchema,
  CreateFinancialAccountSchema,
  Currency,
  DeliverCustodySchema,
  FinancialAccountKind,
  MANUAL_CASH_CATEGORIES,
} from '@realfy/shared';
import { sharedFormSchema, type SharedSchema } from './form-schema';
import { toDecimalString } from './index-values';

/* ──────────── Lo que devuelve la API ──────────── */

export interface PersonRef {
  id: string;
  firstName: string;
  lastName: string;
}

/** Una cuenta de la inmobiliaria con su saldo. */
export interface FinancialAccount {
  id: string;
  kind: string;
  name: string;
  currency: string;
  ownerPersonId: string | null;
  isActive: boolean;
  owner?: PersonRef | null;
  balance: string;
}

export interface CurrencyTotals {
  currency: string;
  agency: string;
  custody: string;
  total: string;
}

export interface AccountsResponse {
  items: FinancialAccount[];
  totals: CurrencyTotals[];
  /** `true` si la inmobiliaria eligió sumar la custodia en su total. */
  custodyInAgencyBalance: boolean;
}

export interface CashMovementRow {
  id: string;
  date: string;
  direction: string;
  amount: string;
  currency: string;
  category: string;
  counterpartyId: string | null;
  contractId: string | null;
  rate: string | null;
  sourceType: string | null;
  sourceId: string | null;
  note: string | null;
  account: { id: string; name: string; kind: string; currency: string; ownerPersonId: string | null };
  counterparty: PersonRef | null;
}

export interface Paged<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface ReceiptRow {
  id: string;
  series: string;
  /** Número ya armado para mostrar (con la moneda o la cuenta si la serie lo pide). */
  number: string;
  issuedAt: string;
  amount: string;
  currency: string;
  paymentId: string | null;
  liquidacionId: string | null;
  contractId: string | null;
  period: string | null;
  property: string | null;
  tenantName: string | null;
  method: string | null;
  receivedBy: string | null;
  inCustody: boolean;
  receivedByName: string | null;
}

/** El cobro que se acaba de registrar (`registeredPayment` de `POST /liquidaciones/:id/payments`). */
export interface RegisteredPayment {
  id: string;
  receivedBy: string;
  inCustody: boolean;
  account: { id: string; name: string; kind: string; currency: string } | null;
  /** `label` es el número como se imprime (lo arma la API). */
  receipt: { id: string; series: string; number: number; label: string } | null;
}

/* ──────────── Constantes ──────────── */

export const ACCOUNT_KINDS = Object.values(FinancialAccountKind);
export const CURRENCIES = Object.values(Currency);
export const CASH_CATEGORIES = Object.values(CashCategory);
export const MANUAL_CATEGORIES: readonly string[] = MANUAL_CASH_CATEGORIES;
export const DIRECTIONS = Object.values(CashDirection);

export const today = () => new Date().toISOString().slice(0, 10);

/** "Nombre Apellido" de una persona, o vacío. */
export function personLabel(person: PersonRef | null | undefined): string {
  return person ? `${person.firstName} ${person.lastName}`.trim() : '';
}

/** Cuentas propias de la inmobiliaria (no custodia) activas, opcionalmente de una moneda. */
export function agencyAccounts(accounts: readonly FinancialAccount[], currency?: string): FinancialAccount[] {
  return accounts.filter(
    (a) => a.isActive && a.kind !== FinancialAccountKind.Custodia && (!currency || a.currency === currency),
  );
}

/** Cuentas de custodia (las de cada locador). */
export function custodyAccounts(accounts: readonly FinancialAccount[]): FinancialAccount[] {
  return accounts.filter((a) => a.kind === FinancialAccountKind.Custodia);
}

/** Importe con signo para mostrar un movimiento: la salida en negativo. */
export function signedAmount(row: Pick<CashMovementRow, 'direction' | 'amount'>): string {
  return row.direction === CashDirection.Out ? `-${row.amount}` : row.amount;
}

/** Importe positivo con hasta 2 decimales (acepta coma decimal), o null. */
export function parsePositiveAmount(raw: string): string | null {
  const text = toDecimalString(raw ?? '');
  return text !== null && /^\d+(\.\d{1,2})?$/.test(text) && Number(text) > 0 ? text : null;
}

/** Tipo de cambio positivo con hasta 6 decimales (acepta coma decimal), o null. */
export function parseRate(raw: string): string | null {
  const text = toDecimalString(raw ?? '');
  return text !== null && /^\d+(\.\d{1,6})?$/.test(text) && Number(text) > 0 ? text : null;
}

/** Importe de destino de una conversión, o null si el importe o el tipo de cambio no son válidos. */
export function convertedAmount(amount: string, rate: string): string | null {
  const a = parsePositiveAmount(amount);
  const r = parseRate(rate);
  if (a === null || r === null) return null;
  return convertAmount(a, r).toFixed(2);
}

const orNull = (value: string | undefined): string | null => (value ?? '').trim() || null;

/** Esquema de formulario a partir de uno compartido: cada error va a su campo con la clave `cash.errors.<campo>`. */
const formSchema = (
  shared: SharedSchema,
  body: (values: Record<string, string>) => Record<string, unknown>,
  fallbackField: string,
) => sharedFormSchema('cash', shared, body, fallbackField);

/* ──────────── Formularios ──────────── */

export interface AccountFormValues {
  kind: string;
  name: string;
  currency: string;
  ownerPersonId: string;
}

export const accountFormSchema = formSchema(
  CreateFinancialAccountSchema,
  (v) => ({
    kind: v.kind,
    name: (v.name ?? '').trim(),
    currency: v.currency,
    ownerPersonId: v.kind === FinancialAccountKind.Custodia ? orNull(v.ownerPersonId) : null,
  }),
  'name',
);

export interface MovementFormValues {
  accountId: string;
  date: string;
  category: string;
  direction: string;
  amount: string;
  counterpartyId: string;
  contractId: string;
  note: string;
}

export const movementFormSchema = formSchema(
  CreateCashMovementSchema,
  (v) => ({
    accountId: v.accountId,
    date: v.date,
    direction: v.direction,
    amount: parsePositiveAmount(v.amount) ?? '',
    category: v.category,
    counterpartyId: orNull(v.counterpartyId),
    contractId: orNull(v.contractId),
    note: orNull(v.note),
  }),
  'accountId',
);

export interface ConversionFormValues {
  fromAccountId: string;
  toAccountId: string;
  date: string;
  amount: string;
  rate: string;
  note: string;
}

export const conversionFormSchema = formSchema(
  CreateConversionSchema,
  (v) => ({
    fromAccountId: v.fromAccountId,
    toAccountId: v.toAccountId,
    date: v.date,
    amount: parsePositiveAmount(v.amount) ?? '',
    rate: parseRate(v.rate) ?? '',
    note: orNull(v.note),
  }),
  'fromAccountId',
);

export interface DeliverFormValues {
  amount: string;
  date: string;
  note: string;
}

export const deliverFormSchema = formSchema(
  DeliverCustodySchema,
  (v) => ({
    // Vacío entrega todo el saldo; un texto inválido se manda tal cual para que el esquema lo marque.
    ...((v.amount ?? '').trim() === '' ? {} : { amount: parsePositiveAmount(v.amount) ?? v.amount }),
    date: v.date,
    note: orNull(v.note),
  }),
  'amount',
);

export interface CompensationFormValues {
  fromLessorId: string;
  toLessorId: string;
  amount: string;
  note: string;
}

/** Compensación de un cobro que recibió otro locador; sin importe, la parte del locador compensado en ese cobro. */
export function compensationFormSchema(paymentId: string, fromCustody: boolean) {
  return formSchema(
    CreateCompensationSchema,
    (v) => ({
      paymentId,
      fromLessorId: v.fromLessorId,
      toLessorId: v.toLessorId,
      ...((v.amount ?? '').trim() === '' ? {} : { amount: parsePositiveAmount(v.amount) ?? v.amount }),
      ...(fromCustody ? { fromCustody: true } : {}),
      ...(orNull(v.note) ? { note: orNull(v.note) } : {}),
    }),
    'toLessorId',
  );
}
