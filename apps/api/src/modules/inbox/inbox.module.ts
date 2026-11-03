import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { TenantsModule } from '../tenants/tenants.module';
import { InboxEmailService } from './inbox-email.service';
import { InboxIngestService } from './inbox-ingest.service';
import { InboxOutboundService } from './inbox-outbound.service';
import { InboxSlaScheduler } from './inbox-sla.scheduler';
import { InboxEmailController, InboxController } from './inbox.controller';
import { InboxService } from './inbox.service';

/** Bandeja de consultas unificada (ADR-0013): ingreso, plazo de primera respuesta, autorrespuesta y atención. */
@Module({
  imports: [TenantsModule, NotificationsModule],
  controllers: [InboxController, InboxEmailController],
  providers: [InboxService, InboxIngestService, InboxOutboundService, InboxEmailService, InboxSlaScheduler],
  exports: [InboxIngestService],
})
export class InboxModule {}
