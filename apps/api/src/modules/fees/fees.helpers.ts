import { Prisma } from '@prisma/client';
import { FeeEngineError, FeeInstallmentStatus, adjustInstallments, personName } from '@realfy/shared';
import type { RentChange } from '@realfy/shared';
import Decimal from 'decimal.js';
import { badRequest } from '../cash/cash.errors';

type Db = any;

/** Un error del motor de honorarios pasa a 400 con su código; los demás se relanzan. */
export function rethrowFeeEngine(error: unknown): never {
  if (error instanceof FeeEngineError) throw badRequest(error.code, error.message);
  throw error;
}

/** "YYYY-MM" -> [primer día del mes, primer día del mes siguiente). */
export function monthRange(period: string): { gte: Date; lt: Date } {
  const [y, m] = period.split('-').map(Number);
  return { gte: new Date(Date.UTC(y, m - 1, 1)), lt: new Date(Date.UTC(y, m, 1)) };
}

export const PERSON_SELECT = { select: { id: true, firstName: true, lastName: true } } as const;

export const FEE_INCLUDE = {
  payer: PERSON_SELECT,
  contract: { select: { id: true, propertyId: true, status: true, property: { select: { id: true, title: true } } } },
  contractPeriod: { select: { id: true, seq: true, kind: true, startDate: true, endDate: true } },
  property: { select: { id: true, title: true } },
  installmentRows: {
    orderBy: { n: 'asc' as const },
    include: { receipt: { select: { id: true, series: true, number: true } } },
  },
  shares: { orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }] },
  staffCommissions: {
    orderBy: [{ createdAt: 'asc' as const }, { id: 'asc' as const }],
    include: { user: { select: { id: true, firstName: true, lastName: true } }, person: PERSON_SELECT },
  },
} satisfies Prisma.FeeInclude;

/** Ajustes aplicados del contrato como cambios de alquiler: la corrección reemplaza al provisorio del mismo período. */
export async function loadRentChanges(db: Db, contractIds: string[]): Promise<Map<string, RentChange[]>> {
  const out = new Map<string, RentChange[]>();
  if (contractIds.length === 0) return out;
  const rows: any[] = await db.contractAdjustment.findMany({
    where: { contractId: { in: contractIds }, appliedAt: { not: null } },
    orderBy: [{ contractId: 'asc' }, { periodNumber: 'asc' }, { isProvisional: 'asc' }],
    select: { contractId: true, periodNumber: true, adjustmentDate: true, newAmount: true, isProvisional: true },
  });
  const seen = new Set<string>();
  for (const row of rows) {
    const key = `${row.contractId}:${row.periodNumber}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const list = out.get(row.contractId) ?? [];
    list.push({ date: new Date(row.adjustmentDate), rent: String(row.newAmount) });
    out.set(row.contractId, list);
  }
  return out;
}

/** Tramo que cubre el honorario: el período indicado o el original del contrato. */
export async function loadReference(db: Db, fee: { contractId: string | null; contractPeriodId: string | null }) {
  if (!fee.contractId) return null;
  const period = fee.contractPeriodId
    ? await db.contractPeriod.findFirst({ where: { id: fee.contractPeriodId } })
    : await db.contractPeriod.findFirst({ where: { contractId: fee.contractId }, orderBy: { seq: 'asc' } });
  if (period) return { date: new Date(period.startDate), rent: String(period.initialRent) };
  const contract = await db.contract.findFirst({ where: { id: fee.contractId }, select: { startDate: true, rentAmount: true } });
  return contract ? { date: new Date(contract.startDate), rent: String(contract.rentAmount) } : null;
}

/**
 * Importe a cobrar de cada cuota pendiente: si el honorario sigue los ajustes
 * del alquiler, el importe ajustado (fee-engine); si no, el de la cuota. Las
 * cobradas muestran lo que se cobró.
 */
export function dueAmounts(
  fee: { adjustInstallments: boolean; installmentRows: any[] },
  reference: { date: Date; rent: string } | null,
  changes: RentChange[],
): Map<number, string> {
  const out = new Map<number, string>();
  const pending = fee.installmentRows.filter((i) => i.status === FeeInstallmentStatus.Pendiente);
  let adjusted: Map<number, string> | null = null;
  if (fee.adjustInstallments && reference && new Decimal(reference.rent).gt(0) && pending.length > 0) {
    adjusted = new Map(
      adjustInstallments(
        pending.map((i) => ({ n: i.n, dueDate: new Date(i.dueDate), amount: String(i.amount) })),
        { referenceDate: reference.date, referenceRent: reference.rent, changes },
      ).map((a) => [a.n, a.adjustedAmount.toFixed(2)]),
    );
  }
  for (const i of fee.installmentRows) {
    if (i.status === FeeInstallmentStatus.Pagada) out.set(i.n, new Decimal(String(i.paidAmount ?? i.amount)).toFixed(2));
    else out.set(i.n, adjusted?.get(i.n) ?? new Decimal(String(i.amount)).toFixed(2));
  }
  return out;
}

/** Honorario listo para la respuesta: cada cuota con `dueAmount` y el nombre de quien paga. */
export function presentFee(fee: any, due: Map<number, string>) {
  return {
    ...fee,
    payerName: fee.payer ? personName(fee.payer) : null,
    installmentRows: (fee.installmentRows ?? []).map((i: any) => ({ ...i, dueAmount: due.get(i.n) ?? null })),
    staffCommissions: (fee.staffCommissions ?? []).map((c: any) => ({
      ...c,
      beneficiaryName: c.user ? personName(c.user) : c.person ? personName(c.person) : null,
    })),
  };
}

const KIND_LABEL: Record<string, string> = {
  AltaAlquiler: 'alta de alquiler',
  Renovacion: 'renovación',
  Venta: 'venta',
  Tasacion: 'tasación',
  GestionReparacion: 'gestión de reparación',
};

/** Texto de una cuota: "Honorarios de renovación, cuota 2/3". */
export function installmentLabel(fee: { kind: string; installments: number }, n: number): string {
  const suffix = fee.installments > 1 ? `, cuota ${n}/${fee.installments}` : '';
  return `Honorarios de ${KIND_LABEL[fee.kind] ?? fee.kind}${suffix}`;
}
