import { TicketStatus } from '../enums';
import { defineStateMachine } from './define';

/**
 * Ticket 13-state workflow machine.
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
 * Repair flow (incidencias, "caso → preautorización → presupuesto → ejecución"):
 *   Abierto | Asignado | Reabierto → PendienteAutorizacion (el costo estimado supera el límite)
 *   Abierto | Asignado | Reabierto → Presupuestado (por debajo del límite se presupuesta sin autorizar)
 *   PendienteAutorizacion → Presupuestado (el locador preautorizó) | Cancelado
 *   Presupuestado → PresupuestoAprobado (el locador aprobó un presupuesto) | Cancelado
 *   PresupuestoAprobado → ProveedorAsignado | EnProgreso | Cancelado
 *   (EnProgreso es la "ejecución"; sin autorización ni presupuesto se sigue yendo
 *   directo de Abierto a la ejecución por el flujo de arriba.)
 *
 * Provider flow:
 *   Abierto | Asignado | Reabierto | EnProgreso → ProveedorAsignado
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
  PendienteAutorizacion,
  Presupuestado,
  PresupuestoAprobado,
} = TicketStatus;

export const ticketMachine = defineStateMachine<TicketStatus>([
  [Abierto, [Asignado, Cancelado, ProveedorAsignado, PendienteAutorizacion, Presupuestado]],
  [Asignado, [EnProgreso, Abierto, Cancelado, ProveedorAsignado, PendienteAutorizacion, Presupuestado]],
  [EnProgreso, [Resuelto, Cancelado, ProveedorAsignado]],
  [Resuelto, [Cerrado, Reabierto]],
  [Cerrado, [Reabierto]],
  [Cancelado, []], // terminal
  [Reabierto, [Asignado, Cancelado, ProveedorAsignado, PendienteAutorizacion, Presupuestado]],
  // Provider states
  [ProveedorAsignado, [ProveedorEnCamino, EnProgreso, Cancelado]],
  [ProveedorEnCamino, [TrabajoRealizado, ProveedorAsignado]],
  [TrabajoRealizado, [Resuelto, EnProgreso]],
  // Incidencias: autorización, presupuesto y aprobación
  [PendienteAutorizacion, [Presupuestado, Cancelado]],
  [Presupuestado, [PresupuestoAprobado, Cancelado]],
  [PresupuestoAprobado, [ProveedorAsignado, EnProgreso, Cancelado]],
]);

/**
 * Check whether a ticket state transition is valid.
 */
export function validateTicketTransition(
  from: TicketStatus,
  to: TicketStatus,
): boolean {
  return ticketMachine.canTransition(from, to);
}

/**
 * Return the list of valid next states for a given ticket status.
 * Returns an empty array if the state is terminal or the input is invalid.
 */
export function getValidTicketTransitions(
  from: TicketStatus,
): TicketStatus[] {
  return ticketMachine.allowedFrom(from);
}
