import { PropertyState, getPropertyMachine } from '@realfy/shared';
import { assertTransition } from '../../common/errors/assert-transition';

/** Lo mínimo de una operación de propiedad que hace falta para moverla de estado. */
export interface OperationRef {
  id: string;
  operationType: string;
  state: string;
}

/**
 * Pasa una operación de propiedad a `to` validando la transición contra la
 * máquina de estados de su tipo y escribe el nuevo estado. Es el único lugar
 * que cambia `propertyOperation.state` por una transición: lo usan tanto el
 * endpoint de transición como la activación de un contrato.
 *
 * `db` es el cliente de Prisma o una transacción.
 */
export async function applyOperationTransition(
  db: any,
  operation: OperationRef,
  to: PropertyState,
): Promise<any> {
  assertTransition(
    getPropertyMachine(operation.operationType as any),
    operation.state as PropertyState,
    to,
  );
  return db.propertyOperation.update({
    where: { id: operation.id },
    data: { state: to as any },
  });
}
