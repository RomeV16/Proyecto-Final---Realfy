import Decimal from 'decimal.js';
import { LineItemType } from '../enums';

// Configure Decimal for financial calculations: 20 significant digits, ROUND_HALF_UP
Decimal.set({ precision: 20, rounding: Decimal.ROUND_HALF_UP });

// ─── Types ──────────────────────────────────────────────

export interface LineItemInput {
  type: LineItemType;
  amount: Decimal | string | number;
}

export interface LineItemsTotalResult {
  subtotal: Decimal;
  discounts: Decimal;
  total: Decimal;
}

export interface PaymentInput {
  amount: Decimal | string | number;
}

// ─── Line Item Calculation ──────────────────────────────

/**
 * Calculate totals from a list of line items.
 * - Alquiler, Ajuste, Extra are positive (summed into subtotal)
 * - Descuento is negative (subtracted from subtotal)
 * - Total = subtotal - discounts (never negative, floored at 0)
 */
export function calculateLineItemsTotal(items: LineItemInput[]): LineItemsTotalResult {
  let subtotal = new Decimal(0);
  let discounts = new Decimal(0);

  for (const item of items) {
    const amount = new Decimal(item.amount);

    if (item.type === LineItemType.Descuento) {
      discounts = discounts.plus(amount);
    } else {
      subtotal = subtotal.plus(amount);
    }
  }

  // Total cannot go below 0
  const total = Decimal.max(subtotal.minus(discounts), new Decimal(0));

  return {
    subtotal: subtotal.toDecimalPlaces(2),
    discounts: discounts.toDecimalPlaces(2),
    total: total.toDecimalPlaces(2),
  };
}

// ─── Payment Tracking ───────────────────────────────────

/**
 * Calculate the remaining balance on a liquidación after payments.
 * Result may be 0 or negative (overpayment).
 */
export function calculateRemainingBalance(
  total: Decimal | string | number,
  payments: PaymentInput[],
): Decimal {
  const totalDecimal = new Decimal(total);
  let paid = new Decimal(0);

  for (const payment of payments) {
    paid = paid.plus(new Decimal(payment.amount));
  }

  return totalDecimal.minus(paid).toDecimalPlaces(2);
}

/**
 * Check whether a liquidación is fully paid (remaining balance ≤ 0).
 */
export function isFullyPaid(
  total: Decimal | string | number,
  payments: PaymentInput[],
): boolean {
  const remaining = calculateRemainingBalance(total, payments);
  return remaining.lte(0);
}
