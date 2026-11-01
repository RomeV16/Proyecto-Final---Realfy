import { Logger } from '@nestjs/common';
import {
  AdjustmentPeriod,
  AdjustmentType,
  ContractStatus,
  IndexType,
  ScheduleStatus,
  calculateAdjustment,
} from '@realfy/shared';
import { ContractAdjustmentService, MissingIndexDataError } from './contract-adjustment.service';

/**
 * Las reglas del contrato en el cálculo del ajuste: rezago, base, meses fijos,
 * escalonado, UVA y pago a cuenta con estimados. Los alquileres esperados se
 * calcularon a mano.
 */

type Point = [period: string, value: string, isEstimate?: boolean];

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const contract = (overrides: Record<string, unknown> = {}) => ({
  id: 'contract-1',
  tenantId: 'tenant-1',
  rentAmount: '100000.00',
  rentCurrency: 'ARS',
  adjustmentType: AdjustmentType.IPC,
  adjustmentPeriod: AdjustmentPeriod.Trimestral,
  customAdjustmentPct: null,
  startDate: utc('2025-01-01'),
  status: ContractStatus.Activo,
  isActive: true,
  ...overrides,
});

const terms = (overrides: Record<string, unknown> = {}) => ({
  adjustmentType: AdjustmentType.IPC,
  adjustmentPeriod: AdjustmentPeriod.Trimestral,
  adjustmentBase: 'Vigente',
  indexLagMonths: 0,
  fixedInitialMonths: 0,
  customPct: null,
  customSteps: null,
  ...overrides,
});

const firstWindow = (until: string, from = '2025-01-01') => ({
  from: utc(from),
  until: utc(until),
  afterPrevious: false,
});
const afterWindow = (from: string, until: string) => ({ from: utc(from), until: utc(until), afterPrevious: true });

function harness(opts: {
  terms?: Record<string, unknown> | null;
  points?: Partial<Record<IndexType, Point[]>>;
  tenantDefaults?: unknown;
  period?: { startDate: Date; initialRent: string } | null;
}) {
  const getForPeriod = jest.fn(async (type: IndexType, from: Date, until: Date, o: any = {}) =>
    (opts.points?.[type] ?? [])
      .map(([period, value, isEstimate]) => ({
        period: period.length === 7 ? utc(`${period}-01`) : utc(period),
        value,
        isEstimate: Boolean(isEstimate),
      }))
      .filter(
        (r) =>
          (o.includeEstimates || !r.isEstimate) &&
          (o.startExclusive ? r.period > from : r.period >= from) &&
          r.period <= until,
      ),
  );
  const findTerms = jest.fn(async () => (opts.terms === undefined ? terms() : opts.terms));
  const findPeriod = jest.fn(async () => opts.period ?? null);
  const tx: any = {
    contract: { findUnique: jest.fn(), update: jest.fn() },
    adjustmentSchedule: { findFirst: jest.fn(async () => null), update: jest.fn() },
    contractAdjustment: { create: jest.fn(async ({ data }: any) => ({ id: 'adj-1', ...data })) },
    contractTermsVersion: { findFirst: findTerms },
    contractPeriod: { findFirst: findPeriod },
    indexData: { findMany: jest.fn() },
  };
  const prisma: any = {
    client: { $transaction: jest.fn(async (cb: any) => cb(tx)) },
    baseClient: {
      contractTermsVersion: { findFirst: findTerms },
      contractPeriod: { findFirst: findPeriod },
      tenant: { findUnique: jest.fn(async () => ({ operationalDefaults: opts.tenantDefaults ?? null })) },
    },
  };
  const audit: any = { record: jest.fn() };
  const service = new ContractAdjustmentService(prisma, { getForPeriod } as any, audit);
  return { service, getForPeriod, tx, audit, prisma };
}

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

