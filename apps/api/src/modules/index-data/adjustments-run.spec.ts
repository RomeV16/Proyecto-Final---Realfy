import { ForbiddenException, Logger } from '@nestjs/common';
import Decimal from 'decimal.js';
import { AdjustmentType, AdjustmentPeriod, ContractStatus, ScheduleStatus } from '@realfy/shared';
import { AdjustmentBatchService } from './adjustment-batch.service';
import { AdjustmentTrueUpService } from './adjustment-trueup.service';
import { AdjustmentsController } from './adjustments.controller';
import { AdjustmentsScheduler } from './adjustments.scheduler';
import { ContractAdjustmentService, MissingIndexDataError } from './contract-adjustment.service';
import { makeTenantCron } from '../../common/scheduler/tenant-cron.testing';

const utc = (s: string) => new Date(`${s}T00:00:00.000Z`);

const contract = (o: Record<string, unknown> = {}) => ({
  id: 'c1',
  tenantId: 't1',
  rentAmount: '100000.00',
  rentCurrency: 'ARS',
  adjustmentType: AdjustmentType.FixedPercent,
  adjustmentPeriod: AdjustmentPeriod.Trimestral,
  startDate: utc('2026-01-01'),
  status: ContractStatus.Activo,
  isActive: true,
  property: { id: 'p1', title: 'Depto 1' },
  ...o,
});

const schedule = (o: Record<string, unknown> = {}) => ({
  id: 's1',
  contractId: 'c1',
  periodNumber: 1,
  nextAdjustmentDate: utc('2026-04-01'),
  status: ScheduleStatus.Pending,
  contract: contract(),
  ...o,
});

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

