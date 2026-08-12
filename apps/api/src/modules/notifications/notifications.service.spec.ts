import { BadRequestException, NotFoundException } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

function createMockPrismaService() {
  return {
    client: {
      notification: {
        findMany: jest.fn(),
        count: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
    },
    baseClient: {
      notification: {
        create: jest.fn(),
      },
    },
  } as unknown as PrismaService;
}

function createMockTenantContext() {
  return {
    getTenantId: jest.fn(),
    getUserId: jest.fn(),
  } as unknown as TenantContextService;
}

describe('NotificationsService', () => {
  let service: NotificationsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tenantContext: ReturnType<typeof createMockTenantContext>;

  const USER_ID = 'user-123';
  const TENANT_ID = 'tenant-abc';

  beforeEach(() => {
    prisma = createMockPrismaService();
    tenantContext = createMockTenantContext();
    service = new NotificationsService(prisma as any, tenantContext as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('findAll', () => {
    it('returns paginated notifications scoped to the current user', async () => {
      (tenantContext.getUserId as jest.Mock).mockReturnValue(USER_ID);
      (prisma.client.notification.findMany as jest.Mock).mockResolvedValue([
        { id: 'n1' },
      ]);
      (prisma.client.notification.count as jest.Mock).mockResolvedValue(1);

      const result = await service.findAll({ page: 1, limit: 20 });

      expect(prisma.client.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { userId: USER_ID } }),
      );
      expect(result).toEqual({
        items: [{ id: 'n1' }],
        total: 1,
        page: 1,
        limit: 20,
        totalPages: 1,
      });
    });

    it('applies isRead and type filters when provided', async () => {
      (tenantContext.getUserId as jest.Mock).mockReturnValue(USER_ID);
      (prisma.client.notification.findMany as jest.Mock).mockResolvedValue([]);
      (prisma.client.notification.count as jest.Mock).mockResolvedValue(0);

      await service.findAll({ isRead: false, type: 'SystemAlert' });

      expect(prisma.client.notification.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: USER_ID, isRead: false, type: 'SystemAlert' },
        }),
      );
    });

    it('throws when there is no user context', async () => {
      (tenantContext.getUserId as jest.Mock).mockReturnValue(undefined);

      await expect(service.findAll({})).rejects.toBeInstanceOf(
        BadRequestException,
      );
    });
  });

  describe('getUnreadCount', () => {
    it('returns the unread count for the current user', async () => {
      (tenantContext.getUserId as jest.Mock).mockReturnValue(USER_ID);
      (prisma.client.notification.count as jest.Mock).mockResolvedValue(3);

      const result = await service.getUnreadCount();

      expect(prisma.client.notification.count).toHaveBeenCalledWith({
        where: { userId: USER_ID, isRead: false },
      });
      expect(result).toEqual({ count: 3 });
    });
  });

  describe('markAsRead', () => {
    it('marks an owned notification as read', async () => {
      (tenantContext.getUserId as jest.Mock).mockReturnValue(USER_ID);
      (prisma.client.notification.findFirst as jest.Mock).mockResolvedValue({
        id: 'n1',
        userId: USER_ID,
      });
      (prisma.client.notification.update as jest.Mock).mockResolvedValue({
        id: 'n1',
        isRead: true,
      });

      const result = await service.markAsRead('n1');

      expect(prisma.client.notification.update).toHaveBeenCalledWith({
        where: { id: 'n1' },
        data: { isRead: true },
      });
      expect(result).toEqual({ id: 'n1', isRead: true });
    });

    it('throws NotFound when the notification does not belong to the user', async () => {
      (tenantContext.getUserId as jest.Mock).mockReturnValue(USER_ID);
      (prisma.client.notification.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(service.markAsRead('missing')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });
  });

  describe('markAllAsRead', () => {
    it('marks all unread notifications as read and returns the count', async () => {
      (tenantContext.getUserId as jest.Mock).mockReturnValue(USER_ID);
      (prisma.client.notification.updateMany as jest.Mock).mockResolvedValue({
        count: 5,
      });

      const result = await service.markAllAsRead();

      expect(result).toEqual({ updated: 5 });
    });
  });

  describe('createNotification', () => {
    it('creates a notification via the base client with the given data', async () => {
      (prisma.baseClient.notification.create as jest.Mock).mockResolvedValue({
        id: 'n9',
      });

      const result = await service.createNotification({
        tenantId: TENANT_ID,
        userId: USER_ID,
        type: 'SystemAlert',
        title: 'Hola',
        message: 'Mensaje',
      });

      expect(prisma.baseClient.notification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            tenantId: TENANT_ID,
            userId: USER_ID,
            type: 'SystemAlert',
            title: 'Hola',
            message: 'Mensaje',
          }),
        }),
      );
      expect(result).toEqual({ id: 'n9' });
    });
  });
});