describe('rezago del índice en el cálculo', () => {
  const points: Point[] = [
    ['2025-01', '2'],
    ['2025-02', '3'],
    ['2025-03', '1'],
    ['2025-04', '1'],
    ['2025-05', '4'],
    ['2025-06', '5'],
    ['2025-07', '9'],
  ];

  it('CP-274: rezago 0 es lo de siempre, la ventana llega hasta el mes del ajuste', async () => {
    const { service, getForPeriod } = harness({ terms: terms({ indexLagMonths: 0 }), points: { IPC: points } });

    const loaded = await service.loadParams(contract(), firstWindow('2025-04-01'), { tenantId: 'tenant-1' });

    expect(loaded.params).toMatchObject({ type: AdjustmentType.IPC });
    expect((loaded.params as any).monthlyValues.map(String)).toEqual(['2', '3', '1', '1']);
    expect(getForPeriod.mock.calls[0].slice(1, 3)).toEqual([utc('2025-01-01'), utc('2025-04-01')]);
  });

  it('CP-274: rezago 2, primer ajuste de abril: enero y febrero; 100.000 × 1,02 × 1,03 = 105.060', async () => {
    const { service } = harness({ terms: terms({ indexLagMonths: 2 }), points: { IPC: points } });

    const loaded = await service.loadParams(contract(), firstWindow('2025-04-01'), { tenantId: 'tenant-1' });

    expect((loaded.params as any).monthlyValues.map(String)).toEqual(['2', '3']);
    expect(calculateAdjustment(loaded.params).newRent.toFixed(2)).toBe('105060.00');
    expect(loaded.window).toEqual({ from: utc('2025-01-01'), until: utc('2025-02-01') });
  });

  it('CP-274: rezago 2, ajuste siguiente de julio tras el de abril: marzo, abril y mayo', async () => {
    const { service } = harness({
      terms: terms({ indexLagMonths: 2 }),
      points: { IPC: points },
    });

    const loaded = await service.loadParams(
      contract({ rentAmount: '105060.00' }),
      afterWindow('2025-04-01', '2025-07-01'),
      { tenantId: 'tenant-1' },
    );

    expect((loaded.params as any).monthlyValues.map(String)).toEqual(['1', '1', '4']);
    // 105060 × 1,01 × 1,01 × 1,04 = 105060 × 1,060904 = 111.458,57
    expect(calculateAdjustment(loaded.params).newRent.toFixed(2)).toBe('111458.57');
  });

  it('CP-275: con rezago, el mes de junio sin publicar no frena un ajuste que termina en mayo', async () => {
    const { service } = harness({
      terms: terms({ indexLagMonths: 2 }),
      points: { IPC: points.filter(([p]) => p <= '2025-05') },
    });

    await expect(
      service.loadParams(contract(), afterWindow('2025-04-01', '2025-07-01'), { tenantId: 'tenant-1' }),
    ).resolves.toMatchObject({ isProvisional: false });
  });
});

describe('base del ajuste', () => {
  const period = { startDate: utc('2025-01-01'), initialRent: '100000.00' };
  const points: Point[] = ['2025-01', '2025-02', '2025-03', '2025-04', '2025-05', '2025-06', '2025-07'].map((p) => [p, '2']);

  it('CP-276: Vigente aplica el índice del período al alquiler de hoy', async () => {
    const { service } = harness({ terms: terms({ adjustmentBase: 'Vigente' }), points: { IPC: points }, period });

    const loaded = await service.loadParams(
      contract({ rentAmount: '120000.00' }),
      afterWindow('2025-04-01', '2025-07-01'),
      { tenantId: 'tenant-1' },
    );

    expect((loaded.params as any).baseRent.toFixed(2)).toBe('120000.00');
    expect((loaded.params as any).monthlyValues).toHaveLength(3);
    // 120000 × 1,02^3 = 127.344,96
    expect(calculateAdjustment(loaded.params).newRent.toFixed(2)).toBe('127344.96');
  });

  it('CP-276: Original aplica el factor acumulado desde el inicio al alquiler inicial', async () => {
    const { service } = harness({ terms: terms({ adjustmentBase: 'Original' }), points: { IPC: points }, period });

    const loaded = await service.loadParams(
      contract({ rentAmount: '120000.00' }),
      afterWindow('2025-04-01', '2025-07-01'),
      { tenantId: 'tenant-1' },
    );

    expect((loaded.params as any).baseRent.toFixed(2)).toBe('100000.00');
    expect((loaded.params as any).monthlyValues).toHaveLength(7);
    // 100000 × 1,02^7 = 114.868,57
    expect(calculateAdjustment(loaded.params).newRent.toFixed(2)).toBe('114868.57');
  });
});

