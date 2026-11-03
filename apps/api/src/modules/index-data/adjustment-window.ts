import { IndexType, ScheduleStatus, SkippedAdjustmentsMode, addMonthsClamped } from '@realfy/shared';
import { getTermsAt } from '../contracts/contract-terms';

/**
 * Período de índices que corresponde a un ajuste (DEF-07, DEF-137).
 *
 * Arranca en la fecha desde la que rige el alquiler vigente, porque la base del
 * cálculo es ese alquiler y ya incluye todo lo anterior: si la ventana
 * arrancara siempre en el inicio del contrato, cada ajuste volvería a cobrar la
 * inflación que los anteriores ya trasladaron. Esa fecha es, en orden:
 *
 * 1. el último ajuste aplicado, del cronograma o del historial (un contrato
 *    importado puede traer ajustes posteriores al fin pactado);
 * 2. sin ajustes, el último período salteado al importar, porque el alquiler
 *    importado ya viene actualizado (salvo que el contrato pacte recuperar esa
 *    inflación, `skippedAdjustmentsMode`); los períodos salteados dentro de los
 *    meses fijos iniciales no cuentan, el alquiler no cambia en ellos;
 * 3. si no hay nada de eso, el inicio del contrato.
 */
export interface AdjustmentWindow {
  from: Date;
  until: Date;
  /** `from` es la fecha de un ajuste ya aplicado, no el inicio del contrato. */
  afterPrevious: boolean;
}

type ScheduleClient = {
  adjustmentSchedule: { findFirst: (args: any) => Promise<any> };
  contractAdjustment: { findFirst: (args: any) => Promise<any> };
  contractTermsVersion: { findFirst: (args: any) => Promise<any> };
  contractPeriod?: { findFirst: (args: any) => Promise<any> };
};

export async function resolveAdjustmentWindow(
  client: ScheduleClient,
  contract: { id: string; tenantId: string; startDate: Date },
  until: Date,
): Promise<AdjustmentWindow> {
  const scope = { tenantId: contract.tenantId, contractId: contract.id };
  const previous = await client.adjustmentSchedule.findFirst({
    where: { ...scope, status: ScheduleStatus.Applied, nextAdjustmentDate: { lt: until } },
    orderBy: { nextAdjustmentDate: 'desc' },
  });
  const adjusted = await client.contractAdjustment.findFirst({
    where: { ...scope, adjustmentDate: { lt: until } },
    orderBy: { adjustmentDate: 'desc' },
  });
  const appliedDates: Date[] = [previous?.nextAdjustmentDate, adjusted?.adjustmentDate].filter(Boolean);
  if (appliedDates.length > 0) {
    const from = appliedDates.reduce((a, b) => (b > a ? b : a));
    return { from, until, afterPrevious: true };
  }

  const wholeContract: AdjustmentWindow = { from: contract.startDate, until, afterPrevious: false };
  const terms = await getTermsAt(client, contract, until);
  if (terms?.skippedAdjustmentsMode === SkippedAdjustmentsMode.Recuperar) return wholeContract;

  const fixedMonths: number = terms?.fixedInitialMonths ?? 0;
  const minDate = fixedMonths > 0 ? await fixedInitialEnd(client, contract, until, fixedMonths) : null;
  const skipped = await client.adjustmentSchedule.findFirst({
    where: {
      ...scope,
      status: ScheduleStatus.Skipped,
      nextAdjustmentDate: { lt: until, ...(minDate && { gte: minDate }) },
    },
    orderBy: { nextAdjustmentDate: 'desc' },
  });
  return skipped ? { from: skipped.nextAdjustmentDate, until, afterPrevious: true } : wholeContract;
}

/** Fin de los meses fijos del tramo vigente a la fecha: antes de él un período salteado no cuenta. */
async function fixedInitialEnd(
  client: ScheduleClient,
  contract: { id: string; tenantId: string; startDate: Date },
  until: Date,
  fixedMonths: number,
): Promise<Date> {
  const period = client.contractPeriod
    ? await client.contractPeriod.findFirst({
        where: { tenantId: contract.tenantId, contractId: contract.id, startDate: { lte: until } },
        orderBy: { startDate: 'desc' },
      })
    : null;
  return addMonthsClamped(period?.startDate ?? contract.startDate, fixedMonths);
}

/**
 * Las series de variación mensual (IPC, CVS, CER) dejan afuera el mes del
 * ajuste anterior, que ya entró en ese cálculo. Las de nivel (ICL, UVA) lo
 * incluyen, porque el cociente se toma contra el valor en esa fecha.
 */
export function excludesWindowStart(window: AdjustmentWindow, indexType: IndexType): boolean {
  return window.afterPrevious && indexType !== IndexType.ICL && indexType !== IndexType.UVA;
}
