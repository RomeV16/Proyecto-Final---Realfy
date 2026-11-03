import { Injectable } from '@nestjs/common';
import { LiquidacionStatus, Money, OVERDUE_STATUSES, formatMoneyAR, formatPeriodShortAR } from '@realfy/shared';
import { PenaltiesService } from '../penalties/penalties.service';
import { isOverdue, outstandingBalance } from '../liquidaciones/receivables';

/** Cliente o transacción de Prisma. */
type Db = any;

/** Liquidaciones ya entregadas al inquilino: las que pueden deberse o ya se pagaron. */
const BILLED_STATUSES = [LiquidacionStatus.Enviada, LiquidacionStatus.Vencida, LiquidacionStatus.Pagada];

/** Una liquidación con saldo, con lo que se debe hoy. */
export interface DebtLiquidacion {
  id: string;
  period: Date;
  dueDate: Date;
  currency: string;
  /** Saldo: total menos pagos. */
  balance: Money;
  /** Punitorio devengado a hoy que todavía no se condonó ni se cobró en otra liquidación. */
  penalty: Money;
  /** Lo que hay que pagar hoy: saldo más punitorio. */
  total: Money;
  overdue: boolean;
}

/** La deuda vencida de un contrato a un día. */
export interface ContractDebt {
  contractId: string;
  currency: string;
  /** Todas las liquidaciones con saldo, vencidas o por vencer, de la más vieja a la más nueva. */
  unpaid: DebtLiquidacion[];
  overdue: DebtLiquidacion[];
  /** Hay una liquidación entregada posterior al vencimiento impago más viejo (paga o no). */
  nextRentBilled: boolean;
  /** Saldo vencido, sin punitorios. */
  balance: Money;
  /** Lo que debe hoy: saldo vencido más punitorios. */
  payoff: Money;
  oldestDue: Date | null;
}

/** «$ 1.234,56» al estilo de los mensajes: moneda y monto. */
export function formatDebtAmount(currency: string, amount: Money | string): string {
  return `${currency} ${formatMoneyAR(amount.toString())}`;
}

/** Períodos de las liquidaciones vencidas, en orden y sin repetir: «03/2026». */
export function overduePeriods(debt: Pick<ContractDebt, 'overdue'>): string[] {
  return [...new Set(debt.overdue.map((l) => formatPeriodShortAR(l.period)))];
}

/**
 * Lee la deuda de un contrato: saldo de cada liquidación entregada y lo que se
 * debe hoy con los punitorios (el mismo importe que `GET /liquidaciones/:id/payoff`).
 */
@Injectable()
export class CollectionDebtService {
  constructor(private readonly penalties: PenaltiesService) {}

  /** Contratos con al menos una liquidación vencida con saldo a `today`, en orden estable. */
  async overdueContractIds(db: Db, today: Date): Promise<string[]> {
    const rows = await db.liquidacion.findMany({
      where: { status: { in: [...OVERDUE_STATUSES] }, dueDate: { lt: today } },
      select: { contractId: true, total: true, status: true, dueDate: true, payments: { select: { amount: true } } },
    });
    const ids = new Set<string>();
    for (const row of rows as any[]) {
      if (outstandingBalance({ total: row.total.toString(), payments: row.payments }).gt(0)) ids.add(row.contractId);
    }
    return [...ids].sort((a, b) => a.localeCompare(b));
  }

  async loadDebt(db: Db, tenantId: string, contractId: string, today: Date): Promise<ContractDebt> {
    const rows: any[] = await db.liquidacion.findMany({
      where: { contractId, status: { in: BILLED_STATUSES } },
      select: {
        id: true,
        tenantId: true,
        period: true,
        dueDate: true,
        status: true,
        total: true,
        currency: true,
        payments: { select: { amount: true, paidAt: true } },
        lineItems: { select: { type: true, amount: true, sourceType: true, sourceId: true } },
      },
      orderBy: [{ dueDate: 'asc' }, { id: 'asc' }],
    });

    const open = rows.filter(
      (r) =>
        (OVERDUE_STATUSES as readonly string[]).includes(r.status) &&
        outstandingBalance({ total: r.total.toString(), payments: r.payments }).gt(0),
    );
    const ctx = open.some((r) => isOverdue(r, today))
      ? await this.penalties.loadContext(tenantId, contractId, today)
      : null;

    const unpaid: DebtLiquidacion[] = [];
    for (const r of open) {
      const balance = outstandingBalance({ total: r.total.toString(), payments: r.payments });
      const overdue = isOverdue(r, today);
      const penalty =
        overdue && ctx ? (await this.penalties.payoffOf(db, { ...r, tenantId }, ctx, today)).due : new Money(0);
      unpaid.push({
        id: r.id,
        period: r.period,
        dueDate: r.dueDate,
        currency: r.currency,
        balance,
        penalty,
        total: balance.plus(penalty),
        overdue,
      });
    }

    const overdue = unpaid.filter((l) => l.overdue);
    const oldestDue = overdue[0]?.dueDate ?? null;
    const nextRentBilled =
      oldestDue !== null && rows.some((r) => r.dueDate.getTime() > oldestDue.getTime());
    return {
      contractId,
      currency: overdue[0]?.currency ?? 'ARS',
      unpaid,
      overdue,
      nextRentBilled,
      balance: overdue.reduce((acc, l) => acc.plus(l.balance), new Money(0)),
      payoff: overdue.reduce((acc, l) => acc.plus(l.total), new Money(0)),
      oldestDue,
    };
  }
}
