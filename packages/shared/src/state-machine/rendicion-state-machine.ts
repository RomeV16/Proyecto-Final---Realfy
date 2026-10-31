import { RendicionStatus } from '../enums';
import { defineStateMachine } from './define';

/**
 * Owner Rendición 4-state workflow machine.
 *
 * States:
 *   Borrador  → Aprobada
 *   Aprobada  → Enviada | Borrador (return to draft)
 *   Enviada   → Depositada
 *   Depositada → (terminal)
 */

const { Borrador, Aprobada, Enviada, Depositada } = RendicionStatus;

export const rendicionMachine = defineStateMachine<RendicionStatus>([
  [Borrador, [Aprobada]],
  [Aprobada, [Enviada, Borrador]],
  [Enviada, [Depositada]],
  [Depositada, []], // terminal
]);

/**
 * Check whether a rendición state transition is valid.
 */
export function validateRendicionTransition(
  from: RendicionStatus,
  to: RendicionStatus,
): boolean {
  return rendicionMachine.canTransition(from, to);
}

/**
 * Return the list of valid next states for a given rendición status.
 * Returns an empty array if the state is terminal or the input is invalid.
 */
export function getValidRendicionTransitions(
  from: RendicionStatus,
): RendicionStatus[] {
  return rendicionMachine.allowedFrom(from);
}
