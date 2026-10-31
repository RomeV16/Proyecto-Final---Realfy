import type Decimal from 'decimal.js';
import { Money } from '../money';
import { RendicionLineItemType } from '../enums';
import { calculateCommission, CommissionConfig } from '../commission-engine';

// ─── Types ──────────────────────────────────────────────

export interface RendicionPaymentInput {
  amount: Decimal | string | number;
  description: string;
}

export interface RendicionDeductionInput {
  amount: Decimal | string | number;
  description: string;
}

export interface RendicionLineItem {
  type: RendicionLineItemType;
  description: string;
  amount: Decimal;
}

export interface RendicionResult {
  rentCollected: Decimal;
  commissionAmount: Decimal;
  adminFeeAmount: Decimal;
  deductionTotal: Decimal;
  netDeposit: Decimal;
  lineItems: RendicionLineItem[];
}

// ─── Engine ─────────────────────────────────────────────

/**
 * Build a rendición summary from payments, commission config, and deductions.
 *
 * Line items are generated in order:
 *   1. Alquiler — one per payment input
 *   2. Comision — commission calculated via commission-engine
 *   3. AdminFee — admin fee (if > 0)
 *   4. Deduccion — one per deduction input
 *
 * rentCollected y deductionTotal son la suma de las líneas ya redondeadas: el
 * documento tiene que sumar lo que muestra.
 * netDeposit = rentCollected - commissionAmount - adminFeeAmount - deductionTotal
 * All arithmetic uses Decimal.js; outputs are rounded to 2 decimal places.
 */
export function buildRendicionFromPayments(
  payments: RendicionPaymentInput[],
  commissionConfig: CommissionConfig,
  deductions: RendicionDeductionInput[] = [],
): RendicionResult {
  const lineItems: RendicionLineItem[] = [];
  let rentCollected = new Money(0);

  // 1. Alquiler line items (one per payment)
  for (const payment of payments) {
    const amt = new Money(payment.amount).toDecimalPlaces(2);
    rentCollected = rentCollected.plus(amt);
    lineItems.push({
      type: RendicionLineItemType.Alquiler,
      description: payment.description,
      amount: amt,
    });
  }

  // 2. Commission calculation
  const commResult = calculateCommission(rentCollected, commissionConfig);

  // 3. Comision line item
  lineItems.push({
    type: RendicionLineItemType.Comision,
    description: 'Comisión',
    amount: commResult.commissionAmount,
  });

  // 4. AdminFee line item (only if > 0)
  if (commResult.adminFeeAmount.gt(0)) {
    lineItems.push({
      type: RendicionLineItemType.AdminFee,
      description: 'Gastos administrativos',
      amount: commResult.adminFeeAmount,
    });
  }

  // 5. Deduction line items
  let deductionTotal = new Money(0);
  for (const deduction of deductions) {
    const amt = new Money(deduction.amount).toDecimalPlaces(2);
    deductionTotal = deductionTotal.plus(amt);
    lineItems.push({
      type: RendicionLineItemType.Deduccion,
      description: deduction.description,
      amount: amt,
    });
  }

  // 6. Net deposit = rent - commission - adminFee - deductions
  const netDeposit = rentCollected
    .minus(commResult.commissionAmount)
    .minus(commResult.adminFeeAmount)
    .minus(deductionTotal)
    .toDecimalPlaces(2);

  return {
    rentCollected,
    commissionAmount: commResult.commissionAmount,
    adminFeeAmount: commResult.adminFeeAmount,
    deductionTotal,
    netDeposit,
    lineItems,
  };
}
