import { Injectable } from '@nestjs/common';
import type { ContractClosureMetrics } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { daysBetween } from './daily-context';
import { isClosedStatus } from './contract-closure';

/** Liquidaciones anuladas: no llegaron a existir como obligación de pago. */
const VOID_LIQUIDACION_STATUS = 'Anulada';

/** Rendiciones que efectivamente salieron hacia el propietario. */
const ISSUED_RENDICION_STATUSES = ['Aprobada', 'Enviada', 'Depositada'];

/** Reclamos que se cerraron con el trabajo hecho. */
const RESOLVED_TICKET_STATUSES = ['Resuelto', 'Cerrado'];

/** Reclamos que se dieron de baja sin trabajo. */
const CANCELLED_TICKET_STATUS = 'Cancelado';

/** Punitorios que se perdonaron y no pesan sobre el historial de pago. */
const WAIVED_PENALTY_STATUS = 'waived';

function toNumber(value: unknown): number {
  return Math.round(Number(value ?? 0) * 100) / 100;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}

/** Meses enteros entre dos fechas, contando sólo los meses completos. */
function monthsBetween(from: Date, to: Date): number {
  let months =
    (to.getUTCFullYear() - from.getUTCFullYear()) * 12 +
    (to.getUTCMonth() - from.getUTCMonth());
  if (to.getUTCDate() < from.getUTCDate()) months -= 1;
  return Math.max(0, months);
}

/**
 * Métricas de gestión de un contrato cerrado.
 *
 * Todo lo que después se redacta sale de acá, y sale calculado: se leen los
 * registros reales del contrato — liquidaciones con sus pagos, punitorios,
 * reclamos de la propiedad durante la vigencia, ajustes aplicados y rendiciones
 * emitidas — y se los reduce a una grilla de números. El servicio no redacta
 * nada y el redactor no calcula nada, así que las dos redacciones posibles
 * (modelo y plantilla) parten exactamente de la misma grilla.
 */
