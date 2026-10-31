import {
  LiquidacionStatus,
  Money,
  OVERDUE_STATUSES,
  RECEIVABLE_STATUSES,
  calculateRemainingBalance,
  sumMoney,
  type MoneyInput,
} from '@realfy/shared';

/** Lo mínimo de una liquidación para saber cuánto falta cobrarle. */
export interface ReceivableInput {
  status: string;
  dueDate: Date;
  total: MoneyInput;
  /** Pagos registrados; sin pagos (o sin cargar) el saldo es el total. */
  payments?: ReadonlyArray<{ amount: MoneyInput }> | null;
}

/** La liquidación espera cobro (grupo `RECEIVABLE_STATUSES`). */
export function isReceivable(status: string): boolean {
  return (RECEIVABLE_STATUSES as readonly string[]).includes(status);
}

/**
 * Saldo pendiente: total menos pagos, nunca negativo. Es la base de toda suma
 * de deuda y del punitorio; sumar `total` ignora los pagos parciales.
 */
export function outstandingBalance(liquidacion: Pick<ReceivableInput, 'total' | 'payments'>): Money {
  const remaining = new Money(
    calculateRemainingBalance(
      new Money(liquidacion.total),
      (liquidacion.payments ?? []).map((p) => ({ amount: new Money(p.amount) })),
    ),
  );
  return Money.max(remaining, new Money(0));
}

/**
 * Vencida: está en `Vencida`, o está `Enviada` y su vencimiento es anterior a
 * `today` (día calendario de Buenos Aires, ver `todayInAR`). Si vence hoy,
 * todavía no está vencida.
 */
export function isOverdue(liquidacion: Pick<ReceivableInput, 'status' | 'dueDate'>, today: Date): boolean {
  if (liquidacion.status === LiquidacionStatus.Vencida) return true;
  return (
    (OVERDUE_STATUSES as readonly string[]).includes(liquidacion.status) &&
    liquidacion.dueDate.getTime() < today.getTime()
  );
}

/** Suma exacta del saldo pendiente de varias liquidaciones. */
export function sumOutstanding(liquidaciones: ReadonlyArray<Pick<ReceivableInput, 'total' | 'payments'>>): Money {
  return sumMoney(liquidaciones.map((l) => outstandingBalance(l)));
}

export interface ReceivableSplit<T> {
  overdue: T[];
  pending: T[];
}

/**
 * Reparte las liquidaciones por cobrar con saldo entre vencidas y pendientes.
 * Descarta las que no esperan cobro o ya no tienen saldo. Conserva el orden.
 */
export function splitReceivables<T extends ReceivableInput>(
  liquidaciones: readonly T[],
  today: Date,
): ReceivableSplit<T> {
  const split: ReceivableSplit<T> = { overdue: [], pending: [] };
  for (const l of liquidaciones) {
    if (!isReceivable(l.status) || outstandingBalance(l).lte(0)) continue;
    (isOverdue(l, today) ? split.overdue : split.pending).push(l);
  }
  return split;
}
