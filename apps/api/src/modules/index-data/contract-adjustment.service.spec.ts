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
/** IndexDataService.getForPeriod: une índices propios y de sistema (DEF-01). */
const mockFindManyIndex = jest.fn();
const mockIndexData = { getForPeriod: mockFindManyIndex } as any;

// baseClient (barrido de cronogramas vencidos) y cliente de transacción
const mockFindManyDueSchedules = jest.fn();
const mockTxContractUpdate = jest.fn();
const mockTxContractFindUnique = jest.fn();
const mockTxScheduleUpdate = jest.fn();
const mockTxScheduleFindFirst = jest.fn();
const mockTxAuditCreate = jest.fn();
const mockTransaction = jest.fn();

const tx = {
  indexData: { findMany: jest.fn() },
  contract: { update: mockTxContractUpdate, findUnique: mockTxContractFindUnique },
  adjustmentSchedule: { update: mockTxScheduleUpdate, findFirst: mockTxScheduleFindFirst },
  auditLog: { create: mockTxAuditCreate },
};

const mockPrisma = {
  client: {
    contract: { findFirst: mockFindFirstContract },
    adjustmentSchedule: { findFirst: mockFindFirstSchedule },
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

/**
 * Serie mensual con fechas: el doble responde como IndexDataService.getForPeriod,
 * filtrando por el rango pedido, para verificar qué meses entran en cada ajuste.
 */
function series(points: [string, string][]) {
  return async (_type: IndexType, from: Date, until: Date, options: any = {}) =>
    points
      .map(([period, value]) => ({ period: new Date(`${period}T00:00:00.000Z`), value }))
      .filter(
        (r) =>
          (options.startExclusive ? r.period > from : r.period >= from) && r.period <= until,
      );
}

describe('ContractAdjustmentService', () => {
  let service: ContractAdjustmentService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new ContractAdjustmentService(mockPrisma, mockIndexData);
    jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    // La transacción ejecuta el callback con el cliente simulado.
    mockTransaction.mockImplementation(async (fn: (t: typeof tx) => Promise<void>) => fn(tx));
    mockFindManyIndex.mockReset();
    mockFindManyIndex.mockResolvedValue([]);
    // clearAllMocks no vacía las respuestas encoladas con *Once.
    mockFindFirstContract.mockReset();
    mockFindFirstSchedule.mockReset();
    mockTxContractUpdate.mockReset();
    mockTxContractFindUnique.mockReset();
    mockTxScheduleFindFirst.mockReset();
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

      expect(mockFindManyIndex).toHaveBeenCalledWith(
        IndexType.IPC,
        contract.startDate,
        new Date('2025-04-01T12:00:00.000Z'),
        { tenantId: 'tenant-1' },
      );
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
      mockFindManyIndex.mockImplementation(async (type: IndexType) => {
        if (type === IndexType.CVS) return rows('2.000000', '1.000000');
        if (type === IndexType.CER) return rows('1.500000', '1.500000');
        return [];
      });

      const result = await service.preview('contract-1');

      // mes 1: min(1,8; 1,5) = 1,5 %; mes 2: min(0,9; 1,5) = 0,9 % → 100000 × 1,015 × 1,009
      expect(result.projectedRent.toFixed(2)).toBe('102413.50');
      expect(result.indexType).toBe(IndexType.CVS);
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

    it('CP-55 (DEF-07): con un ajuste ya aplicado, IPC encadena solo los meses posteriores a ese ajuste', async () => {
      // Ajuste de abril aplicado con 2 %, 3 % y 1 % (100.000 → 106.110,60).
      // El de julio solo debe sumar el 4 % de mayo: 106.110,60 × 1,04.
      mockFindFirstContract.mockResolvedValueOnce(
        makeContract({
          adjustmentType: AdjustmentType.IPC,
          rentAmount: '106110.60',
          customAdjustmentPct: null,
        }),
      );
      mockFindFirstSchedule
        .mockResolvedValueOnce(makeSchedule({ nextAdjustmentDate: new Date('2025-07-01T00:00:00.000Z'), periodNumber: 2 }))
        .mockResolvedValueOnce(
          makeSchedule({ nextAdjustmentDate: new Date('2025-04-01T00:00:00.000Z'), status: ScheduleStatus.Applied }),
        );
      mockFindManyIndex.mockImplementation(
        series([
          ['2025-02-01', '2.000000'],
          ['2025-03-01', '3.000000'],
          ['2025-04-01', '1.000000'],
          ['2025-05-01', '4.000000'],
        ]),
      );

      const result = await service.preview('contract-1');

      expect(result.projectedRent.toFixed(2)).toBe('110355.02');
      expect(result.factor.toFixed(4)).toBe('1.0400');
    });

    it('CP-56 (DEF-07): con un ajuste ya aplicado, ICL toma como inicio el valor en la fecha de ese ajuste', async () => {
      // Ajuste de abril aplicado con ICL 100 → 110 (50.000 → 55.000).
      // El de julio es 121 / 110 = 1,1 sobre 55.000, no 121 / 100.
      mockFindFirstContract.mockResolvedValueOnce(
        makeContract({ adjustmentType: AdjustmentType.ICL, rentAmount: '55000.00', customAdjustmentPct: null }),
      );
      mockFindFirstSchedule
        .mockResolvedValueOnce(makeSchedule({ nextAdjustmentDate: new Date('2025-07-01T00:00:00.000Z'), periodNumber: 2 }))
        .mockResolvedValueOnce(
          makeSchedule({ nextAdjustmentDate: new Date('2025-04-01T00:00:00.000Z'), status: ScheduleStatus.Applied }),
        );
      mockFindManyIndex.mockImplementation(
        series([
          ['2025-01-01', '100.000000'],
          ['2025-04-01', '110.000000'],
          ['2025-07-01', '121.000000'],
        ]),
      );

      const result = await service.preview('contract-1');

      expect(result.projectedRent.toFixed(2)).toBe('60500.00');
      expect(result.factor.toFixed(4)).toBe('1.1000');
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
      mockFindManyIndex.mockResolvedValueOnce(rows('100', '110'));

      await service.applyDueAdjustments();

      expect(mockFindManyIndex).toHaveBeenCalledWith(
        IndexType.ICL,
        expect.any(Date),
        expect.any(Date),
        { tenantId: 'tenant-7', client: tx },
      );
      expect(mockTxContractUpdate.mock.calls[0][0].data.rentAmount).toBe('55000');
    });

    it('CP-14 (D1): vencido IPC 2 % y 3 % informa el delta realmente aplicado (RF-13)', async () => {
      mockFindManyDueSchedules.mockResolvedValueOnce([
        makeDue({ adjustmentType: AdjustmentType.IPC, rentAmount: '100000.00', customAdjustmentPct: null }),
      ]);
      mockFindManyIndex.mockResolvedValueOnce(rows('2.000000', '3.000000'));

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

    it('CP-57 (DEF-08): dos ajustes vencidos del mismo contrato se encadenan; el segundo parte del alquiler que dejó el primero', async () => {
      let rent = '50000.00';
      mockTxContractUpdate.mockImplementation(async ({ data }: any) => {
        rent = data.rentAmount;
      });
      mockTxContractFindUnique.mockImplementation(async () => makeContract({ rentAmount: rent }));
      mockFindManyDueSchedules.mockResolvedValueOnce([
        makeDue({}, { id: 'schedule-1', nextAdjustmentDate: new Date('2025-04-01T00:00:00.000Z') }),
        makeDue({}, { id: 'schedule-2', periodNumber: 2, nextAdjustmentDate: new Date('2025-07-01T00:00:00.000Z') }),
      ]);

      const result = await service.applyDueAdjustments();

      expect(mockTxContractUpdate.mock.calls.map((c) => c[0].data.rentAmount)).toEqual(['55000', '60500']);
      expect(mockTxAuditCreate.mock.calls[1][0].data.changes).toMatchObject({
        previousRent: '55000',
        newRent: '60500',
      });
      expect(result.map((r) => Number(r.deltaAmount))).toEqual([5000, 5500]);
    });

    it.each([
      [AdjustmentPeriod.Mensual, '2025-05-01'],
      [AdjustmentPeriod.Bimestral, '2025-06-01'],
      [AdjustmentPeriod.Trimestral, '2025-07-01'],
      [AdjustmentPeriod.Cuatrimestral, '2025-08-01'],
      [AdjustmentPeriod.Semestral, '2025-10-01'],
      [AdjustmentPeriod.Anual, '2026-04-01'],
    ])('CP-16: periodicidad %s avanza la próxima fecha a %s', async (period, expected) => {
      mockFindManyDueSchedules.mockResolvedValueOnce([makeDue({ adjustmentPeriod: period })]);

      await service.applyDueAdjustments();

      const next = mockTxAuditCreate.mock.calls[0][0].data.changes.nextAdjustmentDate;
      expect(next.slice(0, 10)).toBe(expected);
    });

    it('CP-16: una periodicidad desconocida no aplica el ajuste ni asume trimestral (DEF-10)', async () => {
      mockFindManyDueSchedules.mockResolvedValueOnce([makeDue({ adjustmentPeriod: 'Inventada' })]);

      const result = await service.applyDueAdjustments();

      expect(result).toEqual([]);
      expect(mockTxContractUpdate).not.toHaveBeenCalled();
      expect(mockTxAuditCreate).not.toHaveBeenCalled();
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
