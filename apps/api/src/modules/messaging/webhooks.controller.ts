import {
  Body,
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  HttpCode,
  Logger,
  Post,
  Query,
  Req,
  UnauthorizedException,
  type RawBodyRequest,
} from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import type { Request } from 'express';
import { Public } from '../../common/auth/public.decorator';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { WebhooksService } from './webhooks.service';
import { safeEqual, verifyMetaSignature, verifySvixSignature } from './webhook-signatures';

/**
 * Avisos de los proveedores (ADR-0013). Son rutas públicas, pero cada pedido
 * se rechaza si la firma no coincide con el secreto del ambiente; sin secreto
 * configurado se rechazan todos (falla cerrado). La respuesta es siempre la
 * misma y no dice nada de los datos.
 */
@Public()
@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(
    private readonly config: MessagingConfigService,
    private readonly webhooks: WebhooksService,
  ) {}

  /** GET /webhooks/whatsapp — Verificación de la suscripción (hub.challenge). */
  @Get('whatsapp')
  @Header('Content-Type', 'text/plain')
  verifyWhatsApp(
    @Query('hub.mode') mode: string,
    @Query('hub.verify_token') token: string,
    @Query('hub.challenge') challenge: string,
  ): string {
    const expected = this.config.whatsapp.verifyToken;
    if (mode !== 'subscribe' || !expected || !token || !safeEqual(token, expected) || !challenge) {
      throw new ForbiddenException({ error: 'WEBHOOK_VERIFICATION_FAILED', message: 'Verification failed' });
    }
    return challenge;
  }

  /** POST /webhooks/whatsapp — Estados de entrega y mensajes entrantes, firmados con X-Hub-Signature-256. */
  @Post('whatsapp')
  @HttpCode(200)
  async whatsapp(
    @Req() req: RawBodyRequest<Request>,
    @Headers('x-hub-signature-256') signature: string | undefined,
    @Body() body: unknown,
  ) {
    if (!verifyMetaSignature(req.rawBody, signature, this.config.whatsapp.appSecret)) {
      this.logger.warn('WhatsApp webhook rejected: invalid signature');
      throw new UnauthorizedException({ error: 'INVALID_SIGNATURE', message: 'Invalid signature' });
    }
    await this.webhooks.handleWhatsApp(body, this.config.whatsapp.phoneNumberId);
    return { received: true };
  }

  /** POST /webhooks/resend — Entregas, rebotes y quejas, firmados por svix. */
  @Post('resend')
  @HttpCode(200)
  async resend(
    @Req() req: RawBodyRequest<Request>,
    @Headers('svix-id') id: string | undefined,
    @Headers('svix-timestamp') timestamp: string | undefined,
    @Headers('svix-signature') signature: string | undefined,
    @Body() body: unknown,
  ) {
    if (!verifySvixSignature(req.rawBody, { id, timestamp, signature }, this.config.resend.webhookSecret)) {
      this.logger.warn('Resend webhook rejected: invalid signature');
      throw new UnauthorizedException({ error: 'INVALID_SIGNATURE', message: 'Invalid signature' });
    }
    await this.webhooks.handleResend(body as Parameters<WebhooksService['handleResend']>[0]);
    return { received: true };
  }
}
