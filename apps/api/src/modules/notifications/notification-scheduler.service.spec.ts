import { Logger } from '@nestjs/common';
import { NotificationSchedulerService } from './notification-scheduler.service';
import { makeTenantCron } from '../../../test/helpers/tenant-cron';

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
      user: { findMany: jest.fn() },
    },
    client: {
      service: { findMany: jest.fn() },
      contract: { findMany: jest.fn() },
      liquidacion: { findMany: jest.fn() },
      lead: { findMany: jest.fn() },
      notification: { findFirst: jest.fn().mockResolvedValue(null) },
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
      makeTenantCron([], prisma).tenantCron,
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
    prisma.client.service.findMany.mockResolvedValue([
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
    prisma.client.contract.findMany.mockRejectedValue(
      new Error('db down'),
    );

    await expect(
      scheduler.handleContractExpiryWarnings(),
    ).resolves.toBeUndefined();
    expect(mockCreateNotification).not.toHaveBeenCalled();
  });

  // ── Avisos de vencimiento de contrato (CP-242, DEF-22) ─────────────────────

  describe('contract-expiry-warnings: un aviso por contrato y umbral', () => {
    const END_DATE = new Date('2026-03-26T00:00:00.000Z');
    const users = [
      { id: 'u1', email: 'admin@inmo.test' },
      { id: 'u2', email: 'gerente@inmo.test' },
    ];
    let stored: any[];

    /** "Hoy" a media tarde de Buenos Aires para el día dado. */
    const setToday = (isoDay: string) =>
      jest.useFakeTimers({ now: new Date(`${isoDay}T15:00:00.000Z`) });

    beforeEach(() => {
      process.env.NODE_ENV = 'production';
      stored = [];
      prisma.client.notification = {
        findFirst: jest.fn(async ({ where }: any) =>
          stored.find((n) =>
            Object.entries(where).every(([key, value]) => n[key] === value),
          ) ?? null,
        ),
      };
      mockCreateNotification.mockImplementation(async (params: any) => {
        stored.push(params);
        return params;
      });
      prisma.baseClient.tenant.findMany.mockResolvedValue([{ id: 't1', name: 'Inmo Uno' }]);
      prisma.baseClient.user.findMany.mockResolvedValue(users);
      // Como la base: solo devuelve el contrato si vence dentro del rango pedido.
      prisma.client.contract.findMany.mockImplementation(async ({ where }: any) =>
        END_DATE >= where.endDate.gte && END_DATE <= where.endDate.lte
          ? [{ id: 'c1', endDate: END_DATE, property: { title: 'Depto Centro' } }]
          : [],
      );
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('correr el barrido dos veces el mismo día no duplica avisos ni mails', async () => {
      setToday('2026-03-01'); // faltan 25 días

      await scheduler.handleContractExpiryWarnings();
      await scheduler.handleContractExpiryWarnings();

      expect(stored).toHaveLength(2); // uno por usuario
      expect(mockSendNotificationEmail).toHaveBeenCalledTimes(2);
    });

    it('en días consecutivos avisa una vez por umbral: 30, 15 y 7 días', async () => {
      const days = [
        '2026-03-01', // 25 días: umbral 30
        '2026-03-02', // 24 días: ya avisado
        '2026-03-10', // 16 días: ya avisado
        '2026-03-11', // 15 días: umbral 15
        '2026-03-12', // 14 días: ya avisado
        '2026-03-19', // 7 días: umbral 7
        '2026-03-20', // 6 días: ya avisado
        '2026-03-25', // 1 día: ya avisado
      ];
      for (const day of days) {
        setToday(day);
        await scheduler.handleContractExpiryWarnings();
      }

      const ofUser = stored.filter((n) => n.userId === 'u1');
      expect(ofUser).toHaveLength(3);
      expect(ofUser[0].title).toContain('30 días');
      expect(ofUser[1].title).toContain('15 días');
      expect(ofUser[2].title).toContain('7 días');
      expect(stored).toHaveLength(6);
      expect(mockSendNotificationEmail).toHaveBeenCalledTimes(6);
    });

    it('un contrato que entra directo al último umbral recibe un solo aviso', async () => {
      for (const day of ['2026-03-20', '2026-03-21', '2026-03-22']) {
        setToday(day); // 6, 5 y 4 días
        await scheduler.handleContractExpiryWarnings();
      }

      expect(stored.filter((n) => n.userId === 'u1')).toHaveLength(1);
      expect(stored[0].title).toContain('7 días');
    });

    it('no avisa lo que vence después de 30 días', async () => {
      setToday('2026-02-10'); // faltan 44 días

      await scheduler.handleContractExpiryWarnings();

      expect(stored).toHaveLength(0);
    });
  });

  describe('zona horaria de los crons', () => {
    it.each([
      'handleServiceDueReminders',
      'handleContractExpiryWarnings',
      'handleOverdueLiquidaciones',
      'handleStaleLeadAlerts',
    ])('%s corre en hora de Buenos Aires', (method) => {
      const options = Reflect.getMetadata(
        'SCHEDULE_CRON_OPTIONS',
        (NotificationSchedulerService.prototype as any)[method],
      );

      expect(options.timeZone).toBe('America/Argentina/Buenos_Aires');
    });
  });
});
