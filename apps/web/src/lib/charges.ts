import {
  ChargeTarget,
  CreatePendingChargeSchema,
  LineBeneficiary,
  PendingChargeKind,
  PendingChargeStatus,
} from '@realfy/shared';
import type { FormSchema } from '@/hooks/use-zod-form';
import { toDecimalString } from './index-values';
import { parseDateInput } from './service-bills';

/** Un cargo del centro de carga, como lo devuelve la API. */
export interface PendingChargeRow {
  id: string;
  propertyId: string;
  contractId: string | null;
  chargedTo: string;
  kind: string;
  description: string;
  /** Con signo: un negativo es un crédito a favor de quien lo soporta. */
  amount: string;
  currency: string;
  beneficiary: string;
  incurredAt: string;
  targetPeriod: string | null;
  status: string;
  requiresUpfront: boolean;
  installmentNo: number;
  installmentOf: number;
  imputedLiquidacionId: string | null;
  property?: { id: string; title: string } | null;
  lessor?: { id: string; firstName: string; lastName: string } | null;
}

export interface ChargesResponse {
  items: PendingChargeRow[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

export interface BulkChargeResult {
  index: number;
  status: 'created' | 'error';
  chargeIds?: string[];
  error?: { code: string; message: string };
}

export interface BulkChargesResponse {
  results: BulkChargeResult[];
  created: number;
  failed: number;
}

export const CHARGE_TARGETS = Object.values(ChargeTarget);
export const CHARGE_KINDS = Object.values(PendingChargeKind);
export const CHARGE_STATUSES = Object.values(PendingChargeStatus);
export const CHARGE_BENEFICIARIES = [LineBeneficiary.Locador, LineBeneficiary.Inmobiliaria] as const;

/** Importe con hasta 2 decimales, con signo opcional, o null. Acepta coma decimal. */
export function parseChargeAmount(raw: string): string | null {
  const text = toDecimalString(raw);
  return text !== null && /^-?\d+(\.\d{1,2})?$/.test(text) && Number(text) !== 0 ? text : null;
}

const orNull = (value: string): string | null => (value.trim() === '' ? null : value.trim());

export interface ChargeFormValues {
  contractId: string;
  propertyId: string;
  chargedTo: string;
  lessorPersonId: string;
  kind: string;
  description: string;
  amount: string;
  currency: string;
  beneficiary: string;
  incurredAt: string;
  targetPeriod: string;
  installments: string;
  notes: string;
}

/** Un cargo a partir de los valores de un formulario o de una fila de planilla. */
export function chargeBody(values: Record<string, string>): Record<string, unknown> {
  const installments = (values.installments ?? '').trim();
  return {
    contractId: orNull(values.contractId ?? ''),
    propertyId: orNull(values.propertyId ?? '') ?? undefined,
    chargedTo: values.chargedTo,
    // Solo un gasto al locador elige locador; sin elegir es de todos, según su porcentaje.
    lessorPersonId: values.chargedTo === 'Locador' ? orNull(values.lessorPersonId ?? '') : null,
    kind: values.kind,
    description: (values.description ?? '').trim(),
    amount: parseChargeAmount(values.amount ?? '') ?? '',
    currency: values.currency || undefined,
    beneficiary: values.beneficiary || undefined,
    incurredAt: parseDateInput(values.incurredAt ?? '') ?? '',
    targetPeriod: orNull(values.targetPeriod ?? ''),
    installments: installments === '' ? undefined : Number(installments),
    notes: orNull(values.notes ?? ''),
  };
}

/**
 * Esquema del formulario: arma el cuerpo y lo valida con el esquema compartido. Cada error queda en su campo,
 * con la clave `charges.errors.<campo>` que `useSchemaMessages` traduce.
 */
export const chargeFormSchema: FormSchema<Record<string, unknown>> = {
  safeParse(input) {
    const result = CreatePendingChargeSchema.safeParse(chargeBody(input as Record<string, string>));
    if (result.success) return { success: true, data: result.data as Record<string, unknown> };
    return {
      success: false,
      error: {
        issues: result.error.issues.map((issue) => ({
          path: [issue.path[0] ?? 'propertyId'],
          message: `charges.errors.${String(issue.path[0] ?? 'propertyId')}`,
        })),
      },
    };
  },
};

export type ChargeAction = 'forceImpute' | 'markPaidUpfront' | 'agencyExpense' | 'cancel' | 'release';

/** Lo que se puede hacer con un cargo según su estado. */
export function chargeActions(row: Pick<PendingChargeRow, 'status' | 'chargedTo' | 'requiresUpfront'>): ChargeAction[] {
  if (row.status === PendingChargeStatus.Imputado) return ['release'];
  if (row.status !== PendingChargeStatus.Pendiente) return [];
  const actions: ChargeAction[] = [];
  if (row.chargedTo === ChargeTarget.Inquilino) {
    if (row.requiresUpfront) actions.push('forceImpute');
    actions.push('markPaidUpfront');
  }
  // Un gasto de la inmobiliaria se cierra como egreso de una de sus cuentas.
  if (row.chargedTo === ChargeTarget.Inmobiliaria) actions.push('agencyExpense');
  actions.push('cancel');
  return actions;
}

/** "YYYY-MM" del mes de un cargo para mostrarlo: el elegido o, si no hay, el del gasto. */
export function chargeMonth(row: Pick<PendingChargeRow, 'targetPeriod' | 'incurredAt'>): string {
  return (row.targetPeriod ?? row.incurredAt).slice(0, 7);
}
