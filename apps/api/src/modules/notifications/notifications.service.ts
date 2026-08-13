import {
  Injectable,
  Logger,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { NotificationFilterSchema } from '@realfy/shared';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * List notifications for the current user with filters and pagination.
   */
  async findAll(query: Record<string, any>) {
    const parsed = NotificationFilterSchema.parse(query);
    const userId = this.tenantContext.getUserId();
    if (!userId) {
      throw new BadRequestException({
        error: 'MISSING_USER',
        message: 'User context is required',
      });
    }

    const where: any = { userId };
    if (parsed.isRead !== undefined) {
      where.isRead = parsed.isRead;
    }
    if (parsed.type) {
      where.type = parsed.type;
    }

    const [items, total] = await Promise.all([
      this.prisma.client.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (parsed.page - 1) * parsed.limit,
        take: parsed.limit,
      }),
      this.prisma.client.notification.count({ where }),
    ]);

    return {
      items,
      total,
      page: parsed.page,
      limit: parsed.limit,
      totalPages: Math.ceil(total / parsed.limit),
    };
  }

  /**
   * Get unread notification count for the current user.
   */
  async getUnreadCount() {
    const userId = this.tenantContext.getUserId();
    if (!userId) {
      throw new BadRequestException({
        error: 'MISSING_USER',
        message: 'User context is required',
      });
    }

    const count = await this.prisma.client.notification.count({
      where: { userId, isRead: false },
    });

    return { count };
  }

  /**
   * Mark a single notification as read.
   */
  async markAsRead(id: string) {
    const userId = this.tenantContext.getUserId();
    if (!userId) {
      throw new BadRequestException({
        error: 'MISSING_USER',
        message: 'User context is required',
      });
    }

    const notification = await this.prisma.client.notification.findFirst({
      where: { id, userId },
    });

    if (!notification) {
      throw new NotFoundException({
        error: 'NOTIFICATION_NOT_FOUND',
        message: `Notification ${id} not found`,
      });
    }

    return this.prisma.client.notification.update({
      where: { id },
      data: { isRead: true },
    });
  }

  /**
   * Mark all notifications as read for the current user.
   */
  async markAllAsRead() {
    const userId = this.tenantContext.getUserId();
    if (!userId) {
      throw new BadRequestException({
        error: 'MISSING_USER',
        message: 'User context is required',
      });
    }

    const result = await this.prisma.client.notification.updateMany({
      where: { userId, isRead: false },
      data: { isRead: true },
    });

    this.logger.log('Marked all notifications as read', {
      userId,
      count: result.count,
    });

    return { updated: result.count };
  }

  /**
   * Create a notification — used internally by the scheduler.
   * Operates with the provided tenantId/userId directly (no CLS context needed).
   */
  async createNotification(params: {
    tenantId: string;
    userId: string;
    type: string;
    title: string;
    message: string;
    entityType?: string;
    entityId?: string;
  }) {
    /* Los barridos diarios vuelven a mirar los mismos vencimientos, asi que sin
       este corte el mismo aviso se repite un dia tras otro en la bandeja. */
    if (params.entityId) {
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
      const alreadySent = await this.prisma.baseClient.notification.findFirst({
        where: {
          tenantId: params.tenantId,
          userId: params.userId,
          type: params.type as any,
          entityId: params.entityId,
          createdAt: { gte: since },
        },
        select: { id: true },
      });

      if (alreadySent) {
        this.logger.debug('Notification skipped — already sent in the last 24h', {
          tenantId: params.tenantId,
          userId: params.userId,
          type: params.type,
          entityId: params.entityId,
        });
        return null;
      }
    }

    const notification = await this.prisma.baseClient.notification.create({
      data: {
        tenantId: params.tenantId,
        userId: params.userId,
        type: params.type as any,
        title: params.title,
        message: params.message,
        entityType: params.entityType,
        entityId: params.entityId,
      },
    });

    this.logger.debug('Notification created', {
      notificationId: notification.id,
      tenantId: params.tenantId,
      userId: params.userId,
      type: params.type,
    });

    return notification;
  }
}
