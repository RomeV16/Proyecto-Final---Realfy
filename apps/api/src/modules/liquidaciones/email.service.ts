import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);
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
      'liquidaciones@realfy.com.ar';
  }

  /**
   * Send a liquidación PDF receipt via email.
   * Gracefully skips if RESEND_API_KEY is not configured.
   */
  async sendLiquidacionEmail(
    to: string,
    liquidacion: { id: string; period: Date | string; total: string | number },
    pdfBuffer: Buffer,
    tenantName: string,
  ): Promise<{ id: string } | null> {
    if (!this.resend) {
      this.logger.warn('Email skipped — Resend not configured', {
        liquidacionId: liquidacion.id,
        to,
      });
      return null;
    }

    const period = new Date(liquidacion.period);
    const monthYear = period.toLocaleDateString('es-AR', {
      month: 'long',
      year: 'numeric',
    });
    const monthNum = String(period.getMonth() + 1).padStart(2, '0');
    const yearNum = period.getFullYear();

    try {
      const result = await this.resend.emails.send({
        from: this.fromAddress,
        to: [to],
        subject: `Liquidación ${monthNum}/${yearNum} - ${tenantName}`,
        html: `
          <h2>Liquidación de ${monthYear}</h2>
          <p>Estimado/a,</p>
          <p>Adjuntamos la liquidación correspondiente al período <strong>${monthYear}</strong>.</p>
          <p><strong>Total: $ ${Number(liquidacion.total).toLocaleString('es-AR', { minimumFractionDigits: 2 })}</strong></p>
          <p>Por favor revise el documento adjunto para ver el detalle completo.</p>
          <br/>
          <p>Saludos cordiales,<br/>${tenantName}</p>
        `,
        attachments: [
          {
            filename: `liquidacion-${monthNum}-${yearNum}.pdf`,
            content: pdfBuffer,
          },
        ],
      });

      this.logger.log('Email sent successfully', {
        liquidacionId: liquidacion.id,
        to,
        resendId: result.data?.id,
      });

      return { id: result.data?.id ?? 'unknown' };
    } catch (error) {
      this.logger.error('Email delivery failed', {
        liquidacionId: liquidacion.id,
        to,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
