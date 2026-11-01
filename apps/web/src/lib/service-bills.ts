import { toDecimalString } from './index-values';

/** Una boleta cargada, como la devuelve la API. */
export interface ServiceBill {
  id: string;
  installmentLabel: string;
  amount: string;
  dueDate: string | null;
  consumption: string | null;
  status: string;
  paidBy: string | null;
}

/** Quién paga y cómo se reparte, resumido de la regla vigente de un contrato. */
export interface ChargeRuleSummary {
  id: string;
  contractId: string;
  payer: string;
  splitMode: string;
  tenantSharePct: string;
  fixedAmount: string | null;
  paymentPlan: string;
}

export interface SheetService {
  id: string;
  serviceType: string;
  providerName: string | null;
  amount: string;
  currency: string;
  dueDay: number;
  billingFrequency: string;
  hasAnnualOption: boolean;
  property: { id: string; title: string } | null;
}

export interface SheetRow {
  service: SheetService;
  bills: ServiceBill[];
  rules: ChargeRuleSummary[];
}

export interface SheetResponse {
  period: string;
  rows: SheetRow[];
}

export interface BulkRowResult {
  index: number;
  status: 'created' | 'updated' | 'unchanged' | 'error';
  billId?: string;
  error?: { code: string; message: string };
}

export interface BulkResponse {
  total: number;
  created: number;
  updated: number;
  unchanged: number;
  failed: number;
  results: BulkRowResult[];
}

/** Mes actual de la persona, `YYYY-MM`. */
export function currentMonth(now = new Date()): string {
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}

/** "MM/YYYY" de un período `YYYY-MM`: la cuota que se propone cuando la boleta no trae otra. */
export function defaultInstallment(period: string): string {
  const [year, month] = period.split('-');
  return `${month}/${year}`;
}

/** Vencimiento propuesto: el día de vencimiento del servicio dentro del mes (como máximo, el último día). */
export function proposedDueDate(period: string, dueDay: number): string {
  const [year, month] = period.split('-').map(Number);
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return `${period}-${String(Math.min(dueDay, last)).padStart(2, '0')}`;
}

/** Importe con hasta 2 decimales y sin signo, o null. Acepta coma decimal. */
export function parseAmountInput(raw: string): string | null {
  const text = toDecimalString(raw);
  return text !== null && /^\d+(\.\d{1,2})?$/.test(text) ? text : null;
}

/** Consumo con hasta 3 decimales y sin signo, o null. Acepta coma decimal. */
export function parseConsumptionInput(raw: string): string | null {
  const text = toDecimalString(raw);
  return text !== null && /^\d+(\.\d{1,3})?$/.test(text) ? text : null;
}

/** Fecha escrita `AAAA-MM-DD` o `D/M/AAAA` (como sale de una planilla argentina) -> `AAAA-MM-DD`, o null si no existe. */
export function parseDateInput(raw: string): string | null {
  const text = raw.trim();
  let year: number;
  let month: number;
  let day: number;
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(text);
  const local = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(text);
  if (iso) [year, month, day] = [Number(iso[1]), Number(iso[2]), Number(iso[3])];
  else if (local) [day, month, year] = [Number(local[1]), Number(local[2]), Number(local[3])];
  else return null;
  const date = new Date(Date.UTC(year, month - 1, day));
  if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
