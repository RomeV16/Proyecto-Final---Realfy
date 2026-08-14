import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

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
   * Send a generic email via Resend.
   * Returns { id } on success, null on failure or when not configured.
   * Non-throwing — logs errors instead of propagating.
   *
   * Optional `attachments` are passed through to Resend v6 as
   * `{ filename: string; content: Buffer }[]`.
   */
  async sendEmail(params: {
    to: string;
    subject: string;
    html: string;
    attachments?: { filename: string; content: Buffer }[];
  }): Promise<{ id: string } | null> {
    if (!this.resend) {
      this.logger.warn('Email skipped — Resend not configured', {
        to: params.to,
        subject: params.subject,
      });
      return null;
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

      return { id: result.data?.id ?? 'unknown' };
    } catch (error) {
      this.logger.error('Email delivery failed', {
        to: params.to,
        subject: params.subject,
        error: (error as Error).message,
      });
      return null;
    }
  }
}
