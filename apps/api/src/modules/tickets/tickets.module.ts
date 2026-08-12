import { Module } from '@nestjs/common';
import { TicketsController } from './tickets.controller';
import { TicketsService } from './tickets.service';
import { TicketCategoriesController } from './ticket-categories.controller';
import { TicketCategoriesService } from './ticket-categories.service';
import { TicketNotificationService } from './ticket-notification.service';

@Module({
  controllers: [TicketsController, TicketCategoriesController],
  providers: [TicketsService, TicketCategoriesService, TicketNotificationService],
  exports: [TicketsService, TicketCategoriesService, TicketNotificationService],
})
export class TicketsModule {}
