import { MessageChannel } from '@realfy/shared';
import { CommonEmailService } from '../../../common/email/common-email.service';
import { attachmentFilename, renderEmail } from '../../../common/messaging/message-templates';
import type { MessageProvider, OutgoingMessage, ProviderResult } from './message-provider';

/**
 * Rechazos de Resend que no se arreglan reintentando: datos inválidos,
 * remitente o dominio sin verificar, clave sin permiso.
 * https://resend.com/docs/api-reference/errors
 */
const PERMANENT = /^(validation_error|invalid_[a-z_]+|missing_[a-z_]+|restricted_api_key|security_error|not_found|method_not_allowed)\b/;

/**
 * Mail por Resend, sobre el único transporte de mail de la API
 * (`CommonEmailService`). Manda la clave de idempotencia del mensaje como
 * `Idempotency-Key`: un reintento después de un corte no duplica el mail.
 */
export class ResendEmailProvider implements MessageProvider {
  readonly channel = MessageChannel.Email;
  readonly name = 'resend';

  constructor(private readonly email: CommonEmailService) {}

  isConfigured(): boolean {
    return this.email.isConfigured();
  }

  async send(message: OutgoingMessage): Promise<ProviderResult> {
    const { subject, html } = renderEmail(message.templateKey, message.vars);
    const attachments = message.attachment
      ? [
          {
            filename: attachmentFilename(message.templateKey, message.vars, message.attachment.filename),
            content: message.attachment.content,
          },
        ]
      : undefined;
    const result = await this.email.send(
      { to: message.to, subject, html, attachments },
      { purpose: 'outbox', idempotencyKey: message.idempotencyKey },
    );
    if (result.status === 'sent') return { ok: true, providerMsgId: result.id };
    if (result.status === 'skipped') return { ok: false, error: 'PROVIDER_NOT_CONFIGURED', retryable: true };
    return { ok: false, error: result.error, retryable: !PERMANENT.test(result.error) };
  }
}
