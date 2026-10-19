import { Logger, NotFoundException } from '@nestjs/common';
import { ContractAdjustmentService } from './contract-adjustment.service';
import {
  AdjustmentType,
  AdjustmentPeriod,
  ContractStatus,
  ScheduleStatus,
  IndexType,
} from '@realfy/shared';

// ─── Mock Prisma ─────────────────────────────────────────────────────────────

const mockFindFirstContract = jest.fn();
const mockFindFirstSchedule = jest.fn();
const mockFindManyIndex = jest.fn();

// baseClient (barrido de cronogramas vencidos) y cliente de transacción
const mockFindManyDueSchedules = jest.fn();
const mockTxIndexFindMany = jest.fn();
const mockTxContractUpdate = jest.fn();
const mockTxScheduleUpdate = jest.fn();
const mockTxAuditCreate = jest.fn();
const mockTransaction = jest.fn();

const tx = {
  indexData: { findMany: mockTxIndexFindMany },
  contract: { update: mockTxContractUpdate },
  adjustmentSchedule: { update: mockTxScheduleUpdate },
  auditLog: { create: mockTxAuditCreate },
};

const mockPrisma = {
  client: {
    contract: { findFirst: mockFindFirstContract },
    adjustmentSchedule: { findFirst: mockFindFirstSchedule },
    indexData: { findMany: mockFindManyIndex },
  },
  baseClient: {
    adjustmentSchedule: { findMany: mockFindManyDueSchedules },
    $transaction: mockTransaction,
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
    nextAdjustmentDate: new Date('2025-04-01T12:00:00.000Z'),
    periodNumber: 1,
    status: ScheduleStatus.Pending,
    ...overrides,
  };
}

/** Cronograma vencido con su contrato incluido, como lo devuelve el barrido. */
function makeDue(contractOverrides: Partial<any> = {}, scheduleOverrides: Partial<any> = {}): any {
  return makeSchedule({ contract: makeContract(contractOverrides), ...scheduleOverrides });
}

const rows = (...values: string[]) => values.map((value) => ({ value }));

