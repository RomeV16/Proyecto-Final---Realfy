import { Injectable } from '@nestjs/common';
import { formatMoneyAR, formatPeriodAR, formatPeriodShortAR, type MoneyLike } from '@realfy/shared';
import { CommonEmailService, type EmailResult } from '../../common/email/common-email.service';

/** Arma el mail de una liquidación; el envío lo hace CommonEmailService. */
@Injectable()
export class EmailService {
  constructor(private readonly email: CommonEmailService) {}

  /**
   * Send a liquidación PDF receipt via email.
   * Never throws: the caller checks the returned result.
   */
  sendLiquidacionEmail(
    to: string,
    liquidacion: { id: string; period: Date | string; total: MoneyLike },
    pdfBuffer: Buffer,
    tenantName: string,
  ): Promise<EmailResult> {
    const monthYear = formatPeriodAR(liquidacion.period);
    const shortPeriod = formatPeriodShortAR(liquidacion.period);

    return this.email.send({
      to,
      subject: `Liquidación ${shortPeriod} - ${tenantName}`,
      html: `
          <h2>Liquidación de ${monthYear}</h2>
          <p>Estimado/a,</p>
          <p>Adjuntamos la liquidación correspondiente al período <strong>${monthYear}</strong>.</p>
          <p><strong>Total: $ ${formatMoneyAR(liquidacion.total)}</strong></p>
          <p>Por favor revise el documento adjunto para ver el detalle completo.</p>
          <br/>
          <p>Saludos cordiales,<br/>${tenantName}</p>
        `,
      attachments: [{ filename: `liquidacion-${shortPeriod.replace('/', '-')}.pdf`, content: pdfBuffer }],
    });
  }
}
