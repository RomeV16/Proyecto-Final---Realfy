import { ConflictException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  ApproveTicketQuoteSchema,
  CreateTicketQuoteSchema,
  EstimateTicketSchema,
  PreauthorizeTicketSchema,
  QUOTING_STATUSES,
  TicketQuoteStatus,
  TicketStatus,
  UpdateTicketQuoteSchema,
  getValidTicketTransitions,
  requiresPreauthorization,
  ticketMachine,
} from '@realfy/shared';
import { AuditService } from '../../common/audit/audit.service';
import { assertTransition } from '../../common/errors/assert-transition';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';

type Db = any;

const notFound = (error: string, message: string) => new NotFoundException({ error, message });
const conflict = (error: string, message: string) => new ConflictException({ error, message });

const PERSON = { select: { id: true, firstName: true, lastName: true } } as const;
const QUOTE_INCLUDE = { provider: PERSON, approvedBy: PERSON } as const;

/** Estados desde los que se puede estimar el costo (antes de empezar a trabajar). */
const ESTIMABLE: readonly TicketStatus[] = [
  TicketStatus.Abierto,
  TicketStatus.Asignado,
  TicketStatus.Reabierto,
  TicketStatus.PendienteAutorizacion,
  TicketStatus.Presupuestado,
];

/** Estados desde los que el estimado manda el caso a esperar la autorización del locador. */
const CAN_AWAIT_AUTHORIZATION: readonly TicketStatus[] = [
  TicketStatus.Abierto,
  TicketStatus.Asignado,
  TicketStatus.Reabierto,
];

const snapshot = (ticket: any) => ({
  status: ticket.status,
  providerId: ticket.providerId,
  estimatedAmount: ticket.estimatedAmount?.toString() ?? null,
  costAmount: ticket.costAmount?.toString() ?? null,
  costCurrency: ticket.costCurrency,
  preauthorizedAmount: ticket.preauthorizedAmount?.toString() ?? null,
  preauthorizedByPersonId: ticket.preauthorizedByPersonId,
  preauthorizedChannel: ticket.preauthorizedChannel,
});

const quoteSnapshot = (quote: any) => ({
  status: quote.status,
  providerId: quote.providerId,
  amount: quote.amount?.toString(),
  currency: quote.currency,
  approvedByPersonId: quote.approvedByPersonId,
  channel: quote.channel,
});

/**
 * Preautorización y presupuestos de una incidencia: el estimado decide si hace
 * falta consultar al locador (límite de la inmobiliaria o tope ya autorizado), la
 * preautorización registra hasta qué importe puede actuar la inmobiliaria, y de los
 * presupuestos de proveedores el locador aprueba uno (quién, cuándo y por qué canal).
 */
@Injectable()
export class TicketQuotesService {
  private readonly logger = new Logger(TicketQuotesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly audit: AuditService,
    private readonly operationalDefaults: OperationalDefaultsService,
  ) {}

  // ─── Estimado y preautorización ─────────────────────

