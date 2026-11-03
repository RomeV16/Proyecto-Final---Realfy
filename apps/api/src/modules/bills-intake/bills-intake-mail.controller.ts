import { Body, Controller, Headers, HttpCode, Logger, Post, Req, type RawBodyRequest } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { assertEmailIngestSignature } from '../inbox/inbox-signature';
import { BillMailService } from './bill-mail.service';

/**
 * Entrada del mail con boletas adjuntas. Ruta pública, igual que la de la bandeja de
 * consultas: cada pedido se rechaza si la firma (`X-Realfy-Signature`, el mismo secreto
 * INBOX_EMAIL_INGEST_SECRET) no coincide, y sin secreto configurado se rechazan todos.
 */
@Public()
@SkipThrottle()
@Controller('bills-intake')
export class BillsIntakeMailController {
  private readonly logger = new Logger(BillsIntakeMailController.name);

  constructor(
    private readonly config: MessagingConfigService,
    private readonly mail: BillMailService,
  ) {}

  /** POST /bills-intake/email-ingest — Un mail recibido en la casilla de boletas. */
  @Post('email-ingest')
  @HttpCode(200)
  async emailIngest(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-realfy-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    assertEmailIngestSignature(this.config, req, signature, this.logger);
    return this.mail.ingest(body);
  }
}
