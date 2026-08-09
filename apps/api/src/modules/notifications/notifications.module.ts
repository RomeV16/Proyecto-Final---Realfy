import { Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller';
import { NotificationsService } from './notifications.service';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { NotificationEmailService } from './notification-email.service';

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationSchedulerService,
    NotificationEmailService,
  ],
  exports: [NotificationsService, NotificationEmailService],
})
export class NotificationsModule {}
