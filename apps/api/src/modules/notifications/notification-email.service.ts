import { Injectable } from '@nestjs/common';
import { CommonEmailService, type EmailResult } from '../../common/email/common-email.service';

/** Arma el mail de una notificación; el envío lo hace CommonEmailService. */
@Injectable()
export class NotificationEmailService {
  constructor(private readonly email: CommonEmailService) {}

  /**
   * Send a notification alert email.
   * Non-blocking: never throws, the result says whether it went out.
   */
  sendNotificationEmail(params: {
    to: string;
    subject: string;
    title: string;
    message: string;
    tenantName: string;
  }): Promise<EmailResult> {
    return this.email.send({
      to: params.to,
      subject: params.subject,
      html: `
          <h2>${params.title}</h2>
          <p>${params.message}</p>
          <br/>
          <p>Saludos cordiales,<br/>${params.tenantName}</p>
        `,
    });
  }
}
