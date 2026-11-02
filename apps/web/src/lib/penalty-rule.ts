import {
  BNA_RATE_KINDS,
  CAP_BASES,
  MISSING_RATE_BEHAVIORS,
  PARTIAL_PAYMENT_ALLOCATIONS,
  PENALTY_MODES,
  PenaltyConfigSchema,
  ROUNDING_MODES,
  type PenaltyConfig,
  type PenaltyMode,
} from '@realfy/shared';

/** Opciones pactables de la regla y sus valores, el primero es el por defecto. */
export const PENALTY_RULE_OPTIONS = {
  partialPaymentAllocation: PARTIAL_PAYMENT_ALLOCATIONS,
  roundingMode: ROUNDING_MODES,
  capBase: CAP_BASES,
  bnaRateKind: BNA_RATE_KINDS,
  missingRateBehavior: MISSING_RATE_BEHAVIORS,
} as const;
export type PenaltyOptionField = keyof typeof PENALTY_RULE_OPTIONS;
/** Las que solo valen con la tasa BNA. */
export const BNA_OPTION_FIELDS: readonly PenaltyOptionField[] = ['bnaRateKind', 'missingRateBehavior'];

/** Modos de punitorio en el orden en que se ofrecen. */
export const PENALTY_RULE_MODES: readonly PenaltyMode[] = PENALTY_MODES;

/** Los modos de porcentaje se cargan en % por día; el monto fijo, en pesos por día. */
export function isPercentMode(mode: PenaltyMode): boolean {
  return mode !== 'daily_fixed';
}

/** Valores del formulario: todo en texto, y la tasa diaria en porcentaje. */
export interface PenaltyRuleForm {
  mode: PenaltyMode;
  value: string;
  graceDays: string;
  maxMultiplier: string;
  bnaMultiplier: string;
  yearDays: string;
  partialPaymentAllocation: string;
  roundingMode: string;
  capBase: string;
  bnaRateKind: string;
  missingRateBehavior: string;
}

const DEFAULT_PENALTY_RULE_FORM: PenaltyRuleForm = {
  mode: 'max_bna_or_daily',
  value: '0.3',
  graceDays: '0',
  maxMultiplier: '2',
  bnaMultiplier: '2',
  yearDays: '365',
  partialPaymentAllocation: 'RentaPrimero',
  roundingMode: 'Total',
  capBase: 'SaldoInicioMora',
  bnaRateKind: 'Nominal',
  missingRateBehavior: 'AplicarPiso',
};

/** Pasa un decimal de texto a otro de texto multiplicado por 100 (o dividido), sin ruido de coma flotante. */
function scale(value: string, factor: number): string {
  const n = Number(value);
  if (!Number.isFinite(n)) return value;
  return String(parseFloat((n * factor).toFixed(8)));
}

export function ruleToForm(config: PenaltyConfig | null | undefined): PenaltyRuleForm {
  if (!config) return DEFAULT_PENALTY_RULE_FORM;
  return {
    mode: config.mode,
    value: isPercentMode(config.mode) ? scale(config.value, 100) : config.value,
    graceDays: String(config.graceDays),
    maxMultiplier: config.maxMultiplier,
    bnaMultiplier: config.bnaMultiplier ?? DEFAULT_PENALTY_RULE_FORM.bnaMultiplier,
    yearDays: String(config.yearDays ?? 365),
    partialPaymentAllocation: config.partialPaymentAllocation ?? 'RentaPrimero',
    roundingMode: config.roundingMode ?? 'Total',
    capBase: config.capBase ?? 'SaldoInicioMora',
    bnaRateKind: config.bnaRateKind ?? 'Nominal',
    missingRateBehavior: config.missingRateBehavior ?? 'AplicarPiso',
  };
}

export type RuleFormResult =
  | { ok: true; value: PenaltyConfig }
  | { ok: false; errors: Partial<Record<keyof PenaltyRuleForm, string>> };

/** Valida el formulario con el mismo esquema de la API; los mensajes son claves del namespace `penaltyRule.errors`. */
export function formToRule(form: PenaltyRuleForm): RuleFormResult {
  const candidate: Record<string, unknown> = {
    mode: form.mode,
    value: isPercentMode(form.mode) ? scale(form.value.trim(), 0.01) : form.value.trim(),
    graceDays: form.graceDays.trim() === '' ? NaN : Number(form.graceDays),
    maxMultiplier: form.maxMultiplier.trim(),
    partialPaymentAllocation: form.partialPaymentAllocation,
    roundingMode: form.roundingMode,
    capBase: form.capBase,
  };
  if (form.mode === 'max_bna_or_daily') {
    candidate.bnaMultiplier = form.bnaMultiplier.trim();
    candidate.yearDays = Number(form.yearDays);
    candidate.bnaRateKind = form.bnaRateKind;
    candidate.missingRateBehavior = form.missingRateBehavior;
  }
  const parsed = PenaltyConfigSchema.safeParse(candidate);
  if (parsed.success) return { ok: true, value: parsed.data };
  const errors: Partial<Record<keyof PenaltyRuleForm, string>> = {};
  for (const issue of parsed.error.issues) {
    const field = issue.path[0] as keyof PenaltyRuleForm | undefined;
    if (field && !errors[field]) errors[field] = 'invalid';
  }
  return { ok: false, errors };
}
