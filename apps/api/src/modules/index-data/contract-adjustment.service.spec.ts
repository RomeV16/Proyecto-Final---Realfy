import { Logger, NotFoundException } from '@nestjs/common';
import { ContractAdjustmentService } from './contract-adjustment.service';
import { AdjustmentType, AdjustmentPeriod, ContractStatus, ScheduleStatus, IndexType } from '@realfy/shared';

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

const mockFindFirstContract = jest.fn();
const mockFindFirstSchedule = jest.fn();
const mockFindManyIndex = jest.fn();

const mockPrisma = {
  client: {
    contract: { findFirst: mockFindFirstContract },
    adjustmentSchedule: { findFirst: mockFindFirstSchedule },
    indexData: { findMany: mockFindManyIndex },
  },
} as any;

// ─── Fixtures ─────────────────────────────────────────────────────────────────

function makeContract(overrides: Partial<any> = {}): any {
  return {
    id: 'contract-1',
    tenantId: 'tenant-1',
    rentAmount: '50000.00',
    adjustmentType: AdjustmentType.FixedPercent,
    adjustmentPeriod: AdjustmentPeriod.Trimestral,
    customAdjustmentPct: '10.00',
    startDate: new Date('2025-01-01'),
    status: ContractStatus.Activo,
    isActive: true,
    ...overrides,
  };
}

function makeSchedule(overrides: Partial<any> = {}): any {
  return {
    id: 'schedule-1',
    contractId: 'contract-1',
    nextAdjustmentDate: new Date('2025-04-01'),
    periodNumber: 1,
    status: ScheduleStatus.Pending,
    ...overrides,
  };
}

describe('ContractAdjustmentService', () => {
  let service: ContractAdjustmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ContractAdjustmentService(mockPrisma);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });

  // ── preview ───────────────────────────────────────────────────────────────

  describe('preview', () => {
    it('returns projected rent for FixedPercent contract (happy path)', async () => {
      mockFindFirstContract.mockResolvedValueOnce(makeContract());
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce([]);

      const result = await service.preview('contract-1');

      expect(result.currentRent.toFixed(2)).toBe('50000.00');
      // 10% adjustment
      expect(result.projectedRent.toFixed(2)).toBe('55000.00');
      expect(result.projectedDelta.toFixed(2)).toBe('5000.00');
      expect(result.indexType).toBe(IndexType.IPC);
    });

    it('throws NotFoundException when contract not found', async () => {
      mockFindFirstContract.mockResolvedValueOnce(null);

      await expect(service.preview('missing')).rejects.toThrow(NotFoundException);
    });

    it('falls back to today when no pending schedule exists', async () => {
      mockFindFirstContract.mockResolvedValueOnce(makeContract());
      mockFindFirstSchedule.mockResolvedValueOnce(null); // no schedule
      mockFindManyIndex.mockResolvedValueOnce([]);

      const result = await service.preview('contract-1');
      // Period should be current month
      const expectedPeriod = new Date().toISOString().slice(0, 7);
      expect(result.period).toBe(expectedPeriod);
    });

    it('correctly computes ICL factor when index data present', async () => {
      mockFindFirstContract.mockResolvedValueOnce(
        makeContract({ adjustmentType: AdjustmentType.ICL, customAdjustmentPct: null }),
      );
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      // startValue=100, endValue=120 → 20% increase
      mockFindManyIndex.mockResolvedValueOnce([
        { value: '100.000000' },
        { value: '120.000000' },
      ]);

      const result = await service.preview('contract-1');

      expect(result.projectedRent.toFixed(2)).toBe('60000.00'); // 50000 * 1.2
      expect(result.indexType).toBe(IndexType.ICL);
    });
  });
});
