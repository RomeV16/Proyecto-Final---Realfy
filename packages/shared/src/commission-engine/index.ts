import type Decimal from 'decimal.js';
import { Money } from '../money';
import { CommissionType } from '../enums';

// ─── Types ──────────────────────────────────────────────

export interface CommissionConfig {
  type: CommissionType;
  /** Percentage (0–100) used by FixedPercent and Mixed. */
  percentage?: Decimal | string | number | null;
  /** Fixed amount used by FixedAmount and Mixed. */
  fixedAmount?: Decimal | string | number | null;
  /** Flat admin fee, always additive regardless of commission type. */
  adminFee?: Decimal | string | number | null;
}

export interface CommissionResult {
  commissionAmount: Decimal;
  adminFeeAmount: Decimal;
  totalDeducted: Decimal;
}

/** Configuración o monto de comisión fuera de rango. */
export class InvalidCommissionError extends Error {
  readonly code = 'INVALID_COMMISSION';

  constructor(message: string) {
    super(message);
    this.name = 'InvalidCommissionError';
  }
}

// ─── Engine ─────────────────────────────────────────────

/**
 * Calculate commission and admin-fee for a given rent amount.
 *
 * Supports three commission types:
 *   - FixedPercent: commission = rentCollected × (percentage / 100)
 *   - FixedAmount:  commission = fixedAmount
 *   - Mixed:        commission = fixedAmount + (rentCollected × percentage / 100)
 *
 * Rejects (InvalidCommissionError) a percentage outside 0–100 and negative amounts.
 * Admin fee is always a flat amount added on top (or Decimal(0) if absent).
 * All arithmetic uses Decimal.js; outputs are rounded to 2 decimal places.
 */
export function calculateCommission(
  rentCollected: Decimal | string | number,
  config: CommissionConfig,
): CommissionResult {
  const rent = new Money(rentCollected);
  const pct = config.percentage != null ? new Money(config.percentage) : new Money(0);
  const fixed = config.fixedAmount != null ? new Money(config.fixedAmount) : new Money(0);
  const adminFee = config.adminFee != null ? new Money(config.adminFee) : new Money(0);

  if (pct.isNegative() || pct.gt(100)) {
    throw new InvalidCommissionError(`El porcentaje debe estar entre 0 y 100: ${pct.toString()}`);
  }
  for (const [name, value] of [
    ['El monto cobrado', rent],
    ['El monto fijo', fixed],
    ['Los gastos administrativos', adminFee],
  ] as const) {
    if (value.isNegative()) {
      throw new InvalidCommissionError(`${name} no puede ser negativo: ${value.toString()}`);
    }
  }

  let commission: Decimal;

  switch (config.type) {
    case CommissionType.FixedPercent:
      commission = rent.times(pct.dividedBy(100));
      break;
    case CommissionType.FixedAmount:
      commission = fixed;
      break;
    case CommissionType.Mixed:
      commission = fixed.plus(rent.times(pct.dividedBy(100)));
      break;
    default: {
      const _exhaustive: never = config.type;
      throw new Error(`Unknown commission type: ${_exhaustive}`);
    }
  }

  const commissionAmount = commission.toDecimalPlaces(2);
  const adminFeeAmount = adminFee.toDecimalPlaces(2);
  const totalDeducted = commissionAmount.plus(adminFeeAmount).toDecimalPlaces(2);

  return { commissionAmount, adminFeeAmount, totalDeducted };
}
