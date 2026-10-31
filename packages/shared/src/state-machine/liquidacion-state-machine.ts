import { LiquidacionStatus } from '../enums';
import { defineStateMachine } from './define';

/**
 * Liquidación 8-state workflow machine.
 *
 * States:
 *   Borrador → Revision | Anulada
 *   Revision → Aprobada | Borrador | Anulada
 *   Aprobada → Enviada | Anulada
 *   Enviada  → Pagada | Vencida | Anulada
 *   Pagada   → (terminal)
 *   Vencida  → Pagada | Anulada
 *   Anulada  → (terminal)
 *   Pendiente → (estado heredado de la base: ningún flujo entra ni sale)
 */

const {
  Borrador,
  Revision,
  Aprobada,
  Pendiente,
  Enviada,
  Pagada,
  Vencida,
  Anulada,
} = LiquidacionStatus;

export const liquidacionMachine = defineStateMachine<LiquidacionStatus>([
  [Borrador, [Revision, Anulada]],
  [Revision, [Aprobada, Borrador, Anulada]],
  [Aprobada, [Enviada, Anulada]],
  [Pendiente, []], // heredado: sin transiciones definidas
  [Enviada, [Pagada, Vencida, Anulada]],
  [Pagada, []], // terminal
  [Vencida, [Pagada, Anulada]],
  [Anulada, []], // terminal
]);

/**
 * Check whether a liquidación state transition is valid.
 */
export function validateLiquidacionTransition(
  from: LiquidacionStatus,
  to: LiquidacionStatus,
): boolean {
  return liquidacionMachine.canTransition(from, to);
}

/**
 * Return the list of valid next states for a given liquidación status.
 * Returns an empty array if the state is terminal or the input is invalid.
 */
export function getValidLiquidacionTransitions(
  from: LiquidacionStatus,
): LiquidacionStatus[] {
  return liquidacionMachine.allowedFrom(from);
}

/**
 * Liquidaciones por cobrar: ya aprobadas, ni pagadas ni anuladas. Borrador y
 * Revisión todavía no se emitieron; Pagada y Anulada no dejan saldo. `Pendiente`
 * es heredado de la base pero, si existe, representa dinero esperado.
 *
 * Es el único criterio de "deuda" del sistema: panel, resumen de pagos,
 * contexto diario, reporte de morosidad y punitorios lo usan y suman el saldo
 * pendiente (total menos pagos), no el total.
 */
export const RECEIVABLE_STATUSES: readonly LiquidacionStatus[] = [
  Aprobada,
  Enviada,
  Pendiente,
  Vencida,
];

/**
 * Estados que pueden estar vencidos. `Vencida` lo está siempre; `Enviada` lo
 * está cuando su fecha de vencimiento ya pasó (ningún proceso la pasa a
 * `Vencida` sola). `Aprobada` no cuenta: todavía no se le mandó al inquilino.
 * Son los estados sobre los que corren la morosidad y el punitorio.
 */
export const OVERDUE_STATUSES: readonly LiquidacionStatus[] = [Enviada, Vencida];
