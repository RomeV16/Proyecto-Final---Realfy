import Decimal from 'decimal.js';
import { AdjustmentType } from '../enums';

// Configure Decimal for financial calculations: 20 significant digits, ROUND_HALF_UP
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

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
  | { type: AdjustmentType.Custom; percentage: Decimal; baseRent: Decimal };

// ─── IPC (Índice de Precios al Consumidor) ──────────────
// Multiplicative chain of monthly percentage values.
// Trimestral: Π(1 + m_i/100) - 1
// Result percentage and newRent = baseRent * (1 + percentage/100)

export function calculateIPC(
  monthlyValues: Decimal[],
  baseRent: Decimal,
): AdjustmentResult {
  if (monthlyValues.length === 0) {
    return { newRent: baseRent, percentage: new Decimal(0) };
  }

  // Build multiplicative chain: product = Π(1 + m_i/100)
  let product = new Decimal(1);
  for (const m of monthlyValues) {
    product = product.mul(new Decimal(1).plus(m.div(100)));
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
    return { newRent: baseRent, percentage: new Decimal(0) };
  }

  let product = new Decimal(1);
  for (let i = 0; i < cvsPcts.length; i++) {
    const cvsComponent = new Decimal('0.9').mul(cvsPcts[i]);
    const cerComponent = cerPcts[i];
    const factor = Decimal.min(cvsComponent, cerComponent);
    product = product.mul(new Decimal(1).plus(factor.div(100)));
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
  const factor = new Decimal(1).plus(percentage.div(100));
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
    default: {
      const _exhaustive: never = params;
      throw new Error(`Unknown adjustment type: ${(_exhaustive as any).type}`);
    }
  }
}
