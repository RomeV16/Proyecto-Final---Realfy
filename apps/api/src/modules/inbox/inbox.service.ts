import { BadRequestException, ConflictException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import {
  AssignConversationSchema,
  ChangeConversationStatusSchema,
  ConversationChannel,
  ConversationFilterSchema,
  ConversationStatus,
  InboxSettingsSchema,
  LinkConversationSchema,
  MessageDirection,
  RegisterCallSchema,
  ReplyConversationSchema,
  normalizePhone,
  personName,
  slaState,
  type InboxSettings,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { parseOrThrow } from '../../common/validation/zod';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { CLOSED_STATUSES, InboxIngestService } from './inbox-ingest.service';
import { InboxOutboundService } from './inbox-outbound.service';

const PREVIEW_CHARS = 140;

const MANUAL_REPLY_STATUSES: string[] = [
  ConversationStatus.Nueva,
  ConversationStatus.Asignada,
  ConversationStatus.EnCurso,
  ConversationStatus.Resuelta,
];

const ROUTE_ERROR_MESSAGE: Record<string, string> = {
  CONTACT_OPTED_OUT: 'The contact asked not to be messaged on the channels available',
  WHATSAPP_WINDOW_CLOSED:
    'The 24-hour WhatsApp window is closed and the contact has no email: call them or wait for their next message',
  NO_REPLY_CHANNEL: 'There is no address to reply to: register a call or link a person with an email or phone',
};

/** Bandeja de consultas vista por el personal (ADR-0013): lista, hilo, respuesta, responsable, estado y vínculos. */
@Injectable()
export class InboxService {
  private readonly logger = new Logger(InboxService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly defaults: OperationalDefaultsService,
    private readonly ingest: InboxIngestService,
    private readonly outbound: InboxOutboundService,
    private readonly notifications: NotificationsService,
  ) {}

  private tenantId(): string {
    const id = this.tenantContext.getTenantId();
    if (!id) throw new ForbiddenException({ error: 'TENANT_CONTEXT_REQUIRED', message: 'Tenant context is required' });
    return id;
  }

  private userId(): string | null {
    return this.tenantContext.getUserId() ?? null;
  }

  async getSettings(): Promise<InboxSettings> {
    return (await this.defaults.get(this.tenantId())).inbox;
  }

  async updateSettings(body: unknown): Promise<InboxSettings> {
    const validated = parseOrThrow(InboxSettingsSchema, body, 'Invalid inbox settings');
    if (validated.defaultAssigneeUserId) await this.requireUser(validated.defaultAssigneeUserId);
    const tenantId = this.tenantId();
    const current = await this.defaults.get(tenantId);
    await this.defaults.set(tenantId, { ...current, inbox: validated });
    return validated;
  }

  private async requireUser(userId: string): Promise<void> {
    const user = await this.prisma.client.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } });
    if (!user) throw new BadRequestException({ error: 'USER_NOT_FOUND', message: 'User not found or inactive' });
  }

  // ─── Lista ────────────────────────────────────────────

  async list(query: unknown) {
    const f = parseOrThrow(ConversationFilterSchema, query, 'Invalid filter parameters');
    const now = new Date();
    const where: Record<string, unknown> = {};
    const and: Record<string, unknown>[] = [];
    if (f.status) where.status = f.status;
    else if (f.open === true) where.status = { notIn: CLOSED_STATUSES };
    if (f.channel) where.channel = f.channel;
    if (f.assignee === 'none') where.assigneeUserId = null;
    else if (f.assignee === 'me') where.assigneeUserId = this.userId() ?? '';
    else if (f.assignee) where.assigneeUserId = f.assignee;
    if (f.slaBreached === true) {
      Object.assign(where, { firstResponseAt: null, slaDueAt: { lte: now } });
      and.push({ status: { notIn: CLOSED_STATUSES } });
    }
    if (f.search) {
      and.push({
        OR: [
          { counterpartName: { contains: f.search, mode: 'insensitive' } },
          { address: { contains: f.search, mode: 'insensitive' } },
          { subject: { contains: f.search, mode: 'insensitive' } },
        ],
      });
    }
    if (and.length) where.AND = and;

    const [rows, total, settings] = await Promise.all([
      this.prisma.client.conversation.findMany({
        where,
        orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
        skip: (f.page - 1) * f.limit,
        take: f.limit,
        include: {
          assignee: { select: { firstName: true, lastName: true } },
          messages: { orderBy: [{ at: 'desc' }, { id: 'asc' }], take: 1, select: { body: true } },
        },
      }),
      this.prisma.client.conversation.count({ where }),
      this.getSettings(),
    ]);
    return {
      items: rows.map((r) => ({
        id: r.id,
        channel: r.channel,
        subject: r.subject,
        counterpartName: r.counterpartName,
        address: r.address,
        status: r.status,
        assigneeUserId: r.assigneeUserId,
        assigneeName: r.assignee ? personName(r.assignee) : null,
        unread: r.unread,
        slaDueAt: r.slaDueAt,
        slaBreachedAt: r.slaBreachedAt,
        firstResponseAt: r.firstResponseAt,
        slaState: slaState(r, settings.slaMinutes, now),
        lastMessageAt: r.lastMessageAt,
        preview: r.messages[0]?.body.slice(0, PREVIEW_CHARS) ?? null,
      })),
      total,
      page: f.page,
      limit: f.limit,
      totalPages: Math.ceil(total / f.limit),
    };
  }

  /** Contadores del menú: sin leer (propias o sin responsable), plazo vencido y sin responsable. */
  async summary() {
    const db = this.prisma.client;
    const me = this.userId() ?? '';
    const open = { status: { notIn: CLOSED_STATUSES } };
    const [unread, breached, unassigned] = await Promise.all([
      db.conversation.count({ where: { ...open, unread: { gt: 0 }, OR: [{ assigneeUserId: me }, { assigneeUserId: null }] } }),
      db.conversation.count({ where: { ...open, firstResponseAt: null, slaDueAt: { lte: new Date() } } }),
      db.conversation.count({ where: { ...open, assigneeUserId: null } }),
    ]);
    return { unread, breached, unassigned };
  }

  // ─── Detalle ──────────────────────────────────────────

  private async load(id: string) {
    const conv = await this.prisma.client.conversation.findFirst({ where: { id } });
    if (!conv) throw new NotFoundException({ error: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' });
    return conv;
  }

  async get(id: string) {
    const conv = await this.prisma.client.conversation.findFirst({
      where: { id },
      include: {
        assignee: { select: { id: true, firstName: true, lastName: true } },
        person: { select: { id: true, firstName: true, lastName: true, email: true, phone: true } },
        lead: { select: { id: true, status: true, propertyId: true } },
        messages: {
          orderBy: [{ at: 'asc' }, { id: 'asc' }],
          take: 500,
          include: { outboxMessage: { select: { status: true, statusReason: true, error: true, channel: true } } },
        },
      },
    });
    if (!conv) throw new NotFoundException({ error: 'CONVERSATION_NOT_FOUND', message: 'Conversation not found' });
    const settings = await this.getSettings();
    const route = await this.outbound.resolveRoute(conv);
    return {
      id: conv.id,
      channel: conv.channel,
      address: conv.address,
      counterpartName: conv.counterpartName,
      subject: conv.subject,
      status: conv.status,
      assignee: conv.assignee ? { id: conv.assignee.id, name: personName(conv.assignee) } : null,
      person: conv.person,
      lead: conv.lead,
      related: conv.relatedType && conv.relatedId ? { type: conv.relatedType, id: conv.relatedId } : null,
      unread: conv.unread,
      firstResponseAt: conv.firstResponseAt,
      slaDueAt: conv.slaDueAt,
      slaBreachedAt: conv.slaBreachedAt,
      slaState: slaState(conv, settings.slaMinutes, new Date()),
      lastMessageAt: conv.lastMessageAt,
      /** Por dónde saldría una respuesta, o por qué no puede salir. */
      replyRoute: route.ok ? { channel: route.route.channel, to: route.route.to } : null,
      replyBlockedReason: route.ok ? null : route.error,
      messages: conv.messages.map((m) => ({
        id: m.id,
        direction: m.direction,
        body: m.body,
        at: m.at,
        isAutoReply: m.isAutoReply,
        authorUserId: m.authorUserId,
        delivery: m.outboxMessage
          ? { status: m.outboxMessage.status, reason: m.outboxMessage.statusReason, error: m.outboxMessage.error }
          : null,
      })),
    };
  }

  async markRead(id: string) {
    await this.load(id);
    await this.prisma.client.conversation.updateMany({ where: { id, unread: { gt: 0 } }, data: { unread: 0 } });
    return { id, unread: 0 };
  }

  // ─── Responder ────────────────────────────────────────

  async reply(id: string, body: unknown) {
    const input = parseOrThrow(ReplyConversationSchema, body, 'Invalid reply');
    const conv = await this.load(id);
    if (conv.status === ConversationStatus.Archivada) {
      throw new ConflictException({ error: 'CONVERSATION_ARCHIVED', message: 'Archived conversations cannot be replied to' });
    }
    const resolved = await this.outbound.resolveRoute(conv);
    if (!resolved.ok) {
      throw new ConflictException({ error: resolved.error, message: ROUTE_ERROR_MESSAGE[resolved.error] });
    }
    const tenant = await this.prisma.baseClient.tenant.findUnique({ where: { id: this.tenantId() }, select: { name: true } });
    const last = await this.prisma.client.conversationMessage.findFirst({
      where: { conversationId: id },
      orderBy: [{ at: 'desc' }, { id: 'asc' }],
      select: { id: true },
    });
    const userId = this.userId();
    const now = new Date();
    const subject = input.subject ?? `Re: ${conv.subject ?? 'tu consulta'}`;

    const result = await this.prisma.client.$transaction(async (tx: any) => {
      const enqueued = await this.outbound.enqueue(tx, {
        conversation: conv,
        route: resolved.route,
        subject,
        text: input.body,
        agency: tenant?.name ?? '',
        idempotencyKey: this.outbound.replyKey(id, last?.id ?? null, input.body),
        createdByUserId: userId,
      });
      if (enqueued.created) {
        await tx.conversationMessage.create({
          data: {
            conversationId: id,
            direction: MessageDirection.Out,
            body: input.body,
            outboxMessageId: enqueued.id,
            authorUserId: userId,
            at: now,
          },
        });
        await tx.conversation.update({
          where: { id },
          data: {
            firstResponseAt: conv.firstResponseAt ?? now,
            lastMessageAt: now,
            unread: 0,
            status: MANUAL_REPLY_STATUSES.includes(conv.status) ? ConversationStatus.Esperando : conv.status,
            // Quien contesta una consulta sin responsable se la queda.
            assigneeUserId: conv.assigneeUserId ?? userId,
          },
        });
      }
      return enqueued;
    });
    this.logger.log(`Inbox reply queued: conversationId=${id} outboxId=${result.id} channel=${resolved.route.channel}`);
    return { outboxId: result.id, status: result.status, statusReason: result.statusReason, channel: resolved.route.channel, queued: result.created };
  }

  // ─── Responsable, estado y vínculos ───────────────────

  async assign(id: string, body: unknown) {
    const { assigneeUserId } = parseOrThrow(AssignConversationSchema, body, 'Invalid assignment');
    const conv = await this.load(id);
    if (assigneeUserId) await this.requireUser(assigneeUserId);
    let status = conv.status;
    if (assigneeUserId && status === ConversationStatus.Nueva) status = ConversationStatus.Asignada;
    if (!assigneeUserId && status === ConversationStatus.Asignada) status = ConversationStatus.Nueva;
    await this.prisma.client.conversation.update({ where: { id }, data: { assigneeUserId, status } });
    if (assigneeUserId && assigneeUserId !== this.userId() && assigneeUserId !== conv.assigneeUserId) {
      await this.notifications.createNotification({
        tenantId: this.tenantId(),
        userId: assigneeUserId,
        type: 'InboxAssigned',
        title: 'Te asignaron una consulta',
        message: `${conv.counterpartName ?? conv.address}: ${conv.subject ?? conv.channel}`,
        entityType: 'Conversation',
        entityId: id,
      });
    }
    return { id, assigneeUserId, status };
  }

  async changeStatus(id: string, body: unknown) {
    const { status } = parseOrThrow(ChangeConversationStatusSchema, body, 'Invalid status');
    const conv = await this.load(id);
    await this.prisma.client.conversation.update({
      where: { id },
      data: { status, ...(CLOSED_STATUSES.includes(status) ? { unread: 0 } : {}) },
    });
    return { id, status, previous: conv.status };
  }

  async link(id: string, body: unknown) {
    const input = parseOrThrow(LinkConversationSchema, body, 'Invalid links');
    await this.load(id);
    const db = this.prisma.client;
    const data: Record<string, unknown> = {};
    if (input.personId !== undefined) {
      if (input.personId && !(await db.person.findFirst({ where: { id: input.personId }, select: { id: true } }))) {
        throw new NotFoundException({ error: 'PERSON_NOT_FOUND', message: 'Person not found' });
      }
      data.personId = input.personId;
    }
    if (input.leadId !== undefined) {
      if (input.leadId && !(await db.lead.findFirst({ where: { id: input.leadId }, select: { id: true } }))) {
        throw new NotFoundException({ error: 'LEAD_NOT_FOUND', message: 'Lead not found' });
      }
      data.leadId = input.leadId;
    }
    if (input.related !== undefined) {
      if (input.related) await this.requireRelated(input.related.type, input.related.id);
      data.relatedType = input.related?.type ?? null;
      data.relatedId = input.related?.id ?? null;
    }
    await db.conversation.update({ where: { id }, data });
    return this.get(id);
  }

  private async requireRelated(type: 'Property' | 'Contract', relatedId: string): Promise<void> {
    const db = this.prisma.client;
    const found =
      type === 'Property'
        ? await db.property.findFirst({ where: { id: relatedId }, select: { id: true } })
        : await db.contract.findFirst({ where: { id: relatedId }, select: { id: true } });
    if (!found) {
      throw new NotFoundException({ error: `${type.toUpperCase()}_NOT_FOUND`, message: `${type} not found` });
    }
  }

  // ─── Registrar llamada ────────────────────────────────

  /** "Registrar llamada": anota un llamado (atendido en el momento o para devolver) como consulta de canal Telefono. */
  async registerCall(body: unknown) {
    const input = parseOrThrow(RegisterCallSchema, body, 'Invalid call');
    const phone = normalizePhone(input.phone);
    if (!phone) throw new BadRequestException({ error: 'INVALID_PHONE', message: 'The phone number is not valid' });
    if (input.propertyId) await this.requireRelated('Property', input.propertyId);
    const userId = this.userId();
    const result = await this.ingest.receiveInContext({
      channel: ConversationChannel.Telefono,
      address: phone,
      name: input.name,
      subject: 'Llamada',
      body: input.summary,
      at: new Date(),
      relatedType: input.propertyId ? 'Property' : null,
      relatedId: input.propertyId ?? null,
      assigneeUserId: userId,
      authorUserId: userId,
      answered: input.answered,
      autoreply: false,
    });
    return this.get(result.conversationId);
  }
}
