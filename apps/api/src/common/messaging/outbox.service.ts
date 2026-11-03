import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import {
  ConsentStatus,
  MESSAGE_TEMPLATES,
  MessageChannel,
  MessageStatus,
  normalizeAddress,
  type MessageTemplateKey,
} from '@realfy/shared';
import { latestConsent, type Db } from './consent-policy';
import { MessagingConfigService } from './messaging-config.service';
import type { MessageVars } from './message-templates';

export interface EnqueueInput {
  channel: MessageChannel;
  templateKey: MessageTemplateKey;
  vars: MessageVars;
  /** Persona destinataria; sin `to`, la dirección sale de su mail o su teléfono. */
  personId?: string | null;
  /** Dirección explícita (se normaliza). */
  to?: string | null;
  relatedType?: string;
  relatedId?: string;
  /**
   * Clave única del envío: la misma operación repetida (un doble clic, un
   * reintento del proceso) no encola dos mensajes.
   */
  idempotencyKey: string;
  scheduledAt?: Date;
  createdByUserId?: string | null;
}

export interface EnqueuedMessage {
  id: string;
  status: MessageStatus;
  statusReason: string | null;
  /** false si la clave ya existía: se devuelve el mensaje encolado antes. */
  created: boolean;
}

const OUTBOX_SELECT = { id: true, status: true, statusReason: true, idempotencyKey: true } as const;

/**
 * Encola mensajes en la bandeja de salida (ADR-0013). Corre dentro de la
 * transacción de quien llama (`db` puede ser el cliente o un `tx`): si la
 * operación de negocio se revierte, el mensaje no existe; si se confirma, el
 * mensaje queda y el despacho lo manda después. Nunca manda nada por sí mismo.
 */
@Injectable()
export class OutboxService {
  private readonly logger = new Logger(OutboxService.name);

  constructor(private readonly config: MessagingConfigService) {}

  async enqueue(db: Db, input: EnqueueInput): Promise<EnqueuedMessage> {
    const template = MESSAGE_TEMPLATES[input.templateKey];
    if (!template?.channels.includes(input.channel)) {
      throw new BadRequestException({
        error: 'MESSAGE_CHANNEL_NOT_SUPPORTED',
        message: `Template ${input.templateKey} cannot be sent by ${input.channel}`,
        templateKey: input.templateKey,
        channel: input.channel,
      });
    }

    const to = await this.resolveAddress(db, input);
    // Con el modo apagado el mensaje se guarda igual y se ve en la bandeja con el motivo.
    const statusReason = this.config.mode === 'off' ? 'MESSAGING_OFF' : null;

    // ON CONFLICT DO NOTHING: una clave repetida no aborta la transacción de quien llama.
    const { count } = await db.messageOutbox.createMany({
      data: [
        {
          channel: input.channel,
          personId: input.personId ?? null,
          to,
          templateKey: input.templateKey,
          vars: input.vars,
          status: MessageStatus.Pending,
          statusReason,
          relatedType: input.relatedType ?? null,
          relatedId: input.relatedId ?? null,
          idempotencyKey: input.idempotencyKey,
          scheduledAt: input.scheduledAt ?? new Date(),
          createdByUserId: input.createdByUserId ?? null,
        },
      ],
      skipDuplicates: true,
    });

    const row = await db.messageOutbox.findFirst({
      where: { idempotencyKey: input.idempotencyKey },
      select: OUTBOX_SELECT,
    });
    if (!row) {
      // La clave existe en otra inmobiliaria: no se revela nada de ese mensaje.
      throw new BadRequestException({ error: 'IDEMPOTENCY_KEY_CONFLICT', message: 'Idempotency key already used' });
    }
    if (count === 1) {
      this.logger.log(
        `Message queued: id=${row.id} template=${input.templateKey} channel=${input.channel} related=${input.relatedType ?? '-'}:${input.relatedId ?? '-'}`,
      );
    }
    return { id: row.id, status: row.status, statusReason: row.statusReason, created: count === 1 };
  }

  /**
   * Canal para avisarle algo a una persona de la cartera: WhatsApp si tiene
   * teléfono y dio el alta; si no, mail si tiene y no pidió la baja. Null si
   * no hay forma de avisarle.
   */
  async pickChannel(
    db: Db,
    person: { id: string; email?: string | null; phone?: string | null },
    templateKey: MessageTemplateKey,
  ): Promise<MessageChannel | null> {
    const channels = MESSAGE_TEMPLATES[templateKey].channels;
    const phone = normalizeAddress(MessageChannel.WhatsApp, person.phone);
    if (channels.includes(MessageChannel.WhatsApp) && phone) {
      const wa = await latestConsent(db, { channel: MessageChannel.WhatsApp, personId: person.id, address: phone });
      if (wa?.status === ConsentStatus.OptIn) return MessageChannel.WhatsApp;
    }
    const email = normalizeAddress(MessageChannel.Email, person.email);
    if (channels.includes(MessageChannel.Email) && email) {
      const mail = await latestConsent(db, { channel: MessageChannel.Email, personId: person.id, address: email });
      if (mail?.status !== ConsentStatus.OptOut) return MessageChannel.Email;
    }
    return null;
  }

  private async resolveAddress(db: Db, input: EnqueueInput): Promise<string> {
    let raw = input.to ?? null;
    if (!raw && input.personId) {
      const person = await db.person.findFirst({
        where: { id: input.personId },
        select: { email: true, phone: true },
      });
      raw = input.channel === MessageChannel.Email ? person?.email : person?.phone;
    }
    const address = normalizeAddress(input.channel, raw);
    if (!address) {
      throw new BadRequestException({
        error: 'NO_CONTACT_ADDRESS',
        message:
          input.channel === MessageChannel.Email
            ? 'The recipient has no valid email address'
            : 'The recipient has no valid phone number',
        channel: input.channel,
        personId: input.personId ?? null,
      });
    }
    return address;
  }
}
