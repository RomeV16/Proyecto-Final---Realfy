import { TicketStatus } from '../enums';

/**
 * Ticket 10-state workflow machine.
 *
 * S01 core states (6): Abierto, Asignado, EnProgreso, Resuelto, Cerrado, Cancelado, Reabierto.
 * Provider states (3): ProveedorAsignado, ProveedorEnCamino, TrabajoRealizado.
 *
 * Core flow:
 *   Abierto → Asignado | Cancelado
 *   Asignado → EnProgreso | Abierto | Cancelado
 *   EnProgreso → Resuelto | Cancelado | ProveedorAsignado
 *   Resuelto → Cerrado | Reabierto
 *   Cerrado → Reabierto
 *   Cancelado → (terminal)
 *   Reabierto → Asignado | Cancelado
 *
 * Provider flow:
 *   EnProgreso → ProveedorAsignado
 *   ProveedorAsignado → ProveedorEnCamino | EnProgreso | Cancelado
 *   ProveedorEnCamino → TrabajoRealizado | ProveedorAsignado
 *   TrabajoRealizado → Resuelto | EnProgreso
 */

const {
  Abierto,
  Asignado,
  EnProgreso,
  ProveedorAsignado,
  ProveedorEnCamino,
  TrabajoRealizado,
  Resuelto,
  Cerrado,
  Cancelado,
  Reabierto,
} = TicketStatus;

const TICKET_TRANSITIONS: Map<TicketStatus, TicketStatus[]> = new Map([
  [Abierto, [Asignado, Cancelado]],
  [Asignado, [EnProgreso, Abierto, Cancelado]],
  [EnProgreso, [Resuelto, Cancelado, ProveedorAsignado]],
  [Resuelto, [Cerrado, Reabierto]],
  [Cerrado, [Reabierto]],
  [Cancelado, []], // terminal
  [Reabierto, [Asignado, Cancelado]],
  // Provider states
  [ProveedorAsignado, [ProveedorEnCamino, EnProgreso, Cancelado]],
  [ProveedorEnCamino, [TrabajoRealizado, ProveedorAsignado]],
  [TrabajoRealizado, [Resuelto, EnProgreso]],
]);

/**
 * Check whether a ticket state transition is valid.
 */
export function validateTicketTransition(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  const validTargets = TICKET_TRANSITIONS.get(from);
  if (!validTargets) return false;
  return validTargets.includes(to);
}

/**
 * Return the list of valid next states for a given ticket status.
 * Returns an empty array if the state is terminal or the input is invalid.
 */
export function getValidTicketTransitions(
  from: TicketStatus,
): TicketStatus[] {
  return TICKET_TRANSITIONS.get(from) ?? [];
}
