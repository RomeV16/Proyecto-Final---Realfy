import { Module } from '@nestjs/common';
import { MessageChannel } from '@realfy/shared';
import { CommonEmailService } from '../../common/email/common-email.service';
import { MessagingConfigService } from '../../common/messaging/messaging-config.service';
import { CashModule } from '../cash/cash.module';
import { LiquidacionesModule } from '../liquidaciones/liquidaciones.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { OwnerAccountsModule } from '../owner-accounts/owner-accounts.module';
import { TenantsModule } from '../tenants/tenants.module';
import { ConsentsService } from './consents.service';
import { DocumentMessagesService } from './document-messages.service';
import { MessageAttachmentsService } from './message-attachments.service';
import { ConsentsController, MessagingSettingsController, OutboxController } from './messaging.controller';
import { OutboxAdminService } from './outbox-admin.service';
import { OutboxDispatcherService } from './outbox-dispatcher.service';
import { FakeProvider } from './providers/fake.provider';
import { MESSAGE_PROVIDERS, type MessageProvider } from './providers/message-provider';
import { ResendEmailProvider } from './providers/resend-email.provider';
import { WhatsAppCloudProvider } from './providers/whatsapp-cloud.provider';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';

/**
 * Un proveedor por canal. Con NODE_ENV=test son proveedores de prueba que no
 * salen de la máquina: ninguna prueba llama a Resend ni a Meta.
 */
export function messageProvidersFactory(email: CommonEmailService, config: MessagingConfigService): MessageProvider[] {
  if (process.env.NODE_ENV === 'test') {
    return [new FakeProvider(MessageChannel.Email), new FakeProvider(MessageChannel.WhatsApp)];
  }
  return [new ResendEmailProvider(email), new WhatsAppCloudProvider(config)];
}

/** Mensajería saliente: despacho, proveedores, webhooks, consentimiento y bandeja de salida (ADR-0013). */
@Module({
  imports: [TenantsModule, NotificationsModule, CashModule, OwnerAccountsModule, LiquidacionesModule],
  controllers: [OutboxController, MessagingSettingsController, ConsentsController, WebhooksController],
  providers: [
    { provide: MESSAGE_PROVIDERS, useFactory: messageProvidersFactory, inject: [CommonEmailService, MessagingConfigService] },
    OutboxAdminService,
    OutboxDispatcherService,
    DocumentMessagesService,
    ConsentsService,
    WebhooksService,
    MessageAttachmentsService,
  ],
})
export class MessagingModule {}
