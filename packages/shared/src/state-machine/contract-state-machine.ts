import { ContractStatus } from '../enums';

/**
 * Máquina de estados del contrato.
 *
 * States:
 *   Borrador   → Activo | Rescindido | Archivado
 *   Activo     → Vencido | Rescindido | Renovado
 *   Vencido    → Renovado | Rescindido | Archivado
 *   Rescindido → Archivado
 *   Renovado   → Archivado
 *   Archivado  → (terminal)
 *
 * Borrador → Activo es la activación: la hace POST /contracts/:id/activate,
 * que además valida partes, fechas y superposición con otros contratos.
 * Rescindido se alcanza con POST /contracts/:id/terminate.
 */

const { Borrador, Activo, Vencido, Rescindido, Renovado, Archivado } =
  ContractStatus;

const CONTRACT_TRANSITIONS: Map<ContractStatus, ContractStatus[]> = new Map([
  [Borrador, [Activo, Rescindido, Archivado]],
  [Activo, [Vencido, Rescindido, Renovado]],
  [Vencido, [Renovado, Rescindido, Archivado]],
  [Rescindido, [Archivado]],
  [Renovado, [Archivado]],
  [Archivado, []], // terminal
]);

/**
 * Check whether a contract state transition is valid.
 */
export function validateContractTransition(
  from: ContractStatus,
  to: ContractStatus,
): boolean {
  const validTargets = CONTRACT_TRANSITIONS.get(from);
  if (!validTargets) return false;
  return validTargets.includes(to);
}

/**
 * Return the list of valid next states for a given contract status.
 * Returns an empty array if the state is terminal or the input is invalid.
 */
export function getValidContractTransitions(
  from: ContractStatus,
): ContractStatus[] {
  return CONTRACT_TRANSITIONS.get(from) ?? [];
}
