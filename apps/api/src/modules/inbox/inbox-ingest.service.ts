import { Injectable, Logger } from '@nestjs/common';
import {
  ConversationChannel,
  ConversationStatus,
  MessageDirection,
  computeSlaDueAt,
  normalizeEmail,
  renderInboxText,
  type InboxSettings,
} from '@realfy/shared';
import { ClsService } from 'nestjs-cls';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { findStaff } from '../../common/auth/find-staff';
import { MANAGEMENT_ROLES } from '../../common/auth/role-groups';
import { normalizePhone as nationalPhone } from '../data-quality/normalize';
import { NotificationsService } from '../notifications/notifications.service';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { InboxOutboundService } from './inbox-outbound.service';

/** Estados en los que una consulta ya no se trabaja. */
export const CLOSED_STATUSES: ConversationStatus[] = [ConversationStatus.Resuelta, ConversationStatus.Archivada];

/** Remitentes automáticos a los que no se les contesta (evita que dos autorrespuestas se contesten entre sí). */
export const NO_REPLY_LOCAL_PART = /^(no-?reply|do-?not-?reply|mailer-daemon|postmaster|bounces?|notifications?)([+._-]|$)/i;

const PREVIEW_MAX = 4000;

export interface InboundInput {
  channel: ConversationChannel;
  /** Dirección ya normalizada: teléfono (con 54 9) o mail en minúsculas. */
  address: string;
  name?: string | null;
  subject?: string | null;
  body: string;
  at: Date;
  inboundMessageId?: string | null;
  personId?: string | null;
  leadId?: string | null;
  relatedType?: 'Property' | 'Contract' | null;
  relatedId?: string | null;
  assigneeUserId?: string | null;
  authorUserId?: string | null;
  /** Una llamada ya atendida: nace con primera respuesta y sin plazo. */
  answered?: boolean;
  /** Si corresponde la autorrespuesta (por defecto sí). */
  autoreply?: boolean;
}

export interface IngestResult {
  conversationId: string;
  created: boolean;
  reopened: boolean;
}

/**
 * Entrada de las consultas a la bandeja (ADR-0013): WhatsApp, mail, formulario del
 * micrositio y llamadas terminan acá. Une el mensaje a la consulta abierta del mismo
 * contacto y canal dentro de la ventana, o abre una (con responsable, plazo de
 * primera respuesta y autorrespuesta). Nada de lo que falle después de guardar el
 * mensaje —aviso, autorrespuesta— le quita la consulta a la persona.
 */
