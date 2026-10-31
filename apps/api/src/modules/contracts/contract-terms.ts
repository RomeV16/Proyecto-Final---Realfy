import { AdjustmentBase, PaymentFlow } from '@realfy/shared';
import type { OperationalDefaults } from '@realfy/shared';

/**
 * Reglas versionadas de un contrato (defecto -> contrato -> acuerdo).
 *
 * Cada `ContractTermsVersion` es una foto de las reglas desde `validFrom`; un
 * cambio crea una versión nueva y nunca pisa la anterior. Las columnas de
 * ajuste de `contracts` quedan como la vista "vigente" desnormalizada.
 */

/** Campos de una versión de reglas que importan para resolver una regla. */
export interface TermsLike {
  validFrom: Date;
  adjustmentType: string;
  adjustmentPeriod: string;
  adjustmentBase: string;
  indexLagMonths: number;
  fixedInitialMonths: number;
  customPct: unknown;
  customSteps: unknown;
  rentOverride: unknown;
  discountPct: unknown;
  discountAmount: unknown;
  dueDay: number;
  paymentFlow: string;
  penaltyConfig: unknown;
}

type TermsClient = {
  contractTermsVersion: { findFirst: (args: any) => Promise<any> };
};

/**
 * La versión vigente a una fecha: la última con `validFrom` anterior o igual.
 * Devuelve null si la fecha es anterior a la primera versión.
 */
export function pickTermsAt<T extends { validFrom: Date }>(versions: T[], date: Date): T | null {
  let best: T | null = null;
  for (const v of versions) {
    if (v.validFrom.getTime() > date.getTime()) continue;
    if (!best || v.validFrom.getTime() > best.validFrom.getTime()) best = v;
  }
  return best;
}

/** Lee de la base la versión de reglas vigente de un contrato a una fecha. */
export async function getTermsAt(
  client: TermsClient,
  contract: { id: string; tenantId: string },
  date: Date,
) {
  return client.contractTermsVersion.findFirst({
    where: { tenantId: contract.tenantId, contractId: contract.id, validFrom: { lte: date } },
    orderBy: { validFrom: 'desc' },
  });
}

/**
 * Fin efectivo del contrato: el fin real o prórroga de palabra si se registró,
 * y si no el fin pactado. Un contrato pasado de su fin pactado sin fin real
 * sigue vigente mientras esté Activo (D-3).
 */
export function getEffectiveEndDate(contract: { endDate: Date; actualEndDate?: Date | null }): Date {
  return contract.actualEndDate ?? contract.endDate;
}

/** Regla -> valor que rige si el contrato no la fijó. */
const RULE_DEFAULTS = {
  dueDay: (d: OperationalDefaults) => d.dueDay,
  indexLagMonths: (d: OperationalDefaults) => d.ipcLagMonths,
  adjustmentBase: () => AdjustmentBase.Vigente,
  paymentFlow: () => PaymentFlow.Partido,
  penaltyConfig: () => null,
} as const;

export type ResolvableRule = keyof typeof RULE_DEFAULTS;

/**
 * Valor de una regla: el de la versión vigente del contrato si lo fija y, si
 * no, el valor por defecto de la inmobiliaria.
 */
export function resolveRule(
  defaults: OperationalDefaults,
  terms: Partial<TermsLike> | null | undefined,
  key: ResolvableRule,
): unknown {
  const own = terms?.[key];
  if (own !== null && own !== undefined) return own;
  return RULE_DEFAULTS[key](defaults);
}

/** Columnas de contracts que reflejan la versión vigente. */
export function denormalizedColumns(terms: {
  adjustmentType: string;
  adjustmentPeriod: string;
  customPct: unknown;
}) {
  return {
    adjustmentType: terms.adjustmentType as any,
    adjustmentPeriod: terms.adjustmentPeriod as any,
    customAdjustmentPct: (terms.customPct ?? null) as any,
  };
}
