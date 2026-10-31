import { Injectable } from '@nestjs/common';
import {
  formatMoneyAR,
  formatPeriodAR,
  formatPeriodShortAR,
  personName,
  type MoneyLike,
} from '@realfy/shared';
import { CommonEmailService, type EmailResult } from '../../common/email/common-email.service';

/** Arma el mail de una rendición; el envío lo hace CommonEmailService. */
@Injectable()
export class RenditionEmailService {
  constructor(private readonly email: CommonEmailService) {}

  /**
   * Send a rendition PDF to the owner via email.
   * Never throws: the caller checks the returned result.
   */
  sendRendicionEmail(
    to: string,
    rendicion: {
      id: string;
      period: Date | string;
      netDeposit: MoneyLike;
      owner?: { firstName?: string | null; lastName?: string | null } | null;
    },
    pdfBuffer: Buffer,
    tenantName: string,
  ): Promise<EmailResult> {
    const monthYear = formatPeriodAR(rendicion.period);
    const shortPeriod = formatPeriodShortAR(rendicion.period);
    const ownerName = personName(rendicion.owner) || 'Propietario/a';

    return this.email.send({
      to,
      subject: `Rendición ${shortPeriod} - ${tenantName}`,
      html: `
          <h2>Rendición de Alquileres — ${monthYear}</h2>
          <p>Estimado/a ${ownerName},</p>
          <p>Adjuntamos la rendición de alquileres correspondiente al período <strong>${monthYear}</strong>.</p>
          <p><strong>Depósito neto: $ ${formatMoneyAR(rendicion.netDeposit)}</strong></p>
          <p>Por favor revise el documento adjunto para ver el detalle completo de comisiones, honorarios y deducciones.</p>
          <br/>
          <p>Saludos cordiales,<br/>${tenantName}</p>
        `,
      attachments: [{ filename: `rendicion-${shortPeriod.replace('/', '-')}.pdf`, content: pdfBuffer }],
    });
  }
}
