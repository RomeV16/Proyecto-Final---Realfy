import { BadRequestException } from '@nestjs/common';
import type { StateMachine } from '@realfy/shared';

/**
 * Verifica una transición contra su máquina de estados. Si no está permitida
 * lanza 400 con el código de dominio `INVALID_TRANSITION` (ADR-0005) y los
 * destinos válidos desde el estado actual, para que el cliente pueda ofrecerlos.
 */
export function assertTransition<S extends string>(
  machine: StateMachine<S> | undefined,
  from: S,
  to: S,
): void {
  if (machine?.canTransition(from, to)) return;
  throw new BadRequestException({
    error: 'INVALID_TRANSITION',
    message: `Cannot transition from ${from} to ${to}`,
    currentState: from,
    attemptedState: to,
    validTransitions: machine?.allowedFrom(from) ?? [],
  });
}
