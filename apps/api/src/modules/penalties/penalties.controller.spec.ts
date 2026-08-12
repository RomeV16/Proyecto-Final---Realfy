import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
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

  const penaltiesService = new PenaltiesService();

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
    it('throws NotFoundException when penalty does not exist', async () => {
      const mocks = buildMocks();
      mocks.prisma.client.penalty.findFirst.mockResolvedValue(null);
      const controller = buildController(mocks);

      await expect(
        controller.waivePenalty('non-existent', { reason: 'test' }),
      ).rejects.toThrow(NotFoundException);
    });

    it('waives penalty when it exists', async () => {
      const mocks = buildMocks();
      mocks.prisma.client.penalty.findFirst.mockResolvedValue({ id: 'p1', status: 'active' });
      const controller = buildController(mocks);

      const result = await controller.waivePenalty('p1', { reason: 'manual override' });

      expect(mocks.prisma.client.penalty.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'p1' },
          data: expect.objectContaining({
            status: 'waived',
            waiveReason: 'manual override',
            waivedBy: 'user-1',
          }),
        }),
      );
      expect(result.status).toBe('waived');
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