describe('meses fijos, escalonado y UVA', () => {
  it('CP-277: dentro de los meses fijos iniciales el ajuste no cambia el alquiler', async () => {
    const { service } = harness({
      terms: terms({ fixedInitialMonths: 12 }),
      period: { startDate: utc('2025-01-01'), initialRent: '100000.00' },
    });

    const loaded = await service.loadParams(contract(), firstWindow('2025-07-01'), { tenantId: 'tenant-1' });

    expect(loaded.fixedInitial).toBe(true);
    expect(calculateAdjustment(loaded.params).newRent.toFixed(2)).toBe('100000.00');
  });

  it('CP-277: al cumplirse los meses fijos el ajuste se calcula con todo el período', async () => {
    const { service } = harness({
      terms: terms({ fixedInitialMonths: 12 }),
      period: { startDate: utc('2025-01-01'), initialRent: '100000.00' },
      points: { IPC: Array.from({ length: 13 }, (_, i): Point => [`2025-${String(i + 1).padStart(2, '0')}`, '1']).slice(0, 12).concat([['2026-01', '1']]) },
    });

    const loaded = await service.loadParams(contract(), firstWindow('2026-01-01'), { tenantId: 'tenant-1' });

    expect(loaded.fixedInitial).toBe(false);
    expect((loaded.params as any).monthlyValues).toHaveLength(13);
  });

  it('CP-278: escalonado aplica el escalón vigente al mes del ajuste', async () => {
    const steps = [
      { fromMonth: 1, pct: '3.00' },
      { fromMonth: 13, pct: '5.00' },
    ];
    const { service } = harness({
      terms: terms({ adjustmentType: AdjustmentType.Escalonado, customSteps: steps }),
      period: { startDate: utc('2025-01-01'), initialRent: '100000.00' },
    });

    const at6 = await service.loadParams(contract({ adjustmentType: AdjustmentType.Escalonado }), firstWindow('2025-07-01'), {
      tenantId: 'tenant-1',
    });
    const at15 = await service.loadParams(contract({ adjustmentType: AdjustmentType.Escalonado }), firstWindow('2026-04-01'), {
      tenantId: 'tenant-1',
    });

    expect(calculateAdjustment(at6.params).newRent.toFixed(2)).toBe('103000.00');
    expect(calculateAdjustment(at15.params).newRent.toFixed(2)).toBe('105000.00');
  });

  it('CP-279: UVA toma el cociente entre el primer y el último valor diario de la ventana', async () => {
    const { service } = harness({
      terms: terms({ adjustmentType: AdjustmentType.UVA }),
      points: { UVA: [['2025-01-01', '1000'], ['2025-02-15', '1100'], ['2025-04-01', '1250']] },
    });

    const loaded = await service.loadParams(contract({ adjustmentType: AdjustmentType.UVA }), firstWindow('2025-04-01'), {
      tenantId: 'tenant-1',
    });

    expect(loaded.indexType).toBe(IndexType.UVA);
    expect(calculateAdjustment(loaded.params).newRent.toFixed(2)).toBe('125000.00');
    expect(loaded.observations.map((o) => o.period)).toEqual(['2025-01-01', '2025-04-01']);
  });

  it('CP-279: UVA con un solo valor no ajusta', async () => {
    const { service } = harness({
      terms: terms({ adjustmentType: AdjustmentType.UVA }),
      points: { UVA: [['2025-01-01', '1000']] },
    });

    await expect(
      service.loadParams(contract({ adjustmentType: AdjustmentType.UVA }), firstWindow('2025-04-01'), { tenantId: 'tenant-1' }),
    ).rejects.toBeInstanceOf(MissingIndexDataError);
  });
});

