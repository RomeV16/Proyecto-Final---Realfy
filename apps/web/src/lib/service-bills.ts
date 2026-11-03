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
  /** Datos que la planilla no edita y reenvía tal cual al corregir la boleta. */
  nominalAmount?: string | null;
  notes?: string | null;
  unitConsumptions?: UnitConsumption[] | null;
}

/** Consumo de una unidad en la boleta (la API lo guarda por propiedad). */
export interface UnitConsumption {
  propertyId: string;
  consumption: string;
}

/** Una unidad del edificio (o la propiedad de una regla por consumo) a la que se le carga su consumo. */
export interface SheetUnit {
  propertyId: string;
  title: string;
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
  propertyId?: string | null;
  propertyTitle?: string | null;
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
  units?: SheetUnit[];
}

/** Una parte del reparto que devuelve la vista previa (`POST /service-bills/preview`). */
export interface PreviewAllocation {
  contractId: string;
  payer: string;
  amount: string;
  chargePeriod: string;
  installmentNo: number;
  installmentsTotal: number;
  basis: string;
}

export interface PreviewResponse {
  allocations: PreviewAllocation[];
  skipped: { contractId: string; reason: string }[];
  warnings: { contractId: string; code: string }[];
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

/** Texto de consumo por unidad, por propiedad. */
export type UnitValues = Record<string, string>;

/** Los consumos que la boleta ya trae, listos para editar. */
export function initialUnitValues(bill?: ServiceBill | null): UnitValues {
  return Object.fromEntries((bill?.unitConsumptions ?? []).map((u) => [u.propertyId, String(Number(u.consumption))]));
}

const thousandths = (value: string) => Math.round(Number(value) * 1000);
const fromThousandths = (n: number) => String(n / 1000);

export interface UnitCheck {
  /** Lo que se envía: las unidades con consumo cargado. */
  entries: UnitConsumption[];
  /** Por propiedad: `invalid` (no es un número) o `missing` (falta y la boleta se reparte por consumo entre varias). */
  errors: Record<string, 'invalid' | 'missing'>;
  /** Suma de los consumos cargados. */
  sum: string;
  /** El consumo total de la boleta es menor a la suma: el reparto usa la suma. */
  totalBelowSum: boolean;
  /** Consumo total de la boleta que no está en ninguna unidad (áreas comunes): no se traslada. */
  untransferred: string | null;
}

/** Propiedades con regla por consumo: si son varias, a todas les tiene que llegar su consumo. */
export function consumptionRuleProperties(row: SheetRow): string[] {
  return row.rules
    .filter((rule) => rule.splitMode === 'Consumo' && rule.propertyId)
    .map((rule) => rule.propertyId as string);
}

/** Valida y arma el consumo por unidad de una boleta; `total` es el consumo total escrito (puede estar vacío). */
export function checkUnitConsumptions(row: SheetRow, values: UnitValues, total: string): UnitCheck {
  const errors: UnitCheck['errors'] = {};
  const entries: UnitConsumption[] = [];
  let sum = 0;
  for (const [propertyId, raw] of Object.entries(values)) {
    if (raw.trim() === '') continue;
    const parsed = parseConsumptionInput(raw);
    if (parsed === null) errors[propertyId] = 'invalid';
    else {
      entries.push({ propertyId, consumption: parsed });
      sum += thousandths(parsed);
    }
  }
  const ruled = consumptionRuleProperties(row);
  if (ruled.length > 1) {
    for (const propertyId of ruled) {
      if (!errors[propertyId] && !entries.some((e) => e.propertyId === propertyId)) errors[propertyId] = 'missing';
    }
  }
  const totalParsed = total.trim() === '' ? null : parseConsumptionInput(total);
  const totalValue = totalParsed === null ? null : thousandths(totalParsed);
  return {
    entries,
    errors,
    sum: fromThousandths(sum),
    totalBelowSum: totalValue !== null && totalValue < sum,
    untransferred: totalValue !== null && totalValue > sum ? fromThousandths(totalValue - sum) : null,
  };
}
