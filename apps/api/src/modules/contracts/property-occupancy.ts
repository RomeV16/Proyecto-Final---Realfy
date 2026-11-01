import {
  ContractStatus,
  ContractType,
  PropertyOperationType,
  PropertyState,
  findTransitionPath,
} from '@realfy/shared';
import { applyOperationTransition } from '../properties/operation-state';

/** Sólo el alquiler tradicional ocupa la operación de alquiler de la propiedad. */
export function occupiesRentalOperation(contractType: string): boolean {
  return contractType === ContractType.Alquiler;
}

export type OccupyResult =
  | { outcome: 'created'; operationId: string }
  | { outcome: 'moved'; operationId: string; steps: PropertyState[] }
  | { outcome: 'unchanged' }
  | { outcome: 'unreachable'; from: PropertyState };

/**
 * Deja la operación de alquiler de la propiedad en Alquilado, recorriendo
 * transiciones válidas de la máquina de estados. Si no tenía operación de
 * alquiler la crea ya alquilada. No valida el contrato: eso es de quien llama
 * (la activación o el importador). `unreachable` es que la máquina no tiene
 * camino desde el estado actual (por ejemplo, archivada).
 */
export async function occupyRentalOperation(
  tx: any,
  tenantId: string,
  propertyId: string,
): Promise<OccupyResult> {
  const operation = await tx.propertyOperation.findFirst({
    where: { propertyId, operationType: PropertyOperationType.Alquiler },
  });

  if (!operation) {
    const created = await tx.propertyOperation.create({
      data: {
        tenantId,
        propertyId,
        operationType: PropertyOperationType.Alquiler,
        state: PropertyState.Alquilado,
      },
    });
    return { outcome: 'created', operationId: created.id };
  }

  const from = operation.state as PropertyState;
  const path = findTransitionPath(PropertyOperationType.Alquiler, from, PropertyState.Alquilado);
  if (!path) return { outcome: 'unreachable', from };
  if (path.length === 0) return { outcome: 'unchanged' };

  let current: PropertyState = from;
  for (const step of path) {
    await applyOperationTransition(tx, { ...operation, state: current }, step);
    current = step;
  }
  return { outcome: 'moved', operationId: operation.id, steps: [from, ...path] };
}

/**
 * Devuelve la operación de alquiler a Disponible cuando el contrato que deja
 * de estar activo era el último alquiler activo de la propiedad. Si alguien ya
 * movió la operación a otro estado, se respeta. Devuelve la operación movida.
 */
export async function releaseRentalOperation(
  tx: any,
  contract: { id: string; propertyId: string; contractType: string },
): Promise<{ operationId: string } | null> {
  if (!occupiesRentalOperation(contract.contractType)) return null;

  const stillActive = await tx.contract.count({
    where: {
      propertyId: contract.propertyId,
      contractType: ContractType.Alquiler,
      status: ContractStatus.Activo,
      id: { not: contract.id },
    },
  });
  if (stillActive > 0) return null;

  const operation = await tx.propertyOperation.findFirst({
    where: { propertyId: contract.propertyId, operationType: PropertyOperationType.Alquiler },
  });
  if (!operation || operation.state !== PropertyState.Alquilado) return null;

  await applyOperationTransition(tx, operation, PropertyState.Disponible);
  return { operationId: operation.id };
}
