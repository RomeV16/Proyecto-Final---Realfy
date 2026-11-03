import { Injectable, Logger } from '@nestjs/common';
import {
  ConsentSource,
  MessageChannel,
  MessageStatus,
  ConversationChannel,
  normalizeEmail,
  normalizePhone,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { NotificationsService } from '../notifications/notifications.service';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { InboxIngestService } from '../inbox/inbox-ingest.service';
import { notifyManagement } from './notify-management';
import { ConsentsService } from './consents.service';

/** Palabras con que una persona pide la baja respondiendo un WhatsApp. */
const OPT_OUT_WORDS = new Set(['BAJA', 'STOP']);

/** Orden de los estados de entrega: un aviso viejo que llega tarde no hace retroceder el estado. */
const RANK: Record<string, number> = {
  [MessageStatus.Sending]: 0,
  [MessageStatus.Sent]: 1,
  [MessageStatus.Delivered]: 2,
  [MessageStatus.Read]: 3,
};

interface StatusUpdate {
  providerMsgId: string;
  status: MessageStatus.Sent | MessageStatus.Delivered | MessageStatus.Read | MessageStatus.Failed;
  at: Date;
  error?: string;
}

interface WhatsAppValue {
  metadata?: { phone_number_id?: string };
  contacts?: { wa_id?: string; profile?: { name?: string } }[];
  statuses?: { id?: string; status?: string; timestamp?: string; errors?: { code?: number; title?: string; message?: string }[] }[];
  messages?: { id?: string; from?: string; timestamp?: string; type?: string; text?: { body?: string }; button?: { text?: string } }[];
}

interface ResendEvent {
  type?: string;
  created_at?: string;
  data?: { email_id?: string; to?: string[] | string; bounce?: { message?: string } };
}

const WA_STATUS: Record<string, StatusUpdate['status']> = {
  sent: MessageStatus.Sent,
  delivered: MessageStatus.Delivered,
  read: MessageStatus.Read,
  failed: MessageStatus.Failed,
};

const RESEND_STATUS: Record<string, StatusUpdate['status']> = {
  'email.sent': MessageStatus.Sent,
  'email.delivered': MessageStatus.Delivered,
  'email.bounced': MessageStatus.Failed,
  'email.failed': MessageStatus.Failed,
};

/**
 * Lo que llega de los proveedores, ya con la firma verificada. Corre sin
 * contexto de inmobiliaria: cada cambio se ubica por el id del proveedor (que
 * es único) o, para un mensaje entrante, por el último mensaje que se le mandó
 * a ese número. Nada de lo que se responde depende de los datos.
 */
@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly consents: ConsentsService,
    private readonly notifications: NotificationsService,
    private readonly inbox: InboxIngestService,
    private readonly config: MessagingConfigService,
  ) {}

  async handleWhatsApp(payload: unknown, phoneNumberId: string | undefined): Promise<void> {
    const entries = (payload as { entry?: { changes?: { field?: string; value?: WhatsAppValue }[] }[] })?.entry ?? [];
    for (const change of entries.flatMap((e) => e.changes ?? [])) {
      const value = change.value;
      if (change.field !== 'messages' || !value) continue;
      // Un número que no es el de este ambiente no se procesa.
      if (phoneNumberId && value.metadata?.phone_number_id && value.metadata.phone_number_id !== phoneNumberId) continue;
      for (const s of value.statuses ?? []) {
        const status = s.status ? WA_STATUS[s.status] : undefined;
        if (!s.id || !status) continue;
        const err = s.errors?.[0];
        await this.applyStatus({
          providerMsgId: s.id,
          status,
          at: fromUnix(s.timestamp),
          error: err ? `WHATSAPP_${err.code ?? ''}: ${err.message ?? err.title ?? 'failed'}` : undefined,
        });
      }
      for (const m of value.messages ?? []) {
        await this.inbound(m, value.contacts?.find((c) => normalizePhone(c.wa_id) === normalizePhone(m.from))?.profile?.name);
      }
    }
  }

  async handleResend(event: ResendEvent): Promise<void> {
    const type = event?.type ?? '';
    const id = event?.data?.email_id;
    if (!id) return;
    if (type === 'email.complained') {
      await this.complaint(id);
      return;
    }
    const status = RESEND_STATUS[type];
    if (!status) return;
    await this.applyStatus({
      providerMsgId: id,
      status,
      at: event.created_at ? new Date(event.created_at) : new Date(),
      error:
        status === MessageStatus.Failed
          ? `${type === 'email.bounced' ? 'BOUNCED' : 'FAILED'}: ${event.data?.bounce?.message ?? 'rejected by the receiving server'}`
          : undefined,
    });
  }

  /** Actualiza el estado de entrega sin retroceder (leído no vuelve a entregado). */
  async applyStatus(u: StatusUpdate): Promise<void> {
    const db = this.prisma.baseClient;
    const row = await db.messageOutbox.findUnique({
      where: { providerMsgId: u.providerMsgId },
      select: { id: true, status: true, tenantId: true, relatedType: true, relatedId: true },
    });
    if (!row) return;
    if (u.status === MessageStatus.Failed) {
      if (row.status !== MessageStatus.Sent && row.status !== MessageStatus.Sending) return;
      await db.messageOutbox.update({ where: { id: row.id }, data: { status: MessageStatus.Failed, error: u.error ?? 'FAILED' } });
      return;
    }
    if ((RANK[row.status] ?? 99) >= RANK[u.status]) return;
    await db.messageOutbox.update({
      where: { id: row.id },
      data: {
        status: u.status,
        ...(u.status === MessageStatus.Delivered || u.status === MessageStatus.Read ? { deliveredAt: u.at } : {}),
      },
    });
  }

  /** Mensaje entrante de WhatsApp: se guarda y, si pide la baja, se registra. */
  private async inbound(m: NonNullable<WhatsAppValue['messages']>[number], profileName?: string): Promise<void> {
    const from = normalizePhone(m.from);
    if (!m.id || !from) return;
    const db = this.prisma.baseClient;
    const last = await this.resolveTenant(from);
    if (!last) {
      this.logger.warn('Inbound WhatsApp message from an unknown number: discarded');
      return;
    }
    const body = (m.text?.body ?? m.button?.text ?? `[${m.type ?? 'mensaje'}]`).slice(0, 4000);
    const personIds = await this.personsByPhone(last.tenantId, from);
    const personId = last.personId ?? personIds[0] ?? null;
    const { count } = await db.inboundMessage.createMany({
      data: [
        {
          tenantId: last.tenantId,
          channel: MessageChannel.WhatsApp,
          from,
          personId,
          body,
          providerMsgId: m.id,
          receivedAt: fromUnix(m.timestamp),
        },
      ],
      skipDuplicates: true,
    });
    const word = body.trim().toUpperCase();
    const optOut = OPT_OUT_WORDS.has(word);
    // Meta reintenta: una baja no se procesa dos veces; un mensaje sí se reintenta hasta que
    // llegue a la bandeja de consultas (ingestar es idempotente).
    if (count === 0 && optOut) return;

    if (optOut) {
      const ids = [...new Set([...(last.personId ? [last.personId] : []), ...personIds])];
      await this.consents.recordOptOut(db, {
        tenantId: last.tenantId,
        channel: MessageChannel.WhatsApp,
        address: from,
        source: ConsentSource.Inbound,
        personIds: ids,
      });
      await notifyManagement(this.prisma, this.notifications, last.tenantId, {
        type: 'ContactOptedOut',
        title: 'Un contacto pidió la baja de WhatsApp',
        message: `El número ${from} respondió ${word}: no se le mandan más mensajes por WhatsApp.`,
        entityType: 'Person',
        entityId: personId ?? `wa:${from}`,
      });
      return;
    }
    await this.inbox.receiveStored(last.tenantId, m.id, {
      channel: ConversationChannel.WhatsApp,
      address: from,
      name: profileName ?? null,
      body,
      at: fromUnix(m.timestamp),
      personId,
    });
  }

  /**
   * La inmobiliaria de un mensaje entrante: la del último mensaje que se le mandó a ese
   * número; si nunca se le escribió (una consulta nueva), la dueña del número de WhatsApp
   * del ambiente (WHATSAPP_TENANT_SLUG) o, sin esa variable, la única inmobiliaria activa.
   */
  private async resolveTenant(from: string): Promise<{ tenantId: string; personId: string | null } | null> {
    const db = this.prisma.baseClient;
    const last = await db.messageOutbox.findFirst({
      where: { channel: MessageChannel.WhatsApp, to: from, status: { not: MessageStatus.Pending } },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      select: { tenantId: true, personId: true },
    });
    if (last) return last;
    const slug = this.config.inbox.whatsappTenantSlug;
    const tenants = await db.tenant.findMany({
      where: { isActive: true, ...(slug ? { slug } : {}) },
      select: { id: true },
      orderBy: { id: 'asc' },
      take: 2,
    });
    return tenants.length === 1 ? { tenantId: tenants[0].id, personId: null } : null;
  }

  /** Queja de spam en un mail: es una baja del mail para esa dirección. */
  private async complaint(providerMsgId: string): Promise<void> {
    const db = this.prisma.baseClient;
    const row = await db.messageOutbox.findUnique({
      where: { providerMsgId },
      select: { tenantId: true, personId: true, to: true },
    });
    const address = normalizeEmail(row?.to);
    if (!row || !address) return;
    await this.consents.recordOptOut(db, {
      tenantId: row.tenantId,
      channel: MessageChannel.Email,
      address,
      source: ConsentSource.Complaint,
      personIds: row.personId ? [row.personId] : [],
    });
  }

  /** Personas de la inmobiliaria con ese teléfono (comparado normalizado). */
  private async personsByPhone(tenantId: string, phone: string): Promise<string[]> {
    const tail = `%${phone.slice(-10)}`;
    const rows: { id: string; phone: string | null; phone2: string | null }[] = await this.prisma.baseClient.$queryRaw`
      SELECT "id", "phone", "phone2" FROM "persons"
      WHERE "tenantId" = ${tenantId}
        AND (regexp_replace(coalesce("phone", ''), '\\D', '', 'g') LIKE ${tail}
          OR regexp_replace(coalesce("phone2", ''), '\\D', '', 'g') LIKE ${tail})
      ORDER BY "id"`;
    return rows.filter((r) => normalizePhone(r.phone) === phone || normalizePhone(r.phone2) === phone).map((r) => r.id);
  }

}

function fromUnix(ts: string | undefined): Date {
  const n = Number(ts);
  return Number.isFinite(n) && n > 0 ? new Date(n * 1000) : new Date();
}
