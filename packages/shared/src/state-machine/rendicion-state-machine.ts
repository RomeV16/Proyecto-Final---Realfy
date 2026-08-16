import { RendicionStatus } from '../enums';

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

const RENDICION_TRANSITIONS: Map<RendicionStatus, RendicionStatus[]> = new Map([
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
  const validTargets = RENDICION_TRANSITIONS.get(from);
  if (!validTargets) return false;
  return validTargets.includes(to);
}

/**
 * Return the list of valid next states for a given rendición status.
 * Returns an empty array if the state is terminal or the input is invalid.
 */
export function getValidRendicionTransitions(
  from: RendicionStatus,
): RendicionStatus[] {
  return RENDICION_TRANSITIONS.get(from) ?? [];
}
