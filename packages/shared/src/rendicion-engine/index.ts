import type Decimal from 'decimal.js';
import { Money, allocateLargestRemainder, sumMoney } from '../money';
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

// ─── Errors ─────────────────────────────────────────────

/** Un pago o una deducción con un monto que la rendición no admite (negativo). */
export class InvalidRendicionLineError extends Error {
  readonly code = 'INVALID_LINE_AMOUNT';

  constructor(
    readonly lineType: RendicionLineItemType,
    readonly description: string,
    readonly amount: string,
  ) {
    super(
      `Monto inválido para un renglón ${lineType} (${description}): ${amount} (no puede ser negativo)`,
    );
    this.name = 'InvalidRendicionLineError';
  }
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
 * Ningún pago ni deducción puede ser negativo: lanza InvalidRendicionLineError
 * (INVALID_LINE_AMOUNT), igual que la liquidación y la comisión.
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
    const raw = new Money(payment.amount);
    if (raw.isNegative()) {
      throw new InvalidRendicionLineError(
        RendicionLineItemType.Alquiler,
        payment.description,
        raw.toString(),
      );
    }
    const amt = raw.toDecimalPlaces(2);
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
    const raw = new Money(deduction.amount);
    if (raw.isNegative()) {
      throw new InvalidRendicionLineError(
        RendicionLineItemType.Deduccion,
        deduction.description,
        raw.toString(),
      );
    }
    const amt = raw.toDecimalPlaces(2);
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

// ─── Reparto entre locadores ────────────────────────────

/**
 * Reparte una rendición entre los locadores vigentes según su porcentaje de
 * cobro. Cada renglón se reparte por el método del mayor resto (la suma de las
 * partes es exactamente el renglón) y los totales de cada locador salen de sus
 * renglones, así que cada rendición suma lo que muestra y la suma de los netos
 * es el neto total. Con un solo locador devuelve la rendición sin cambios.
 * No cambia ninguna regla de comisión: solo reparte el resultado.
 */
export function splitRendicionAmongLessors(
  result: RendicionResult,
  weights: Array<string | number>,
): RendicionResult[] {
  if (weights.length === 1) return [result];

  const shares = result.lineItems.map((li) => allocateLargestRemainder(li.amount, weights));
  return weights.map((_, k) => {
    const lineItems = result.lineItems.map((li, i) => ({ ...li, amount: shares[i][k] }));
    const totalOf = (type: RendicionLineItemType) =>
      sumMoney(lineItems.filter((li) => li.type === type).map((li) => li.amount));
    const rentCollected = totalOf(RendicionLineItemType.Alquiler);
    const commissionAmount = totalOf(RendicionLineItemType.Comision);
    const adminFeeAmount = totalOf(RendicionLineItemType.AdminFee);
    const deductionTotal = totalOf(RendicionLineItemType.Deduccion);
    return {
      rentCollected,
      commissionAmount,
      adminFeeAmount,
      deductionTotal,
      netDeposit: rentCollected.minus(commissionAmount).minus(adminFeeAmount).minus(deductionTotal),
      lineItems,
    };
  });
}
