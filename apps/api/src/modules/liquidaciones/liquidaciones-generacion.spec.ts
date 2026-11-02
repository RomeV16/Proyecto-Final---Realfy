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

function build(
  contracts: any[],
  opts: {
    existing?: any;
    defaults?: any;
    findFirst?: jest.Mock;
    trueUps?: any[];
    serviceLines?: any[];
    chargeLines?: any[];
    penaltyLines?: any[];
    penaltyRowIds?: string[];
  } = {},
) {
  const client: any = {
    contract: { findMany: jest.fn().mockResolvedValue(contracts) },
    liquidacion: {
      findFirst: opts.findFirst ?? jest.fn().mockResolvedValue(opts.existing ?? null),
      create: jest.fn().mockResolvedValue({ id: 'liq-new' }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const adjustments = {
    getPendingTrueUps: jest.fn().mockResolvedValue(opts.trueUps ?? []),
    markTrueUpBilled: jest.fn().mockResolvedValue(0),
  };
  const serviceBills = {
    pendingLines: jest.fn().mockResolvedValue(opts.serviceLines ?? []),
    markBilled: jest.fn().mockResolvedValue(0),
    release: jest.fn().mockResolvedValue(0),
  };
  const penalties = {
    pendingLines: jest.fn().mockResolvedValue({ lines: opts.penaltyLines ?? [], rowIds: opts.penaltyRowIds ?? [] }),
    markSettled: jest.fn().mockResolvedValue(0),
    release: jest.fn().mockResolvedValue(0),
  };
  const charges = {
    pendingLines: jest.fn().mockResolvedValue(opts.chargeLines ?? []),
    markImputed: jest.fn().mockResolvedValue(0),
    releaseFromLiquidation: jest.fn().mockResolvedValue(0),
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const defaults = {
    get: jest.fn().mockResolvedValue({
      dueDay: 10,
      leadDays: 10,
      prorationMode: 'DiasReales',
      midMonthAdjustmentMode: 'DesdePeriodoSiguiente',
      firstDueMode: 'DiaDeInicio',
      fixedDiscountProration: 'Proporcional',
      ...opts.defaults,
    }),
  };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn() };
  const service = new LiquidacionesService(
    { client } as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    {} as any,
    {} as any,
    defaults as any,
    audit as any,
    adjustments as any,
    serviceBills as any,
    penalties as any,
    charges as any,
    { record: jest.fn(async (_tx: any, ctx: any) => ctx.payment) } as any,
  );
  return { service, client, audit, defaults, adjustments, serviceBills, penalties, charges };
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

describe('LiquidacionesService.generate: convenciones pactadas', () => {
  const version = (conventions: Record<string, string>, validFrom = d('2026-01-01')) => ({
    validFrom,
    dueDay: 10,
    ...conventions,
  });

  it('rige la convención de la versión de reglas del contrato', async () => {
    // Empieza el 16 de diciembre (31 días): Mes30 cubre 15 de 30 = 150000; DiasReales 16 de 31.
    const mes30 = contract({
      startDate: d('2026-12-16'),
      termsVersions: [version({ prorationMode: 'Mes30' }, d('2026-12-16'))],
    });
    const { service, client } = build([mes30]);
    await service.generate({ month: 12, year: 2026 });
    expect(createdData(client).total).toBe('150000.00');
  });

  it('sin convención en la versión rige la de la inmobiliaria, y la del contrato la pisa', async () => {
    const start = { startDate: d('2026-12-16') };
    const legacy = build([contract({ ...start })], { defaults: { prorationMode: 'SinProrrateo' } });
    await legacy.service.generate({ month: 12, year: 2026 });
    expect(createdData(legacy.client).total).toBe('300000.00');

    const own = build(
      [contract({ ...start, termsVersions: [version({ prorationMode: 'DiasReales' }, d('2026-12-16'))] })],
      { defaults: { prorationMode: 'SinProrrateo' } },
    );
    await own.service.generate({ month: 12, year: 2026 });
    expect(createdData(own.client).total).toBe('154838.71');
  });

  it('un ajuste a mitad de mes se parte según la convención', async () => {
    const adjusted = contract({
      rentAmount: '330000',
      adjustments: [
        { adjustmentDate: d('2026-11-15'), previousAmount: '300000', newAmount: '330000', isProvisional: false },
      ],
      termsVersions: [version({ midMonthAdjustmentMode: 'Prorrateado' })],
    });
    const { service, client } = build([adjusted]);
    await service.generate({ month: 11, year: 2026 });
    const data = createdData(client);
    expect(data.lineItems.create.map((l: any) => l.amount)).toEqual(['140000.00', '176000.00']);
    expect(data.total).toBe('316000.00');

    const next = build([{ ...adjusted, termsVersions: [version({ midMonthAdjustmentMode: 'DesdeEsePeriodo' })] }]);
    await next.service.generate({ month: 11, year: 2026 });
    expect(createdData(next.client).total).toBe('330000.00');

    const ignored = build([{ ...adjusted, termsVersions: [version({})] }]);
    await ignored.service.generate({ month: 11, year: 2026 });
    expect(createdData(ignored.client).total).toBe('300000.00');
  });

  it('AlFirmar: el primer mes no se liquida y se informa como no liquidado', async () => {
    const signing = contract({
      startDate: d('2026-11-16'),
      termsVersions: [version({ firstDueMode: 'AlFirmar' }, d('2026-11-16'))],
    });
    const { service, client } = build([signing]);
    const summary = await service.generate({ month: 11, year: 2026 });
    expect(summary).toMatchObject({ created: 0, outOfRange: 0, notBilled: 1 });
    expect(summary.results[0]).toMatchObject({ status: 'not_billed', reason: 'ChargedAtSigning' });
    expect(client.liquidacion.create).not.toHaveBeenCalled();
  });

  it('VencimientoMesSiguiente: el primer mes se difiere y el siguiente lo suma una sola vez', async () => {
    const late = contract({
      startDate: d('2026-11-16'),
      termsVersions: [version({ firstDueMode: 'VencimientoMesSiguiente' }, d('2026-11-16'))],
    });
    const first = build([late]);
    const nov = await first.service.generate({ month: 11, year: 2026 });
    expect(nov.results[0]).toMatchObject({ status: 'not_billed', reason: 'DeferredToNextPeriod' });

    const dec = build([late]);
    await dec.service.generate({ month: 12, year: 2026 });
    const data = createdData(dec.client);
    expect(data.lineItems.create.map((l: any) => [l.amount, l.sourceType])).toEqual([
      ['300000.00', null],
      ['150000.00', 'DeferredFirstMonth'],
    ]);
    expect(data.total).toBe('450000.00');
    expect(data.dueDate).toEqual(d('2026-12-10'));

    // Si noviembre ya tenía su liquidación, diciembre no lo repite.
    const billed = jest.fn().mockImplementation(async ({ where }: any) =>
      where.period.getUTCMonth() === 10 ? { id: 'liq-nov' } : null,
    );
    const again = build([late], { findFirst: billed });
    await again.service.generate({ month: 12, year: 2026 });
    expect(createdData(again.client).lineItems.create).toHaveLength(1);
  });

  it('el descuento fijo completo no se prorratea', async () => {
    const c = contract({
      startDate: d('2026-11-16'),
      termsVersions: [
        { ...version({ fixedDiscountProration: 'Completo' }, d('2026-11-16')), discountAmount: '20000' },
      ],
    });
    const { service, client } = build([c]);
    await service.generate({ month: 11, year: 2026 });
    expect(createdData(client).total).toBe('130000.00');
  });
});

describe('LiquidacionesService.generate: correcciones de ajustes provisorios', () => {
  const trueUp = (overrides: Record<string, unknown> = {}) => ({
    adjustmentId: 'adj-final-1',
    provisionalAdjustmentId: 'adj-prov-1',
    contractId: 'c-1',
    periodNumber: 1,
    effectiveFrom: '2026-08',
    total: '60000.00',
    months: [],
    ...overrides,
  });

  it('suma la corrección como renglón retroactivo comisionable al locador y la marca facturada', async () => {
    const { service, client, adjustments } = build([contract()], { trueUps: [trueUp()] });
    await service.generate({ month: 11, year: 2026 });

    // Se piden las correcciones hasta el mes anterior al período.
    expect(adjustments.getPendingTrueUps).toHaveBeenCalledWith('c-1', '2026-10');
    const data = createdData(client);
    expect(data.lineItems.create.map((l: any) => [l.type, l.amount, l.commissionable, l.beneficiary, l.sourceType, l.sourceId])).toEqual([
      ['Alquiler', '300000.00', true, 'Locador', null, null],
      ['AjusteRetroactivo', '60000.00', true, 'Locador', 'ContractAdjustment', 'adj-final-1'],
    ]);
    expect(data.lineItems.create[1].description).toBe('Corrección de ajuste provisorio (2026-08 a 2026-10)');
    expect(data.total).toBe('360000.00');
    // Se marca en la misma transacción que crea la liquidación.
    expect(client.$transaction).toHaveBeenCalledTimes(1);
    expect(adjustments.markTrueUpBilled).toHaveBeenCalledWith(['adj-final-1'], client);
  });

  it('una corrección a favor del inquilino sale como descuento', async () => {
    const { service, client } = build([contract()], { trueUps: [trueUp({ total: '-15000.50' })] });
    await service.generate({ month: 11, year: 2026 });
    const data = createdData(client);
    expect(data.lineItems.create[1]).toMatchObject({
      type: 'Descuento',
      amount: '15000.50',
      commissionable: true,
      sourceId: 'adj-final-1',
    });
    expect(data.total).toBe('284999.50');
  });

  it('una corrección en cero no agrega renglón pero igual se marca facturada', async () => {
    const { service, client, adjustments } = build([contract()], { trueUps: [trueUp({ total: '0.00' })] });
    await service.generate({ month: 11, year: 2026 });
    expect(createdData(client).lineItems.create).toHaveLength(1);
    expect(adjustments.markTrueUpBilled).toHaveBeenCalledWith(['adj-final-1'], client);
  });

  it('si la liquidación no se crea, la corrección no se marca', async () => {
    const { service, client, adjustments } = build([contract()], { trueUps: [trueUp()] });
    client.liquidacion.create.mockRejectedValue(new Error('boom'));
    const summary = await service.generate({ month: 11, year: 2026 });
    expect(summary.failed).toBe(1);
    expect(adjustments.markTrueUpBilled).not.toHaveBeenCalled();
  });

  it('un contrato que ya tiene su liquidación no consulta ni marca correcciones', async () => {
    const { service, adjustments } = build([contract()], { existing: { id: 'liq-old' }, trueUps: [trueUp()] });
    await service.generate({ month: 11, year: 2026 });
    expect(adjustments.getPendingTrueUps).not.toHaveBeenCalled();
    expect(adjustments.markTrueUpBilled).not.toHaveBeenCalled();
  });

  it('un contrato fuera de su período no marca nada', async () => {
    const { service, adjustments } = build([contract({ startDate: d('2026-12-01') })], { trueUps: [trueUp()] });
    await service.generate({ month: 11, year: 2026 });
    expect(adjustments.markTrueUpBilled).not.toHaveBeenCalled();
  });
});

describe('LiquidacionesService.generate: impuestos y servicios', () => {
  const line = (overrides: Record<string, unknown> = {}) => ({
    type: 'Servicio',
    description: 'Electricidad 11/2026',
    amount: '12500.00',
    commissionable: false,
    beneficiary: 'Ente',
    sourceType: 'ServiceBillAllocation',
    sourceId: 'alloc-1',
    ...overrides,
  });

  it('suma los renglones de las boletas, sin comisión, con su destino, y marca las partes en la misma transacción', async () => {
    const { service, client, serviceBills } = build([contract()], {
      serviceLines: [
        line(),
        line({
          type: 'Impuesto',
          description: 'Impuesto inmobiliario 2026, cuota 11/12 (por cuenta y orden del locador)',
          amount: '4000.00',
          beneficiary: 'Locador',
          sourceId: 'alloc-2',
        }),
      ],
    });
    await service.generate({ month: 11, year: 2026 });

    expect(serviceBills.pendingLines).toHaveBeenCalledWith('c-1', d('2026-11-01'), 'ARS');
    const data = createdData(client);
    expect(
      data.lineItems.create.map((l: any) => [l.type, l.amount, l.commissionable, l.beneficiary, l.sourceType, l.sourceId]),
    ).toEqual([
      ['Alquiler', '300000.00', true, 'Locador', null, null],
      ['Servicio', '12500.00', false, 'Ente', 'ServiceBillAllocation', 'alloc-1'],
      ['Impuesto', '4000.00', false, 'Locador', 'ServiceBillAllocation', 'alloc-2'],
    ]);
    expect(data.total).toBe('316500.00');
    expect(serviceBills.markBilled).toHaveBeenCalledWith(client, ['alloc-1', 'alloc-2'], 'liq-new');
  });

  it('una parte con dos renglones (diferencia por descuento) se marca una sola vez', async () => {
    const { service, serviceBills } = build([contract()], {
      serviceLines: [
        line({ amount: '4500.00' }),
        line({ type: 'Cargo', amount: '500.00', beneficiary: 'Locador', sourceType: 'ServiceBillAllocationSurplus' }),
      ],
    });
    await service.generate({ month: 11, year: 2026 });
    expect(serviceBills.markBilled.mock.calls[0][1]).toEqual(['alloc-1']);
  });

  it('si la liquidación no se crea, las partes no se marcan', async () => {
    const { service, client, serviceBills } = build([contract()], { serviceLines: [line()] });
    client.liquidacion.create.mockRejectedValue(new Error('boom'));
    const summary = await service.generate({ month: 11, year: 2026 });
    expect(summary.failed).toBe(1);
    expect(serviceBills.markBilled).not.toHaveBeenCalled();
  });

  it('si otra generación ya facturó una parte, el contrato falla y no se crea nada', async () => {
    const { service, serviceBills } = build([contract()], { serviceLines: [line()] });
    serviceBills.markBilled.mockRejectedValue(new Error('ALLOCATION_ALREADY_BILLED'));
    const summary = await service.generate({ month: 11, year: 2026 });
    expect(summary.failed).toBe(1);
    expect(summary.results[0].reason).toBe('ALLOCATION_ALREADY_BILLED');
  });

  it('un contrato que ya tiene su liquidación no consulta boletas', async () => {
    const { service, serviceBills } = build([contract()], { existing: { id: 'liq-old' }, serviceLines: [line()] });
    await service.generate({ month: 11, year: 2026 });
    expect(serviceBills.pendingLines).not.toHaveBeenCalled();
    expect(serviceBills.markBilled).not.toHaveBeenCalled();
  });
});

describe('LiquidacionesService.generate: centro de carga', () => {
  const chargeLine = (overrides: Record<string, unknown> = {}) => ({
    type: 'Cargo',
    description: 'Reparación: canilla',
    amount: '8000.50',
    commissionable: false,
    beneficiary: 'Locador',
    sourceType: 'PendingCharge',
    sourceId: 'pc-1',
    ...overrides,
  });

  it('suma los cargos sin comisión y los marca imputados en la misma transacción', async () => {
    const { service, client, charges } = build([contract()], {
      chargeLines: [
        chargeLine(),
        chargeLine({ type: 'Descuento', description: 'Devolución: arreglo, a favor del inquilino', amount: '3000.00', sourceId: 'pc-2' }),
      ],
    });
    await service.generate({ month: 11, year: 2026 });

    expect(charges.pendingLines).toHaveBeenCalledWith('c-1', d('2026-11-01'), 'ARS');
    const data = createdData(client);
    expect(
      data.lineItems.create.map((l: any) => [l.type, l.amount, l.commissionable, l.beneficiary, l.sourceType, l.sourceId]),
    ).toEqual([
      ['Alquiler', '300000.00', true, 'Locador', null, null],
      ['Cargo', '8000.50', false, 'Locador', 'PendingCharge', 'pc-1'],
      ['Descuento', '3000.00', false, 'Locador', 'PendingCharge', 'pc-2'],
    ]);
    expect(data.total).toBe('305000.50');
    expect(charges.markImputed).toHaveBeenCalledWith(client, ['pc-1', 'pc-2'], 'liq-new');
  });

  it('si la liquidación no se crea, los cargos no se marcan', async () => {
    const { service, client, charges } = build([contract()], { chargeLines: [chargeLine()] });
    client.liquidacion.create.mockRejectedValue(new Error('boom'));
    const summary = await service.generate({ month: 11, year: 2026 });
    expect(summary.failed).toBe(1);
    expect(charges.markImputed).not.toHaveBeenCalled();
  });

  it('si otra generación ya imputó un cargo, el contrato falla y no se crea nada', async () => {
    const { service, charges } = build([contract()], { chargeLines: [chargeLine()] });
    charges.markImputed.mockRejectedValue(new Error('CHARGE_ALREADY_IMPUTED'));
    const summary = await service.generate({ month: 11, year: 2026 });
    expect(summary.failed).toBe(1);
    expect(summary.results[0].reason).toBe('CHARGE_ALREADY_IMPUTED');
  });

  it('un contrato que ya tiene su liquidación no consulta cargos', async () => {
    const { service, charges } = build([contract()], { existing: { id: 'liq-old' }, chargeLines: [chargeLine()] });
    await service.generate({ month: 11, year: 2026 });
    expect(charges.pendingLines).not.toHaveBeenCalled();
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

describe('LiquidacionesService.generate: punitorios (FB-07)', () => {
  const penaltyLine = {
    type: 'Multa',
    description: 'Punitorios por mora, alquiler 02/2026 (10 días)',
    amount: '100.00',
    commissionable: true,
    beneficiary: 'Locador',
    sourceType: 'Penalty',
    sourceId: 'liq-feb',
  };

  it('suma los punitorios pendientes como renglón Multa comisionable del locador', async () => {
    const { service, client, penalties } = build([contract()], { penaltyLines: [penaltyLine], penaltyRowIds: ['pen-1', 'pen-2'] });
    await service.generate({ month: 3, year: 2026 });

    const data = createdData(client);
    const multa = data.lineItems.create.find((l: any) => l.type === 'Multa');
    expect(multa).toMatchObject({
      amount: '100.00',
      commissionable: true,
      beneficiary: 'Locador',
      sourceType: 'Penalty',
      sourceId: 'liq-feb',
    });
    expect(data.total).toBe('300100.00');
    expect(penalties.pendingLines).toHaveBeenCalledWith('tenant-1', 'c-1', d('2026-03-01'), expect.any(Date));
  });

  it('marca las filas como cobradas en la misma transacción que crea la liquidación', async () => {
    const { service, client, penalties } = build([contract()], { penaltyLines: [penaltyLine], penaltyRowIds: ['pen-1', 'pen-2'] });
    await service.generate({ month: 3, year: 2026 });
    expect(client.$transaction).toHaveBeenCalled();
    expect(penalties.markSettled).toHaveBeenCalledWith(client, ['pen-1', 'pen-2'], 'liq-new');
  });

  it('sin punitorios pendientes no agrega renglón', async () => {
    const { service, client } = build([contract()]);
    await service.generate({ month: 3, year: 2026 });
    expect(createdData(client).lineItems.create.some((l: any) => l.type === 'Multa')).toBe(false);
  });
});