@Injectable()
export class InboxIngestService {
  private readonly logger = new Logger(InboxIngestService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cls: ClsService,
    private readonly tenantContext: TenantContextService,
    private readonly defaults: OperationalDefaultsService,
    private readonly outbound: InboxOutboundService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Para quien no tiene contexto de inmobiliaria (webhooks, formulario público): lo crea y la fija. */
  async receive(tenantId: string, input: InboundInput): Promise<IngestResult> {
    return this.cls.run({ ifNested: 'override' }, async () => {
      this.tenantContext.setTenantId(tenantId);
      return this.receiveInContext(input);
    });
  }

  /**
   * Un mensaje que proveedor ya entregó y que quedó guardado en `inbound_messages`.
   * Es idempotente: si el aviso se reintenta y el mensaje ya está en una consulta, no
   * lo duplica; si se cortó antes de llegar a la consulta, lo completa.
   */
  async receiveStored(
    tenantId: string,
    providerMsgId: string,
    input: Omit<InboundInput, 'inboundMessageId'>,
  ): Promise<IngestResult | null> {
    return this.cls.run({ ifNested: 'override' }, async () => {
      this.tenantContext.setTenantId(tenantId);
      const row = await this.prisma.client.inboundMessage.findFirst({
        where: { providerMsgId },
        select: { id: true, conversationMessage: { select: { id: true } } },
      });
      if (!row || row.conversationMessage) return null;
      return this.receiveInContext({ ...input, inboundMessageId: row.id });
    });
  }

  async receiveInContext(input: InboundInput): Promise<IngestResult> {
    const tenantId = this.tenantContext.getTenantId()!;
    const db = this.prisma.client;
    const settings = (await this.defaults.get(tenantId)).inbox;
    const since = new Date(input.at.getTime() - settings.threadWindowHours * 3_600_000);

    const thread = await db.conversation.findFirst({
      where: {
        channel: input.channel,
        address: input.address,
        status: { not: ConversationStatus.Archivada },
        lastMessageAt: { gte: since },
      },
      orderBy: [{ lastMessageAt: 'desc' }, { id: 'asc' }],
    });
    const result = thread
      ? await this.appendToThread(thread, input, settings)
      : await this.openThread(tenantId, input, settings);

    try {
      await this.afterReceive(tenantId, result, input, settings);
    } catch (err) {
      this.logger.error(`Inbox follow-up failed: conversationId=${result.conversationId} error=${(err as Error).message}`);
    }
    return result;
  }

  // ─── Abrir y seguir un hilo ────────────────────────────

  private async openThread(tenantId: string, input: InboundInput, settings: InboxSettings): Promise<IngestResult> {
    const db = this.prisma.client;
    const personId = input.personId ?? (await this.matchPerson(tenantId, input.channel, input.address));
    const lead = await this.findLead(input.leadId, personId);
    const assigneeUserId = await this.pickAssignee(
      input.assigneeUserId ?? lead?.assignedToUserId ?? settings.defaultAssigneeUserId,
    );
    const answered = input.answered === true;

    const conversation = await db.$transaction(async (tx: any) => {
      const created = await tx.conversation.create({
        data: {
          channel: input.channel,
          address: input.address,
          counterpartName: input.name?.trim() || null,
          subject: input.subject?.trim() || null,
          status: initialStatus(answered, assigneeUserId),
          personId,
          leadId: lead?.id ?? null,
          relatedType: input.relatedType ?? null,
          relatedId: input.relatedId ?? null,
          assigneeUserId,
          firstResponseAt: answered ? input.at : null,
          slaDueAt: answered ? null : computeSlaDueAt(input.at, settings.slaMinutes, settings.businessHours),
          unread: answered ? 0 : 1,
          lastMessageAt: input.at,
        },
        select: { id: true },
      });
      await tx.conversationMessage.create({ data: this.messageData(created.id, input) });
      return created;
    });
    return { conversationId: conversation.id, created: true, reopened: false };
  }

  /** El interés indicado o, si no, el más reciente y activo de la persona. */
  private async findLead(leadId: string | null | undefined, personId: string | null) {
    const select = { id: true, assignedToUserId: true };
    if (leadId) return this.prisma.client.lead.findFirst({ where: { id: leadId }, select });
    if (!personId) return null;
    return this.prisma.client.lead.findFirst({
      where: { personId, isActive: true },
      orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
      select,
    });
  }

  private async appendToThread(
    thread: { id: string; status: string; assigneeUserId: string | null; personId: string | null; lastMessageAt: Date },
    input: InboundInput,
    settings: InboxSettings,
  ): Promise<IngestResult> {
    const db = this.prisma.client;
    const reopened = thread.status === ConversationStatus.Resuelta;
    const data: Record<string, unknown> = {
      lastMessageAt: input.at > thread.lastMessageAt ? input.at : thread.lastMessageAt,
    };
    if (input.answered !== true) data.unread = { increment: 1 };
    if (reopened) {
      // Una consulta resuelta que vuelve a escribir es trabajo nuevo: plazo nuevo.
      Object.assign(data, {
        status: thread.assigneeUserId ? ConversationStatus.Asignada : ConversationStatus.Nueva,
        firstResponseAt: null,
        slaBreachedAt: null,
        slaDueAt: computeSlaDueAt(input.at, settings.slaMinutes, settings.businessHours),
      });
    } else if (thread.status === ConversationStatus.Esperando) {
      data.status = ConversationStatus.EnCurso;
    }
    if (!thread.personId && input.personId) data.personId = input.personId;

    await db.$transaction(async (tx: any) => {
      await tx.conversationMessage.create({ data: this.messageData(thread.id, input) });
      await tx.conversation.update({ where: { id: thread.id }, data });
    });
    return { conversationId: thread.id, created: false, reopened };
  }

  private messageData(conversationId: string, input: InboundInput) {
    return {
      conversationId,
      direction: MessageDirection.In,
      body: input.body.slice(0, PREVIEW_MAX),
      inboundMessageId: input.inboundMessageId ?? null,
      authorUserId: input.authorUserId ?? null,
      at: input.at,
    };
  }

  // ─── Contraparte y responsable ─────────────────────────

  /** Un usuario activo de la inmobiliaria, o null. */
  private async pickAssignee(userId: string | null | undefined): Promise<string | null> {
    if (!userId) return null;
    const user = await this.prisma.client.user.findFirst({ where: { id: userId, isActive: true }, select: { id: true } });
    return user?.id ?? null;
  }

  /**
   * Persona de la cartera que escribe: por mail exacto (sin mayúsculas) o por teléfono
   * comparado con la misma normalización de calidad de datos. Con más de una coincidencia
   * se toma la de menor id (la misma regla que usa la mensajería).
   */
  async matchPerson(tenantId: string, channel: ConversationChannel, address: string): Promise<string | null> {
    const db = this.prisma.client;
    if (channel === ConversationChannel.Email || address.includes('@')) {
      const email = normalizeEmail(address);
      if (!email) return null;
      const person = await db.person.findFirst({
        where: { email: { equals: email, mode: 'insensitive' } },
        orderBy: { id: 'asc' },
        select: { id: true },
      });
      return person?.id ?? null;
    }
    const national = nationalPhone(address);
    if (!national) return null;
    const tail = `%${national.slice(-8)}`;
    const rows: { id: string; phone: string | null; phone2: string | null }[] = await this.prisma.baseClient.$queryRaw`
      SELECT "id", "phone", "phone2" FROM "persons"
      WHERE "tenantId" = ${tenantId}
        AND (regexp_replace(coalesce("phone", ''), '\\D', '', 'g') LIKE ${tail}
          OR regexp_replace(coalesce("phone2", ''), '\\D', '', 'g') LIKE ${tail})
      ORDER BY "id"`;
    return rows.find((r) => nationalPhone(r.phone) === national || nationalPhone(r.phone2) === national)?.id ?? null;
  }

  // ─── Avisos y autorrespuesta ───────────────────────────

  private async afterReceive(tenantId: string, result: IngestResult, input: InboundInput, settings: InboxSettings): Promise<void> {
    const conv = await this.prisma.client.conversation.findFirst({
      where: { id: result.conversationId },
      select: { id: true, channel: true, address: true, personId: true, assigneeUserId: true, counterpartName: true, subject: true },
    });
    if (!conv) return;
    const label = conv.counterpartName ?? conv.address;
    if (input.answered !== true && (result.created || result.reopened)) {
      await this.notifyResponsible(tenantId, conv.assigneeUserId, {
        type: conv.assigneeUserId ? 'InboxAssigned' : 'InboundMessageReceived',
        title: conv.assigneeUserId ? 'Te asignaron una consulta nueva' : 'Consulta nueva sin responsable',
        message: `${label} escribió por ${input.channel}. Primera respuesta antes de ${settings.slaMinutes} minutos.`,
        entityId: conv.id,
      });
    } else if (input.answered !== true) {
      await this.notifyResponsible(tenantId, conv.assigneeUserId, {
        type: 'InboundMessageReceived',
        title: 'Nuevo mensaje en una consulta',
        message: `${label} escribió de nuevo por ${input.channel}.`,
        entityId: conv.id,
      });
    }
    if (result.created && input.autoreply !== false && input.answered !== true) {
      await this.autoReply(tenantId, conv, input.channel, settings);
    }
  }

  /** Al responsable; si no hay, a Admin y Gerente. */
  private async notifyResponsible(
    tenantId: string,
    assigneeUserId: string | null,
    n: { type: string; title: string; message: string; entityId: string },
  ): Promise<void> {
    const userIds = assigneeUserId
      ? [assigneeUserId]
      : (await findStaff(this.prisma, tenantId, MANAGEMENT_ROLES, { id: true })).map((u) => u.id);
    for (const userId of userIds) {
      await this.notifications.createNotification({ tenantId, userId, entityType: 'Conversation', ...n });
    }
  }

  /**
   * Primera respuesta automática, una sola por consulta (la clave de idempotencia es la
   * consulta). Respeta el modo del ambiente y la baja (la mensajería los aplica al
   * despachar), y no sale por WhatsApp fuera de la ventana de 24 horas ni a una
   * dirección automática. Que la autorrespuesta no salga no detiene el plazo humano.
   */
  private async autoReply(
    tenantId: string,
    conv: { id: string; channel: string; address: string; personId: string | null; counterpartName: string | null; subject: string | null },
    channel: ConversationChannel,
    settings: InboxSettings,
  ): Promise<void> {
    if (!settings.autoreply.enabled || channel === ConversationChannel.Telefono) return;
    if (channel === ConversationChannel.Email && NO_REPLY_LOCAL_PART.test(conv.address.split('@')[0] ?? '')) return;

    const resolved = await this.outbound.resolveRoute(conv);
    if (!resolved.ok) {
      this.logger.log(`Autoreply skipped: conversationId=${conv.id} reason=${resolved.error}`);
      return;
    }
    const tenant = await this.prisma.baseClient.tenant.findUnique({ where: { id: tenantId }, select: { name: true } });
    const agency = tenant?.name ?? '';
    const template = settings.autoreply.texts[channel as 'WhatsApp' | 'Email' | 'Web'];
    const text = renderInboxText(template, { name: firstName(conv.counterpartName), agency });
    const subject = `Recibimos tu consulta - ${agency}`.trim();

    const queued = await this.prisma.client.$transaction(async (tx: any) => {
      const enqueued = await this.outbound.enqueue(tx, {
        conversation: conv,
        route: resolved.route,
        subject,
        text,
        agency,
        idempotencyKey: `inbox-autoreply:${conv.id}`,
      });
      if (enqueued.created) {
        await tx.conversationMessage.create({
          data: {
            conversationId: conv.id,
            direction: MessageDirection.Out,
            body: text,
            outboxMessageId: enqueued.id,
            isAutoReply: true,
            at: new Date(),
          },
        });
        await tx.conversation.update({ where: { id: conv.id }, data: { autoRepliedAt: new Date() } });
      }
      return enqueued;
    });
    this.logger.log(`Autoreply queued: conversationId=${conv.id} outboxId=${queued.id} created=${queued.created}`);
  }
}

function initialStatus(answered: boolean, assigneeUserId: string | null): ConversationStatus {
  if (answered) return ConversationStatus.EnCurso;
  return assigneeUserId ? ConversationStatus.Asignada : ConversationStatus.Nueva;
}

function firstName(full: string | null): string {
  return (full ?? '').trim().split(/\s+/)[0] ?? '';
}
