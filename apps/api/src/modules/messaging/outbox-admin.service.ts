import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import {
  MESSAGE_TEMPLATES,
  MessageChannel,
  MessageStatus,
  OutboxFilterSchema,
  REDACTED,
  personName,
  redactMessageVars,
  type MessagingSettings,
  type OutboxItem,
  type OutboxPage,
} from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { parseOrThrow } from '../../common/validation/zod';
import { OperationalDefaultsService } from '../tenants/operational-defaults.service';
import { MESSAGE_PROVIDERS, type MessageProvider } from './providers/message-provider';

/** Estados desde los que una persona puede volver a encolar un mensaje. */
const RETRYABLE: string[] = [MessageStatus.Failed, MessageStatus.Blocked, MessageStatus.Cancelled];
/** Estados que todavía se pueden cancelar (no salieron). */
const CANCELLABLE: string[] = [MessageStatus.Pending, MessageStatus.Blocked];

/** Bandeja de salida vista por el personal: lista, reintento, cancelación y configuración. */
@Injectable()
export class OutboxAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly config: MessagingConfigService,
    private readonly defaults: OperationalDefaultsService,
    @Inject(MESSAGE_PROVIDERS) private readonly providers: MessageProvider[],
  ) {}

  async list(query: unknown): Promise<OutboxPage> {
    const f = parseOrThrow(OutboxFilterSchema, query, 'Invalid filter parameters');
    const where: Record<string, unknown> = {};
    if (f.status) where.status = f.status;
    if (f.channel) where.channel = f.channel;
    if (f.personId) where.personId = f.personId;
    if (f.relatedType) where.relatedType = f.relatedType;
    if (f.relatedId) where.relatedId = f.relatedId;
    const [rows, total] = await Promise.all([
      this.prisma.client.messageOutbox.findMany({
        where,
        include: { person: { select: { firstName: true, lastName: true } } },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (f.page - 1) * f.limit,
        take: f.limit,
      }),
      this.prisma.client.messageOutbox.count({ where }),
    ]);
    return {
      items: rows.map((r: any) => toItem(r)),
      total,
      page: f.page,
      limit: f.limit,
      totalPages: Math.ceil(total / f.limit),
    };
  }

  /**
   * Vuelve a encolar un mensaje fallido, bloqueado o cancelado: se revisan otra
   * vez el modo, el consentimiento y el horario. Un mensaje con secretos ya
   * borrados (una invitación) no se puede reintentar: se reenvía la invitación.
   */
  async retry(id: string): Promise<OutboxItem> {
    const row = await this.require(id);
    if (!RETRYABLE.includes(row.status)) {
      throw new BadRequestException({
        error: 'MESSAGE_NOT_RETRYABLE',
        message: `A ${row.status} message cannot be retried`,
        status: row.status,
      });
    }
    const secrets = MESSAGE_TEMPLATES[row.templateKey as keyof typeof MESSAGE_TEMPLATES]?.secretVars ?? [];
    const vars = (row.vars ?? {}) as Record<string, unknown>;
    if (secrets.some((k) => typeof vars[k] !== 'string' || vars[k] === REDACTED)) {
      throw new BadRequestException({
        error: 'MESSAGE_EXPIRED',
        message: 'The message carried a one-time link that is no longer stored; send it again from its screen',
      });
    }
    const updated = await this.prisma.client.messageOutbox.update({
      where: { id },
      data: {
        status: MessageStatus.Pending,
        statusReason: this.config.mode === 'off' ? 'MESSAGING_OFF' : null,
        error: null,
        attempts: 0,
        nextAttemptAt: null,
        scheduledAt: new Date(),
      },
      include: { person: { select: { firstName: true, lastName: true } } },
    });
    return toItem(updated);
  }

  async cancel(id: string): Promise<OutboxItem> {
    const row = await this.require(id);
    if (!CANCELLABLE.includes(row.status)) {
      throw new BadRequestException({
        error: 'MESSAGE_NOT_CANCELLABLE',
        message: `A ${row.status} message cannot be cancelled`,
        status: row.status,
      });
    }
    // Solo si sigue sin tomar: uno que el despacho ya está mandando no se cancela.
    const { count } = await this.prisma.client.messageOutbox.updateMany({
      where: { id, status: { in: CANCELLABLE as any[] } },
      data: { status: MessageStatus.Cancelled, nextAttemptAt: null, vars: redactMessageVars(row.templateKey, row.vars) },
    });
    if (count === 0) {
      throw new BadRequestException({ error: 'MESSAGE_NOT_CANCELLABLE', message: 'The message is being sent' });
    }
    return toItem(await this.require(id));
  }

  async settings(): Promise<MessagingSettings> {
    const tenantId = this.tenantContext.getTenantId()!;
    const { messaging } = await this.defaults.get(tenantId);
    const email = this.providers.find((p) => p.channel === MessageChannel.Email);
    const whatsapp = this.providers.find((p) => p.channel === MessageChannel.WhatsApp);
    const mode = this.config.mode;
    return {
      mode,
      allowlistCount: mode === 'allowlist' ? this.config.allowlist.size : 0,
      providers: {
        email: {
          configured: email?.isConfigured() ?? false,
          from: email?.isConfigured() ? this.config.resend.from : null,
          webhook: Boolean(this.config.resend.webhookSecret),
        },
        whatsapp: {
          configured: whatsapp?.isConfigured() ?? false,
          webhook: Boolean(this.config.whatsapp.appSecret && this.config.whatsapp.verifyToken),
        },
      },
      sendingWindow: messaging,
      templates: Object.values(MESSAGE_TEMPLATES),
    };
  }

  private async require(id: string): Promise<any> {
    const row = await this.prisma.client.messageOutbox.findFirst({
      where: { id },
      include: { person: { select: { firstName: true, lastName: true } } },
    });
    if (!row) throw new NotFoundException({ error: 'MESSAGE_NOT_FOUND', message: 'Message not found' });
    return row;
  }
}

const iso = (d: Date | null | undefined) => (d ? d.toISOString() : null);

/** Fila -> respuesta, sin variables secretas. */
export function toItem(r: any): OutboxItem {
  return {
    id: r.id,
    channel: r.channel,
    personId: r.personId ?? null,
    personName: r.person ? personName(r.person) : null,
    to: r.to,
    templateKey: r.templateKey,
    vars: redactMessageVars(r.templateKey, r.vars),
    status: r.status,
    statusReason: r.statusReason ?? null,
    error: r.error ?? null,
    attempts: r.attempts,
    nextAttemptAt: iso(r.nextAttemptAt),
    scheduledAt: r.scheduledAt.toISOString(),
    sentAt: iso(r.sentAt),
    deliveredAt: iso(r.deliveredAt),
    relatedType: r.relatedType ?? null,
    relatedId: r.relatedId ?? null,
    createdAt: r.createdAt.toISOString(),
  };
}
