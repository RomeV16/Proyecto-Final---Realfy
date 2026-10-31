import type Decimal from 'decimal.js';
import { Money } from '../money';
import { AdjustmentType } from '../enums';

// ─── Types ──────────────────────────────────────────────

export interface AdjustmentResult {
  newRent: Decimal;
  percentage: Decimal;
}

export type AdjustmentParams =
  | { type: AdjustmentType.IPC; monthlyValues: Decimal[]; baseRent: Decimal }
  | { type: AdjustmentType.ICL; startValue: Decimal; endValue: Decimal; baseRent: Decimal }
  | { type: AdjustmentType.CCP; cvsPcts: Decimal[]; cerPcts: Decimal[]; baseRent: Decimal }
  | { type: AdjustmentType.FixedPercent; percentage: Decimal; baseRent: Decimal }
  | { type: AdjustmentType.Custom; percentage: Decimal; baseRent: Decimal }
  | { type: AdjustmentType.UVA; startValue: Decimal; endValue: Decimal; baseRent: Decimal }
  | {
      type: AdjustmentType.Escalonado;
      steps: EscalonadoStep[];
      /** Meses transcurridos desde el inicio del tramo hasta la fecha del ajuste. */
      monthsElapsed: number;
      baseRent: Decimal;
    };

/** Desde el mes `fromMonth` del tramo rige el porcentaje `pct`. */
export interface EscalonadoStep {
  fromMonth: number;
  pct: Decimal;
}

// ─── IPC (Índice de Precios al Consumidor) ──────────────
// Multiplicative chain of monthly percentage values.
// Trimestral: Π(1 + m_i/100) - 1
// Result percentage and newRent = baseRent * (1 + percentage/100)

export function calculateIPC(
  monthlyValues: Decimal[],
  baseRent: Decimal,
): AdjustmentResult {
  if (monthlyValues.length === 0) {
    return { newRent: baseRent, percentage: new Money(0) };
  }

  // Build multiplicative chain: product = Π(1 + m_i/100)
  let product = new Money(1);
  for (const m of monthlyValues) {
    product = product.mul(new Money(1).plus(m.div(100)));
  }

  // percentage = (product - 1) * 100
  const percentage = product.minus(1).mul(100);
  const newRent = baseRent.mul(product).toDecimalPlaces(2);

  return { newRent, percentage };
}

// ─── ICL (Índice para Contratos de Locación) ────────────
// Simple ratio: percentage = (end/start - 1) * 100

export function calculateICL(
  startValue: Decimal,
  endValue: Decimal,
  baseRent: Decimal,
): AdjustmentResult {
  if (startValue.isZero()) {
    throw new Error('ICL start value cannot be zero');
  }

  const ratio = endValue.div(startValue);
  const percentage = ratio.minus(1).mul(100);
  const newRent = baseRent.mul(ratio).toDecimalPlaces(2);

  return { newRent, percentage };
}

// ─── CCP (Coeficiente Casa Propia) ──────────────────────
// For each month: factor = min(0.9 * CVS%, CER%)
// Chain: newRent = baseRent * Π(1 + factor_i/100)

export function calculateCCP(
  cvsPcts: Decimal[],
  cerPcts: Decimal[],
  baseRent: Decimal,
): AdjustmentResult {
  if (cvsPcts.length !== cerPcts.length) {
    throw new Error('CVS and CER arrays must have the same length');
  }

  if (cvsPcts.length === 0) {
    return { newRent: baseRent, percentage: new Money(0) };
  }

  let product = new Money(1);
  for (let i = 0; i < cvsPcts.length; i++) {
    const cvsComponent = new Money('0.9').mul(cvsPcts[i]);
    const cerComponent = cerPcts[i];
    const factor = Money.min(cvsComponent, cerComponent);
    product = product.mul(new Money(1).plus(factor.div(100)));
  }

  const percentage = product.minus(1).mul(100);
  const newRent = baseRent.mul(product).toDecimalPlaces(2);

  return { newRent, percentage };
}

// ─── Fixed Percent ──────────────────────────────────────
// Simple: newRent = baseRent * (1 + pct/100)

export function calculateFixedPercent(
  percentage: Decimal,
  baseRent: Decimal,
): AdjustmentResult {
  const factor = new Money(1).plus(percentage.div(100));
  const newRent = baseRent.mul(factor).toDecimalPlaces(2);

  return { newRent, percentage };
}

// ─── Custom ─────────────────────────────────────────────
// Same formula as Fixed Percent but user-defined per period

export function calculateCustom(
  percentage: Decimal,
  baseRent: Decimal,
): AdjustmentResult {
  return calculateFixedPercent(percentage, baseRent);
}

// ─── UVA (Unidad de Valor Adquisitivo) ──────────────────
// Índice diario de nivel: cociente entre el valor de la fecha final y el de la
// fecha inicial, igual que el ICL.

export function calculateUVA(
  startValue: Decimal,
  endValue: Decimal,
  baseRent: Decimal,
): AdjustmentResult {
  if (startValue.isZero()) {
    throw new Error('UVA start value cannot be zero');
  }
  const ratio = endValue.div(startValue);
  return {
    newRent: baseRent.mul(ratio).toDecimalPlaces(2),
    percentage: ratio.minus(1).mul(100),
  };
}

// ─── Escalonado ─────────────────────────────────────────
// Rige el porcentaje del último escalón cuyo `fromMonth` ya llegó. Antes del
// primer escalón el alquiler no cambia: es la regla pactada, no un dato faltante.

export function calculateEscalonado(
  steps: EscalonadoStep[],
  monthsElapsed: number,
  baseRent: Decimal,
): AdjustmentResult {
  if (steps.length === 0) {
    throw new Error('Escalonado needs at least one step');
  }
  let applicable: EscalonadoStep | null = null;
  for (const step of steps) {
    if (step.fromMonth <= monthsElapsed && (!applicable || step.fromMonth > applicable.fromMonth)) {
      applicable = step;
    }
  }
  if (!applicable) {
    return { newRent: baseRent, percentage: new Money(0) };
  }
  return calculateFixedPercent(applicable.pct, baseRent);
}

// ─── Dispatcher ─────────────────────────────────────────

export function calculateAdjustment(params: AdjustmentParams): AdjustmentResult {
  switch (params.type) {
    case AdjustmentType.IPC:
      return calculateIPC(params.monthlyValues, params.baseRent);
    case AdjustmentType.ICL:
      return calculateICL(params.startValue, params.endValue, params.baseRent);
    case AdjustmentType.CCP:
      return calculateCCP(params.cvsPcts, params.cerPcts, params.baseRent);
    case AdjustmentType.FixedPercent:
      return calculateFixedPercent(params.percentage, params.baseRent);
    case AdjustmentType.Custom:
      return calculateCustom(params.percentage, params.baseRent);
    case AdjustmentType.UVA:
      return calculateUVA(params.startValue, params.endValue, params.baseRent);
    case AdjustmentType.Escalonado:
      return calculateEscalonado(params.steps, params.monthsElapsed, params.baseRent);
    default: {
      const _exhaustive: never = params;
      throw new Error(`Unknown adjustment type: ${(_exhaustive as any).type}`);
    }
  }
}

export * from './windows';
export * from './provisional';
