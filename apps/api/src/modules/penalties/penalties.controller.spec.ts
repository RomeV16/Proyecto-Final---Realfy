import { Test, TestingModule } from '@nestjs/testing';
import { BadRequestException, ForbiddenException } from '@nestjs/common';
import { PenaltiesController } from './penalties.controller';
import { PenaltiesService } from './penalties.service';
import { PenaltiesScheduler } from './penalties.scheduler';

/**
 * Unit tests for PenaltiesController — RBAC and business logic.
 * All dependencies are mocked.
 */

function buildMocks() {
  const prisma = {
    client: {
      penalty: {
        findMany: jest.fn().mockResolvedValue([]),
        findFirst: jest.fn().mockResolvedValue(null),
        update: jest.fn().mockResolvedValue({ id: 'p1', status: 'waived' }),
      },
    },
    baseClient: {
      liquidacion: {
        findMany: jest.fn().mockResolvedValue([]),
        count: jest.fn().mockResolvedValue(0),
      },
    },
  } as any;

  const tenantContext = {
    getTenantId: jest.fn().mockReturnValue('tenant-1'),
    getUserId: jest.fn().mockReturnValue('user-1'),
  } as any;

  const tenantsService = {
    getPenaltyConfig: jest.fn().mockResolvedValue({
      mode: 'daily_fixed',
      value: '10',
      graceDays: 0,
      maxMultiplier: '2.0',
    }),
    updatePenaltyConfig: jest.fn().mockResolvedValue({
      mode: 'daily_fixed',
      value: '10',
      graceDays: 0,
      maxMultiplier: '2.0',
    }),
  } as any;

  const penaltiesService = {
    waive: jest.fn().mockResolvedValue({ id: 'p1', status: 'waived' }),
    waiveAll: jest.fn().mockResolvedValue({ waived: 2, total: '30.00', upTo: '2026-03-10' }),
  } as any;

  const scheduler = {
    applyPenalties: jest.fn().mockResolvedValue({ tenantsProcessed: 1, penaltiesInserted: 0 }),
  } as any;

  return { prisma, tenantContext, tenantsService, penaltiesService, scheduler };
}

function buildController(mocks: ReturnType<typeof buildMocks>) {
  return new PenaltiesController(
    mocks.prisma,
    mocks.tenantContext,
    mocks.tenantsService,
    mocks.penaltiesService,
    mocks.scheduler,
  );
}