@Injectable()
export class ContractClosureMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula las métricas del contrato. Devuelve `null` si el contrato no existe
   * en la inmobiliaria en sesión.
   */
  async compute(contractId: string): Promise<ContractClosureMetrics | null> {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
      select: {
        id: true,
        propertyId: true,
        contractType: true,
        status: true,
        startDate: true,
        endDate: true,
        rentAmount: true,
        rentCurrency: true,
        closedAt: true,
        updatedAt: true,
        liquidaciones: {
          select: {
            id: true,
            dueDate: true,
            total: true,
            status: true,
            paidAt: true,
            payments: { select: { amount: true, paidAt: true } },
          },
        },
        adjustments: {
          where: { appliedAt: { not: null } },
          select: { previousAmount: true, newAmount: true, adjustmentDate: true },
          orderBy: { adjustmentDate: 'asc' },
        },
        rendiciones: { select: { status: true, netDeposit: true } },
      },
    });

    if (!contract) return null;

    // La fecha de cierre queda registrada en la transición de estado. Los
    // contratos que ya estaban cerrados antes de que se registrara no la tienen,
    // así que para esos se infiere: el fin pactado, o el momento de la última
    // modificación cuando el contrato se cortó antes.
    const closedOn =
      contract.closedAt ??
      new Date(Math.min(contract.endDate.getTime(), contract.updatedAt.getTime()));

    const liquidaciones = contract.liquidaciones.filter(
      (l) => l.status !== VOID_LIQUIDACION_STATUS,
    );
    const liquidacionIds = liquidaciones.map((l) => l.id);

    const [penalties, tickets] = await Promise.all([
      liquidacionIds.length > 0
        ? this.prisma.client.penalty.findMany({
            where: { liquidacionId: { in: liquidacionIds } },
            select: { amount: true, status: true },
          })
        : Promise.resolve([]),
      this.prisma.client.ticket.findMany({
        where: {
          propertyId: contract.propertyId,
          createdAt: { gte: contract.startDate, lte: closedOn },
        },
        select: {
          status: true,
          createdAt: true,
          resolvedAt: true,
          closedAt: true,
          costAmount: true,
        },
      }),
    ]);

    // ── Comportamiento de pago ───────────────────────────
    let onTimeCount = 0;
    let lateCount = 0;
    let unpaidCount = 0;
    let delayTotal = 0;
    let maxDelayDays = 0;
    let billedAmount = 0;
    let collectedAmount = 0;

    for (const liquidacion of liquidaciones) {
      billedAmount += Number(liquidacion.total);

      const paidAmount = liquidacion.payments.reduce(
        (sum, payment) => sum + Number(payment.amount),
        0,
      );
      collectedAmount += paidAmount;

      const settledOn = this.settlementDate(liquidacion);
      if (!settledOn) {
        unpaidCount += 1;
        continue;
      }

      const delay = Math.max(0, daysBetween(liquidacion.dueDate, settledOn));
      if (delay > 0) {
        lateCount += 1;
        delayTotal += delay;
        maxDelayDays = Math.max(maxDelayDays, delay);
      } else {
        onTimeCount += 1;
      }
    }

    const paidCount = onTimeCount + lateCount;

    // ── Punitorios ───────────────────────────────────────
    const activePenalties = penalties.filter((p) => p.status !== WAIVED_PENALTY_STATUS);

    // ── Reclamos ─────────────────────────────────────────
    let ticketsResolved = 0;
    let ticketsCancelled = 0;
    let resolutionDaysTotal = 0;
    let ticketCostAmount = 0;

    for (const ticket of tickets) {
      ticketCostAmount += Number(ticket.costAmount ?? 0);

      if (ticket.status === CANCELLED_TICKET_STATUS) {
        ticketsCancelled += 1;
        continue;
      }
      if (!RESOLVED_TICKET_STATUSES.includes(ticket.status)) continue;

      ticketsResolved += 1;
      const closed = ticket.resolvedAt ?? ticket.closedAt;
      if (closed) {
        resolutionDaysTotal += Math.max(0, daysBetween(ticket.createdAt, closed));
      }
    }

    // ── Ajustes de alquiler ──────────────────────────────
    const adjustments = contract.adjustments;
    const currentRent = Number(contract.rentAmount);
    const firstRent =
      adjustments.length > 0 ? Number(adjustments[0].previousAmount) : currentRent;
    const lastRent =
      adjustments.length > 0
        ? Number(adjustments[adjustments.length - 1].newAmount)
        : currentRent;

    // ── Rendiciones ──────────────────────────────────────
    const issuedRendiciones = contract.rendiciones.filter((r) =>
      ISSUED_RENDICION_STATUSES.includes(r.status),
    );

    return {
      contractType: contract.contractType,
      closureStatus: contract.status,
      startDate: contract.startDate.toISOString(),
      endDate: contract.endDate.toISOString(),
      closedOn: closedOn.toISOString(),
      durationDays: Math.max(0, daysBetween(contract.startDate, closedOn)),
      durationMonths: monthsBetween(contract.startDate, closedOn),
      endedEarly: closedOn.getTime() < contract.endDate.getTime(),
      currency: contract.rentCurrency,

      billedCount: liquidaciones.length,
      paidCount,
      onTimeCount,
      lateCount,
      unpaidCount,
      onTimeRate: paidCount > 0 ? round1((onTimeCount / paidCount) * 100) : 0,
      averageDelayDays: lateCount > 0 ? round1(delayTotal / lateCount) : 0,
      maxDelayDays,
      billedAmount: round2(billedAmount),
      collectedAmount: round2(collectedAmount),
      outstandingAmount: Math.max(0, round2(billedAmount - collectedAmount)),

      penaltyCount: activePenalties.length,
      penaltyAmount: round2(
        activePenalties.reduce((sum, p) => sum + Number(p.amount), 0),
      ),
      penaltyWaivedCount: penalties.length - activePenalties.length,

      ticketCount: tickets.length,
      ticketsResolved,
      ticketsCancelled,
      ticketsOpen: tickets.length - ticketsResolved - ticketsCancelled,
      averageResolutionDays:
        ticketsResolved > 0 ? round1(resolutionDaysTotal / ticketsResolved) : null,
      ticketCostAmount: round2(ticketCostAmount),

      adjustmentCount: adjustments.length,
      firstRent: toNumber(firstRent),
      lastRent: toNumber(lastRent),
      rentIncreasePct: firstRent > 0 ? round1(((lastRent - firstRent) / firstRent) * 100) : 0,

      rendicionCount: issuedRendiciones.length,
      rendicionNetAmount: round2(
        issuedRendiciones.reduce((sum, r) => sum + Number(r.netDeposit), 0),
      ),
    };
  }

  /** El contrato ya está en un estado de cierre. */
  async isClosed(contractId: string): Promise<boolean> {
    const contract = await this.prisma.client.contract.findFirst({
      where: { id: contractId },
      select: { status: true },
    });
    return contract ? isClosedStatus(contract.status) : false;
  }

  // ─── Private ──────────────────────────────────────────

  /**
   * Cuándo quedó saldada una liquidación: la fecha del cierre si está anotada, y
   * si no, la del último pago registrado. Sin ninguna de las dos, sigue impaga.
   */
  private settlementDate(liquidacion: {
    paidAt: Date | null;
    payments: Array<{ paidAt: Date }>;
  }): Date | null {
    if (liquidacion.paidAt) return liquidacion.paidAt;
    if (liquidacion.payments.length === 0) return null;
    return liquidacion.payments.reduce(
      (latest, payment) => (payment.paidAt > latest ? payment.paidAt : latest),
      liquidacion.payments[0].paidAt,
    );
  }
}
