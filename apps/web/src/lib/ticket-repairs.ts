import {
  ApproveTicketQuoteSchema,
  CreateTicketQuoteSchema,
  EstimateTicketSchema,
  ImputeTicketSchema,
  PreauthorizeTicketSchema,
  RegisterProviderPaymentSchema,
  TicketStatus,
  PROVIDER_PAYMENT_STATUSES,
  IMPUTATION_STATUSES,
  QUOTING_STATUSES,
} from '@realfy/shared';
import type { FormSchema } from '@/hooks/use-zod-form';
import { parseChargeAmount } from './charges';

/** Persona (proveedor, locador, aprobador) como la devuelve la API. */
export interface RepairPerson {
  id: string;
  firstName: string;
  lastName: string;
}

export interface TicketQuoteRow {
  id: string;
  providerId: string;
  amount: string;
  currency: string;
  status: string;
  approvedAt: string | null;
  channel: string | null;
  documentUrl: string | null;
  notes: string | null;
  provider?: RepairPerson | null;
  approvedBy?: RepairPerson | null;
}

/** Lo que la ficha de una incidencia necesita para mostrar y mover el circuito de reparación. */
export interface RepairTicket {
  id: string;
  status: string;
  contractId: string | null;
  providerId: string | null;
  estimatedAmount: string | null;
  costAmount: string | null;
  costCurrency: string | null;
  costPayer: string | null;
  preauthorizedAmount: string | null;
  preauthorizedAt: string | null;
  preauthorizedChannel: string | null;
  preauthorizedBy?: RepairPerson | null;
  imputedAt: string | null;
  quotes: TicketQuoteRow[];
}

export interface ProviderPayment {
  id: string;
  date: string;
  amount: string;
  currency: string;
  note: string | null;
  account?: { id: string; name: string } | null;
}

export interface ProviderPaymentsResponse {
  items: ProviderPayment[];
  total: string;
  currency: string | null;
}

export interface ImputationResult {
  total: string;
  currency: string;
  charge: { id: string; status: string; chargedTo: string };
  feeCharge: { id: string; amount: string } | null;
}

export const APPROVAL_CHANNELS = ['WhatsApp', 'Telefono', 'Mail', 'Presencial'] as const;
export const REPAIR_PAYERS = ['Inquilino', 'Locador', 'Inmobiliaria'] as const;
export const FEE_MODES = ['None', 'Percent', 'Fixed'] as const;

export const personName = (p?: RepairPerson | null): string => (p ? `${p.firstName} ${p.lastName}`.trim() : '');

export const canQuote = (status: string): boolean => (QUOTING_STATUSES as readonly string[]).includes(status);
export const canPayProvider = (ticket: Pick<RepairTicket, 'status' | 'imputedAt' | 'providerId'>): boolean =>
  !ticket.imputedAt && !!ticket.providerId && (PROVIDER_PAYMENT_STATUSES as readonly string[]).includes(ticket.status);
export const canImpute = (ticket: Pick<RepairTicket, 'status' | 'imputedAt'>): boolean =>
  !ticket.imputedAt && (IMPUTATION_STATUSES as readonly string[]).includes(ticket.status);
export const awaitsAuthorization = (status: string): boolean => status === TicketStatus.PendienteAutorizacion;
/** Se puede estimar el costo antes de que el trabajo empiece. */
export const canEstimate = (status: string): boolean =>
  canQuote(status) || awaitsAuthorization(status);

type Issue = { path: PropertyKey[]; message: string };

/** Valida el cuerpo con un esquema compartido; cada error queda en su campo con la clave `tickets.repair.errors.<campo>`. */
function schemaFor(
  build: (values: Record<string, string>) => unknown,
  schema: { safeParse(input: unknown): { success: boolean; data?: unknown; error?: { issues: { path: PropertyKey[] }[] } } },
  fallbackField: string,
): FormSchema<Record<string, unknown>> {
  return {
    safeParse(input) {
      const result = schema.safeParse(build(input as Record<string, string>));
      if (result.success) return { success: true, data: result.data as Record<string, unknown> };
      const issues: Issue[] = (result.error?.issues ?? []).map((issue) => {
        const field = String(issue.path[0] ?? fallbackField);
        return { path: [field], message: `tickets.repair.errors.${field}` };
      });
      return { success: false, error: { issues } };
    },
  };
}

/** Texto sin espacios sobrantes o `undefined` si quedó vacío (no viaja en el cuerpo). */
const orNull = (value: string | undefined): string | undefined => ((value ?? '').trim() === '' ? undefined : (value ?? '').trim());
/** Importe positivo con hasta dos decimales o '' (que el esquema rechaza). */
const money = (raw: string | undefined): string => {
  const parsed = parseChargeAmount(raw ?? '');
  return parsed !== null && Number(parsed) > 0 ? parsed : '';
};

export const estimateFormSchema = schemaFor(
  (v) => ({ amount: money(v.amount), currency: v.currency || undefined }),
  EstimateTicketSchema,
  'amount',
);

export const preauthorizeFormSchema = schemaFor(
  (v) => ({ amount: money(v.amount), approvedByPersonId: v.approvedByPersonId, channel: v.channel, note: orNull(v.note) }),
  PreauthorizeTicketSchema,
  'amount',
);

export const quoteFormSchema = schemaFor(
  (v) => ({ providerId: v.providerId, amount: money(v.amount), currency: v.currency || undefined, notes: orNull(v.notes) }),
  CreateTicketQuoteSchema,
  'amount',
);

export const approveFormSchema = schemaFor(
  (v) => ({ approvedByPersonId: v.approvedByPersonId, channel: v.channel, note: orNull(v.note) }),
  ApproveTicketQuoteSchema,
  'approvedByPersonId',
);

export const paymentFormSchema = schemaFor(
  (v) => ({ accountId: v.accountId, amount: money(v.amount), date: orNull(v.date), note: orNull(v.note) }),
  RegisterProviderPaymentSchema,
  'amount',
);

/** El porcentaje se escribe con coma o punto; vacío usa el que la inmobiliaria tiene por defecto. */
const pct = (raw: string | undefined): number | undefined => {
  const text = (raw ?? '').trim().replace(',', '.');
  return text === '' ? undefined : Number(text);
};

const imputeBase = schemaFor(
  (v) => ({
    chargedTo: v.chargedTo || undefined,
    managementFee:
      v.chargedTo === 'Inmobiliaria' || v.feeMode === 'None'
        ? undefined
        : {
            mode: v.feeMode,
            pct: v.feeMode === 'Percent' ? pct(v.feePct) : undefined,
            amount: v.feeMode === 'Fixed' ? money(v.feeAmount) : undefined,
          },
  }),
  ImputeTicketSchema,
  'chargedTo',
);

/** Imputación: quien paga es obligatorio en pantalla (el esquema compartido lo deja opcional por el pagador ya anotado). */
export const imputeFormSchema: FormSchema<Record<string, unknown>> = {
  safeParse(input) {
    if (!(input as Record<string, string>).chargedTo) {
      return { success: false, error: { issues: [{ path: ['chargedTo'], message: 'tickets.repair.errors.chargedTo' }] } };
    }
    const result = imputeBase.safeParse(input);
    if (result.success) return result;
    // El error del honorario se muestra en el selector del honorario.
    return {
      success: false,
      error: { issues: result.error.issues.map((i) => (i.path[0] === 'managementFee' ? { ...i, path: ['feeMode'] } : i)) },
    };
  },
};
