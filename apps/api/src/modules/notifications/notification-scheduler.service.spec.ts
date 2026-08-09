import { Logger } from '@nestjs/common';
import { NotificationSchedulerService } from './notification-scheduler.service';

const mockCreateNotification = jest.fn();
const mockSendNotificationEmail = jest.fn();

const mockNotificationsService = {
  createNotification: mockCreateNotification,
} as any;

const mockEmailService = {
  sendNotificationEmail: mockSendNotificationEmail,
} as any;

function createMockPrismaService() {
  return {
    baseClient: {
      tenant: { findMany: jest.fn() },
      service: { findMany: jest.fn() },
      contract: { findMany: jest.fn() },
      liquidacion: { findMany: jest.fn() },
      user: { findMany: jest.fn() },
    },
  } as any;
}

describe('NotificationSchedulerService', () => {
  let scheduler: NotificationSchedulerService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  const originalEnv = process.env.NODE_ENV;

  beforeEach(() => {
    jest.clearAllMocks();
    prisma = createMockPrismaService();
    scheduler = new NotificationSchedulerService(
      prisma,
      mockNotificationsService,
      mockEmailService,
    );
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env.NODE_ENV = originalEnv;
    jest.restoreAllMocks();
  });

  it('no-ops all jobs when NODE_ENV=test (runGuarded skips)', async () => {
    process.env.NODE_ENV = 'test';

    await scheduler.handleServiceDueReminders();
    await scheduler.handleContractExpiryWarnings();
    await scheduler.handleOverdueLiquidaciones();

    expect(prisma.baseClient.tenant.findMany).not.toHaveBeenCalled();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  it('creates service-due notifications for due services', async () => {
    process.env.NODE_ENV = 'production';
    prisma.baseClient.tenant.findMany.mockResolvedValue([
      { id: 't1', name: 'Inmo Uno' },
    ]);
    const today = new Date();
    prisma.baseClient.service.findMany.mockResolvedValue([
      {
        id: 's1',
        dueDay: today.getDate(),
        serviceType: 'Expensas',
        isActive: true,
        property: { title: 'Depto Centro' },
      },
    ]);
    prisma.baseClient.user.findMany.mockResolvedValue([
      { id: 'u1', email: 'admin@inmo.test' },
    ]);

    await scheduler.handleServiceDueReminders();

    expect(mockCreateNotification).toHaveBeenCalledTimes(1);
    expect(mockCreateNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: 't1',
        userId: 'u1',
        type: 'ServiceDueReminder',
        entityType: 'Service',
        entityId: 's1',
      }),
    );
  });

  it('does not throw when a tenant query rejects (per-tenant guard)', async () => {
    process.env.NODE_ENV = 'production';
    prisma.baseClient.tenant.findMany.mockResolvedValue([
      { id: 't1', name: 'Inmo Uno' },
    ]);
    prisma.baseClient.contract.findMany.mockRejectedValue(
      new Error('db down'),
    );

    await expect(
      scheduler.handleContractExpiryWarnings(),
    ).resolves.toBeUndefined();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });
});