describe('ajuste provisorio con estimados (pago a cuenta)', () => {
  const start = '2025-03-01';
  const points: Point[] = [
    ['2025-03', '2'],
    ['2025-04', '2.5', true],
  ];

  it('CP-280: un mes sin oficial pero con estimado da un ajuste provisorio y lista los meses estimados', async () => {
    const { service } = harness({ points: { IPC: points } });

    const loaded = await service.loadParams(contract({ startDate: utc(start) }), firstWindow('2025-04-01', start), {
      tenantId: 'tenant-1',
    });

    expect(loaded.isProvisional).toBe(true);
    expect(loaded.estimated).toEqual([{ indexType: IndexType.IPC, period: '2025-04' }]);
    expect(loaded.observations.map((o) => [o.period, o.isEstimate])).toEqual([
      ['2025-03', false],
      ['2025-04', true],
    ]);
    // 100000 × 1,02 × 1,025 = 104.550,00
    expect(calculateAdjustment(loaded.params).newRent.toFixed(2)).toBe('104550.00');
  });

  it('CP-281: con el pago a cuenta apagado, el estimado no alcanza y se informa el mes que falta', async () => {
    const { service } = harness({ points: { IPC: points }, tenantDefaults: { allowProvisional: false } });

    const err: any = await service
      .loadParams(contract({ startDate: utc(start) }), firstWindow('2025-04-01', start), { tenantId: 'tenant-1' })
      .catch((e) => e);

    expect(err).toBeInstanceOf(MissingIndexDataError);
    expect(err.getResponse()).toMatchObject({
      error: 'MISSING_INDEX_DATA',
      missingPeriods: ['2025-04'],
      estimatesOnly: true,
    });
  });

  it('CP-281: la opción explícita manda sobre el valor de la inmobiliaria', async () => {
    const { service } = harness({ points: { IPC: points } });

    await expect(
      service.loadParams(contract({ startDate: utc(start) }), firstWindow('2025-04-01', start), {
        tenantId: 'tenant-1',
        allowProvisional: false,
      }),
    ).rejects.toBeInstanceOf(MissingIndexDataError);
  });

  it('CP-282: sin oficial ni estimado el mes queda nombrado como faltante', async () => {
    const { service } = harness({ points: { IPC: [['2025-03', '2']] } });

    const err: any = await service
      .loadParams(contract({ startDate: utc(start) }), firstWindow('2025-04-01', start), { tenantId: 'tenant-1' })
      .catch((e) => e);

    expect(err.getResponse()).toMatchObject({ missingPeriods: ['2025-04'], estimatesOnly: false });
  });

  it('CP-282: CCP nombra el índice y los meses que faltan', async () => {
    const { service } = harness({
      terms: terms({ adjustmentType: AdjustmentType.CCP }),
      points: { CVS: [['2025-03', '2'], ['2025-04', '2']], CER: [['2025-03', '1.5']] },
    });

    const err: any = await service
      .loadParams(contract({ adjustmentType: AdjustmentType.CCP, startDate: utc(start) }), firstWindow('2025-04-01', start), {
        tenantId: 'tenant-1',
      })
      .catch((e) => e);

    expect(err.getResponse()).toMatchObject({ indexType: 'CER', missingPeriods: ['2025-04'] });
  });

  it('CP-283: aplicar un ajuste provisorio lo guarda como tal, sube el alquiler y lo audita', async () => {
    const h = harness({ points: { IPC: points } });
    h.tx.contract.findUnique.mockResolvedValue(contract({ startDate: utc(start) }));

    const outcome = await h.service.applySchedule(
      { id: 'schedule-1', contractId: 'contract-1', nextAdjustmentDate: utc('2025-04-01'), periodNumber: 1 },
      { tenantId: 'tenant-1', source: 'cron', allowProvisional: true },
    );

    expect(outcome).toMatchObject({
      status: 'provisional',
      previousRent: '100000',
      newRent: '104550',
      estimatedPeriods: ['2025-04'],
      adjustmentId: 'adj-1',
    });
    const data = h.tx.contractAdjustment.create.mock.calls[0][0].data;
    expect(data).toMatchObject({
      isProvisional: true,
      periodNumber: 1,
      previousAmount: '100000',
      newAmount: '104550',
      notes: 'PROVISIONAL',
    });
    expect(data.indexValues.estimated).toEqual([{ indexType: 'IPC', period: '2025-04' }]);
    expect(h.tx.contract.update).toHaveBeenCalledWith({ where: { id: 'contract-1' }, data: { rentAmount: '104550' } });
    expect(h.tx.adjustmentSchedule.update).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
      data: { status: ScheduleStatus.Applied },
    });
    expect(h.audit.record.mock.calls[0][1].metadata).toMatchObject({ provisional: true, source: 'cron' });
  });

  it('CP-283: un ajuste con índice oficial queda definitivo', async () => {
    const h = harness({ points: { IPC: [['2025-03', '2'], ['2025-04', '2.5']] } });
    h.tx.contract.findUnique.mockResolvedValue(contract({ startDate: utc(start) }));

    const outcome = await h.service.applySchedule(
      { id: 'schedule-1', contractId: 'contract-1', nextAdjustmentDate: utc('2025-04-01'), periodNumber: 1 },
      { tenantId: 'tenant-1', source: 'cron', allowProvisional: true },
    );

    expect(outcome.status).toBe('applied');
    expect(h.tx.contractAdjustment.create.mock.calls[0][0].data).toMatchObject({ isProvisional: false, notes: null });
  });

  it('CP-277: en los meses fijos el cronograma se saltea sin tocar el alquiler ni crear ajuste', async () => {
    const h = harness({
      terms: terms({ fixedInitialMonths: 12 }),
      period: { startDate: utc('2025-01-01'), initialRent: '100000.00' },
    });
    h.tx.contract.findUnique.mockResolvedValue(contract());

    const outcome = await h.service.applySchedule(
      { id: 'schedule-1', contractId: 'contract-1', nextAdjustmentDate: utc('2025-04-01'), periodNumber: 1 },
      { tenantId: 'tenant-1', source: 'cron', allowProvisional: true },
    );

    expect(outcome).toMatchObject({ status: 'fixed_initial', deltaAmount: '0', adjustmentId: null });
    expect(h.tx.contractAdjustment.create).not.toHaveBeenCalled();
    expect(h.tx.contract.update).not.toHaveBeenCalled();
    expect(h.tx.adjustmentSchedule.update).toHaveBeenCalledWith({
      where: { id: 'schedule-1' },
      data: { status: ScheduleStatus.Skipped },
    });
  });
});

describe('MissingIndexDataError', () => {
  it('conserva los índices y los meses para los informes del barrido', () => {
    const err = new MissingIndexDataError(
      [IndexType.IPC],
      { from: utc('2025-01-01'), until: utc('2025-02-01') },
      ['2025-02'],
    );
    expect(err.indexTypes).toEqual(['IPC']);
    expect(err.missingPeriods).toEqual(['2025-02']);
  });
});
