import { ContractsService } from './contracts.service';
import {
  ContractAdjustmentService,
  MISSING_INDEX_DATA,
} from '../index-data/contract-adjustment.service';
import {
  AdjustmentPeriod,
  AdjustmentType,
  ContractStatus,
  IndexType,
  ScheduleStatus,
} from '@realfy/shared';

/**
 * Caracterización del cálculo de ajuste por modalidad: los dos caminos que hoy
 * existen (el cálculo manual de ContractsService y la previsualización y el
 * barrido automático de ContractAdjustmentService) reciben los mismos datos
 * sintéticos y se anota lo que cada uno responde.
 */

type Outcome = { rent: string } | { error: string };
type Series = Partial<Record<IndexType, string[]>>;

interface Case {
  name: string;
  contract: Record<string, unknown>;
  series?: Series;
  manual: Outcome;
  preview: Outcome;
  auto: Outcome | 'skipped';
}

const SCHEDULE_DATE = new Date('2025-04-01T12:00:00.000Z');

const baseContract = (overrides: Record<string, unknown>) => ({
  id: 'contract-1',
  tenantId: 'tenant-1',
  rentAmount: '100000.00',
  rentCurrency: 'ARS',
  adjustmentType: AdjustmentType.FixedPercent,
  adjustmentPeriod: AdjustmentPeriod.Trimestral,
  customAdjustmentPct: null,
  startDate: new Date('2025-01-01T12:00:00.000Z'),
  status: ContractStatus.Activo,
  isActive: true,
  adjustments: [],
  ...overrides,
});

const schedule = {
  id: 'schedule-1',
  contractId: 'contract-1',
  nextAdjustmentDate: SCHEDULE_DATE,
  periodNumber: 1,
  status: ScheduleStatus.Pending,
};

