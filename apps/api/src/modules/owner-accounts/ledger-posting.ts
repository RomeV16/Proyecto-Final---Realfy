import { ConflictException } from '@nestjs/common';
import {
  OwnerLedgerEntryType,
  formatMoneyAR,
  formatPeriodAR,
  paymentPostings,
  splitByShare,
  statementPeriodFor,
} from '@realfy/shared';
import type { SettlementResult } from '@realfy/shared';
import Decimal from 'decimal.js';
import { getLessorsAt } from '../contracts/contract-parties';

type Db = any;

/**
 * Asientos de la cuenta corriente del locador (ADR-0009), escritos dentro de la
 * transacción de la operación que los origina: un cobro, una compensación, una
 * entrega de custodia, un pago al locador o una boleta que pagó la
 * inmobiliaria. Cada asiento tiene origen (`sourceType`/`sourceId`) y es único
 * por origen, persona y concepto: volver a asentar el mismo origen no duplica.
 */

export interface NewLedgerEntry {
  personId: string;
  type: OwnerLedgerEntryType;
  amount: Decimal.Value;
  currency: string;
  date: Date;
  description: string;
  sourceType: string;
  sourceId: string;
  contractId?: string | null;
  propertyId?: string | null;
  /** Mes del estado; por defecto, el de la fecha según el día de cierre. */
  period?: Date;
}

export interface PostingContext {
  tenantId: string;
  /** Día de cierre del estado (`ownerAccounts.statementCloseDay`); null = fin de mes. */
  closeDay: number | null;
  userId?: string | null;
}

/** "YYYY-MM-DD" o fecha -> medianoche UTC de ese día. */
const dayOf = (value: Date | string): Date =>
  new Date(`${(typeof value === 'string' ? value : value.toISOString()).slice(0, 10)}T00:00:00.000Z`);

/** Escribe los asientos (los de importe cero no) y omite los que ya existían con el mismo origen. */
export async function writeEntries(tx: Db, ctx: PostingContext, entries: NewLedgerEntry[]): Promise<number> {
  const data = entries
    .filter((e) => !new Decimal(e.amount).isZero())
    .map((e) => ({
      tenantId: ctx.tenantId,
      personId: e.personId,
      contractId: e.contractId ?? null,
      propertyId: e.propertyId ?? null,
      date: dayOf(e.date),
      period: e.period ?? statementPeriodFor(dayOf(e.date), ctx.closeDay),
      type: e.type,
      amount: new Decimal(e.amount).toFixed(2),
      currency: e.currency,
      description: e.description,
      sourceType: e.sourceType,
      sourceId: e.sourceId,
      createdById: ctx.userId ?? null,
    }));
  if (data.length === 0) return 0;
  const result = await tx.ownerLedgerEntry.createMany({ data, skipDuplicates: true });
  return result.count;
}

/**
 * Borra los asientos de un origen que todavía no están en un estado emitido. Si
 * alguno ya está en un estado emitido, no se toca nada: hay que anular el
 * estado primero.
 */
export async function removeEntries(tx: Db, sourceType: string, sourceIds: string[]): Promise<number> {
  if (sourceIds.length === 0) return 0;
  const where = { sourceType, sourceId: { in: sourceIds } };
  const locked = await tx.ownerLedgerEntry.count({ where: { ...where, statementId: { not: null } } });
  if (locked > 0) {
    throw new ConflictException({
      error: 'OWNER_LEDGER_LOCKED',
      message: 'The lessor statement that includes these entries was issued: annul it first',
    });
  }
  const result = await tx.ownerLedgerEntry.deleteMany({ where });
  return result.count;
}

// ─── Cobros ─────────────────────────────────────────────

