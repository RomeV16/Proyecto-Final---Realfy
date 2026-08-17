import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TICKET_SLA_HOURS, TicketPriority } from '@realfy/shared';
import {
  DailyContext,
  DailyContextItem,
  buildRef,
  daysBetween,
  hoursBetween,
} from './daily-context';

/** Hasta cuándo mirar hacia adelante en los vencimientos de contrato. */
const CONTRACT_HORIZON_DAYS = 90;

/** Desde cuántos días sin contacto un lead entra en la agenda. */
const LEAD_STALE_DAYS = 7;

/** Cuántos items entran por frente. Acota el pedido al modelo y la pantalla. */
const MAX_PER_KIND = 8;

/** Cuánto se lee de cada tabla antes de filtrar y recortar en memoria. */
const QUERY_LIMIT = 80;

/** Liquidaciones que siguen esperando cobro. */
const OUTSTANDING_STATUSES = ['Vencida', 'Enviada', 'Aprobada', 'Pendiente'];

/** Reclamos que ya no pesan sobre el día. */
const CLOSED_TICKET_STATUSES = ['Resuelto', 'Cerrado', 'Cancelado'];

/** Leads que ya salieron del embudo. */
const CLOSED_LEAD_STATUSES = ['Convertido', 'Perdido'];

/** Etiqueta corta de período: `2026-08-01` → `ago 26`. */
function periodLabel(period: Date): string {
  return period
    .toLocaleDateString('es-AR', { month: 'short', year: '2-digit', timeZone: 'UTC' })
    .replace('.', '');
}

function personName(person?: { firstName: string; lastName: string } | null): string | null {
  return person ? `${person.firstName} ${person.lastName}` : null;
}

/** Contraparte de un contrato: el inquilino, o el primer firmante que haya. */
function counterparty(
  persons: Array<{ role: string; person: { firstName: string; lastName: string } | null }>,
): string | null {
  const inquilino = persons.find((p) => p.role === 'Inquilino');
  return personName(inquilino?.person ?? persons[0]?.person);
}

/**
 * Vencimiento efectivo del SLA de un reclamo: el guardado en el ticket, y si no
 * hay, el que sale de la prioridad. `Baja` no tiene SLA, así que no vence nunca.
 */
function slaDeadline(ticket: {
  slaDeadline: Date | null;
  priority: string;
  createdAt: Date;
}): Date | null {
  if (ticket.slaDeadline) return ticket.slaDeadline;
  const hours = TICKET_SLA_HOURS[ticket.priority as TicketPriority];
  if (hours == null) return null;
  return new Date(ticket.createdAt.getTime() + hours * 3_600_000);
}

/**
 * Arma el contexto del día del inmobiliaria en sesión.
 *
 * Lee las mismas tablas que alimentan los widgets del panel — liquidaciones sin
 * cobrar, contratos por vencer, reclamos abiertos y leads del embudo — y las
 * normaliza a una lista de items comparables entre sí, sin decidir todavía en
 * qué orden hay que atenderlos.
 */
@Injectable()
export class DailyContextService {
  constructor(private readonly prisma: PrismaService) {}

