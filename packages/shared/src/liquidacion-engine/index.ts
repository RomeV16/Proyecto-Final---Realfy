import type Decimal from 'decimal.js';
import { Money } from '../money';
import { LineBeneficiary, LineItemType } from '../enums';

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

// ─── Errors ─────────────────────────────────────────────

/** Un renglón con un monto que el tipo no admite (por ejemplo, negativo). */
export class InvalidLineAmountError extends Error {
  readonly code = 'INVALID_LINE_AMOUNT';

  constructor(
    readonly lineType: LineItemType,
    readonly amount: string,
  ) {
    super(`Monto inválido para un renglón ${lineType}: ${amount} (no puede ser negativo)`);
    this.name = 'InvalidLineAmountError';
  }
}

// ─── Line Item Calculation ──────────────────────────────

/**
 * Calculate totals from a list of line items.
 * - Alquiler, Ajuste, Extra, Multa suman al subtotal
 * - Descuento se resta del subtotal (su monto se carga en positivo)
 * - Ningún monto puede ser negativo: lanza InvalidLineAmountError
 * - Total = subtotal redondeado - descuentos redondeados (nunca negativo, piso en 0),
 *   que es exactamente lo que muestra el documento
 */
export function calculateLineItemsTotal(items: LineItemInput[]): LineItemsTotalResult {
  let subtotal = new Money(0);
  let discounts = new Money(0);

  for (const item of items) {
    const amount = new Money(item.amount);
    if (amount.isNegative()) {
      throw new InvalidLineAmountError(item.type, amount.toString());
    }

    if (item.type === LineItemType.Descuento) {
      discounts = discounts.plus(amount);
    } else {
      subtotal = subtotal.plus(amount);
    }
  }

  const roundedSubtotal = subtotal.toDecimalPlaces(2);
  const roundedDiscounts = discounts.toDecimalPlaces(2);
  // Total cannot go below 0
  const total = Money.max(roundedSubtotal.minus(roundedDiscounts), new Money(0));

  return {
    subtotal: roundedSubtotal,
    discounts: roundedDiscounts,
    total,
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
  const totalDecimal = new Money(total);
  let paid = new Money(0);

  for (const payment of payments) {
    paid = paid.plus(new Money(payment.amount));
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

// ─── Destino y comisión por defecto ─────────────────────

const COMMISSIONABLE_TYPES: ReadonlySet<LineItemType> = new Set([
  LineItemType.Alquiler,
  LineItemType.Ajuste,
  LineItemType.AjusteRetroactivo,
  LineItemType.Multa,
  LineItemType.Descuento,
]);

/**
 * La comisión de la inmobiliaria corre sobre el alquiler, sus ajustes y los
 * punitorios; nunca sobre reparaciones, impuestos ni servicios.
 */
export function defaultCommissionable(type: LineItemType): boolean {
  return COMMISSIONABLE_TYPES.has(type);
}

/** Destino de un renglón cuando quien lo carga no lo indica. */
export function defaultBeneficiary(type: LineItemType): LineBeneficiary {
  switch (type) {
    case LineItemType.Impuesto:
    case LineItemType.Servicio:
      return LineBeneficiary.Ente;
    case LineItemType.Honorario:
      return LineBeneficiary.Inmobiliaria;
    default:
      return LineBeneficiary.Locador;
  }
}