describe('AdjustmentBatchService', () => {
  function build(schedules: any[]) {
    const findMany = jest.fn(async (_args: any) => schedules);
    const prisma: any = {
      client: {
        adjustmentSchedule: { findMany, findFirst: jest.fn(async () => null) },
        contractAdjustment: { findFirst: jest.fn(async () => null) },
        contractTermsVersion: { findFirst: jest.fn(async () => null) },
        contract: { findFirst: jest.fn(async ({ where }: any) => (where.id === 'known' ? { id: 'known' } : null)) },
      },
    };
    const adjustments: any = {
      isProvisionalAllowed: jest.fn(async () => true),
      loadParams: jest.fn(),
      applySchedule: jest.fn(),
      skipReason: jest.fn((e: any) => e?.getResponse?.()?.error ?? 'ADJUSTMENT_FAILED'),
    };
    const tenantContext: any = { getTenantId: () => 't1', getUserId: () => 'u1' };
    return { service: new AdjustmentBatchService(prisma, tenantContext, adjustments), findMany, adjustments };
  }

  const loaded = (o: Record<string, unknown> = {}) => ({
    params: { type: AdjustmentType.FixedPercent, percentage: new Decimal(10), baseRent: new Decimal(100000) },
    fixedInitial: false,
    isProvisional: false,
    estimated: [],
    observations: [],
    ...o,
  });

  it('CP-292: filtra pendientes hasta el fin del mes y toma el más antiguo de cada contrato', async () => {
    const h = build([
      schedule(),
      schedule({ id: 's2', periodNumber: 2, nextAdjustmentDate: utc('2026-07-01') }),
      schedule({ id: 's3', contractId: 'c2', contract: contract({ id: 'c2' }) }),
    ]);
    h.adjustments.loadParams.mockResolvedValue(loaded());

    const res = await h.service.preview('2026-04');

    expect(h.findMany.mock.calls[0][0].where.nextAdjustmentDate.lte).toEqual(new Date('2026-04-30T23:59:59.999Z'));
    expect(res.rows.map((r) => r.scheduleId)).toEqual(['s1', 's3']);
    expect(res.rows[0]).toMatchObject({
      status: 'ready',
      newRent: '110000.00',
      percentage: '10.0000',
      factor: '1.100000',
      propertyTitle: 'Depto 1',
      selectable: true,
      overdue: false,
    });
  });

  it('CP-292: marca atrasado lo que venció antes del mes, provisorio y fijo inicial', async () => {
    const h = build([
      schedule({ nextAdjustmentDate: utc('2026-02-01') }),
      schedule({ id: 's2', contractId: 'c2', contract: contract({ id: 'c2' }) }),
      schedule({ id: 's3', contractId: 'c3', contract: contract({ id: 'c3' }) }),
    ]);
    h.adjustments.loadParams
      .mockResolvedValueOnce(loaded())
      .mockResolvedValueOnce(loaded({ isProvisional: true, estimated: [{ indexType: 'IPC', period: '2026-02' }] }))
      .mockResolvedValueOnce(loaded({ fixedInitial: true }));

    const { rows } = await h.service.preview('2026-04');

    expect(rows[0].overdue).toBe(true);
    expect(rows[1]).toMatchObject({ status: 'provisional', isProvisional: true, estimatedPeriods: ['2026-02'] });
    expect(rows[2]).toMatchObject({ status: 'fixed_initial', newRent: '100000.00', percentage: '0.0000' });
  });

  it('CP-293: datos faltantes y otros errores dejan la fila sin seleccionar; un error inesperado se propaga', async () => {
    const h = build([
      schedule(),
      schedule({ id: 's2', contractId: 'c2', contract: contract({ id: 'c2' }) }),
    ]);
    const window = { from: utc('2026-01-01'), until: utc('2026-02-01') };
    h.adjustments.loadParams
      .mockRejectedValueOnce(new MissingIndexDataError(['IPC' as any], window, ['2026-02'], true))
      .mockRejectedValueOnce(
        Object.assign(new MissingIndexDataError(['IPC' as any], window), { getResponse: () => ({ error: 'MISSING_ADJUSTMENT_PCT' }) }),
      );
    const { rows } = await h.service.preview('2026-04');
    expect(rows[0]).toMatchObject({
      status: 'missing_data',
      selectable: false,
      missing: { indexTypes: ['IPC'], missingPeriods: ['2026-02'], estimatesOnly: true },
    });
    expect(rows[1].status).toBe('missing_data');

    h.adjustments.loadParams.mockRejectedValueOnce(new Error('boom'));
    await expect(h.service.preview('2026-04')).rejects.toThrow('boom');
  });

  it('CP-293: otro código de error de la modalidad se informa en la fila', async () => {
    const h = build([schedule()]);
    const { BadRequestException } = jest.requireActual('@nestjs/common');
    h.adjustments.loadParams.mockRejectedValue(
      new BadRequestException({ error: 'MISSING_ADJUSTMENT_PCT', message: 'x' }),
    );
    const { rows } = await h.service.preview('2026-04');
    expect(rows[0]).toMatchObject({ status: 'error', error: 'MISSING_ADJUSTMENT_PCT', selectable: false });
  });

  it('CP-294: aplica por contrato, informa lo salteado y no repite ids', async () => {
    const h = build([schedule(), schedule({ id: 's2', contractId: 'c2', contract: contract({ id: 'c2' }) })]);
    h.adjustments.applySchedule
      .mockResolvedValueOnce({
        status: 'provisional',
        previousRent: '100000',
        newRent: '104550',
        estimatedPeriods: ['2026-02'],
      })
      .mockRejectedValueOnce(
        new MissingIndexDataError(['CER' as any], { from: utc('2026-01-01'), until: utc('2026-02-01') }, ['2026-02']),
      );

    const res = await h.service.apply('2026-04', ['c1', 'c2', 'c1', 'known', 'ajeno']);

    expect(h.adjustments.applySchedule).toHaveBeenCalledTimes(2);
    expect(h.adjustments.applySchedule.mock.calls[0][1]).toMatchObject({ tenantId: 't1', source: 'batch', userId: 'u1' });
    expect(res.results).toEqual([
      expect.objectContaining({ contractId: 'c1', result: 'applied', status: 'provisional', estimatedPeriods: ['2026-02'] }),
      expect.objectContaining({
        contractId: 'c2',
        result: 'skipped',
        reason: 'MISSING_INDEX_DATA',
        indexTypes: ['CER'],
        missingPeriods: ['2026-02'],
      }),
      expect.objectContaining({ contractId: 'known', reason: 'NO_DUE_ADJUSTMENT' }),
      expect.objectContaining({ contractId: 'ajeno', reason: 'CONTRACT_NOT_FOUND' }),
    ]);
  });

  it('CP-294: un error de la modalidad se informa salteado y uno inesperado, como error', async () => {
    const h = build([schedule()]);
    const { BadRequestException } = jest.requireActual('@nestjs/common');
    h.adjustments.applySchedule.mockRejectedValueOnce(
      new BadRequestException({ error: 'UNKNOWN_ADJUSTMENT_TYPE', message: 'x' }),
    );
    const res = await h.service.apply('2026-04', ['c1']);
    expect(res.results[0]).toMatchObject({ result: 'skipped', reason: 'UNKNOWN_ADJUSTMENT_TYPE' });

    // Un error no HTTP no corta el lote: el contrato se informa como error con su código (DEF-136).
    h.adjustments.applySchedule.mockRejectedValueOnce(new Error('deadlock'));
    const failed = await h.service.apply('2026-04', ['c1']);
    expect(failed.results[0]).toMatchObject({ result: 'error', reason: 'ADJUSTMENT_FAILED' });
  });

  it('exige contexto de inmobiliaria', async () => {
    const service = new AdjustmentBatchService({} as any, { getTenantId: () => undefined } as any, {} as any);
    await expect(service.preview('2026-04')).rejects.toThrow('tenant context');
  });
});