const PAYMENT_LABEL: Partial<Record<OwnerLedgerEntryType, string>> = {
  [OwnerLedgerEntryType.Alquiler]: 'Alquiler',
  [OwnerLedgerEntryType.Punitorio]: 'Punitorios',
  [OwnerLedgerEntryType.ReintegroImpuesto]: 'Reintegro de impuestos y servicios',
  [OwnerLedgerEntryType.Ajuste]: 'Otros conceptos',
  [OwnerLedgerEntryType.Comision]: 'Comisión',
  [OwnerLedgerEntryType.Honorario]: 'Gastos administrativos',
  [OwnerLedgerEntryType.CobroDirecto]: 'Cobrado directamente del inquilino',
};

/**
 * Asientos de un cobro con reparto (settlement-engine): los conceptos de cada
 * locador y, si cobró el locador, lo que ya tiene en mano. Un cobro sin reparto
 * (por ejemplo, locadores que no suman 100) no deja asientos: queda para revisar.
 */
export async function postPayment(
  tx: Db,
  ctx: PostingContext,
  input: {
    payment: { id: string; paidAt: Date };
    liquidacion: { period: Date; currency: string; lineItems: { amount: unknown; beneficiary: string; type: string }[] };
    contract: { id: string; propertyId: string };
    settlement: SettlementResult;
  },
): Promise<number> {
  const { payment, liquidacion, contract, settlement } = input;
  const postings = paymentPostings({
    flow: settlement.flow,
    lines: liquidacion.lineItems.map((li) => ({ amount: String(li.amount), beneficiary: li.beneficiary, type: li.type })),
    buckets: settlement.buckets,
    positions: settlement.positions,
  });
  const month = formatPeriodAR(liquidacion.period);
  return writeEntries(
    tx,
    ctx,
    postings.map((p) => {
      let description = `${PAYMENT_LABEL[p.type] ?? p.type} ${month}`;
      if (p.type === OwnerLedgerEntryType.CobroDirecto && p.keptForEnte && !p.keptForEnte.isZero()) {
        description += ` (cobró ${formatMoneyAR(p.received!.toFixed(2))}; retiene ${formatMoneyAR(p.keptForEnte.toFixed(2))} para pagar entes)`;
      }
      return {
        personId: p.personId,
        type: p.type,
        amount: p.amount.toFixed(2),
        currency: liquidacion.currency,
        date: payment.paidAt,
        description,
        sourceType: 'Payment',
        sourceId: payment.id,
        contractId: contract.id,
        propertyId: contract.propertyId,
      };
    }),
  );
}

// ─── Compensaciones ─────────────────────────────────────

/**
 * Una compensación: `from` cobró dinero que era de `to`. En la cuenta de `from`
 * resta (lo tiene en mano) y en la de `to` suma (la inmobiliaria se lo debe).
 * Si se pagó con la custodia de `from`, el asiento es el mismo: su custodia era
 * parte de su saldo.
 */
export async function postCompensation(
  tx: Db,
  ctx: PostingContext,
  input: {
    compensation: { id: string; fromLessorId: string; toLessorId: string; amount: unknown; currency: string };
    contract: { id: string; propertyId: string };
    period: Date;
    date: Date;
    names: { from: string; to: string };
  },
): Promise<number> {
  const { compensation, contract } = input;
  const amount = new Decimal(String(compensation.amount));
  const month = formatPeriodAR(input.period);
  const common = {
    type: OwnerLedgerEntryType.Compensacion,
    currency: compensation.currency,
    date: input.date,
    sourceType: 'Compensation',
    sourceId: compensation.id,
    contractId: contract.id,
    propertyId: contract.propertyId,
  };
  return writeEntries(tx, ctx, [
    {
      ...common,
      personId: compensation.fromLessorId,
      amount: amount.negated(),
      description: `Compensación: cobró la parte de ${input.names.to} (${month})`,
    },
    {
      ...common,
      personId: compensation.toLessorId,
      amount,
      description: `Compensación: su parte la cobró ${input.names.from} (${month})`,
    },
  ]);
}

// ─── Pagos al locador ───────────────────────────────────

