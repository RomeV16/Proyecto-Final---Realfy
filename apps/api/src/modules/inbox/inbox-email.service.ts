import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConversationChannel, EmailIngestSchema, MessageChannel, normalizeEmail } from '@realfy/shared';
import { PrismaService } from '../../common/prisma/prisma.service';
import { parseOrThrow } from '../../common/validation/zod';
import { InboxIngestService, NO_REPLY_LOCAL_PART } from './inbox-ingest.service';

const BODY_MAX = 4000;

/**
 * Mail entrante (POST /inbox/email-ingest). El servicio que recibe los mails de la
 * casilla de consultas los reenvía ya normalizados y firmados; acá se guardan en
 * `inbound_messages` (con el Message-ID como identificador, único por inmobiliaria,
 * así un reenvío repetido no duplica) y pasan a la bandeja. Los mails automáticos
 * (rebotes, avisos, respuestas de ausencia) no abren consultas.
 */
@Injectable()
export class InboxEmailService {
  private readonly logger = new Logger(InboxEmailService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly ingest: InboxIngestService,
  ) {}

  async ingestEmail(body: unknown): Promise<{ received: true; ignored?: 'automatic' | 'invalid-sender' }> {
    const input = parseOrThrow(EmailIngestSchema, body, 'Invalid inbound email');
    const tenant = await this.prisma.baseClient.tenant.findFirst({
      where: { slug: input.tenantSlug, isActive: true },
      select: { id: true },
    });
    if (!tenant) throw new NotFoundException({ error: 'TENANT_NOT_FOUND', message: 'Unknown tenant' });

    const from = normalizeEmail(input.from);
    if (!from) return { received: true, ignored: 'invalid-sender' };
    if (input.automatic || NO_REPLY_LOCAL_PART.test(from.split('@')[0] ?? '')) {
      this.logger.log(`Inbound email ignored (automatic): tenantId=${tenant.id}`);
      return { received: true, ignored: 'automatic' };
    }

    const at = input.receivedAt ?? new Date();
    const providerMsgId = `email:${tenant.id}:${input.messageId}`;
    const text = input.text.trim().slice(0, BODY_MAX);
    const subject = input.subject?.trim() || null;

    // Se guarda antes de ubicarlo: el reintento del reenvío completa lo que se haya cortado.
    await this.prisma.baseClient.inboundMessage.createMany({
      data: [
        { tenantId: tenant.id, channel: MessageChannel.Email, from, body: text, providerMsgId, receivedAt: at },
      ],
      skipDuplicates: true,
    });
    await this.ingest.receiveStored(tenant.id, providerMsgId, {
      channel: ConversationChannel.Email,
      address: from,
      name: input.fromName?.trim() || null,
      subject,
      body: text,
      at,
    });
    return { received: true };
  }
}