describe('AdjustmentTrueUpService', () => {
  const provisional = (o: Record<string, unknown> = {}) => ({
    id: 'adj-p',
    contractId: 'c1',
    periodNumber: 1,
    adjustmentDate: utc('2026-04-01'),
    previousAmount: '100000.00',
    newAmount: '104550.00',
    currency: 'ARS',
    indexType: 'IPC',
    isProvisional: true,
    ...o,
  });

  function build(opts: { provisionals: any[]; corrected?: string[]; later?: unknown; rent?: string; loadError?: Error }) {
    const tx: any = {
      contract: {
        findUnique: jest.fn(async () => contract({ rentAmount: opts.rent ?? '104550.00' })),
        update: jest.fn(),
      },
      adjustmentSchedule: { findFirst: jest.fn(async () => null) },
      contractTermsVersion: { findFirst: jest.fn(async () => null) },
      contractAdjustment: {
        create: jest.fn(async ({ data }: any) => ({ id: 'adj-f', ...data })),
        findFirst: jest.fn(async () => opts.later ?? null),
      },
    };
    const prisma: any = {
      client: {
        contractAdjustment: {
          findMany: jest
            .fn()
            .mockResolvedValueOnce(opts.provisionals)
            .mockResolvedValueOnce((opts.corrected ?? []).map((id) => ({ trueUpOfId: id }))),
        },
        $transaction: jest.fn(async (cb: any) => cb(tx)),
      },
    };
    const adjustments: any = {
      loadParams: opts.loadError
        ? jest.fn().mockRejectedValue(opts.loadError)
        : jest.fn(async () => ({
            params: { type: AdjustmentType.FixedPercent, percentage: new Decimal('4.856'), baseRent: new Decimal(100000) },
          })),
      buildIndexValues: jest.fn(() => ({ ok: true })),
    };
    const audit: any = { record: jest.fn() };
    return { service: new AdjustmentTrueUpService(prisma, adjustments, audit), tx, adjustments, audit };
  }

  it('CP-295: sin provisorios no hace nada', async () => {
    const h = build({ provisionals: [] });
    expect(await h.service.correctProvisionals('t1')).toEqual({ corrected: [], waiting: [] });
  });

  it('CP-295: crea el definitivo enlazado, deja el alquiler en el oficial y audita', async () => {
    const h = build({ provisionals: [provisional()] });

    const run = await h.service.correctProvisionals('t1');

    expect(h.adjustments.loadParams.mock.calls[0][0].rentAmount).toBe('100000.00');
    expect(h.adjustments.loadParams.mock.calls[0][2]).toMatchObject({ allowProvisional: false, tenantId: 't1' });
    expect(run.corrected[0]).toMatchObject({
      contractId: 'c1',
      provisionalAdjustmentId: 'adj-p',
      adjustmentId: 'adj-f',
      provisionalRent: '104550',
      officialRent: '104856',
      monthlyDelta: '306.00',
      rentUpdated: true,
    });
    expect(h.tx.contractAdjustment.create.mock.calls[0][0].data).toMatchObject({
      trueUpOfId: 'adj-p',
      isProvisional: false,
      periodNumber: 1,
      previousAmount: '100000.00',
      newAmount: '104856',
    });
    expect(h.tx.contract.update).toHaveBeenCalledWith({ where: { id: 'c1' }, data: { rentAmount: '104856' } });
    expect(h.audit.record.mock.calls[0][1]).toMatchObject({ entity: 'adjustment_trued_up', userId: null });
  });

  it('CP-295: con un ajuste posterior no toca el alquiler y lo informa', async () => {
    const h = build({ provisionals: [provisional()], later: { id: 'adj-2' } });
    const run = await h.service.correctProvisionals('t1');
    expect(run.corrected[0].rentUpdated).toBe(false);
    expect(h.tx.contract.update).not.toHaveBeenCalled();
  });

  it('CP-295: si el alquiler ya no es el provisorio tampoco lo pisa', async () => {
    const h = build({ provisionals: [provisional()], rent: '120000.00' });
    const run = await h.service.correctProvisionals('t1');
    expect(run.corrected[0].rentUpdated).toBe(false);
  });

  it('CP-296: ya corregidos se saltean; con oficial pendiente quedan esperando', async () => {
    const done = build({ provisionals: [provisional()], corrected: ['adj-p'] });
    expect((await done.service.correctProvisionals('t1')).corrected).toEqual([]);
    expect(done.adjustments.loadParams).not.toHaveBeenCalled();

    const waiting = build({
      provisionals: [provisional()],
      loadError: new MissingIndexDataError(
        ['IPC' as any],
        { from: utc('2026-01-01'), until: utc('2026-02-01') },
        ['2026-02'],
        true,
      ),
    });
    expect(await waiting.service.correctProvisionals('t1')).toEqual({
      corrected: [],
      waiting: [{ contractId: 'c1', provisionalAdjustmentId: 'adj-p', missingPeriods: ['2026-02'] }],
    });
  });

  it('CP-296: un error inesperado se registra y sigue con los demás', async () => {
    const h = build({ provisionals: [provisional()], loadError: new Error('boom') });
    expect(await h.service.correctProvisionals('t1')).toEqual({ corrected: [], waiting: [] });
    expect(Logger.prototype.error).toHaveBeenCalled();
  });
});

