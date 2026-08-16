import { BadRequestException, NotFoundException } from '@nestjs/common';
import { ScoringService } from './scoring.service';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';

const TENANT_ID = 'tenant-abc';
const USER_ID = 'user-123';
const PERSON_ID = 'person-001';

function createMockPrismaService() {
  return {
    client: {
      tenantScoreConfig: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      tenantScore: {
        findUnique: jest.fn(),
        upsert: jest.fn(),
      },
      person: {
        findFirst: jest.fn(),
      },
    },
  } as unknown as PrismaService;
}

function createMockTenantContext() {
  return {
    getTenantId: jest.fn().mockReturnValue(TENANT_ID),
    getUserId: jest.fn().mockReturnValue(USER_ID),
  } as unknown as TenantContextService;
}

const DEFAULT_CONFIG = {
  id: 'config-1',
  tenantId: TENANT_ID,
  guaranteeWeight: 20,
  jobStabilityWeight: 20,
  referencesWeight: 20,
  paymentHistoryWeight: 20,
  manualRatingWeight: 20,
};

describe('ScoringService', () => {
  let service: ScoringService;
  let prisma: ReturnType<typeof createMockPrismaService>;
  let tenantContext: ReturnType<typeof createMockTenantContext>;

  beforeEach(() => {
    prisma = createMockPrismaService();
    tenantContext = createMockTenantContext();
    service = new ScoringService(prisma as any, tenantContext as any);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // ─── getConfig ────────────────────────────────────────────────────────────

  describe('getConfig', () => {
    it('returns the existing config when one exists', async () => {
      (prisma.client.tenantScoreConfig.findUnique as jest.Mock).mockResolvedValue(DEFAULT_CONFIG);

      const result = await service.getConfig();

      expect(result).toEqual(DEFAULT_CONFIG);
      expect(prisma.client.tenantScoreConfig.create).not.toHaveBeenCalled();
    });

    it('creates a default config (all weights = 20) when none exists', async () => {
      (prisma.client.tenantScoreConfig.findUnique as jest.Mock).mockResolvedValue(null);
      (prisma.client.tenantScoreConfig.create as jest.Mock).mockResolvedValue(DEFAULT_CONFIG);

      const result = await service.getConfig();

      expect(prisma.client.tenantScoreConfig.create).toHaveBeenCalledWith({
        data: {
          tenantId: TENANT_ID,
          guaranteeWeight: 20,
          jobStabilityWeight: 20,
          referencesWeight: 20,
          paymentHistoryWeight: 20,
          manualRatingWeight: 20,
        },
      });
      expect(result).toEqual(DEFAULT_CONFIG);
    });
  });

  // ─── upsertPersonScore — cálculo de puntaje ────────────────────────────────

  describe('upsertPersonScore', () => {
    beforeEach(() => {
      (prisma.client.person.findFirst as jest.Mock).mockResolvedValue({ id: PERSON_ID, tenantId: TENANT_ID });
      (prisma.client.tenantScoreConfig.findUnique as jest.Mock).mockResolvedValue(DEFAULT_CONFIG);
    });

    it('computes totalScore as the weighted average of the five factors', async () => {
      (prisma.client.tenantScore.upsert as jest.Mock).mockImplementation(({ create }: any) => create);

      const result: any = await service.upsertPersonScore(PERSON_ID, {
        guaranteeScore: 80,
        jobStabilityScore: 60,
        referencesScore: 40,
        paymentHistoryScore: 100,
        manualRating: 20,
      });

      // Equal weights (20 each) → simple average of the five scores.
      // (80 + 60 + 40 + 100 + 20) / 5 = 60
      expect(result.totalScore.toString()).toBe('60');
    });

    it('weights factors unevenly when the tenant config is not uniform', async () => {
      (prisma.client.tenantScoreConfig.findUnique as jest.Mock).mockResolvedValue({
        ...DEFAULT_CONFIG,
        guaranteeWeight: 80,
        jobStabilityWeight: 5,
        referencesWeight: 5,
        paymentHistoryWeight: 5,
        manualRatingWeight: 5,
      });
      (prisma.client.tenantScore.upsert as jest.Mock).mockImplementation(({ create }: any) => create);

      const result: any = await service.upsertPersonScore(PERSON_ID, {
        guaranteeScore: 100,
        jobStabilityScore: 0,
        referencesScore: 0,
        paymentHistoryScore: 0,
        manualRating: 0,
      });

      // (100*80 + 0*5*4) / 100 = 80
      expect(result.totalScore.toString()).toBe('80');
    });

    it('rounds totalScore to 2 decimal places', async () => {
      (prisma.client.tenantScoreConfig.findUnique as jest.Mock).mockResolvedValue({
        ...DEFAULT_CONFIG,
        guaranteeWeight: 1,
        jobStabilityWeight: 1,
        referencesWeight: 1,
        paymentHistoryWeight: 0,
        manualRatingWeight: 0,
      });
      (prisma.client.tenantScore.upsert as jest.Mock).mockImplementation(({ create }: any) => create);

      const result: any = await service.upsertPersonScore(PERSON_ID, {
        guaranteeScore: 100,
        jobStabilityScore: 100,
        referencesScore: 0,
        paymentHistoryScore: 0,
        manualRating: 0,
      });

      // (100*1 + 100*1 + 0*1) / 3 = 66.666... → rounds to 66.67
      expect(result.totalScore.toString()).toBe('66.67');
    });

    it('throws NotFoundException when the person does not belong to the tenant', async () => {
      (prisma.client.person.findFirst as jest.Mock).mockResolvedValue(null);

      await expect(
        service.upsertPersonScore(PERSON_ID, {
          guaranteeScore: 50,
          jobStabilityScore: 50,
          referencesScore: 50,
          paymentHistoryScore: 50,
          manualRating: 50,
        }),
      ).rejects.toThrow(NotFoundException);
    });

    it('throws BadRequestException on invalid score data', async () => {
      await expect(
        service.upsertPersonScore(PERSON_ID, {
          guaranteeScore: 150, // out of 0-100 range
          jobStabilityScore: 50,
          referencesScore: 50,
          paymentHistoryScore: 50,
          manualRating: 50,
        }),
      ).rejects.toThrow(BadRequestException);
    });

    it('stamps scoredByUserId with the current tenant-context user', async () => {
      (prisma.client.tenantScore.upsert as jest.Mock).mockImplementation(({ create }: any) => create);

      const result: any = await service.upsertPersonScore(PERSON_ID, {
        guaranteeScore: 50,
        jobStabilityScore: 50,
        referencesScore: 50,
        paymentHistoryScore: 50,
        manualRating: 50,
      });

      expect(result.scoredByUserId).toBe(USER_ID);
    });
  });

  // ─── getPersonScore ─────────────────────────────────────────────────────────

  describe('getPersonScore', () => {
    it('returns null when the person has no score yet', async () => {
      (prisma.client.tenantScore.findUnique as jest.Mock).mockResolvedValue(null);

      const result = await service.getPersonScore(PERSON_ID);

      expect(result).toBeNull();
    });
  });
});