describe('ContractAdjustmentService', () => {
  let service: ContractAdjustmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ContractAdjustmentService(mockPrisma);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // La transacción ejecuta el callback con el cliente simulado.
    mockTransaction.mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));
    mockTxIndexFindMany.mockResolvedValue([]);
  });

  // ── preview ───────────────────────────────────────────────────────────────

  describe('preview', () => {
    it('CP-01 (D8): porcentaje fijo 10 % proyecta 55.000 sobre 50.000', async () => {
      mockFindFirstContract.mockResolvedValueOnce(makeContract());
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce([]);

      const result = await service.preview('contract-1');

      expect(result.currentRent.toFixed(2)).toBe('50000.00');
      expect(result.projectedRent.toFixed(2)).toBe('55000.00');
      expect(result.projectedDelta.toFixed(2)).toBe('5000.00');
      expect(result.indexType).toBe(IndexType.IPC);
      expect(result.period).toBe('2025-04');
    });

    it('CP-02: contrato inexistente responde NotFoundException', async () => {
      mockFindFirstContract.mockResolvedValueOnce(null);

      await expect(service.preview('missing')).rejects.toThrow(NotFoundException);
      expect(mockFindFirstSchedule).not.toHaveBeenCalled();
    });

    it('CP-03: sin cronograma pendiente usa el mes actual como período', async () => {
      mockFindFirstContract.mockResolvedValueOnce(makeContract());
      mockFindFirstSchedule.mockResolvedValueOnce(null);
      mockFindManyIndex.mockResolvedValueOnce([]);

      const result = await service.preview('contract-1');

      expect(result.period).toBe(new Date().toISOString().slice(0, 7));
    });

    it('CP-04 (D3): ICL 100 → 120 proyecta un 20 %', async () => {
      mockFindFirstContract.mockResolvedValueOnce(
        makeContract({ adjustmentType: AdjustmentType.ICL, customAdjustmentPct: null }),
      );
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce(rows('100.000000', '120.000000'));

      const result = await service.preview('contract-1');

      expect(result.projectedRent.toFixed(2)).toBe('60000.00');
      expect(result.factor.toFixed(4)).toBe('1.2000');
      expect(result.indexType).toBe(IndexType.ICL);
    });

    it('CP-05 (D1, D11): IPC 2 % y 3 % encadena por producto (5,06 %) e ignora el porcentaje declarado', async () => {
      mockFindFirstContract.mockResolvedValueOnce(
        makeContract({
          adjustmentType: AdjustmentType.IPC,
          rentAmount: '100000.00',
          customAdjustmentPct: '10.00', // debe ignorarse
        }),
      );
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce(rows('2.000000', '3.000000'));

      const result = await service.preview('contract-1');

      expect(result.projectedRent.toFixed(2)).toBe('105060.00');
      expect(result.factor.toFixed(4)).toBe('1.0506');
      expect(result.projectedDelta.toFixed(2)).toBe('5060.00');
    });

    it('CP-05: consulta los índices del tipo del contrato entre su inicio y la fecha de ajuste', async () => {
      const contract = makeContract({ adjustmentType: AdjustmentType.IPC });
      mockFindFirstContract.mockResolvedValueOnce(contract);
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce([]);

      await service.preview('contract-1');

      expect(mockFindManyIndex).toHaveBeenCalledWith({
        where: {
          indexType: IndexType.IPC,
          period: { gte: contract.startDate, lte: new Date('2025-04-01T12:00:00.000Z') },
        },
        orderBy: { period: 'asc' },
      });
    });

    it('CP-06 (D2): IPC sin valores deja el alquiler igual', async () => {
      mockFindFirstContract.mockResolvedValueOnce(makeContract({ adjustmentType: AdjustmentType.IPC }));
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce([]);

      const result = await service.preview('contract-1');

      expect(result.projectedRent.toFixed(2)).toBe('50000.00');
      expect(result.factor.toFixed(4)).toBe('1.0000');
      expect(result.projectedDelta.toFixed(2)).toBe('0.00');
    });

    it('CP-07 (D4): ICL sin valores deja el alquiler igual', async () => {
      mockFindFirstContract.mockResolvedValueOnce(makeContract({ adjustmentType: AdjustmentType.ICL }));
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce([]);

      const result = await service.preview('contract-1');

      expect(result.projectedRent.toFixed(2)).toBe('50000.00');
      expect(result.factor.toFixed(4)).toBe('1.0000');
    });

    it('CP-08 (D5, límite): ICL con un solo valor da factor 1', async () => {
      mockFindFirstContract.mockResolvedValueOnce(makeContract({ adjustmentType: AdjustmentType.ICL }));
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce(rows('31.490000'));

      const result = await service.preview('contract-1');

      expect(result.factor.toFixed(4)).toBe('1.0000');
      expect(result.projectedRent.toFixed(2)).toBe('50000.00');
    });

    it('CP-09 (D6, D7): CCP usa CVS y CER y aplica el menor entre 0,9·CVS y CER por mes', async () => {
      mockFindFirstContract.mockResolvedValueOnce(
        makeContract({ adjustmentType: AdjustmentType.CCP, rentAmount: '100000.00', customAdjustmentPct: null }),
      );
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockImplementation(async ({ where }: any) => {
        if (where.indexType === IndexType.CVS) return rows('2.000000', '1.000000');
        if (where.indexType === IndexType.CER) return rows('1.500000', '1.500000');
        return [];
      });

      const result = await service.preview('contract-1');

      // mes 1: min(1,8; 1,5) = 1,5 %; mes 2: min(0,9; 1,5) = 0,9 % → 100000 × 1,015 × 1,009
      expect(result.projectedRent.toFixed(2)).toBe('102413.50');
      expect(result.indexType).toBe(IndexType.CVS);
      mockFindManyIndex.mockReset();
    });

    it('CP-10 (D9): porcentaje fijo sin porcentaje declarado no ajusta', async () => {
      mockFindFirstContract.mockResolvedValueOnce(makeContract({ customAdjustmentPct: null }));
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce([]);

      const result = await service.preview('contract-1');

      expect(result.projectedRent.toFixed(2)).toBe('50000.00');
    });

    it('CP-10 (D10): personalizado 7,5 % proyecta 53.750', async () => {
      mockFindFirstContract.mockResolvedValueOnce(
        makeContract({ adjustmentType: AdjustmentType.Custom, customAdjustmentPct: '7.50' }),
      );
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce([]);

      const result = await service.preview('contract-1');

      expect(result.projectedRent.toFixed(2)).toBe('53750.00');
      expect(result.factor.toFixed(4)).toBe('1.0750');
    });

    it('CP-11 (límite): alquiler 0 no divide por cero', async () => {
      mockFindFirstContract.mockResolvedValueOnce(makeContract({ rentAmount: '0.00' }));
      mockFindFirstSchedule.mockResolvedValueOnce(makeSchedule());
      mockFindManyIndex.mockResolvedValueOnce([]);

      const result = await service.preview('contract-1');

      expect(result.projectedRent.toFixed(2)).toBe('0.00');
      expect(result.projectedDelta.toFixed(2)).toBe('0.00');
      expect(result.factor.isFinite()).toBe(true);
    });
  });

  // ── applyDueAdjustments ───────────────────────────────────────────────────

  describe('applyDueAdjustments', () => {
    it('CP-12: sin cronogramas vencidos devuelve lista vacía y no escribe nada', async () => {
      mockFindManyDueSchedules.mockResolvedValueOnce([]);

      const result = await service.applyDueAdjustments();

      expect(result).toEqual([]);
      expect(mockTransaction).not.toHaveBeenCalled();
    });

    it('CP-12: el barrido busca solo pendientes vencidos de contratos activos, sin filtro de inmobiliaria', async () => {
      mockFindManyDueSchedules.mockResolvedValueOnce([]);

      await service.applyDueAdjustments();

      const args = mockFindManyDueSchedules.mock.calls[0][0];
      expect(args.where.status).toBe(ScheduleStatus.Pending);
      expect(args.where.nextAdjustmentDate.lte).toBeInstanceOf(Date);
      expect(args.where.contract).toEqual({ status: ContractStatus.Activo, isActive: true });
      expect(args.where.tenantId).toBeUndefined();
      expect(args.include).toEqual({ contract: true });
    });

    it('CP-13 (D8): fijo 10 % actualiza el alquiler, marca Applied y audita con los valores usados', async () => {
      mockFindManyDueSchedules.mockResolvedValueOnce([makeDue()]);

      const result = await service.applyDueAdjustments();

      expect(mockTxContractUpdate).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: { rentAmount: '55000' },
      });
      expect(mockTxScheduleUpdate).toHaveBeenCalledWith({
        where: { id: 'schedule-1' },
        data: { status: ScheduleStatus.Applied },
      });

      const audit = mockTxAuditCreate.mock.calls[0][0].data;
      expect(audit).toMatchObject({
        tenantId: 'tenant-1',
        userId: null,
        action: 'UPDATE',
        entity: 'adjustment_applied',
        entityId: 'contract-1',
      });
      expect(audit.changes).toMatchObject({
        appliedPeriod: '2025-04',
        previousRent: '50000',
        newRent: '55000',
        delta: '5000',
      });

      expect(result).toHaveLength(1);
      expect(result[0].contractId).toBe('contract-1');
      expect(result[0].appliedPeriod).toBe('2025-04');
      expect(Number(result[0].deltaAmount)).toBe(5000);
    });

    it('CP-13: lee los índices de la inmobiliaria del contrato dentro de la transacción', async () => {
      mockFindManyDueSchedules.mockResolvedValueOnce([
        makeDue({ adjustmentType: AdjustmentType.ICL, tenantId: 'tenant-7' }),
      ]);
      mockTxIndexFindMany.mockResolvedValueOnce(rows('100', '110'));

      await service.applyDueAdjustments();

      const where = mockTxIndexFindMany.mock.calls[0][0].where;
      expect(where.tenantId).toBe('tenant-7');
      expect(where.indexType).toBe(IndexType.ICL);
      expect(mockTxContractUpdate.mock.calls[0][0].data.rentAmount).toBe('55000');
    });

    it('CP-14 (D1): vencido IPC 2 % y 3 % informa el delta realmente aplicado (RF-13)', async () => {
      mockFindManyDueSchedules.mockResolvedValueOnce([
        makeDue({ adjustmentType: AdjustmentType.IPC, rentAmount: '100000.00', customAdjustmentPct: null }),
      ]);
      mockTxIndexFindMany.mockResolvedValueOnce(rows('2.000000', '3.000000'));

      const result = await service.applyDueAdjustments();

      expect(mockTxContractUpdate.mock.calls[0][0].data.rentAmount).toBe('105060');
      expect(mockTxAuditCreate.mock.calls[0][0].data.changes.delta).toBe('5060');
      expect(Number(result[0].deltaAmount)).toBe(5060);
    });

    it('CP-15: si una transacción falla, registra el error y sigue con el resto', async () => {
      mockFindManyDueSchedules.mockResolvedValueOnce([
        makeDue({ id: 'contract-A' }, { id: 'schedule-A' }),
        makeDue({ id: 'contract-B' }, { id: 'schedule-B' }),
      ]);
      mockTransaction
        .mockRejectedValueOnce(new Error('deadlock'))
        .mockImplementationOnce(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));

      const result = await service.applyDueAdjustments();

      expect(result).toHaveLength(1);
      expect(result[0].contractId).toBe('contract-B');
      expect(Logger.prototype.error).toHaveBeenCalledWith(
        expect.stringContaining('contract-A'),
        expect.anything(),
      );
    });

    it.each([
      [AdjustmentPeriod.Mensual, '2025-05-01'],
      [AdjustmentPeriod.Bimestral, '2025-06-01'],
      [AdjustmentPeriod.Trimestral, '2025-07-01'],
      [AdjustmentPeriod.Cuatrimestral, '2025-08-01'],
      [AdjustmentPeriod.Semestral, '2025-10-01'],
      [AdjustmentPeriod.Anual, '2026-04-01'],
      ['Inventada', '2025-07-01'],
    ])('CP-16: periodicidad %s avanza la próxima fecha a %s', async (period, expected) => {
      mockFindManyDueSchedules.mockResolvedValueOnce([makeDue({ adjustmentPeriod: period })]);

      await service.applyDueAdjustments();

      const next = mockTxAuditCreate.mock.calls[0][0].data.changes.nextAdjustmentDate;
      expect(next.slice(0, 10)).toBe(expected);
    });

    it.each([
      ['2025-01-15', AdjustmentPeriod.Mensual, '2025-02-15'],
      ['2025-12-01', AdjustmentPeriod.Mensual, '2026-01-01'],
      ['2026-01-31', AdjustmentPeriod.Mensual, '2026-02-28'],
      ['2025-11-30', AdjustmentPeriod.Trimestral, '2026-02-28'],
      ['2024-02-29', AdjustmentPeriod.Anual, '2025-02-28'],
    ])('CP-17: desde %s con %s la próxima fecha es %s', async (from, period, expected) => {
      mockFindManyDueSchedules.mockResolvedValueOnce([
        makeDue({ adjustmentPeriod: period }, { nextAdjustmentDate: new Date(`${from}T12:00:00.000Z`) }),
      ]);

      await service.applyDueAdjustments();

      const next = mockTxAuditCreate.mock.calls[0][0].data.changes.nextAdjustmentDate;
      expect(next.slice(0, 10)).toBe(expected);
    });
  });
});