/** Entrega de efectivo o transferencia al locador: baja su saldo. */
export async function postPayout(
  tx: Db,
  ctx: PostingContext,
  input: {
    personId: string;
    type: OwnerLedgerEntryType.Transferencia | OwnerLedgerEntryType.EntregaEfectivo;
    amount: Decimal.Value;
    currency: string;
    date: Date;
    movementId: string;
    description: string;
  },
): Promise<number> {
  return writeEntries(tx, ctx, [
    {
      personId: input.personId,
      type: input.type,
      amount: new Decimal(input.amount).negated(),
      currency: input.currency,
      date: input.date,
      description: input.description,
      sourceType: 'CashMovement',
      sourceId: input.movementId,
    },
  ]);
}

// ─── Boletas que pagó la inmobiliaria por el locador ────

/**
 * Una boleta cuyo traslado es "Propietario" (el inquilino la paga con el
 * alquiler y le llega al locador) y que pagó la inmobiliaria: el locador le
 * debe ese importe (PagoEnte, negativo), repartido entre los locadores del
 * contrato según su porcentaje. Si la boleta deja de estar pagada por la
 * inmobiliaria, los asientos se borran (si el estado ya se emitió, se rechaza).
 */
export async function syncServiceBillEntries(
  tx: Db,
  ctx: PostingContext,
  bill: { id: string; status: string; paidBy: string | null; paidAt: Date | null; period: Date; currency: string; installmentLabel: string },
): Promise<void> {
  const desired: NewLedgerEntry[] = [];
  if (bill.status === 'Pagada' && bill.paidBy === 'Inmobiliaria' && bill.paidAt) {
    const allocations = await tx.serviceBillAllocation.findMany({
      where: { billId: bill.id, payer: 'Propietario' },
      include: { contract: { select: { id: true, propertyId: true } } },
      orderBy: { createdAt: 'asc' },
    });
    const byPerson = new Map<string, { amount: Decimal; contractIds: Set<string>; propertyIds: Set<string> }>();
    for (const allocation of allocations) {
      const lessors = await getLessorsAt(tx, allocation.contractId, bill.period);
      const parts = splitByShare(
        new Decimal(String(allocation.amount)).negated().toFixed(2),
        lessors.map((l: any) => ({ personId: l.personId, pct: String(l.payoutPct) })),
      );
      for (const part of parts) {
        const acc = byPerson.get(part.personId) ?? { amount: new Decimal(0), contractIds: new Set(), propertyIds: new Set() };
        acc.amount = acc.amount.plus(part.amount.toFixed(2));
        acc.contractIds.add(allocation.contract.id);
        acc.propertyIds.add(allocation.contract.propertyId);
        byPerson.set(part.personId, acc);
      }
    }
    for (const [personId, acc] of byPerson) {
      desired.push({
        personId,
        type: OwnerLedgerEntryType.PagoEnte,
        amount: acc.amount,
        currency: bill.currency,
        date: bill.paidAt,
        description: `Boleta ${bill.installmentLabel} pagada por la inmobiliaria`,
        sourceType: 'ServiceBill',
        sourceId: bill.id,
        contractId: acc.contractIds.size === 1 ? [...acc.contractIds][0] : null,
        propertyId: acc.propertyIds.size === 1 ? [...acc.propertyIds][0] : null,
      });
    }
  }

  const existing: any[] = await tx.ownerLedgerEntry.findMany({ where: { sourceType: 'ServiceBill', sourceId: bill.id } });
  const same =
    existing.length === desired.filter((d) => !new Decimal(d.amount).isZero()).length &&
    existing.every((e) =>
      desired.some((d) => d.personId === e.personId && new Decimal(d.amount).eq(String(e.amount)) && dayOf(d.date).getTime() === dayOf(e.date).getTime()),
    );
  if (same) return;
  await removeEntries(tx, 'ServiceBill', [bill.id]);
  await writeEntries(tx, ctx, desired);
}
