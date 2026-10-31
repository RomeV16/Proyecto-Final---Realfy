import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

export interface EmailParams {
  to: string;
  subject: string;
  html: string;
  attachments?: { filename: string; content: Buffer }[];
}

/**
 * Resultado de un envío. El transporte no lanza: quien llama decide qué hacer
 * con un envío salteado (sin RESEND_API_KEY) o fallido.
 */
export type EmailResult =
  | { status: 'sent'; id: string }
  | { status: 'skipped' }
  | { status: 'failed'; error: string };

/** Único transporte de mail de la API (Resend). */
@Injectable()
export class CommonEmailService {
  private readonly logger = new Logger(CommonEmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
      this.logger.warn(
        'RESEND_API_KEY not configured — email delivery disabled. Set the env var to enable.',
      );
    }
    this.fromAddress =
      this.config.get<string>('RESEND_FROM_ADDRESS') ??
      'noreply@realfy.com.ar';
  }

  /** Whether the email service is configured and ready to send. */
  isConfigured(): boolean {
    return this.resend !== null;
  }

  /**
   * Send an email via Resend and report what happened. Never throws: a missing
   * configuration is `skipped` and a delivery error is `failed`, both logged.
   *
   * Optional `attachments` are passed through to Resend v6 as
   * `{ filename: string; content: Buffer }[]`.
   */
  async send(params: EmailParams): Promise<EmailResult> {
    if (!this.resend) {
      this.logger.warn('Email skipped — Resend not configured', {
        to: params.to,
        subject: params.subject,
      });
      return { status: 'skipped' };
    }

    try {
      const result = await this.resend.emails.send({
        from: this.fromAddress,
        to: [params.to],
        subject: params.subject,
        html: params.html,
        ...(params.attachments?.length ? { attachments: params.attachments } : {}),
      });

      this.logger.log('Email sent successfully', {
        to: params.to,
        subject: params.subject,
        resendId: result.data?.id,
      });

      return { status: 'sent', id: result.data?.id ?? 'unknown' };
    } catch (error) {
      const message = (error as Error).message;
      this.logger.error('Email delivery failed', {
        to: params.to,
        subject: params.subject,
        error: message,
      });
      return { status: 'failed', error: message };
    }
  }

  /**
   * Same as `send` for callers that only need to know whether it went out:
   * returns `{ id }` on success, null when skipped or failed.
   */
  async sendEmail(params: EmailParams): Promise<{ id: string } | null> {
    const result = await this.send(params);
    return result.status === 'sent' ? { id: result.id } : null;
  }
}
