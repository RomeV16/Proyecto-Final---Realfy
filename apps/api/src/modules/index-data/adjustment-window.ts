import { IndexType, ScheduleStatus } from '@realfy/shared';

/**
 * Período de índices que corresponde a un ajuste (DEF-07).
 *
 * Arranca en el último ajuste aplicado del contrato, o en su inicio si todavía
 * no hubo ninguno, y termina en la fecha del ajuste. La base del cálculo es el
 * alquiler vigente, que ya incluye los ajustes anteriores: si la ventana
 * arrancara siempre en el inicio del contrato, cada ajuste volvería a cobrar la
 * inflación que los anteriores ya trasladaron.
 */
export interface AdjustmentWindow {
  from: Date;
  until: Date;
  /** `from` es la fecha de un ajuste ya aplicado, no el inicio del contrato. */
  afterPrevious: boolean;
}

type ScheduleClient = {
  adjustmentSchedule: { findFirst: (args: any) => Promise<any> };
};

export async function resolveAdjustmentWindow(
  client: ScheduleClient,
  contract: { id: string; tenantId: string; startDate: Date },
  until: Date,
): Promise<AdjustmentWindow> {
  const previous = await client.adjustmentSchedule.findFirst({
    where: {
      tenantId: contract.tenantId,
      contractId: contract.id,
      status: ScheduleStatus.Applied,
      nextAdjustmentDate: { lt: until },
    },
    orderBy: { nextAdjustmentDate: 'desc' },
  });

  return previous
    ? { from: previous.nextAdjustmentDate, until, afterPrevious: true }
    : { from: contract.startDate, until, afterPrevious: false };
}

/**
 * Las series de variación mensual (IPC, CVS, CER) dejan afuera el mes del
 * ajuste anterior, que ya entró en ese cálculo. Las de nivel (ICL, UVA) lo
 * incluyen, porque el cociente se toma contra el valor en esa fecha.
 */
export function excludesWindowStart(window: AdjustmentWindow, indexType: IndexType): boolean {
  return window.afterPrevious && indexType !== IndexType.ICL && indexType !== IndexType.UVA;
}
