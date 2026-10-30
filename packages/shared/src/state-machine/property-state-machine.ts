import { PropertyOperationType, PropertyState } from '../enums';
import { defineStateMachine, type StateMachine } from './define';

/**
 * State machine transition map, keyed by operation type.
 * Each operation type maps current state → array of valid next states.
 *
 * Design: per-operation-type graphs (Decision D021).
 * - Venta: linear to terminal Vendido, with Suspendido toggle and Archivado escape
 * - Alquiler: cyclical (Alquilado→Disponible for lease renewal), Suspendido toggle, Archivado escape
 * - Temporario: cyclical (Ocupado→Disponible for short-term turnover), Suspendido toggle, Archivado escape
 */

const { Venta, Alquiler, Temporario } = PropertyOperationType;
const {
  Borrador,
  Disponible,
  Reservado,
  Alquilado,
  Vendido,
  Ocupado,
  Suspendido,
  Archivado,
} = PropertyState;

const PROPERTY_MACHINES = new Map<PropertyOperationType, StateMachine<PropertyState>>([
  // ─── Venta ──────────────────────────────────────────
  // Borrador → Disponible → Reservado → Vendido (terminal)
  // Disponible ↔ Suspendido
  // Any (except Vendido) → Archivado
  [
    Venta,
    defineStateMachine<PropertyState>([
      [Borrador, [Disponible, Archivado]],
      [Disponible, [Reservado, Suspendido, Archivado]],
      [Reservado, [Disponible, Vendido, Archivado]],
      [Vendido, []], // terminal — no transitions out
      [Suspendido, [Disponible, Archivado]],
      [Archivado, []], // terminal for all types
    ]),
  ],

  // ─── Alquiler ───────────────────────────────────────
  // Borrador → Disponible → Reservado → Alquilado → Disponible (cycle)
  // Disponible ↔ Suspendido
  // Any → Archivado
  [
    Alquiler,
    defineStateMachine<PropertyState>([
      [Borrador, [Disponible, Archivado]],
      [Disponible, [Reservado, Suspendido, Archivado]],
      [Reservado, [Disponible, Alquilado, Archivado]],
      [Alquilado, [Disponible, Archivado]], // lease-end cycle
      [Suspendido, [Disponible, Archivado]],
      [Archivado, []], // terminal for all types
    ]),
  ],

  // ─── Temporario ─────────────────────────────────────
  // Borrador → Disponible → Ocupado → Disponible (cycle)
  // Disponible ↔ Suspendido
  // Any → Archivado
  [
    Temporario,
    defineStateMachine<PropertyState>([
      [Borrador, [Disponible, Archivado]],
      [Disponible, [Ocupado, Suspendido, Archivado]],
      [Ocupado, [Disponible, Archivado]], // short-term turnover cycle
      [Suspendido, [Disponible, Archivado]],
      [Archivado, []], // terminal for all types
    ]),
  ],
]);

export const PROPERTY_TRANSITIONS: Map<
  PropertyOperationType,
  Map<PropertyState, PropertyState[]>
> = new Map(
  [...PROPERTY_MACHINES].map(([op, machine]) => [
    op,
    machine.transitions as Map<PropertyState, PropertyState[]>,
  ]),
);

/** Máquina de estados de un tipo de operación, o `undefined` si el tipo no existe. */
export function getPropertyMachine(
  opType: PropertyOperationType,
): StateMachine<PropertyState> | undefined {
  return PROPERTY_MACHINES.get(opType);
}

/**
 * Check whether a state transition is valid for a given operation type.
 */
export function validateTransition(
  opType: PropertyOperationType,
  from: PropertyState,
  to: PropertyState,
): boolean {
  return PROPERTY_MACHINES.get(opType)?.canTransition(from, to) ?? false;
}

/**
 * Return the list of valid next states for a given operation type and current state.
 * Returns an empty array if the state is terminal or the inputs are invalid.
 */
export function getValidTransitions(
  opType: PropertyOperationType,
  from: PropertyState,
): PropertyState[] {
  return PROPERTY_MACHINES.get(opType)?.allowedFrom(from) ?? [];
}

/**
 * Return the shortest sequence of states that leads from `from` to `to` for a
 * given operation type, without `from` and ending in `to`. An empty array means
 * the operation is already in `to`; `null` means `to` cannot be reached (for
 * example, from a terminal state).
 *
 * Lets other modules move an operation to a target state through valid
 * transitions only — e.g. a signed lease takes an Alquiler operation from
 * Disponible to Alquilado through Reservado.
 */
export function findTransitionPath(
  opType: PropertyOperationType,
  from: PropertyState,
  to: PropertyState,
): PropertyState[] | null {
  if (from === to) return [];
  const machine = PROPERTY_MACHINES.get(opType);
  if (!machine) return null;

  const previous = new Map<PropertyState, PropertyState>();
  const queue: PropertyState[] = [from];
  const seen = new Set<PropertyState>([from]);

  while (queue.length > 0) {
    const current = queue.shift()!;
    for (const next of machine.allowedFrom(current)) {
      if (seen.has(next)) continue;
      seen.add(next);
      previous.set(next, current);
      if (next === to) {
        const path: PropertyState[] = [to];
        let step = current;
        while (step !== from) {
          path.unshift(step);
          step = previous.get(step)!;
        }
        return path;
      }
      queue.push(next);
    }
  }

  return null;
}
