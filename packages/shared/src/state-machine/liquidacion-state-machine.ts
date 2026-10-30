import { LiquidacionStatus } from '../enums';
import { defineStateMachine } from './define';

/**
 * Liquidación 7-state workflow machine.
 *
 * States:
 *   Borrador → Revision | Anulada
 *   Revision → Aprobada | Borrador | Anulada
 *   Aprobada → Enviada | Anulada
 *   Enviada  → Pagada | Vencida | Anulada
 *   Pagada   → (terminal)
 *   Vencida  → Pagada | Anulada
 *   Anulada  → (terminal)
 */

const {
  Borrador,
  Revision,
  Aprobada,
  Enviada,
  Pagada,
  Vencida,
  Anulada,
} = LiquidacionStatus;

export const liquidacionMachine = defineStateMachine<LiquidacionStatus>([
  [Borrador, [Revision, Anulada]],
  [Revision, [Aprobada, Borrador, Anulada]],
  [Aprobada, [Enviada, Anulada]],
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
