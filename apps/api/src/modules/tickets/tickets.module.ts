import { Module } from '@nestjs/common';
import { CashModule } from '../cash/cash.module';
import { ChargesModule } from '../charges/charges.module';
import { TenantsModule } from '../tenants/tenants.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketCategoriesController } from './ticket-categories.controller';
import { TicketCategoriesService } from './ticket-categories.service';
import { TicketNotificationService } from './ticket-notification.service';
import { TicketQuotesService } from './ticket-quotes.service';
import { TicketRepairsService } from './ticket-repairs.service';

@Module({
  imports: [TenantsModule, CashModule, ChargesModule, NotificationsModule],
  controllers: [TicketsController, TicketCategoriesController],
  providers: [
    TicketsService,
    TicketCategoriesService,
    TicketNotificationService,
    TicketQuotesService,
    TicketRepairsService,
  ],
  exports: [TicketsService, TicketCategoriesService, TicketNotificationService],
})
export class TicketsModule {}