  async build(now: Date = new Date()): Promise<DailyContext> {
    const horizon = new Date(now.getTime() + CONTRACT_HORIZON_DAYS * 86_400_000);

    const [liquidaciones, contracts, tickets, leads] = await Promise.all([
      this.prisma.client.liquidacion.findMany({
        where: { status: { in: OUTSTANDING_STATUSES as any } },
        select: {
          id: true,
          period: true,
          dueDate: true,
          total: true,
          currency: true,
          status: true,
          contract: {
            select: {
              property: { select: { title: true } },
              persons: {
                select: { role: true, person: { select: { firstName: true, lastName: true } } },
              },
            },
          },
        },
        orderBy: { dueDate: 'asc' },
        take: QUERY_LIMIT,
      }),
      this.prisma.client.contract.findMany({
        where: { status: 'Activo', endDate: { gte: now, lte: horizon } },
        select: {
          id: true,
          endDate: true,
          rentAmount: true,
          rentCurrency: true,
          status: true,
          property: { select: { title: true } },
          persons: {
            select: { role: true, person: { select: { firstName: true, lastName: true } } },
          },
        },
        orderBy: { endDate: 'asc' },
        take: QUERY_LIMIT,
      }),
      this.prisma.client.ticket.findMany({
        where: { status: { notIn: CLOSED_TICKET_STATUSES as any } },
        select: {
          id: true,
          title: true,
          priority: true,
          status: true,
          slaDeadline: true,
          createdAt: true,
          assignedToUserId: true,
          providerId: true,
          property: { select: { title: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: QUERY_LIMIT,
      }),
      this.prisma.client.lead.findMany({
        where: { isActive: true, status: { notIn: CLOSED_LEAD_STATUSES as any } },
        select: {
          id: true,
          status: true,
          createdAt: true,
          lastContactAt: true,
          budget: true,
          budgetCurrency: true,
          person: { select: { firstName: true, lastName: true } },
          property: { select: { title: true } },
        },
        orderBy: { createdAt: 'asc' },
        take: QUERY_LIMIT,
      }),
    ]);

    // ── Cobranzas ────────────────────────────────────────
    const collections: DailyContextItem[] = liquidaciones
      .map((l) => ({
        item: l,
        daysOverdue: Math.max(0, daysBetween(l.dueDate, now)),
      }))
      .sort((a, b) => b.daysOverdue - a.daysOverdue || Number(b.item.total) - Number(a.item.total))
      .slice(0, MAX_PER_KIND)
      .map(({ item, daysOverdue }, i) =>
        this.emptyItem('cobranza', i + 1, item.id, {
          title: item.contract?.property?.title ?? 'Liquidación',
          subtitle: [counterparty(item.contract?.persons ?? []), periodLabel(item.period)]
            .filter(Boolean)
            .join(' · ') || null,
          amount: Math.round(Number(item.total)),
          currency: item.currency as string,
          daysOverdue,
          status: item.status as string,
        }),
      );

    // ── Reclamos ─────────────────────────────────────────
    const openTickets = tickets.length;
    const claims: DailyContextItem[] = tickets
      .map((t) => {
        const deadline = slaDeadline(t);
        const overdue = deadline && deadline < now ? hoursBetween(deadline, now) : null;
        return {
          item: t,
          slaHoursOverdue: overdue,
          unassigned: !t.assignedToUserId && !t.providerId,
        };
      })
      .filter((row) => row.slaHoursOverdue !== null || row.unassigned)
      .sort((a, b) => (b.slaHoursOverdue ?? 0) - (a.slaHoursOverdue ?? 0))
      .slice(0, MAX_PER_KIND)
      .map(({ item, slaHoursOverdue, unassigned }, i) =>
        this.emptyItem('reclamo', i + 1, item.id, {
          title: item.title,
          subtitle: item.property?.title ?? null,
          slaHoursOverdue,
          unassigned,
          ticketPriority: item.priority as string,
          status: item.status as string,
        }),
      );

    // ── Vencimientos de contrato ─────────────────────────
    const expirations: DailyContextItem[] = contracts
      .slice(0, MAX_PER_KIND)
      .map((c, i) =>
        this.emptyItem('contrato', i + 1, c.id, {
          title: c.property?.title ?? 'Contrato',
          subtitle: counterparty(c.persons ?? []),
          amount: Math.round(Number(c.rentAmount)),
          currency: c.rentCurrency as string,
          daysToDue: Math.max(0, daysBetween(now, c.endDate)),
          status: c.status as string,
        }),
      );

    // ── Leads sin contacto ───────────────────────────────
    const staleLeads = leads
      .map((l) => ({
        item: l,
        daysSinceContact: daysBetween(l.lastContactAt ?? l.createdAt, now),
      }))
      .filter((row) => row.daysSinceContact >= LEAD_STALE_DAYS);

    const followUps: DailyContextItem[] = staleLeads
      .sort((a, b) => b.daysSinceContact - a.daysSinceContact)
      .slice(0, MAX_PER_KIND)
      .map(({ item, daysSinceContact }, i) =>
        this.emptyItem('lead', i + 1, item.id, {
          title: item.property?.title ?? 'Consulta sin propiedad',
          subtitle: personName(item.person),
          amount: item.budget !== null ? Math.round(Number(item.budget)) : null,
          currency: item.budget !== null ? (item.budgetCurrency as string) : null,
          daysSinceContact,
          status: item.status as string,
        }),
      );

    // ── Totales ──────────────────────────────────────────
    let overdueAmount = 0;
    let pendingAmount = 0;
    let overdueCollections = 0;
    for (const l of liquidaciones) {
      const amount = Number(l.total);
      if (l.status === 'Vencida') {
        overdueAmount += amount;
        overdueCollections += 1;
      } else {
        pendingAmount += amount;
      }
    }

    return {
      generatedAt: now.toISOString(),
      totals: {
        overdueAmount: Math.round(overdueAmount),
        pendingAmount: Math.round(pendingAmount),
        overdueCollections,
        openTickets,
        expiringContracts: contracts.length,
        staleLeads: staleLeads.length,
      },
      items: [...collections, ...claims, ...expirations, ...followUps],
    };
  }

  // ─── Private ──────────────────────────────────────────

  /**
   * Item con todos los datos objetivos en su valor neutro, para que cada frente
   * sólo tenga que declarar los que le aplican y el resto quede explícitamente
   * vacío en vez de ausente.
   */
  private emptyItem(
    kind: DailyContextItem['kind'],
    index: number,
    entityId: string,
    overrides: Partial<DailyContextItem> & { title: string },
  ): DailyContextItem {
    return {
      ref: buildRef(kind, index),
      kind,
      entityId,
      subtitle: null,
      amount: null,
      currency: null,
      daysOverdue: null,
      daysToDue: null,
      slaHoursOverdue: null,
      unassigned: false,
      ticketPriority: null,
      status: null,
      daysSinceContact: null,
      ...overrides,
    };
  }
}
