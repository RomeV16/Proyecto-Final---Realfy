import {
  AdjustmentPeriod,
  Money,
  toAmountString,
  AdjustmentType,
  Currency,
  ExpirationLight,
  FollowUpKind,
  FollowUpOutcome,
  OralExtensionSchema,
  RenewContractSchema,
} from '@realfy/shared';
import type { FormSchema } from '@/hooks/use-zod-form';
import { parsePositiveAmount } from './cash';

/* ──────────── Lo que devuelve la API ──────────── */

export interface FollowUpTask {
  id: string;
  code: string;
  label: string;
  done: boolean;
  doneAt: string | null;
  doneById: string | null;
  dueDate: string | null;
}

/** Un seguimiento del fin de un contrato; el color (`light`) lo calcula la API y es null si está cerrado. */
export interface FollowUp {
  id: string;
  contractId: string;
  kind: string;
  status: string;
  outcome: string;
  dueDate: string;
  assigneeId: string | null;
  notes: string | null;
  closedAt: string | null;
  effectiveEnd: string;
  signedEnd: string;
  daysLeft: number;
  light: string | null;
  property: string | null;
  tenantName: string | null;
  tasks: FollowUpTask[];
  progress: { done: number; total: number };
}

/** Los colores del semáforo, del más urgente al menos. */
export const LIGHTS = [ExpirationLight.Expired, ExpirationLight.Red, ExpirationLight.Yellow, ExpirationLight.Green] as const;
export const KINDS = [FollowUpKind.Renovacion, FollowUpKind.Devolucion] as const;
export const OUTCOMES = [
  FollowUpOutcome.Pendiente,
  FollowUpOutcome.Renovado,
  FollowUpOutcome.Devuelto,
  FollowUpOutcome.Prorrogado,
] as const;
export const ADJUSTMENT_TYPES = [
  AdjustmentType.IPC,
  AdjustmentType.ICL,
  AdjustmentType.UVA,
  AdjustmentType.FixedPercent,
] as const;
export const ADJUSTMENT_PERIODS = [
  AdjustmentPeriod.Trimestral,
  AdjustmentPeriod.Cuatrimestral,
  AdjustmentPeriod.Semestral,
  AdjustmentPeriod.Anual,
] as const;
export const FEE_CURRENCIES = [Currency.ARS, Currency.USD] as const;

/* ──────────── Formularios ──────────── */

type Shared = {
  safeParse: (input: unknown) => { success: boolean; data?: unknown; error?: { issues: { path: PropertyKey[] }[] } };
};

/** Esquema de formulario a partir de uno compartido: cada error va a su campo con la clave `followUps.errors.<campo>`. */
function formSchema(
  shared: Shared,
  body: (values: Record<string, string>) => Record<string, unknown>,
  fallbackField: string,
  /** Campo del formulario al que va el error de un campo del cuerpo que el formulario no tiene con ese nombre. */
  fieldOf: Record<string, string> = {},
): FormSchema<Record<string, unknown>> {
  return {
    safeParse(input) {
      const result = shared.safeParse(body(input as Record<string, string>));
      if (result.success) return { success: true, data: result.data as Record<string, unknown> };
      return {
        success: false,
        error: {
          issues: (result.error?.issues ?? []).map((issue) => {
            const raw = String(issue.path[0] ?? fallbackField);
            const field = fieldOf[raw] ?? raw;
            return { path: [field], message: `followUps.errors.${field}` };
          }),
        },
      };
    },
  };
}

export interface OralExtensionFormValues {
  until: string;
  note: string;
}

export const oralExtensionFormSchema = formSchema(
  OralExtensionSchema,
  (v) => ({ until: v.until, note: (v.note ?? '').trim() }),
  'until',
);

export interface RenewFormValues {
  start: string;
  end: string;
  rent: string;
  /** Vacío = la regla de ajuste sigue igual. */
  adjustmentType: string;
  adjustmentPeriod: string;
  customPct: string;
  guarantorPersonIds: string[];
  feeAmount: string;
  feeCurrency: string;
  signedAt: string;
  notes: string;
}

const trimmed = (value: string | undefined) => (value ?? '').trim();

export const renewFormSchema = formSchema(
  RenewContractSchema,
  (v) => {
    const values = v as unknown as RenewFormValues;
    const fee = parsePositiveAmount(values.feeAmount ?? '');
    const changesRule = trimmed(values.adjustmentType) !== '';
    return {
      start: values.start,
      end: values.end,
      rent: parsePositiveAmount(values.rent ?? '') ?? '',
      ...(changesRule && {
        adjustment: {
          adjustmentType: values.adjustmentType,
          adjustmentPeriod: values.adjustmentPeriod,
          ...(values.adjustmentType === AdjustmentType.FixedPercent && { customPct: trimmed(values.customPct) }),
        },
      }),
      ...(values.guarantorPersonIds?.length > 0 && { guarantorPersonIds: values.guarantorPersonIds }),
      ...(fee && { fee: { amount: fee, currency: values.feeCurrency } }),
      ...(trimmed(values.signedAt) && { signedAt: trimmed(values.signedAt) }),
      ...(trimmed(values.notes) && { notes: trimmed(values.notes) }),
    };
  },
  'end',
  { adjustment: 'adjustmentType', fee: 'feeAmount' },
);

const DAY_MS = 86_400_000;

/** Día siguiente a una fecha ISO, como `YYYY-MM-DD`. */
export function dayAfter(iso: string): string {
  return new Date(Date.parse(`${iso.slice(0, 10)}T00:00:00.000Z`) + DAY_MS).toISOString().slice(0, 10);
}

/** Fin de un período de `months` meses que empieza en `start` (un día antes del mismo día `months` meses después). */
export function periodEnd(start: string, months: number): string {
  const [y, m, d] = start.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1 + months, d));
  // Un 31 que cae en un mes más corto se corre al último día de ese mes.
  if (date.getUTCDate() !== d) date.setUTCDate(0);
  return new Date(date.getTime() - DAY_MS).toISOString().slice(0, 10);
}

/**
 * Honorarios de renovación sugeridos: `pct` % del total del alquiler del período (alquiler por los meses que dura).
 * Es solo una propuesta que se puede cambiar; null si falta algún dato.
 */
export function suggestedRenewalFee(rent: string, start: string, end: string, pct: number | null): string | null {
  const amount = parsePositiveAmount(rent);
  if (!amount || pct === null || pct <= 0 || !/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end)) return null;
  const days = (Date.parse(`${end}T00:00:00.000Z`) + DAY_MS - Date.parse(`${start}T00:00:00.000Z`)) / DAY_MS;
  const months = Math.round(days / (365.25 / 12));
  if (months < 1) return null;
  return toAmountString(new Money(amount).times(months).times(pct).div(100));
}
