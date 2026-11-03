import { Inject, Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import {
  AR_TIME_ZONE,
  MESSAGE_TEMPLATES,
  MessageChannel,
  MessageStatus,
  OwnerStatementStatus,
  isInsideSendingWindow,
  nextSendingWindowStart,
  redactMessageVars,
  type MessageTemplateKey,
  type SendingWindow,
} from '@realfy/shared';
import { CronBaseService } from '../../common/scheduler/cron.service';
import { TenantCron } from '../../common/scheduler/tenant-cron';
import { PrismaService } from '../../common/prisma/prisma.service';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { consentBlock, latestConsent } from '../../common/messaging/consent-policy';
import { NotificationsService } from '../notifications/notifications.service';
import { notifyManagement } from './notify-management';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { MessageAttachmentsService } from './message-attachments.service';
import { MESSAGE_PROVIDERS, type MessageProvider, type MessageAttachment } from './providers/message-provider';

/** Mensajes que toma cada vuelta por inmobiliaria. */
const DISPATCH_BATCH = 50;
/** Intentos antes de darlo por fallido. */
export const MAX_ATTEMPTS = 5;
/** Espera antes de cada reintento, en minutos (después del intento 1, 2, 3, 4). */
const BACKOFF_MINUTES = [1, 5, 30, 120] as const;
/**
 * Un mensaje que quedó "enviándose" más de este tiempo es de una vuelta que se
 * cortó (un reinicio). No se reintenta solo: puede haber salido y WhatsApp no
 * deduplica; queda fallido para que una persona decida reintentarlo.
 */
export const STALE_SENDING_MS = 15 * 60 * 1000;
/** Sin proveedor configurado, el mensaje se vuelve a mirar cada cinco minutos. */
const PROVIDER_RECHECK_MS = 5 * 60 * 1000;

export interface DispatchSummary {
  sent: number;
  retried: number;
  failed: number;
  blocked: number;
  /** Siguen pendientes (modo apagado, sin proveedor o fuera de horario). */
  held: number;
}

const emptySummary = (): DispatchSummary => ({ sent: 0, retried: 0, failed: 0, blocked: 0, held: 0 });

/**
 * Despacho de la bandeja de salida (ADR-0013). Cada minuto recorre las
 * inmobiliarias activas y, por cada mensaje pendiente que ya venció, aplica en
 * este orden: modo del ambiente, proveedor configurado, lista permitida,
 * consentimiento y horario permitido; recién entonces lo toma, genera el PDF y
 * lo manda. Un error de envío nunca toca la operación que lo encoló.
 */
@Injectable()
export class OutboxDispatcherService extends CronBaseService {
  protected readonly logger = new Logger(OutboxDispatcherService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantCron: TenantCron,
    private readonly config: MessagingConfigService,
    private readonly defaults: OperationalDefaultsService,
    private readonly attachments: MessageAttachmentsService,
    private readonly notifications: NotificationsService,
    @Inject(MESSAGE_PROVIDERS) private readonly providers: MessageProvider[],
  ) {
    super();
  }

  @Cron('* * * * *', { name: 'outbox-dispatch', timeZone: AR_TIME_ZONE })
  async handleDispatch(): Promise<void> {
    await this.runGuarded(async () => {
      const total = emptySummary();
      const summary = await this.tenantCron.forEachActiveTenant('outbox-dispatch', async (tenantId) => {
        const s = await this.dispatchTenant(tenantId);
        for (const k of Object.keys(total) as (keyof DispatchSummary)[]) total[k] += s[k];
      });
      if (total.sent + total.failed + total.retried + total.blocked > 0) {
        this.logger.log(
          `Cron job completed: outbox-dispatch tenants=${summary.ok + summary.failed} sent=${total.sent} retried=${total.retried} failed=${total.failed} blocked=${total.blocked} held=${total.held}`,
        );
      }
    }, 'outbox-dispatch');
  }

  /** Una vuelta para la inmobiliaria del contexto. */
  async dispatchTenant(tenantId: string, now: Date = new Date()): Promise<DispatchSummary> {
    const summary = emptySummary();
    await this.failStale(now);

    if (this.config.mode === 'off') {
      // Los encolados antes de apagar el modo también muestran por qué no salen.
      const { count } = await this.prisma.client.messageOutbox.updateMany({
        where: { status: MessageStatus.Pending, OR: [{ statusReason: null }, { statusReason: { not: 'MESSAGING_OFF' } }] },
        data: { statusReason: 'MESSAGING_OFF' },
      });
      summary.held = count;
      return summary;
    }

    const due = await this.prisma.client.messageOutbox.findMany({
      where: {
        status: MessageStatus.Pending,
        scheduledAt: { lte: now },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
      orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
      take: DISPATCH_BATCH,
    });
    if (due.length === 0) return summary;

    const window: SendingWindow = (await this.defaults.get(tenantId)).messaging;
    const missingProvider = new Set<MessageChannel>();
    for (const message of due) {
      const outcome = await this.dispatchOne(message, window, now);
      summary[outcome]++;
      const channel = message.channel as MessageChannel;
      if (outcome === 'held' && !this.provider(channel)?.isConfigured()) missingProvider.add(channel);
    }
    for (const channel of [...missingProvider].sort((a, b) => a.localeCompare(b))) {
      await this.alertMissingProvider(tenantId, channel);
    }
    return summary;
  }

  private provider(channel: MessageChannel): MessageProvider | undefined {
    return this.providers.find((p) => p.channel === channel);
  }

  private async dispatchOne(message: any, window: SendingWindow, now: Date): Promise<keyof DispatchSummary> {
    const db = this.prisma.client;
    const hold = (statusReason: string, nextAttemptAt: Date | null = null) =>
      db.messageOutbox.update({ where: { id: message.id }, data: { statusReason, nextAttemptAt } });
    const block = (statusReason: string) =>
      db.messageOutbox.update({ where: { id: message.id }, data: { status: MessageStatus.Blocked, statusReason } });

    const provider = this.provider(message.channel);
    if (!provider?.isConfigured()) {
      await hold('PROVIDER_NOT_CONFIGURED', new Date(now.getTime() + PROVIDER_RECHECK_MS));
      return 'held';
    }
    if (!this.config.allowsAddress(message.to)) {
      await block('NOT_IN_ALLOWLIST');
      return 'blocked';
    }
    const latest = await latestConsent(db, { channel: message.channel, personId: message.personId, address: message.to });
    const consent = consentBlock(latest, message.channel, message.templateKey);
    if (consent) {
      await block(consent);
      return 'blocked';
    }
    const audience = MESSAGE_TEMPLATES[message.templateKey as MessageTemplateKey]?.audience;
    if (audience === 'client' && !isInsideSendingWindow(now, window)) {
      await hold('QUIET_HOURS', nextSendingWindowStart(now, window));
      return 'held';
    }

    const attempts = message.attempts + 1;
    // Tomarlo: otra instancia del proceso no lo manda dos veces.
    const claimed = await db.messageOutbox.updateMany({
      where: { id: message.id, status: MessageStatus.Pending },
      data: { status: MessageStatus.Sending, statusReason: null, attempts: { increment: 1 } },
    });
    if (claimed.count === 0) return 'held';

    let result;
    try {
      const attachment = await this.attachmentFor(message);
      result = await provider.send({
        id: message.id,
        channel: message.channel,
        to: message.to,
        templateKey: message.templateKey,
        vars: (message.vars ?? {}) as Record<string, string>,
        idempotencyKey: message.idempotencyKey,
        attachment,
      });
    } catch (err) {
      // El PDF no se pudo generar (documento borrado o anulado): reintentar no lo arregla.
      result = { ok: false as const, error: `ATTACHMENT_UNAVAILABLE: ${(err as Error).message}`, retryable: false };
    }

    if (result.ok) {
      await db.messageOutbox.update({
        where: { id: message.id },
        data: {
          status: MessageStatus.Sent,
          providerMsgId: result.providerMsgId,
          sentAt: now,
          error: null,
          nextAttemptAt: null,
          vars: redactMessageVars(message.templateKey, message.vars),
        },
      });
      await this.afterSent(message, now);
      return 'sent';
    }

    if (result.retryable && attempts < MAX_ATTEMPTS) {
      const wait = BACKOFF_MINUTES[Math.min(attempts, BACKOFF_MINUTES.length) - 1];
      await db.messageOutbox.update({
        where: { id: message.id },
        data: { status: MessageStatus.Pending, error: result.error, nextAttemptAt: new Date(now.getTime() + wait * 60_000) },
      });
      return 'retried';
    }

    await db.messageOutbox.update({
      where: { id: message.id },
      data: {
        status: MessageStatus.Failed,
        error: result.error,
        nextAttemptAt: null,
        vars: redactMessageVars(message.templateKey, message.vars),
      },
    });
    this.logger.warn(`Message failed: id=${message.id} attempts=${attempts} error=${result.error}`);
    await notifyManagement(this.prisma, this.notifications, message.tenantId, {
      type: 'MessageFailed',
      title: 'Un mensaje no se pudo enviar',
      message: `El mensaje a ${message.to} (${message.templateKey}) no salió: ${result.error}`,
      entityType: 'MessageOutbox',
      entityId: message.id,
    });
    return 'failed';
  }

  /**
   * Un estado de cuenta emitido pasa a Enviado recién cuando el proveedor
   * aceptó el mensaje, no al encolarlo (la lección de DEF-24).
   */
  private async afterSent(message: any, now: Date): Promise<void> {
    if (message.relatedType !== 'OwnerStatement' || !message.relatedId) return;
    await this.prisma.client.ownerStatement.updateMany({
      where: { id: message.relatedId, status: OwnerStatementStatus.Emitido },
      data: { status: OwnerStatementStatus.Enviado, sentAt: now },
    });
  }

  private async attachmentFor(message: any): Promise<MessageAttachment | undefined> {
    const kind = this.attachments.kindFor(message.templateKey);
    if (!kind || !message.relatedId) return undefined;
    return this.attachments.resolve(kind, message.relatedId);
  }

  private async failStale(now: Date): Promise<void> {
    const { count } = await this.prisma.client.messageOutbox.updateMany({
      where: { status: MessageStatus.Sending, updatedAt: { lt: new Date(now.getTime() - STALE_SENDING_MS) } },
      data: { status: MessageStatus.Failed, error: 'INTERRUPTED: the dispatch stopped while sending; retry by hand' },
    });
    if (count > 0) this.logger.warn(`Interrupted messages marked as failed: ${count}`);
  }

  /** Una vez por día y por canal: hay mensajes trabados porque falta configurar el proveedor. */
  private async alertMissingProvider(tenantId: string, channel: MessageChannel): Promise<void> {
    const variables = channel === MessageChannel.Email ? 'RESEND_API_KEY' : 'WHATSAPP_TOKEN y WHATSAPP_PHONE_NUMBER_ID';
    await notifyManagement(this.prisma, this.notifications, tenantId, {
      type: 'SystemAlert',
      title: `Mensajes por ${channel === MessageChannel.Email ? 'mail' : 'WhatsApp'} sin enviar`,
      message: `La mensajería está activa pero falta configurar el proveedor (${variables}). Los mensajes quedan pendientes.`,
      entityType: 'Messaging',
      entityId: `provider-${channel}`,
    });
  }
}