describe('AdjustmentsScheduler y AdjustmentsController', () => {
  function build() {
    const { tenantCron } = makeTenantCron([
      { id: 't1', name: 'Uno' },
      { id: 't2', name: 'Dos' },
    ]);
    const adjustments: any = {
      applyDueAdjustments: jest.fn(async (tenantId: string) => ({
        applied: [{ contractId: `${tenantId}-a` }],
        skipped: tenantId === 't1' ? [{ contractId: 'c9', missingPeriods: ['2026-02'] }] : [],
      })),
    };
    const trueUps: any = {
      correctProvisionals: jest.fn(async () => ({ corrected: [{ contractId: 'c1' }], waiting: [{ contractId: 'c2' }] })),
    };
    const scheduler = new AdjustmentsScheduler(tenantCron, adjustments, trueUps);
    return { scheduler, adjustments, trueUps };
  }

  it('CP-297: recorre cada inmobiliaria, junta lo aplicado, lo salteado y las correcciones', async () => {
    const { scheduler, adjustments } = build();

    const run = await scheduler.run();

    expect(adjustments.applyDueAdjustments.mock.calls.map((c: any[]) => c[0])).toEqual(['t1', 't2']);
    expect(run).toMatchObject({ tenantsProcessed: 2, tenantsFailed: 0 });
    expect(run.applied).toHaveLength(2);
    expect(run.skipped).toEqual([{ contractId: 'c9', missingPeriods: ['2026-02'] }]);
    expect(run.trueUps).toHaveLength(2);
    expect(run.trueUpsWaiting).toHaveLength(2);
  });

  it('CP-297: el cron no corre con NODE_ENV=test', async () => {
    const { scheduler, adjustments } = build();
    await scheduler.handleDailyAdjustments();
    expect(adjustments.applyDueAdjustments).not.toHaveBeenCalled();
  });

  it('CP-298: _run-now solo en modo de prueba', async () => {
    const { scheduler } = build();
    const controller = new AdjustmentsController({} as any, scheduler);
    await expect(controller.runNow()).resolves.toMatchObject({ tenantsProcessed: 2 });

    const previous = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      await expect(controller.runNow()).rejects.toBeInstanceOf(ForbiddenException);
    } finally {
      process.env.NODE_ENV = previous;
    }
  });

  it('CP-298: previsualizar y aplicar delegan en el servicio del lote', async () => {
    const batch: any = { preview: jest.fn(async () => 'p'), apply: jest.fn(async () => 'a') };
    const controller = new AdjustmentsController(batch, {} as any);
    expect(await controller.previewBatch({ period: '2026-04' })).toBe('p');
    expect(await controller.applyBatch({ period: '2026-04', contractIds: ['c1'] })).toBe('a');
    expect(batch.apply).toHaveBeenCalledWith('2026-04', ['c1']);
  });
});

