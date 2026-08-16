import Decimal from 'decimal.js';
import { CommissionType } from '../enums';

// Configure Decimal for financial calculations: 20 significant digits, ROUND_HALF_UP
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

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

// ─── Engine ─────────────────────────────────────────────

/**
 * Calculate commission and admin-fee for a given rent amount.
 *
 * Supports three commission types:
 *   - FixedPercent: commission = rentCollected × (percentage / 100)
 *   - FixedAmount:  commission = fixedAmount
 *   - Mixed:        commission = fixedAmount + (rentCollected × percentage / 100)
 *
 * Admin fee is always a flat amount added on top (or Decimal(0) if absent).
 * All arithmetic uses Decimal.js; outputs are rounded to 2 decimal places.
 */
export function calculateCommission(
  rentCollected: Decimal | string | number,
  config: CommissionConfig,
): CommissionResult {
  const rent = new Decimal(rentCollected);
  const pct = config.percentage != null ? new Decimal(config.percentage) : new Decimal(0);
  const fixed = config.fixedAmount != null ? new Decimal(config.fixedAmount) : new Decimal(0);
  const adminFee = config.adminFee != null ? new Decimal(config.adminFee) : new Decimal(0);

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
