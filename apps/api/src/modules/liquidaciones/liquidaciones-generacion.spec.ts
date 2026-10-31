import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { makeTenantCron } from '../../common/scheduler/tenant-cron.testing';
import { LiquidacionesService } from './liquidaciones.service';
import { LiquidacionesScheduler } from './liquidaciones.scheduler';

jest.mock('./pdf.service', () => ({ PdfService: jest.fn() }));

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

function contract(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    rentAmount: '300000',
    rentCurrency: 'ARS',
    status: 'Activo',
    startDate: d('2026-01-01'),
    endDate: d('2028-12-31'),
    actualEndDate: null,
    property: {},
    termsVersions: [] as any[],
    adjustments: [] as any[],
    lessors: [] as any[],
    ...overrides,
  };
}

function build(contracts: any[], opts: { existing?: any; defaults?: any } = {}) {
  const client: any = {
    contract: { findMany: jest.fn().mockResolvedValue(contracts) },
    liquidacion: {
      findFirst: jest.fn().mockResolvedValue(opts.existing ?? null),
      create: jest.fn().mockResolvedValue({ id: 'liq-new' }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const defaults = { get: jest.fn().mockResolvedValue({ dueDay: 10, leadDays: 10, ...opts.defaults }) };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn() };
  const service = new LiquidacionesService(
    { client } as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    {} as any,
    {} as any,
    defaults as any,
    audit as any,
  );
  return { service, client, audit, defaults };
}

const createdData = (client: any, n = 0) => client.liquidacion.create.mock.calls[n][0].data;

describe('LiquidacionesService.generate: reglas del contrato', () => {
  it('genera el alquiler del mes con destino y comisionable', async () => {
    const { service, client } = build([contract()]);
    const summary = await service.generate({ month: 11, year: 2026 });

    expect(summary).toMatchObject({ created: 1, skipped: 0, outOfRange: 0, failed: 0, total: 1 });
    const data = createdData(client);
    expect(data.kind).toBe('Mensual');
    expect(data.isProvisional).toBe(false);
    expect(data.dueDate).toEqual(d('2026-11-10'));
    expect(data.lineItems.create[0]).toMatchObject({
      type: 'Alquiler',
      amount: '300000.00',
      commissionable: true,
      beneficiary: 'Locador',
      sortOrder: 0,
    });
  });

  it('usa el día de vencimiento de las reglas vigentes, o el de la inmobiliaria', async () => {
    const withTerms = contract({ termsVersions: [{ validFrom: d('2026-01-01'), dueDay: 5 }] });
    const a = build([withTerms]);
    await a.service.generate({ month: 11, year: 2026 });
    expect(createdData(a.client).dueDate).toEqual(d('2026-11-05'));

    const b = build([contract()], { defaults: { dueDay: 15 } });
    await b.service.generate({ month: 11, year: 2026 });
    expect(createdData(b.client).dueDate).toEqual(d('2026-11-15'));
  });

  it('un período pasado usa el alquiler de entonces', async () => {
    const adjusted = contract({
      rentAmount: '160000',
      adjustments: [
        { adjustmentDate: d('2026-07-01'), previousAmount: '130000', newAmount: '160000', isProvisional: false },
      ],
    });
    const { service, client } = build([adjusted]);
    await service.generate({ month: 3, year: 2026 });
    expect(createdData(client).total).toBe('130000.00');
  });

  it('prorratea el primer mes y vence el día de inicio si es posterior al vencimiento', async () => {
    const { service, client } = build([contract({ startDate: d('2026-11-16') })]);
    await service.generate({ month: 11, year: 2026 });
    const data = createdData(client);
    expect(data.total).toBe('150000.00');
    expect(data.dueDate).toEqual(d('2026-11-16'));
    expect(data.lineItems.create[0].description).toContain('proporcional: 15 de 30 días');
  });

  it('no liquida antes del inicio ni después del fin real', async () => {
    const { service, client } = build([
      contract({ id: 'future', startDate: d('2026-12-01') }),
      contract({ id: 'ended', actualEndDate: d('2026-10-31') }),
      contract({ id: 'ok' }),
    ]);
    const summary = await service.generate({ month: 11, year: 2026 });
    expect(summary).toMatchObject({ created: 1, outOfRange: 2, total: 3 });
    expect(summary.results.map((r) => [r.contractId, r.status, r.reason])).toEqual([
      ['future', 'out_of_range', 'BeforeStart'],
      ['ended', 'out_of_range', 'AfterEnd'],
      ['ok', 'created', undefined],
    ]);
    expect(client.liquidacion.create).toHaveBeenCalledTimes(1);
  });

  it('consulta solo contratos que pueden regir en el mes', async () => {
    const { service, client } = build([]);
    await service.generate({ month: 11, year: 2026 });
    const where = client.contract.findMany.mock.calls[0][0].where;
    expect(where.startDate).toEqual({ lte: d('2026-11-30') });
    expect(where.status).toEqual({ not: 'Borrador' });
    expect(where.OR).toEqual([{ status: 'Activo' }, { actualEndDate: { gte: d('2026-11-01') } }]);
  });

  it('es idempotente: omite el contrato que ya tiene su liquidación', async () => {
    const { service, client } = build([contract()], { existing: { id: 'liq-old' } });
    const summary = await service.generate({ month: 11, year: 2026 });
    expect(summary).toMatchObject({ created: 0, skipped: 1 });
    expect(summary.results[0]).toMatchObject({ status: 'skipped', reason: 'EXISTS', liquidacionId: 'liq-old' });
    expect(client.liquidacion.create).not.toHaveBeenCalled();
  });

  it('una generación simultánea que pierde el unique cuenta como omitida', async () => {
    const { service, client } = build([contract()]);
    client.liquidacion.create.mockRejectedValue(Object.assign(new Error('unique'), { code: 'P2002' }));
    const summary = await service.generate({ month: 11, year: 2026 });
    expect(summary).toMatchObject({ created: 0, skipped: 1, failed: 0 });
  });

  it('un contrato con error no corta a los demás', async () => {
    const { service, client } = build([contract({ id: 'bad' }), contract({ id: 'good' })]);
    client.liquidacion.create
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValueOnce({ id: 'liq-2' });
    const summary = await service.generate({ month: 11, year: 2026 });
    expect(summary).toMatchObject({ created: 1, failed: 1 });
    expect(summary.results[0]).toMatchObject({ contractId: 'bad', status: 'failed', reason: 'boom' });
  });

  it('un alquiler con ajuste provisional da un pago a cuenta provisional', async () => {
    const provisional = contract({
      adjustments: [
        { adjustmentDate: d('2026-09-01'), previousAmount: '300000', newAmount: '330000', isProvisional: true },
      ],
    });
    const { service, client } = build([provisional]);
    await service.generate({ month: 11, year: 2026 });
    expect(createdData(client)).toMatchObject({ kind: 'PagoACuenta', isProvisional: true, total: '330000.00' });
  });
});

describe('LiquidacionesService.generateScheduled: diez días antes', () => {
  it('a 10 días del mes siguiente genera ese mes y deja auditoría', async () => {
    const { service, client, audit } = build([contract()]);
    const summary = await service.generateScheduled(d('2026-10-22'));
    expect(summary).toMatchObject({ created: 1 });
    expect(createdData(client).period).toEqual(d('2026-11-01'));
    expect(audit.record).toHaveBeenCalledWith(
      client,
      expect.objectContaining({
        entity: 'Liquidacion',
        userId: null,
        after: expect.objectContaining({ period: '2026-11', created: 1 }),
        metadata: { source: 'cron', job: 'liquidaciones-generate' },
      }),
    );
  });

  it('antes de la ventana no hace nada', async () => {
    const { service, client, audit } = build([contract()]);
    expect(await service.generateScheduled(d('2026-10-21'))).toBeNull();
    expect(client.contract.findMany).not.toHaveBeenCalled();
    expect(audit.record).not.toHaveBeenCalled();
  });

  it('respeta la anticipación de la inmobiliaria', async () => {
    const { service, client } = build([contract()], { defaults: { leadDays: 20 } });
    await service.generateScheduled(d('2026-10-12'));
    expect(createdData(client).period).toEqual(d('2026-11-01'));
  });

  it('si ya estaba generado no vuelve a auditar', async () => {
    const { service, audit } = build([contract()], { existing: { id: 'liq-old' } });
    await service.generateScheduled(d('2026-10-25'));
    expect(audit.record).not.toHaveBeenCalled();
  });
});

describe('LiquidacionesScheduler', () => {
  it('recorre cada inmobiliaria dentro de su contexto y suma lo generado', async () => {
    const { tenantCron, tenantContext } = makeTenantCron([
      { id: 't-a', name: 'A' },
      { id: 't-b', name: 'B' },
      { id: 't-c', name: 'C' },
    ]);
    const seen: string[] = [];
    const liquidaciones = {
      generateScheduled: jest.fn().mockImplementation(async () => {
        const id = tenantContext.getTenantId()!;
        seen.push(id);
        if (id === 't-b') throw new Error('falló B');
        return { created: id === 't-a' ? 2 : 0 };
      }),
    };
    const scheduler = new LiquidacionesScheduler(liquidaciones as any, tenantCron);

    const result = await scheduler.generateForAllTenants(d('2026-10-22'), 'run-now');

    expect(seen).toEqual(['t-a', 't-b', 't-c']);
    expect(result).toEqual({ tenantsProcessed: 2, tenantsFailed: 1, created: 2 });
    expect(liquidaciones.generateScheduled).toHaveBeenCalledWith(d('2026-10-22'), 'run-now');
  });

  it('el cron no corre en el entorno de prueba', async () => {
    const { tenantCron } = makeTenantCron([{ id: 't-a', name: 'A' }]);
    const liquidaciones = { generateScheduled: jest.fn() };
    await new LiquidacionesScheduler(liquidaciones as any, tenantCron).handleDailyGeneration();
    expect(liquidaciones.generateScheduled).not.toHaveBeenCalled();
  });
});
