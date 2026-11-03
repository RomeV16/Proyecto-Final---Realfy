import { createHash } from 'crypto';
import { lessorInvoiceKey } from '@realfy/shared';

type Db = any;

export type LessorInvoiceSourceType = 'Payment' | 'OwnerStatement';

/** UUID estable derivado de la clave: ARCA y la base lo usan como clave de idempotencia. */
export function requestIdFor(key: string): string {
  const h = createHash('sha1').update(key).digest('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-a${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

/** Idempotencia de la factura de un origen, un locador y un contrato. */
export function invoiceRequestId(
  sourceType: LessorInvoiceSourceType,
  sourceId: string,
  personId: string,
  contractId: string,
): string {
  return requestIdFor(`${lessorInvoiceKey('Factura', sourceType, sourceId, personId)}:${contractId}`);
}

/** Idempotencia de la nota de crédito de una factura. */
export function creditNoteRequestId(comprobanteId: string): string {
  return requestIdFor(`lessor:NotaCredito:${comprobanteId}`);
}

/**
 * Deja en cola la nota de crédito de las facturas emitidas por cuenta de un locador por un origen
 * (un estado de cuenta anulado). Solo escribe en la base: la emisión la hace la cola, así que un
 * fallo de ARCA no impide anular. Devuelve cuántas notas quedaron en cola.
 */
export async function enqueueCreditNotes(
  tx: Db,
  tenantId: string,
  sourceType: LessorInvoiceSourceType,
  sourceId: string,
): Promise<number> {
  const invoiced = await tx.lessorInvoiceJob.findMany({
    where: { tenantId, sourceType, sourceId, kind: 'Factura', status: 'Emitido' },
    select: { personId: true },
    orderBy: { id: 'asc' },
  });
  if (invoiced.length === 0) return 0;
  const result = await tx.lessorInvoiceJob.createMany({
    data: invoiced.map((j: { personId: string }) => ({
      tenantId,
      personId: j.personId,
      sourceType,
      sourceId,
      kind: 'NotaCredito',
      auto: true,
    })),
    skipDuplicates: true,
  });
  return result.count;
}
