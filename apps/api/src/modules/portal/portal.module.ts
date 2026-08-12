import { Module } from '@nestjs/common';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { PortalTicketsService } from './portal-tickets.service';
import { LiquidacionesModule } from '../liquidaciones/liquidaciones.module';
import { TicketsModule } from '../tickets/tickets.module';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [LiquidacionesModule, TicketsModule, NotificationsModule],
  controllers: [PortalController],
  providers: [PortalService, PortalTicketsService],
})
export class PortalModule {}
