import { ChargeTarget, ChargePayer, LiquidacionStatus, Money, MoveOutItemKind, OVERDUE_STATUSES, PendingChargeKind, PendingChargeStatus, RECEIVABLE_STATUSES, formatPeriodAR, lastMonthRent, rentAt, round2 } from '@realfy/shared';
import type { ProrationMode, RentStep } from '@realfy/shared';
import type { MoveOutItem } from '@realfy/shared';
import { badRequest } from '../cash/cash.errors';
import { outstandingBalance } from '../liquidaciones/receivables';
import type { PenaltiesService } from '../penalties/penalties.service';

type Db = any;

/** Pasa un importe a la moneda de la liquidación; si es otra moneda hace falta el cambio. */
export function convertItemAmount(
  amount: Money,
  from: string,
  to: string,
  rate: string | null | undefined,
): Money {
  if (from === to) return amount;
  if (!rate) throw badRequest('RATE_REQUIRED', `An exchange rate is required to convert ${from} into ${to}`);
  return round2(amount.times(rate));
}

const item = (
  kind: MoveOutItemKind,
  description: string,
  amount: Money,
  sourceType: string,
  sourceId: string,
): MoveOutItem => ({ kind, description, amount: round2(amount).toFixed(2), included: true, sourceType, sourceId });

/**
 * Lo que el inquilino debe en `asOf` según el sistema: alquileres sin cobrar, punitorios devengados
 * a esa fecha, partes suyas de boletas todavía sin facturar y cargos pendientes (reparaciones y
 * otros). Los descuentos (pintura, faltantes) los carga el equipo a mano. Todo queda en `currency`.
 */
export async function collectMoveOutItems(
  db: Db,
  penalties: PenaltiesService,
  input: {
    tenantId: string;
    contractId: string;
    date: Date;
    currency: string;
    rate?: string | null;
    /** Para el alquiler del último mes: el contrato, sus escalones de alquiler y su convención de prorrateo. */
    lastMonth?: { startDate: Date; rentCurrency: string; rentSteps: readonly RentStep[]; prorationMode: ProrationMode | `${ProrationMode}` };
  },
): Promise<MoveOutItem[]> {
  const { tenantId, contractId, date, currency, rate } = input;
  const items: MoveOutItem[] = [];

  const liquidaciones = await db.liquidacion.findMany({
    where: { contractId, status: { in: [...RECEIVABLE_STATUSES] } },
    include: { payments: { select: { amount: true, paidAt: true } }, lineItems: { select: { type: true, amount: true, sourceType: true, sourceId: true } } },
    orderBy: [{ period: 'asc' }, { id: 'asc' }],
  });
  const overdue = new Set<string>(OVERDUE_STATUSES);
  const ctx = liquidaciones.some((l: any) => overdue.has(l.status))
    ? await penalties.loadContext(tenantId, contractId, date)
    : null;
  for (const liq of liquidaciones) {
    const balance = outstandingBalance(liq);
    if (balance.gt(0)) {
      items.push(
        item(
          MoveOutItemKind.AlquilerPendiente,
          `Liquidación ${formatPeriodAR(liq.period)}`,
          convertItemAmount(balance, liq.currency, currency, rate),
          'Liquidacion',
          liq.id,
        ),
      );
    }
    if (ctx && overdue.has(liq.status)) {
      const { due } = await penalties.payoffOf(db, { ...liq, tenantId }, ctx, date);
      if (due.gt(0)) {
        items.push(
          item(
            MoveOutItemKind.Punitorio,
            `Punitorio de ${formatPeriodAR(liq.period)} al egreso`,
            convertItemAmount(due, liq.currency, currency, rate),
            'Liquidacion',
            liq.id,
          ),
        );
      }
    }
  }

  // El último mes, el del egreso, si todavía no tiene liquidación: del día 1 al día de egreso con la
  // convención de prorrateo del contrato. Es una propuesta editable.
  const lm = input.lastMonth;
  if (lm && date.getTime() >= lm.startDate.getTime()) {
    const monthStart = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1));
    const billed = await db.liquidacion.findFirst({
      where: { contractId, period: monthStart, status: { not: LiquidacionStatus.Anulada } },
      select: { id: true },
    });
    if (!billed) {
      const part = lastMonthRent({ monthlyRent: rentAt(lm.rentSteps, date).toFixed(2), moveOutDate: date, prorationMode: lm.prorationMode });
      if (part.amount.gt(0)) {
        items.push(
          item(
            MoveOutItemKind.AlquilerPendiente,
            `Alquiler de ${formatPeriodAR(monthStart)} (${part.coveredDays} de ${part.baseDays} días)`,
            convertItemAmount(part.amount, lm.rentCurrency, currency, rate),
            'LastMonthRent',
            monthStart.toISOString().slice(0, 10),
          ),
        );
      }
    }
  }

  const allocations = await db.serviceBillAllocation.findMany({
    where: { contractId, payer: ChargePayer.Inquilino, billedAt: null },
    include: { bill: { include: { service: { select: { serviceType: true, providerName: true } } } } },
    orderBy: [{ chargePeriod: 'asc' }, { id: 'asc' }],
  });
  for (const a of allocations) {
    items.push(
      item(
        MoveOutItemKind.Servicio,
        `${a.bill.service.serviceType}${a.bill.service.providerName ? ` (${a.bill.service.providerName})` : ''} ${formatPeriodAR(a.bill.period)}`,
        convertItemAmount(new Money(a.amount.toString()), a.bill.currency, currency, rate),
        'ServiceBillAllocation',
        a.id,
      ),
    );
  }

  const charges = await db.pendingCharge.findMany({
    where: { contractId, chargedTo: ChargeTarget.Inquilino, status: PendingChargeStatus.Pendiente },
    orderBy: [{ incurredAt: 'asc' }, { id: 'asc' }],
  });
  for (const c of charges) {
    items.push(
      item(
        c.kind === PendingChargeKind.Reparacion ? MoveOutItemKind.Reparacion : MoveOutItemKind.Cargo,
        c.description,
        convertItemAmount(new Money(c.amount.toString()), c.currency, currency, rate),
        'PendingCharge',
        c.id,
      ),
    );
  }
  return items;
}
