import {
  ChargeTarget,
  ContractStatus,
  OwnerLedgerEntryType,
  PendingChargeKind,
  PendingChargeStatus,
  repairManagementFee,
  splitByShare,
  statementPeriodRange,
} from '@realfy/shared';
import Decimal from 'decimal.js';
import { getLessorsAt } from '../contracts/contract-parties';
import type { NewLedgerEntry, PostingContext } from './ledger-posting';
import { writeEntries } from './ledger-posting';

type Db = any;

/** Un cargo al locador del centro de carga y los asientos que deja en la cuenta de cada locador. */
export interface LessorChargePosting {
  chargeId: string;
  currency: string;
  /** Locadores que lo soportan, el de mayor parte primero. */
  personIds: string[];
  entries: NewLedgerEntry[];
}

/**
 * Quién soporta un cargo al locador: el locador indicado; si no, los locadores
 * del contrato vigentes a la fecha del cargo (según su porcentaje); sin
 * contrato, los del último contrato de la unidad o, si no hay, sus titulares.
 */
async function bearersOf(tx: Db, charge: any): Promise<{ bearers: { personId: string; pct: string | null }[]; contract: any }> {
  const date: Date = charge.targetPeriod ?? charge.incurredAt;
  if (charge.lessorPersonId) return { bearers: [{ personId: charge.lessorPersonId, pct: '100' }], contract: charge.contract };
  let contract = charge.contract;
  if (!contract) {
    contract = await tx.contract.findFirst({
      where: { propertyId: charge.propertyId, status: { not: ContractStatus.Borrador }, startDate: { lte: date } },
      orderBy: { startDate: 'desc' },
      include: { commission: true },
    });
  }
  if (contract) {
    const lessors = await getLessorsAt(tx, contract.id, date);
    if (lessors.length > 0) {
      return { bearers: lessors.map((l: any) => ({ personId: l.personId, pct: String(l.payoutPct) })), contract };
    }
  }
  const owners: any[] = await tx.propertyOwnership.findMany({
    where: { propertyId: charge.propertyId, OR: [{ until: null }, { until: { gt: date } }] },
    orderBy: [{ sharePct: 'desc' }, { createdAt: 'asc' }],
  });
  const active = owners.filter((o) => !o.since || o.since.getTime() <= date.getTime());
  return { bearers: active.map((o) => ({ personId: o.personId, pct: o.sharePct?.toString() ?? null })), contract };
}

/**
 * Cargos al locador pendientes que se descuentan en el estado del mes: los de
 * imputación hasta ese mes (o sin mes) y gastados hasta el cierre. Un cargo que
 * nadie soporta (unidad sin contrato ni titulares) queda pendiente.
 *
 * Cada uno deja un `Cargo` (negativo si es un gasto, positivo si es un crédito
 * al locador) y, si es una reparación y el contrato pacta un honorario por
 * gestión (`repairMgmtFeePct`), un `Honorario` con ese porcentaje.
 */
export async function pendingLessorCharges(
  tx: Db,
  input: { period: Date; closeDay: number | null; currency?: string; chargeIds?: string[] },
): Promise<LessorChargePosting[]> {
  const { to } = statementPeriodRange(input.period, input.closeDay);
  const charges: any[] = await tx.pendingCharge.findMany({
    where: {
      chargedTo: ChargeTarget.Locador,
      status: PendingChargeStatus.Pendiente,
      incurredAt: { lte: to },
      OR: [{ targetPeriod: null }, { targetPeriod: { lte: input.period } }],
      ...(input.currency ? { currency: input.currency } : {}),
      ...(input.chargeIds ? { id: { in: input.chargeIds } } : {}),
    },
    include: { contract: { include: { commission: true } } },
    orderBy: [{ incurredAt: 'asc' }, { createdAt: 'asc' }],
  });
  const out: LessorChargePosting[] = [];
  for (const charge of charges) {
    const { bearers, contract } = await bearersOf(tx, charge);
    if (bearers.length === 0) continue;
    const amount = new Decimal(String(charge.amount));
    const label = charge.installmentOf > 1 ? `${charge.description} (cuota ${charge.installmentNo}/${charge.installmentOf})` : charge.description;
    const common = {
      currency: charge.currency,
      date: charge.incurredAt,
      period: input.period,
      sourceType: 'PendingCharge',
      sourceId: charge.id,
      contractId: charge.contractId ?? contract?.id ?? null,
      propertyId: charge.propertyId,
    };
    const entries: NewLedgerEntry[] = splitByShare(amount.negated().toFixed(2), bearers).map((part) => ({
      ...common,
      personId: part.personId,
      type: OwnerLedgerEntryType.Cargo,
      amount: part.amount.toFixed(2),
      description: label,
    }));
    const pct = contract?.commission?.repairMgmtFeePct ?? null;
    if (charge.kind === PendingChargeKind.Reparacion && amount.gt(0) && pct !== null) {
      const fee = repairManagementFee(amount.toFixed(2), String(pct));
      for (const part of splitByShare(fee.negated().toFixed(2), bearers)) {
        entries.push({
          ...common,
          personId: part.personId,
          type: OwnerLedgerEntryType.Honorario,
          amount: part.amount.toFixed(2),
          description: `Honorario por gestión (${new Decimal(String(pct)).toString()} %): ${label}`,
        });
      }
    }
    out.push({ chargeId: charge.id, currency: charge.currency, personIds: bearers.map((b) => b.personId), entries });
  }
  return out;
}

/** Asienta los cargos y los pasa a Imputado (el estado se completa después, con su id). */
export async function postLessorCharges(tx: Db, ctx: PostingContext, postings: LessorChargePosting[]): Promise<void> {
  if (postings.length === 0) return;
  await writeEntries(
    tx,
    ctx,
    postings.flatMap((p) => p.entries),
  );
  await tx.pendingCharge.updateMany({
    where: { id: { in: postings.map((p) => p.chargeId) }, status: PendingChargeStatus.Pendiente },
    data: { status: PendingChargeStatus.Imputado, imputedAt: new Date() },
  });
}
