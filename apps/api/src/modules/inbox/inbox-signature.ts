import { Logger, UnauthorizedException, type RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { verifyMetaSignature } from '../messaging/webhook-signatures';

/**
 * Firma del mail reenviado por el servicio de recepción (`X-Realfy-Signature: sha256=<hex>`,
 * HMAC-SHA256 del cuerpo crudo con INBOX_EMAIL_INGEST_SECRET). La comparten la bandeja de
 * consultas y el ingreso de boletas por mail: sin secreto configurado se rechazan todos.
 */
export function assertEmailIngestSignature(
  config: MessagingConfigService,
  req: RawBodyRequest<Request>,
  signature: string | undefined,
  logger: Logger,
): void {
  if (!verifyMetaSignature(req.rawBody, signature, config.inbox.emailIngestSecret)) {
    logger.warn('Inbound email rejected: invalid signature');
    throw new UnauthorizedException({ error: 'INVALID_SIGNATURE', message: 'Invalid signature' });
  }
}