  /**
   * Anota el costo estimado. Si supera el límite de la inmobiliaria (o el tope que el
   * locador ya autorizó) y el caso todavía no empezó, pasa a PendienteAutorizacion;
   * si no, queda como está y se puede presupuestar o trabajar directamente.
   */
  async estimate(ticketId: string, body: unknown) {
    const input = parseOrThrow(EstimateTicketSchema, body, 'Invalid estimate');
    const tenantId = this.tenantContext.getTenantId()!;
    const ticket = await this.findTicket(this.prisma.client, ticketId);
    if (!ESTIMABLE.includes(ticket.status)) {
      throw conflict('TICKET_NOT_ESTIMABLE', `A ticket in ${ticket.status} can no longer be estimated`);
    }
    const defaults = await this.operationalDefaults.get(tenantId);
    const limit = defaults.repairs.preauthLimit;
    const requiresAuthorization = requiresPreauthorization({
      amount: input.amount,
      currency: input.currency,
      limitArs: limit,
      preauthorizedAmount: ticket.preauthorizedAmount?.toString() ?? null,
    });
    const target =
      requiresAuthorization && CAN_AWAIT_AUTHORIZATION.includes(ticket.status)
        ? TicketStatus.PendienteAutorizacion
        : null;
    if (target) assertTransition(ticketMachine, ticket.status, target);

    const updated = await this.prisma.client.$transaction(async (tx: Db) => {
      const row = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          estimatedAmount: input.amount,
          costCurrency: input.currency,
          ...(target ? { status: target } : {}),
        },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Ticket',
        entityId: ticketId,
        before: snapshot(ticket),
        after: snapshot(row),
        metadata: { operation: 'ticket-estimate', requiresAuthorization, limit },
      });
      return row;
    });
    this.logger.log('Ticket estimated', { ticketId, requiresAuthorization });
    return { ticket: this.withTransitions(updated), requiresAuthorization, limit };
  }

  /**
   * Registra la preautorización del locador (importe tope, quién la dio, cuándo y por
   * qué canal) y sigue con los presupuestos.
   */
  async preauthorize(ticketId: string, body: unknown) {
    const input = parseOrThrow(PreauthorizeTicketSchema, body, 'Invalid preauthorization');
    const ticket = await this.findTicket(this.prisma.client, ticketId);
    if (ticket.status !== TicketStatus.PendienteAutorizacion) {
      throw conflict('TICKET_NOT_AWAITING_AUTHORIZATION', 'The ticket is not waiting for an authorization');
    }
    assertTransition(ticketMachine, ticket.status, TicketStatus.Presupuestado);
    await this.assertPerson(input.approvedByPersonId);

    const updated = await this.prisma.client.$transaction(async (tx: Db) => {
      const row = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.Presupuestado,
          preauthorizedAmount: input.amount,
          preauthorizedByPersonId: input.approvedByPersonId,
          preauthorizedAt: new Date(),
          preauthorizedChannel: input.channel,
        },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Ticket',
        entityId: ticketId,
        before: snapshot(ticket),
        after: snapshot(row),
        metadata: { operation: 'ticket-preauthorize', note: input.note ?? null },
      });
      return row;
    });
    this.logger.log('Ticket preauthorized', { ticketId });
    return this.withTransitions(updated);
  }

  // ─── Presupuestos ───────────────────────────────────

  async listQuotes(ticketId: string) {
    await this.findTicket(this.prisma.client, ticketId);
    return this.prisma.client.ticketQuote.findMany({
      where: { ticketId },
      include: QUOTE_INCLUDE,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  /** Carga un presupuesto; el primero pasa el caso a Presupuestado (si no esperaba autorización). */
  async createQuote(ticketId: string, body: unknown) {
    const input = parseOrThrow(CreateTicketQuoteSchema, body, 'Invalid quote');
    const tenantId = this.tenantContext.getTenantId()!;
    const ticket = await this.findTicket(this.prisma.client, ticketId);
    if (ticket.status === TicketStatus.PendienteAutorizacion) {
      throw conflict('TICKET_NEEDS_AUTHORIZATION', 'The ticket needs the lessor authorization before quoting');
    }
    if (!QUOTING_STATUSES.includes(ticket.status)) {
      throw conflict('TICKET_NOT_QUOTABLE', `A ticket in ${ticket.status} does not take quotes`);
    }
    await this.assertProvider(input.providerId);
    const moveTo = ticket.status === TicketStatus.Presupuestado ? null : TicketStatus.Presupuestado;
    if (moveTo) assertTransition(ticketMachine, ticket.status, moveTo);

    return this.prisma.client.$transaction(async (tx: Db) => {
      const quote = await tx.ticketQuote.create({
        data: {
          tenantId,
          ticketId,
          providerId: input.providerId,
          amount: input.amount,
          currency: input.currency,
          documentUrl: input.documentUrl ?? null,
          notes: input.notes ?? null,
          createdById: this.tenantContext.getUserId() ?? null,
        },
        include: QUOTE_INCLUDE,
      });
      if (moveTo) await tx.ticket.update({ where: { id: ticketId }, data: { status: moveTo } });
      await this.audit.record(tx, {
        action: 'CREATE',
        entity: 'TicketQuote',
        entityId: quote.id,
        after: quoteSnapshot(quote),
        metadata: { ticketId },
      });
      return quote;
    });
  }

  /** Corrige un presupuesto pendiente mientras se presupuesta. */
  async updateQuote(ticketId: string, quoteId: string, body: unknown) {
    const input = parseOrThrow(UpdateTicketQuoteSchema, body, 'Invalid quote');
    const { quote } = await this.openQuote(ticketId, quoteId);
    return this.prisma.client.$transaction(async (tx: Db) => {
      const row = await tx.ticketQuote.update({ where: { id: quoteId }, data: input, include: QUOTE_INCLUDE });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'TicketQuote',
        entityId: quoteId,
        before: quoteSnapshot(quote),
        after: quoteSnapshot(row),
        metadata: { ticketId },
      });
      return row;
    });
  }

  /** Quita un presupuesto pendiente. */
  async removeQuote(ticketId: string, quoteId: string) {
    const { quote } = await this.openQuote(ticketId, quoteId);
    await this.prisma.client.$transaction(async (tx: Db) => {
      await tx.ticketQuote.delete({ where: { id: quoteId } });
      await this.audit.record(tx, {
        action: 'DELETE',
        entity: 'TicketQuote',
        entityId: quoteId,
        before: quoteSnapshot(quote),
        metadata: { ticketId },
      });
    });
    return { deleted: true };
  }

  /** Descarta un presupuesto pendiente sin borrarlo (queda en el historial). */
  async rejectQuote(ticketId: string, quoteId: string) {
    const { quote } = await this.openQuote(ticketId, quoteId);
    return this.prisma.client.$transaction(async (tx: Db) => {
      const row = await tx.ticketQuote.update({
        where: { id: quoteId },
        data: { status: TicketQuoteStatus.Rechazado },
        include: QUOTE_INCLUDE,
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'TicketQuote',
        entityId: quoteId,
        before: quoteSnapshot(quote),
        after: quoteSnapshot(row),
        metadata: { ticketId, operation: 'ticket-quote-reject' },
      });
      return row;
    });
  }

  /**
   * Aprueba un presupuesto: lo aprueba el locador (o quien lo representa), por un
   * canal, y queda anotado quién y cuándo. Los demás presupuestos pendientes se
   * descartan; el proveedor y el importe aprobados pasan al ticket.
   */
  async approveQuote(ticketId: string, quoteId: string, body: unknown) {
    const input = parseOrThrow(ApproveTicketQuoteSchema, body, 'Invalid approval');
    const { ticket, quote } = await this.openQuote(ticketId, quoteId);
    assertTransition(ticketMachine, ticket.status, TicketStatus.PresupuestoAprobado);
    await this.assertPerson(input.approvedByPersonId);

    return this.prisma.client.$transaction(async (tx: Db) => {
      const claimed = await tx.ticketQuote.updateMany({
        where: { id: quoteId, status: TicketQuoteStatus.Pendiente },
        data: {
          status: TicketQuoteStatus.Aprobado,
          approvedByPersonId: input.approvedByPersonId,
          approvedByUserId: this.tenantContext.getUserId() ?? null,
          approvedAt: new Date(),
          channel: input.channel,
        },
      });
      if (claimed.count !== 1) throw conflict('QUOTE_NOT_PENDING', 'The quote is no longer pending');
      await tx.ticketQuote.updateMany({
        where: { ticketId, id: { not: quoteId }, status: TicketQuoteStatus.Pendiente },
        data: { status: TicketQuoteStatus.Rechazado },
      });
      const updatedTicket = await tx.ticket.update({
        where: { id: ticketId },
        data: {
          status: TicketStatus.PresupuestoAprobado,
          providerId: quote.providerId,
          costAmount: quote.amount,
          costCurrency: quote.currency,
        },
      });
      const approved = await tx.ticketQuote.findFirst({ where: { id: quoteId }, include: QUOTE_INCLUDE });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'TicketQuote',
        entityId: quoteId,
        before: quoteSnapshot(quote),
        after: quoteSnapshot(approved),
        metadata: { ticketId, operation: 'ticket-quote-approve', note: input.note ?? null },
      });
      await this.audit.record(tx, {
        action: 'UPDATE',
        entity: 'Ticket',
        entityId: ticketId,
        before: snapshot(ticket),
        after: snapshot(updatedTicket),
        metadata: { operation: 'ticket-quote-approve', quoteId },
      });
      this.logger.log('Quote approved', { ticketId, quoteId });
      return { quote: approved, ticket: this.withTransitions(updatedTicket) };
    });
  }

  // ─── Apoyo ──────────────────────────────────────────

  private withTransitions(ticket: any) {
    return { ...ticket, validTransitions: getValidTicketTransitions(ticket.status as TicketStatus) };
  }

  private async findTicket(db: Db, id: string) {
    const ticket = await db.ticket.findUnique({ where: { id } });
    if (!ticket) throw notFound('TICKET_NOT_FOUND', `Ticket ${id} not found`);
    return ticket;
  }

  /** Un presupuesto pendiente de un ticket que se está presupuestando. */
  private async openQuote(ticketId: string, quoteId: string) {
    const ticket = await this.findTicket(this.prisma.client, ticketId);
    const quote = await this.prisma.client.ticketQuote.findFirst({ where: { id: quoteId, ticketId } });
    if (!quote) throw notFound('QUOTE_NOT_FOUND', `Quote ${quoteId} not found`);
    if (ticket.status !== TicketStatus.Presupuestado) {
      throw conflict('TICKET_NOT_QUOTING', 'The ticket is not in the quoting stage');
    }
    if (quote.status !== TicketQuoteStatus.Pendiente) {
      throw conflict('QUOTE_NOT_PENDING', 'The quote is no longer pending');
    }
    return { ticket, quote };
  }

  private async assertPerson(personId: string) {
    const person = await this.prisma.client.person.findFirst({ where: { id: personId }, select: { id: true } });
    if (!person) throw notFound('PERSON_NOT_FOUND', `Person ${personId} not found`);
  }

  private async assertProvider(providerId: string) {
    const provider = await this.prisma.client.person.findFirst({
      where: { id: providerId, providerProfile: { isNot: null } },
      select: { id: true },
    });
    if (!provider) throw notFound('PROVIDER_NOT_FOUND', `Provider ${providerId} not found`);
  }
}