describe('PenaltiesController', () => {
  describe('waivePenalty', () => {
    it('valida el motivo y delega en el servicio', async () => {
      const mocks = buildMocks();
      const controller = buildController(mocks);

      const result = await controller.waivePenalty('p1', { reason: ' acuerdo con el locador ' });

      expect(mocks.penaltiesService.waive).toHaveBeenCalledWith('p1', 'acuerdo con el locador');
      expect(result.status).toBe('waived');
    });

    it.each([{}, { reason: '   ' }, { reason: 'x', extra: 1 }])('rechaza un cuerpo sin motivo válido: %j', async (body) => {
      const controller = buildController(buildMocks());
      await expect(controller.waivePenalty('p1', body)).rejects.toThrow(BadRequestException);
    });
  });

  describe('waiveAll', () => {
    it('condona hasta la fecha pedida', async () => {
      const mocks = buildMocks();
      const controller = buildController(mocks);

      const result = await controller.waiveAll('c1', { upTo: '2026-03-10' }, { reason: 'bonificación' });

      expect(mocks.penaltiesService.waiveAll).toHaveBeenCalledWith('c1', new Date('2026-03-10T00:00:00.000Z'), 'bonificación');
      expect(result.waived).toBe(2);
    });

    it('sin upTo condona hasta hoy (Buenos Aires)', async () => {
      const mocks = buildMocks();
      const controller = buildController(mocks);
      await controller.waiveAll('c1', {}, { reason: 'bonificación' });
      const upTo = mocks.penaltiesService.waiveAll.mock.calls[0][1] as Date;
      expect(upTo.getUTCHours()).toBe(0);
    });

    it('rechaza una fecha mal escrita o un motivo vacío', async () => {
      const controller = buildController(buildMocks());
      await expect(controller.waiveAll('c1', { upTo: '10/03/2026' }, { reason: 'x' })).rejects.toThrow(BadRequestException);
      await expect(controller.waiveAll('c1', {}, { reason: '' })).rejects.toThrow(BadRequestException);
    });
  });

  describe('runNow (_run-now endpoint)', () => {
    const originalEnv = process.env;

    afterEach(() => {
      process.env = { ...originalEnv };
    });

    it('returns 403 when not in test mode', async () => {
      process.env.NODE_ENV = 'production';
      process.env.E2E_TEST_MODE = undefined as any;

      const mocks = buildMocks();
      const controller = buildController(mocks);

      await expect(controller.runNow()).rejects.toThrow(ForbiddenException);
      expect(mocks.scheduler.applyPenalties).not.toHaveBeenCalled();
    });

    it('triggers applyPenalties when NODE_ENV=test', async () => {
      process.env.NODE_ENV = 'test';

      const mocks = buildMocks();
      const controller = buildController(mocks);

      const result = await controller.runNow();

      expect(mocks.scheduler.applyPenalties).toHaveBeenCalledTimes(1);
      expect(result).toEqual({ tenantsProcessed: 1, penaltiesInserted: 0 });
    });

    it('triggers applyPenalties when E2E_TEST_MODE=1', async () => {
      process.env.NODE_ENV = 'production';
      process.env.E2E_TEST_MODE = '1';

      const mocks = buildMocks();
      const controller = buildController(mocks);

      const result = await controller.runNow();

      expect(mocks.scheduler.applyPenalties).toHaveBeenCalledTimes(1);
      expect(result).toBeDefined();
    });
  });

  describe('getPenaltyConfig', () => {
    it('returns config for current tenant', async () => {
      const mocks = buildMocks();
      const controller = buildController(mocks);

      const config = await controller.getPenaltyConfig();

      expect(mocks.tenantsService.getPenaltyConfig).toHaveBeenCalledWith('tenant-1');
      expect(config.mode).toBe('daily_fixed');
    });

    it('throws ForbiddenException when no tenant context', async () => {
      const mocks = buildMocks();
      mocks.tenantContext.getTenantId.mockReturnValue(undefined);
      const controller = buildController(mocks);

      await expect(controller.getPenaltyConfig()).rejects.toThrow(ForbiddenException);
    });
  });

  describe('previewPenalty', () => {
    it('computes preview correctly', async () => {
      const mocks = buildMocks();
      const controller = buildController(mocks);

      const result = await controller.previewPenalty({
        debt: '1000',
        daysOverdue: 10,
        config: {
          mode: 'daily_fixed' as any,
          value: '10',
          graceDays: 0,
          maxMultiplier: '2.0',
        },
      });

      expect(parseFloat(result.amount)).toBe(100); // 10 days × $10
      expect(result.daysOverdue).toBe(10);
      expect(result.capHit).toBe(false);
    });

    it('simula el modo de tasa BNA con la TNA indicada', async () => {
      const controller = buildController(buildMocks());
      const base = {
        debt: '1000',
        daysOverdue: 10,
        config: { mode: 'max_bna_or_daily' as const, value: '0.003', graceDays: 0, maxMultiplier: '3.0' },
      };
      expect(parseFloat((await controller.previewPenalty(base)).amount)).toBe(30);
      expect(parseFloat((await controller.previewPenalty({ ...base, bnaAnnualPct: '100' })).amount)).toBe(54.79);
    });
  });

  describe('getDelinquentTenantsCount', () => {
    it('returns count from DB', async () => {
      const mocks = buildMocks();
      mocks.prisma.baseClient.liquidacion.count.mockResolvedValue(5);
      const controller = buildController(mocks);

      const result = await controller.getDelinquentTenantsCount();

      expect(result).toEqual({ count: 5 });
    });
  });
});