describe('ContractAdjustmentService: correcciones pendientes', () => {
  function build(finals: any[], provisionals: any[]) {
    const findMany = jest.fn<Promise<any[]>, [any]>().mockResolvedValueOnce(finals).mockResolvedValueOnce(provisionals);
    const updateMany = jest.fn(async (_args: any) => ({ count: 1 }));
    const prisma: any = { client: { contractAdjustment: { findMany, updateMany } } };
    return { service: new ContractAdjustmentService(prisma, {} as any, {} as any), findMany, updateMany };
  }

  it('CP-299: calcula la diferencia por mes hasta el mes pedido', async () => {
    const { service, findMany } = build(
      [
        {
          id: 'adj-f',
          contractId: 'c1',
          periodNumber: 1,
          trueUpOfId: 'adj-p',
          adjustmentDate: utc('2026-04-01'),
          newAmount: '104856.00',
        },
        { id: 'adj-x', contractId: 'c1', periodNumber: 2, trueUpOfId: 'perdido', adjustmentDate: utc('2026-07-01'), newAmount: '1' },
      ],
      [{ id: 'adj-p', newAmount: '104550.00' }],
    );

    const items = await service.getPendingTrueUps('c1', '2026-06');

    expect(findMany.mock.calls[0][0].where).toEqual({
      contractId: 'c1',
      trueUpOfId: { not: null },
      trueUpBilledAt: null,
    });
    expect(items).toEqual([
      {
        adjustmentId: 'adj-f',
        provisionalAdjustmentId: 'adj-p',
        contractId: 'c1',
        periodNumber: 1,
        effectiveFrom: '2026-04',
        provisionalRent: '104550.00',
        officialRent: '104856.00',
        monthlyDelta: '306.00',
        months: [
          { period: '2026-04', delta: '306.00' },
          { period: '2026-05', delta: '306.00' },
          { period: '2026-06', delta: '306.00' },
        ],
        total: '918.00',
      },
    ]);
  });

  it('CP-299: sin correcciones no consulta los provisorios; sin hasta el mes en curso', async () => {
    const none = build([], []);
    expect(await none.service.getPendingTrueUps('c1')).toEqual([]);
    expect(none.findMany).toHaveBeenCalledTimes(1);

    const current = build(
      [{ id: 'f', contractId: 'c1', periodNumber: 1, trueUpOfId: 'p', adjustmentDate: utc('2020-01-01'), newAmount: '110' }],
      [{ id: 'p', newAmount: '100' }],
    );
    const [item] = await current.service.getPendingTrueUps('c1');
    expect(item.months.length).toBeGreaterThan(60);
  });

  it('CP-300: marca facturada una sola vez', async () => {
    const { service, updateMany } = build([], []);
    expect(await service.markTrueUpBilled([])).toBe(0);
    expect(await service.markTrueUpBilled(['adj-f'])).toBe(1);
    expect(updateMany.mock.calls[0][0].where).toEqual({
      id: { in: ['adj-f'] },
      trueUpOfId: { not: null },
      trueUpBilledAt: null,
    });
  });

  it('libera la corrección facturada cuando la liquidación se anula o se borra', async () => {
    const { service, updateMany } = build([], []);
    expect(await service.releaseTrueUps([])).toBe(0);
    expect(updateMany).not.toHaveBeenCalled();
    expect(await service.releaseTrueUps(['adj-f'])).toBe(1);
    expect(updateMany.mock.calls[0][0]).toEqual({
      where: { id: { in: ['adj-f'] }, trueUpOfId: { not: null }, trueUpBilledAt: { not: null } },
      data: { trueUpBilledAt: null },
    });
  });
});
