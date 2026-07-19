import { LiquidacionStatus } from '../enums';

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

const LIQUIDACION_TRANSITIONS: Map<LiquidacionStatus, LiquidacionStatus[]> = new Map([
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
  const validTargets = LIQUIDACION_TRANSITIONS.get(from);
  if (!validTargets) return false;
  return validTargets.includes(to);
}

/**
 * Return the list of valid next states for a given liquidación status.
 * Returns an empty array if the state is terminal or the input is invalid.
 */
export function getValidLiquidacionTransitions(
  from: LiquidacionStatus,
): LiquidacionStatus[] {
  return LIQUIDACION_TRANSITIONS.get(from) ?? [];
}
