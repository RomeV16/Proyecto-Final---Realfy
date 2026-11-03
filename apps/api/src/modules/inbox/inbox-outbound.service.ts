import { Injectable } from '@nestjs/common';
import { ConsentStatus, ConversationChannel, MessageChannel, normalizeAddress } from '@realfy/shared';
import { createHash } from 'node:crypto';
import { latestConsent, type Db } from '../../common/messaging/consent-policy';
import { OutboxService, type EnqueuedMessage } from '../../common/messaging/outbox.service';
import { PrismaService } from '../../common/prisma/prisma.service';

/** Ventana de atención al cliente de WhatsApp: texto libre hasta 24 horas después del último mensaje de la persona. */
export const WHATSAPP_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ReplyRoute {
  channel: MessageChannel;
  to: string;
}

/** Por qué no se puede responder: ver `routeError`. */
export type RouteFailure = 'CONTACT_OPTED_OUT' | 'WHATSAPP_WINDOW_CLOSED' | 'NO_REPLY_CHANNEL';

export type RouteResult = { ok: true; route: ReplyRoute } | { ok: false; error: RouteFailure };

export interface RoutableConversation {
  id: string;
  channel: string;
  address: string;
  personId: string | null;
}

/**
 * Por dónde se le contesta a quien consultó (ADR-0013). Se prefiere el canal por el
 * que escribió; si no se puede, el mail; y WhatsApp solo con texto libre dentro de las
 * 24 horas del último mensaje que mandó esa persona por ahí (fuera de esa ventana hace
 * falta una plantilla aprobada, que una respuesta no tiene). Una baja se respeta
 * siempre, en cualquier canal.
 */
@Injectable()
export class InboxOutboundService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly outbox: OutboxService,
  ) {}

  /** Direcciones conocidas de la contraparte, por canal. */
  private async addresses(c: RoutableConversation): Promise<{ email: string | null; phone: string | null }> {
    const own = c.channel === ConversationChannel.Email || c.address.includes('@') ? 'email' : 'phone';
    let email = own === 'email' ? normalizeAddress(MessageChannel.Email, c.address) : null;
    let phone = own === 'phone' ? normalizeAddress(MessageChannel.WhatsApp, c.address) : null;
    if (c.personId && (!email || !phone)) {
      const person = await this.prisma.client.person.findFirst({
        where: { id: c.personId },
        select: { email: true, phone: true },
      });
      email = email ?? normalizeAddress(MessageChannel.Email, person?.email);
      phone = phone ?? normalizeAddress(MessageChannel.WhatsApp, person?.phone);
    }
    return { email, phone };
  }

  async whatsappWindowOpen(phone: string, now: Date): Promise<boolean> {
    const last = await this.prisma.client.inboundMessage.findFirst({
      where: { channel: MessageChannel.WhatsApp, from: phone, receivedAt: { gte: new Date(now.getTime() - WHATSAPP_WINDOW_MS) } },
      select: { id: true },
    });
    return Boolean(last);
  }

  async resolveRoute(c: RoutableConversation, now: Date = new Date()): Promise<RouteResult> {
    const { email, phone } = await this.addresses(c);
    const db = this.prisma.client;
    const order: MessageChannel[] =
      c.channel === ConversationChannel.WhatsApp
        ? [MessageChannel.WhatsApp, MessageChannel.Email]
        : [MessageChannel.Email, MessageChannel.WhatsApp];

    let optedOut = false;
    let windowClosed = false;
    for (const channel of order) {
      const to = channel === MessageChannel.Email ? email : phone;
      if (!to) continue;
      const consent = await latestConsent(db, { channel, personId: c.personId, address: to });
      if (consent?.status === ConsentStatus.OptOut) {
        optedOut = true;
        continue;
      }
      if (channel === MessageChannel.WhatsApp && !(await this.whatsappWindowOpen(to, now))) {
        windowClosed = true;
        continue;
      }
      return { ok: true, route: { channel, to } };
    }
    if (optedOut) return { ok: false, error: 'CONTACT_OPTED_OUT' };
    return { ok: false, error: windowClosed ? 'WHATSAPP_WINDOW_CLOSED' : 'NO_REPLY_CHANNEL' };
  }

  /** Clave de un envío manual: el mismo texto sobre el mismo último mensaje (doble clic) no se encola dos veces. */
  replyKey(conversationId: string, lastMessageId: string | null, body: string): string {
    const digest = createHash('sha256').update(`${conversationId}|${lastMessageId ?? ''}|${body}`).digest('hex').slice(0, 32);
    return `inbox-reply:${conversationId}:${digest}`;
  }

  async enqueue(
    db: Db,
    input: {
      conversation: RoutableConversation;
      route: ReplyRoute;
      subject: string;
      text: string;
      agency: string;
      idempotencyKey: string;
      createdByUserId?: string | null;
    },
  ): Promise<EnqueuedMessage> {
    return this.outbox.enqueue(db, {
      channel: input.route.channel,
      templateKey: 'inbox_message',
      vars: { subject: input.subject, text: input.text, agency: input.agency },
      personId: input.conversation.personId,
      to: input.route.to,
      relatedType: 'Conversation',
      relatedId: input.conversation.id,
      idempotencyKey: input.idempotencyKey,
      createdByUserId: input.createdByUserId ?? null,
    });
  }
}
