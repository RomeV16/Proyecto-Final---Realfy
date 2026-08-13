import {
  Controller,
  Get,
  Patch,
  Post,
  Param,
  Query,
} from '@nestjs/common';
import { UserRole } from '@realfy/shared';
import { Roles } from '../../common/auth/roles.decorator';
import { NotificationsService } from './notifications.service';
import { NotificationSchedulerService } from './notification-scheduler.service';

@Controller('notifications')
export class NotificationsController {
  constructor(
    private readonly notificationsService: NotificationsService,
    private readonly scheduler: NotificationSchedulerService,
  ) {}

  /**
   * POST /notifications/run — Corre los avisos programados en el momento.
   * Los mismos tres barridos que ejecuta el cron diario (servicios por vencer,
   * contratos por vencer y liquidaciones vencidas). Sirve para regenerar la
   * bandeja sin esperar a la corrida de la madrugada. Solo Admin.
   */
  @Roles(UserRole.Admin)
  @Post('run')
  async run() {
    await this.scheduler.handleServiceDueReminders();
    await this.scheduler.handleContractExpiryWarnings();
    await this.scheduler.handleOverdueLiquidaciones();
    return { status: 'ok' };
  }

  /**
   * GET /notifications — Paginated list filtered by isRead/type.
   * Scoped to current userId from JWT.
   */
  @Get()
  async findAll(@Query() query: Record<string, any>) {
    const coerced = { ...query };
    if (coerced.page !== undefined) coerced.page = Number(coerced.page);
    if (coerced.limit !== undefined) coerced.limit = Number(coerced.limit);
    if (coerced.isRead !== undefined) coerced.isRead = coerced.isRead === 'true';
    return this.notificationsService.findAll(coerced);
  }

  /**
   * GET /notifications/unread-count — Badge count for bell icon.
   */
  @Get('unread-count')
  async getUnreadCount() {
    return this.notificationsService.getUnreadCount();
  }

  /**
   * PATCH /notifications/:id/read — Mark single notification as read.
   */
  @Patch(':id/read')
  async markAsRead(@Param('id') id: string) {
    return this.notificationsService.markAsRead(id);
  }

  /**
   * PATCH /notifications/mark-all-read — Mark all as read for current user.
   */
  @Patch('mark-all-read')
  async markAllAsRead() {
    return this.notificationsService.markAllAsRead();
  }
}
