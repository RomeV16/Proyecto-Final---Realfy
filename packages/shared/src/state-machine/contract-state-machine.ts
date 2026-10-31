import { ContractStatus } from '../enums';
import { defineStateMachine } from './define';

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

export const contractMachine = defineStateMachine<ContractStatus>([
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
  return contractMachine.canTransition(from, to);
}

/**
 * Return the list of valid next states for a given contract status.
 * Returns an empty array if the state is terminal or the input is invalid.
 */
export function getValidContractTransitions(
  from: ContractStatus,
): ContractStatus[] {
  return contractMachine.allowedFrom(from);
}

/**
 * Estados en los que un contrato ya terminó su vida útil. `Renovado` cuenta
 * como cierre: la vigencia sigue en un contrato nuevo, pero la gestión del que
 * se renovó está completa.
 */
export const CLOSED_CONTRACT_STATUSES = [
  Vencido,
  Rescindido,
  Renovado,
  Archivado,
] as const;

export type ClosedContractStatus = (typeof CLOSED_CONTRACT_STATUSES)[number];

/** El contrato está en un estado de cierre. */
export function isClosedStatus(status: string): boolean {
  return (CLOSED_CONTRACT_STATUSES as readonly string[]).includes(status);
}
