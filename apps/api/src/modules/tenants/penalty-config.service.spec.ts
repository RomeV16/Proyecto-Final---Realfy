import { NotFoundException } from '@nestjs/common';
import { validate } from 'class-validator';
import { plainToInstance } from 'class-transformer';
import { TenantsService } from './tenants.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { DEFAULT_PENALTY_CONFIG } from './penalty-config.types';
import { UpdatePenaltyConfigDto, PenaltyMode } from './dto/update-penalty-config.dto';

function createMockPrismaService() {
  return {
    client: {
      tenant: {
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    },
    baseClient: {
      tenant: {
        findUnique: jest.fn(),
        update: jest.fn(),
      },
    },
  } as unknown as PrismaService;
}

function createMockTenantContext() {
  return {
    getTenantId: jest.fn(),
    setTenantId: jest.fn(),
    getUserId: jest.fn(),
    setUserId: jest.fn(),
    getUserRole: jest.fn(),
    setUserRole: jest.fn(),
    getIpAddress: jest.fn(),
    setIpAddress: jest.fn(),
    isTenantFilterBypassed: jest.fn().mockReturnValue(false),
    setBypassTenantFilter: jest.fn(),
  } as unknown as TenantContextService;
}

describe('TenantsService — penalty config', () => {
  let service: TenantsService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tenantContext: ReturnType<typeof createMockTenantContext>;

  const TENANT_ID = 'tenant-abc-123';

  beforeEach(() => {
    prisma = createMockPrismaService();
    tenantContext = createMockTenantContext();
    service = new TenantsService(prisma as any, tenantContext as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ──────────────────────────────────────────────────────────
  // getPenaltyConfig
  // ──────────────────────────────────────────────────────────

  describe('getPenaltyConfig', () => {
    it('returns DEFAULT_PENALTY_CONFIG when penaltyConfig is null', async () => {
      (prisma.baseClient.tenant.findUnique as jest.Mock).mockResolvedValue({
        penaltyConfig: null,
      });

      const result = await service.getPenaltyConfig(TENANT_ID);

      expect(result).toEqual(DEFAULT_PENALTY_CONFIG);
    });

    it('returns stored config when penaltyConfig is set', async () => {
      const stored = {
        mode: 'daily_fixed',
        value: '50',
        graceDays: 3,
        maxMultiplier: '1.5',
      };

      (prisma.baseClient.tenant.findUnique as jest.Mock).mockResolvedValue({
        penaltyConfig: stored,
      });

      const result = await service.getPenaltyConfig(TENANT_ID);

      expect(result).toEqual(stored);
    });

    it('throws NotFoundException when tenant does not exist', async () => {
      (prisma.baseClient.tenant.findUnique as jest.Mock).mockResolvedValue(null);

      await expect(service.getPenaltyConfig(TENANT_ID)).rejects.toThrow(
        NotFoundException,
      );
    });

    it('bypasses tenant filter and restores it afterwards', async () => {
      (prisma.baseClient.tenant.findUnique as jest.Mock).mockResolvedValue({
        penaltyConfig: null,
      });

      await service.getPenaltyConfig(TENANT_ID);

      const calls = (tenantContext.setBypassTenantFilter as jest.Mock).mock.calls;
      expect(calls[0][0]).toBe(true);
      expect(calls[1][0]).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────
  // updatePenaltyConfig
  // ──────────────────────────────────────────────────────────

  describe('updatePenaltyConfig', () => {
    const validDto: UpdatePenaltyConfigDto = {
      mode: PenaltyMode.DailyPercent,
      value: '0.002',
      graceDays: 7,
      maxMultiplier: '3.0',
    };

    it('persists and returns the new config (round-trip)', async () => {
      const saved = { ...validDto };
      (prisma.baseClient.tenant.update as jest.Mock).mockResolvedValue({
        penaltyConfig: saved,
      });

      const result = await service.updatePenaltyConfig(TENANT_ID, validDto);

      expect(result).toEqual(saved);

      const updateCall = (prisma.baseClient.tenant.update as jest.Mock).mock.calls[0][0];
      expect(updateCall.where).toEqual({ id: TENANT_ID });
      expect(updateCall.data.penaltyConfig).toMatchObject({
        mode: 'daily_percent',
        value: '0.002',
        graceDays: 7,
        maxMultiplier: '3.0',
      });
    });

    it('bypasses tenant filter and restores it afterwards', async () => {
      (prisma.baseClient.tenant.update as jest.Mock).mockResolvedValue({
        penaltyConfig: validDto,
      });

      await service.updatePenaltyConfig(TENANT_ID, validDto);

      const calls = (tenantContext.setBypassTenantFilter as jest.Mock).mock.calls;
      expect(calls[0][0]).toBe(true);
      expect(calls[1][0]).toBe(false);
    });
  });

  // ──────────────────────────────────────────────────────────
  // UpdatePenaltyConfigDto — class-validator
  // ──────────────────────────────────────────────────────────

  describe('UpdatePenaltyConfigDto validation', () => {
    async function validateDto(plain: object) {
      const dto = plainToInstance(UpdatePenaltyConfigDto, plain);
      return validate(dto);
    }

    it('passes for a fully valid payload', async () => {
      const errors = await validateDto({
        mode: 'daily_percent',
        value: '0.001',
        graceDays: 5,
        maxMultiplier: '2.0',
      });
      expect(errors).toHaveLength(0);
    });

    it('rejects an invalid mode string', async () => {
      const errors = await validateDto({
        mode: 'monthly_percent',
        value: '0.001',
        graceDays: 5,
        maxMultiplier: '2.0',
      });
      const modeErrors = errors.filter((e) => e.property === 'mode');
      expect(modeErrors.length).toBeGreaterThan(0);
    });

    it('rejects a non-decimal value string', async () => {
      const errors = await validateDto({
        mode: 'daily_fixed',
        value: 'not-a-number',
        graceDays: 5,
        maxMultiplier: '2.0',
      });
      const valueErrors = errors.filter((e) => e.property === 'value');
      expect(valueErrors.length).toBeGreaterThan(0);
    });

    it('rejects a negative graceDays', async () => {
      const errors = await validateDto({
        mode: 'compound_percent',
        value: '0.001',
        graceDays: -1,
        maxMultiplier: '2.0',
      });
      const graceErrors = errors.filter((e) => e.property === 'graceDays');
      expect(graceErrors.length).toBeGreaterThan(0);
    });

    it('rejects a non-decimal maxMultiplier string', async () => {
      const errors = await validateDto({
        mode: 'daily_fixed',
        value: '10',
        graceDays: 0,
        maxMultiplier: 'two-point-zero',
      });
      const multiplierErrors = errors.filter((e) => e.property === 'maxMultiplier');
      expect(multiplierErrors.length).toBeGreaterThan(0);
    });

    it('accepts zero graceDays', async () => {
      const errors = await validateDto({
        mode: 'daily_fixed',
        value: '100',
        graceDays: 0,
        maxMultiplier: '1.0',
      });
      expect(errors).toHaveLength(0);
    });

    it('accepts all three valid modes', async () => {
      for (const mode of ['daily_fixed', 'daily_percent', 'compound_percent']) {
        const errors = await validateDto({
          mode,
          value: '0.5',
          graceDays: 2,
          maxMultiplier: '2.0',
        });
        expect(errors).toHaveLength(0);
      }
    });
  });
});
