import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

@Injectable()
export class RenditionEmailService {
  private readonly logger = new Logger(RenditionEmailService.name);
  private readonly resend: Resend | null;
  private readonly fromAddress: string;

  constructor(private readonly config: ConfigService) {
    const apiKey = this.config.get<string>('RESEND_API_KEY');
    if (apiKey) {
      this.resend = new Resend(apiKey);
    } else {
      this.resend = null;
      this.logger.warn(
        'RESEND_API_KEY not configured — rendition email delivery disabled.',
      );
    }
    this.fromAddress =
      this.config.get<string>('RESEND_FROM_ADDRESS') ??
      'rendiciones@realfy.com.ar';
  }

  /**
   * Send a rendition PDF to the owner via email.
   * Gracefully skips if RESEND_API_KEY is not configured.
   */
  async sendRendicionEmail(
    to: string,
    rendicion: {
      id: string;
      period: Date | string;
      netDeposit: any;
      owner?: { firstName?: string; lastName?: string } | null;
    },
    pdfBuffer: Buffer,
    tenantName: string,
  ): Promise<{ id: string } | null> {
    if (!this.resend) {
      this.logger.warn('Email skipped — Resend not configured', {
        rendicionId: rendicion.id,
        to,
      });
      return null;
    }

    const period = new Date(rendicion.period);
    const monthYear = period.toLocaleDateString('es-AR', {
      month: 'long',
      year: 'numeric',
    });
    const monthNum = String(period.getMonth() + 1).padStart(2, '0');
    const yearNum = period.getFullYear();
    const ownerName = rendicion.owner
      ? `${rendicion.owner.firstName} ${rendicion.owner.lastName}`
      : 'Propietario/a';
    const netAmount = Number(rendicion.netDeposit).toLocaleString('es-AR', {
      minimumFractionDigits: 2,
    });

    try {
      const result = await this.resend.emails.send({
        from: this.fromAddress,
        to: [to],
        subject: `Rendición ${monthNum}/${yearNum} - ${tenantName}`,
        html: `
          <h2>Rendición de Alquileres — ${monthYear}</h2>
          <p>Estimado/a ${ownerName},</p>
          <p>Adjuntamos la rendición de alquileres correspondiente al período <strong>${monthYear}</strong>.</p>
          <p><strong>Depósito neto: $ ${netAmount}</strong></p>
          <p>Por favor revise el documento adjunto para ver el detalle completo de comisiones, honorarios y deducciones.</p>
          <br/>
          <p>Saludos cordiales,<br/>${tenantName}</p>
        `,
        attachments: [
          {
            filename: `rendicion-${monthNum}-${yearNum}.pdf`,
            content: pdfBuffer,
          },
        ],
      });

      this.logger.log('Rendition email sent successfully', {
        rendicionId: rendicion.id,
        to,
        resendId: result.data?.id,
      });

      return { id: result.data?.id ?? 'unknown' };
    } catch (error) {
      this.logger.error('Rendition email delivery failed', {
        rendicionId: rendicion.id,
        to,
        error: (error as Error).message,
      });
      throw error;
    }
  }
}
