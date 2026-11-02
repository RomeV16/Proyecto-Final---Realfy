import { CashCategory, CashDirection } from '../enums';

/** Serie con que se numeran los recibos de cobro. */
export enum ReceiptSeriesMode {
  /** Una sola serie para todos los cobros de la inmobiliaria. */
  Unica = 'Unica',
  /** Una serie por moneda (pesos, dólares y euros se numeran por separado). */
  PorMoneda = 'PorMoneda',
  /** Una serie por cuenta de la inmobiliaria donde entró el cobro. */
  PorCuenta = 'PorCuenta',
}

/** Prefijo de las series de recibos de cobro; la de las liquidaciones es otra (`RECIBO_LIQUIDACION`). */
export const PAYMENT_RECEIPT_SERIES = 'RECIBO_COBRO';

/**
 * Nombre de la serie de un recibo de cobro según el modo. Un cobro sin cuenta
 * (lo recibió el locador) en modo `PorCuenta` usa la serie única.
 */
export function receiptSeriesFor(
  mode: ReceiptSeriesMode | `${ReceiptSeriesMode}`,
  ctx: { currency: string; accountId?: string | null },
): string {
  if (mode === ReceiptSeriesMode.PorMoneda) return `${PAYMENT_RECEIPT_SERIES}_${ctx.currency}`;
  if (mode === ReceiptSeriesMode.PorCuenta && ctx.accountId) return `${PAYMENT_RECEIPT_SERIES}_${ctx.accountId}`;
  return PAYMENT_RECEIPT_SERIES;
}

/**
 * Categorías que se cargan a mano en el libro. Las demás las escribe el
 * sistema: cobros (AlquilerCobrado), custodia, compensaciones y conversiones,
 * cada una desde su propia acción.
 */
export const MANUAL_CASH_CATEGORIES: readonly CashCategory[] = [
  CashCategory.PagoLocador,
  CashCategory.PagoEnte,
  CashCategory.PagoProveedor,
  CashCategory.Honorario,
  CashCategory.Gasto,
  CashCategory.ComisionEmpleado,
  CashCategory.Sena,
];

/** Sentido habitual de cada categoría manual (la pantalla lo propone; se puede cambiar). */
export function defaultDirectionFor(category: CashCategory | `${CashCategory}`): CashDirection {
  return category === CashCategory.Honorario || category === CashCategory.Sena
    ? CashDirection.In
    : CashDirection.Out;
}
