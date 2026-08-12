import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class NotificationEmailService {
  private readonly logger = new Logger(NotificationEmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
      this.logger.warn(
        'RESEND_API_KEY not configured — notification email delivery disabled.',
      );
    }
    this.fromAddress =
      this.config.get<string>('RESEND_FROM_ADDRESS') ??
      'notificaciones@realfy.com.ar';
  }

  /**
   * Send a notification alert email.
   * Gracefully skips if RESEND_API_KEY is not configured.
   */
  async sendNotificationEmail(params: {
    to: string;
    subject: string;
    title: string;
    message: string;
    tenantName: string;
  }): Promise<{ id: string } | null> {
    if (!this.resend) {
      this.logger.debug('Email skipped — Resend not configured', {
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
        html: `
          <h2>${params.title}</h2>
          <p>${params.message}</p>
          <br/>
          <p>Saludos cordiales,<br/>${params.tenantName}</p>
        `,
      });

      this.logger.log('Notification email sent', {
        to: params.to,
        subject: params.subject,
        resendId: result.data?.id,
      });

      return { id: result.data?.id ?? 'unknown' };
    } catch (error) {
      this.logger.error('Notification email delivery failed', {
        to: params.to,
        subject: params.subject,
        error: (error as Error).message,
      });
      // Non-blocking — don't throw, just return null
      return null;
    }
  }
}
