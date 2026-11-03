import { Prisma } from '@prisma/client';
import {
  SALES_DOC_CODES,
  SalesOperationStatus,
  hasUnresolvedMoney,
  isDepositExpired,
  salesMachine,
  OPEN_SALES_STATUSES,
} from '@realfy/shared';
import { conflict, notFound } from '../cash/cash.errors';

export type Db = any;

export const PERSON_SELECT = { select: { id: true, firstName: true, lastName: true } } as const;

export const OPERATION_INCLUDE: any = {
  property: { select: { id: true, title: true, type: true, street: true, number: true, city: true } },
  agent: { select: { id: true, firstName: true, lastName: true } },
  parties: { include: { person: PERSON_SELECT }, orderBy: [{ role: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }] },
  deposits: {
    include: { payerPerson: PERSON_SELECT, holderPerson: PERSON_SELECT },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
  docs: true,
  fees: {
    select: { id: true, kind: true, status: true, payerRole: true, payerPersonId: true, total: true, currency: true, pct: true },
    orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
  },
};

/** Una reserva o seña con las marcas que la pantalla necesita: vencida hoy y dinero sin resolver. */
export function presentDeposit(deposit: any, today: Date) {
  return { ...deposit, expired: isDepositExpired(deposit, today), unresolvedMoney: hasUnresolvedMoney(deposit) };
}

/** Operación lista para la pantalla: avance de la documentación, próximo vencimiento y transiciones posibles. */
export function presentOperation(op: any, today: Date) {
  const deposits = (op.deposits ?? []).map((d: any) => presentDeposit(d, today));
  const docs = [...(op.docs ?? [])].sort((a: any, b: any) => SALES_DOC_CODES.indexOf(a.code) - SALES_DOC_CODES.indexOf(b.code));
  const required = docs.filter((d: any) => d.required);
  const expiries = deposits
    .filter((d: any) => d.kind === 'Reserva' && (d.status === 'Pendiente' || d.status === 'Recibida') && d.expiresAt)
    .map((d: any) => new Date(d.expiresAt).toISOString().slice(0, 10))
    .sort((a: string, b: string) => a.localeCompare(b));
  return {
    ...op,
    deposits,
    docs,
    docProgress: {
      done: docs.filter((d: any) => d.done).length,
      total: docs.length,
      requiredDone: required.filter((d: any) => d.done).length,
      requiredTotal: required.length,
    },
    nextExpiry: expiries[0] ?? null,
    validTransitions: salesMachine.allowedFrom(op.status as SalesOperationStatus),
  };
}

/** Bloquea la fila de la operación hasta el commit (SQL crudo: filtra por inmobiliaria a mano, ADR-0006). */
export async function lockOperation(tx: Db, tenantId: string, id: string): Promise<void> {
  const rows: { id: string }[] = await tx.$queryRaw(
    Prisma.sql`SELECT id FROM sales_operations WHERE id = ${id} AND "tenantId" = ${tenantId} FOR UPDATE`,
  );
  if (rows.length === 0) throw notFound('SALES_OPERATION_NOT_FOUND', 'Sales operation not found');
}

/** La operación, o 404. */
export async function findOperation(db: Db, id: string, include: object = OPERATION_INCLUDE) {
  const op = await db.salesOperation.findFirst({ where: { id }, include });
  if (!op) throw notFound('SALES_OPERATION_NOT_FOUND', 'Sales operation not found');
  return op;
}

/** Una operación cerrada (escriturada o cancelada) ya no se toca. */
export function assertOpen(op: { status: string }): void {
  if (!(OPEN_SALES_STATUSES as readonly string[]).includes(op.status)) {
    throw conflict('SALES_OPERATION_CLOSED', 'The sales operation is closed');
  }
}