function build(contract: any, series: Series, previous: any = null) {
  const getForPeriod = jest.fn(async (type: IndexType) =>
    (series[type] ?? []).map((value) => ({ value })),
  );
  const findSchedule = jest.fn(async (args: any) =>
    args.where.status === ScheduleStatus.Applied ? previous : schedule,
  );
  const client = {
    contract: { findFirst: jest.fn(async () => contract) },
    adjustmentSchedule: { findFirst: findSchedule, update: jest.fn() },
    contractAdjustment: {
      create: jest.fn(async ({ data }: any) => data),
    },
  };
  const tx = {
    contract: { findUnique: jest.fn(async () => contract), update: jest.fn() },
    adjustmentSchedule: {
      findFirst: jest.fn(async () => previous),
      update: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    contractTermsVersion: { findFirst: jest.fn(async () => null) },
  };
  const prisma: any = {
    client,
    baseClient: {
      contractTermsVersion: { findFirst: jest.fn(async () => null) },
      adjustmentSchedule: {
        findMany: jest.fn(async () => [{ ...schedule, contract }]),
      },
      $transaction: jest.fn(async (cb: any) => cb(tx)),
    },
  };
  const indexData: any = { getForPeriod };
  const adjustments = new ContractAdjustmentService(prisma, indexData);
  const contracts = new ContractsService(
    prisma,
    { getTenantId: () => 'tenant-1' } as any,
    {} as any,
    adjustments,
    {} as any,
  );
  return { contracts, adjustments, getForPeriod, tx };
}

const errorCode = (err: any): string => err?.getResponse?.()?.error ?? err?.code ?? String(err);

async function runManual(contract: any, series: Series): Promise<Outcome> {
  const { contracts } = build(contract, series);
  try {
    const result: any = await contracts.calculateAdjustment('contract-1', 'schedule-1');
    return { rent: Number(result.newAmount).toFixed(2) };
  } catch (err) {
    return { error: errorCode(err) };
  }
}

async function runPreview(contract: any, series: Series): Promise<Outcome> {
  const { adjustments } = build(contract, series);
  try {
    const result = await adjustments.preview('contract-1');
    return { rent: result.projectedRent.toFixed(2) };
  } catch (err) {
    return { error: errorCode(err) };
  }
}

async function runAuto(contract: any, series: Series): Promise<Outcome | 'skipped'> {
  const { adjustments, tx } = build(contract, series);
  await adjustments.applyDueAdjustments();
  const update = tx.contract.update.mock.calls[0]?.[0];
  if (!update) return 'skipped';
  return { rent: Number(update.data.rentAmount).toFixed(2) };
}

const CASES: Case[] = [
  {
    name: 'IPC 2 % y 3 % encadena a 105.060 e ignora el porcentaje declarado (D1, D11)',
    contract: { adjustmentType: AdjustmentType.IPC, customAdjustmentPct: '10.00' },
    series: { [IndexType.IPC]: ['2.0', '3.0'] },
    manual: { rent: '105060.00' },
    preview: { rent: '105060.00' },
    auto: { rent: '105060.00' },
  },
  {
    name: 'IPC sin valores (D2)',
    contract: { adjustmentType: AdjustmentType.IPC },
    manual: { error: MISSING_INDEX_DATA },
    preview: { error: MISSING_INDEX_DATA },
    auto: 'skipped',
  },
  {
    name: 'ICL 100 a 120 da 120.000 (D3)',
    contract: { adjustmentType: AdjustmentType.ICL },
    series: { [IndexType.ICL]: ['100', '110', '120'] },
    manual: { rent: '120000.00' },
    preview: { rent: '120000.00' },
    auto: { rent: '120000.00' },
  },
  {
    name: 'ICL sin valores (D4)',
    contract: { adjustmentType: AdjustmentType.ICL },
    manual: { error: MISSING_INDEX_DATA },
    preview: { error: MISSING_INDEX_DATA },
    auto: 'skipped',
  },
  {
    name: 'ICL con un solo valor (D5)',
    contract: { adjustmentType: AdjustmentType.ICL },
    series: { [IndexType.ICL]: ['100'] },
    manual: { error: MISSING_INDEX_DATA },
    preview: { error: MISSING_INDEX_DATA },
    auto: 'skipped',
  },
  {
    name: 'CCP con CVS 2,0 y CER 1,5 toma el CER (D6)',
    contract: { adjustmentType: AdjustmentType.CCP },
    series: { [IndexType.CVS]: ['2.0'], [IndexType.CER]: ['1.5'] },
    manual: { rent: '101500.00' },
    preview: { rent: '101500.00' },
    auto: { rent: '101500.00' },
  },
  {
    name: 'CCP con CVS 1,0 y CER 1,5 toma 0,9 por CVS (D7)',
    contract: { adjustmentType: AdjustmentType.CCP },
    series: { [IndexType.CVS]: ['1.0'], [IndexType.CER]: ['1.5'] },
    manual: { rent: '100900.00' },
    preview: { rent: '100900.00' },
    auto: { rent: '100900.00' },
  },
  {
    name: 'CCP con series de distinto largo usa el menor',
    contract: { adjustmentType: AdjustmentType.CCP },
    series: { [IndexType.CVS]: ['2.0', '2.0'], [IndexType.CER]: ['1.5'] },
    manual: { rent: '101500.00' },
    preview: { rent: '101500.00' },
    auto: { rent: '101500.00' },
  },
  {
    name: 'CCP con CVS y sin CER (DEF-20)',
    contract: { adjustmentType: AdjustmentType.CCP },
    series: { [IndexType.CVS]: ['2.0'] },
    manual: { error: MISSING_INDEX_DATA },
    preview: { error: MISSING_INDEX_DATA },
    auto: 'skipped',
  },
  {
    name: 'porcentaje fijo 10 % (D8)',
    contract: { adjustmentType: AdjustmentType.FixedPercent, customAdjustmentPct: '10.00' },
    manual: { rent: '110000.00' },
    preview: { rent: '110000.00' },
    auto: { rent: '110000.00' },
  },
  {
    name: 'porcentaje fijo sin porcentaje declarado (D9)',
    contract: { adjustmentType: AdjustmentType.FixedPercent },
    manual: { error: 'MISSING_ADJUSTMENT_PCT' },
    preview: { error: 'MISSING_ADJUSTMENT_PCT' },
    auto: 'skipped',
  },
  {
    name: 'personalizado 7,5 % (D10)',
    contract: { adjustmentType: AdjustmentType.Custom, customAdjustmentPct: '7.50' },
    manual: { rent: '107500.00' },
    preview: { rent: '107500.00' },
    auto: { rent: '107500.00' },
  },
  {
    name: 'personalizado sin porcentaje declarado',
    contract: { adjustmentType: AdjustmentType.Custom },
    manual: { error: 'MISSING_ADJUSTMENT_PCT' },
    preview: { error: 'MISSING_ADJUSTMENT_PCT' },
    auto: 'skipped',
  },
  {
    name: 'modalidad desconocida',
    contract: { adjustmentType: 'OTRA' },
    manual: { error: 'UNKNOWN_ADJUSTMENT_TYPE' },
    preview: { error: 'UNKNOWN_ADJUSTMENT_TYPE' },
    auto: 'skipped',
  },
];

describe('Caminos de cálculo del ajuste (caracterización)', () => {
  describe.each(CASES)('$name', (c) => {
    const contract = baseContract(c.contract);
    const series = c.series ?? {};

    it('cálculo manual (ContractsService.calculateAdjustment)', async () => {
      expect(await runManual(contract, series)).toEqual(c.manual);
    });

    it('previsualización (ContractAdjustmentService.preview)', async () => {
      expect(await runPreview(contract, series)).toEqual(c.preview);
    });

    it('barrido automático (ContractAdjustmentService.applyDueAdjustments)', async () => {
      expect(await runAuto(contract, series)).toEqual(c.auto);
    });
  });

  describe('ventana de índices tras un ajuste aplicado (DEF-07)', () => {
    const previous = { nextAdjustmentDate: new Date('2025-01-15T12:00:00.000Z') };

    const windowCalls = async (type: AdjustmentType, index: IndexType) => {
      const contract = baseContract({ adjustmentType: type });
      const { contracts, adjustments, getForPeriod } = build(
        contract,
        { [index]: ['100', '120'] },
        previous,
      );
      await contracts.calculateAdjustment('contract-1', 'schedule-1');
      const manual = getForPeriod.mock.calls.map((a: any[]) => a.slice(1));
      getForPeriod.mockClear();
      await adjustments.preview('contract-1');
      const preview = getForPeriod.mock.calls.map((a: any[]) => a.slice(1));
      return { manual, preview };
    };

    it('IPC arranca después del ajuste anterior, sin incluir su mes, en los dos caminos', async () => {
      const { manual, preview } = await windowCalls(AdjustmentType.IPC, IndexType.IPC);
      expect(manual).toEqual([
        [previous.nextAdjustmentDate, SCHEDULE_DATE, expect.objectContaining({ startExclusive: true })],
      ]);
      expect(preview).toEqual(manual);
    });

    it('ICL incluye el valor en la fecha del ajuste anterior, en los dos caminos', async () => {
      const { manual, preview } = await windowCalls(AdjustmentType.ICL, IndexType.ICL);
      expect(manual).toHaveLength(1);
      expect(manual[0][2]).not.toHaveProperty('startExclusive');
      expect(preview).toHaveLength(1);
      expect(preview[0][2]).not.toHaveProperty('startExclusive');
      expect(manual[0].slice(0, 2)).toEqual(preview[0].slice(0, 2));
    });
  });

  describe('previsualización sin datos de índice', () => {
    it('responde 400 MISSING_INDEX_DATA con el índice y el período que faltan, como el cálculo manual', async () => {
      const contract = baseContract({ adjustmentType: AdjustmentType.CCP });
      const { adjustments, contracts } = build(contract, { [IndexType.CVS]: ['2.0'] });
      const expected = {
        error: MISSING_INDEX_DATA,
        indexType: IndexType.CER,
        periodStart: contract.startDate,
        periodEnd: SCHEDULE_DATE,
      };
      const preview = await adjustments.preview('contract-1').catch((e) => e);
      const manual = await contracts.calculateAdjustment('contract-1', 'schedule-1').catch((e) => e);
      expect(preview.getStatus?.()).toBe(400);
      expect(preview.getResponse?.()).toMatchObject(expected);
      expect(manual.getResponse?.()).toMatchObject(expected);
    });
  });

  describe('aplicar el cálculo manual', () => {
    it('deja el alquiler en el monto calculado y marca el cronograma como aplicado', async () => {
      const contract = baseContract({
        adjustmentType: AdjustmentType.FixedPercent,
        customAdjustmentPct: '10.00',
      });
      const update = jest.fn();
      const txClient = {
        contractAdjustment: { update: jest.fn() },
        contract: { update },
        adjustmentSchedule: { updateMany: jest.fn() },
      };
      const prisma: any = {
        client: {
          contract: { findFirst: jest.fn(async () => contract) },
          contractAdjustment: {
            findFirst: jest.fn(async () => ({
              id: 'adj-1',
              periodNumber: 1,
              newAmount: '110000.00',
              appliedAt: null,
            })),
          },
          $transaction: jest.fn(async (cb: any) => cb(txClient)),
        },
      };
      const service = new ContractsService(
        prisma,
        { getTenantId: () => 'tenant-1' } as any,
        {} as any,
        {} as any,
        {} as any,
      );
      jest.spyOn(service, 'findOne').mockResolvedValue({} as any);
      await service.applyAdjustment('contract-1', 'adj-1');
      expect(update).toHaveBeenCalledWith({
        where: { id: 'contract-1' },
        data: { rentAmount: '110000.00' },
      });
      expect(txClient.adjustmentSchedule.updateMany).toHaveBeenCalledWith({
        where: { contractId: 'contract-1', periodNumber: 1 },
        data: { status: ScheduleStatus.Applied },
      });
    });
  });
});
