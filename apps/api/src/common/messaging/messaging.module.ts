import { Global, Module } from '@nestjs/common';
import { MessagingConfigService } from './messaging-config.service';
import { OutboxService } from './outbox.service';

/**
 * Lo mínimo para encolar mensajes desde cualquier módulo (ADR-0013). El
 * despacho, los proveedores y los webhooks viven en `modules/messaging`.
 */
@Global()
@Module({
  providers: [MessagingConfigService, OutboxService],
  exports: [MessagingConfigService, OutboxService],
})
export class CommonMessagingModule {}
