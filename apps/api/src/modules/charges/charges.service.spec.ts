import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { ChargesService } from './charges.service';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const CONTRACT_ID = '11111111-1111-4111-8111-111111111111';
const PROPERTY_ID = '22222222-2222-4222-8222-222222222222';
const PERSON_ID = '33333333-3333-4333-8333-333333333333';
const money = (v: string) => ({ toString: () => v });

/** Alquiler 200000 al 7 % = comisión mensual 14000; umbral 2 comisiones = 28000. */
function contract(over: Record<string, unknown> = {}) {
  return {
    id: CONTRACT_ID,
    propertyId: PROPERTY_ID,
    rentAmount: money('200000'),
    rentCurrency: 'ARS',
    commission: null,
    termsVersions: [{ validFrom: d('2026-01-01'), upfrontThresholdFees: null, upfrontBasis: 'ComisionPactada' }],
    ...over,
  };
}

function build(opts: { contract?: any; charge?: any; liquidacion?: any; updated?: number } = {}) {
  const store: any[] = [];
  const client: any = {
    contract: { findFirst: jest.fn().mockResolvedValue(opts.contract === undefined ? contract() : opts.contract) },
    property: { findFirst: jest.fn().mockResolvedValue({ id: PROPERTY_ID }) },
    person: { findFirst: jest.fn().mockResolvedValue({ id: PERSON_ID }) },
    liquidacion: { findFirst: jest.fn().mockResolvedValue(opts.liquidacion ?? null) },
    pendingCharge: {
      findFirst: jest.fn().mockResolvedValue(opts.charge ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(async ({ data }: any) => {
        const row = { id: `pc-${store.length + 1}`, status: 'Pendiente', ...data };
        store.push(row);
        return row;
      }),
      updateMany: jest.fn().mockResolvedValue({ count: opts.updated ?? 1 }),
    },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const defaults = { get: jest.fn().mockResolvedValue({ commissionPct: 7, upfrontThresholdFees: 2, upfrontBasis: 'ComisionPactada' }) };
  const tenantContext = { getTenantId: jest.fn().mockReturnValue('tenant-1'), getUserId: jest.fn().mockReturnValue('user-1') };
  const service = new ChargesService(
    { client } as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    audit as any,
    defaults as any,
  );
  return { service, client, audit, defaults, store };
}

const input = (over: Record<string, unknown> = {}) => ({
  contractId: CONTRACT_ID,
  chargedTo: 'Inquilino',
  kind: 'Reparacion',
  description: 'canilla',
  amount: '8000.50',
  incurredAt: '2026-10-20',
  ...over,
});

const pending = (over: Record<string, unknown> = {}) => ({
  id: 'pc-1',
  status: 'Pendiente',
  chargedTo: 'Inquilino',
  kind: 'Reparacion',
  amount: money('8000.50'),
  currency: 'ARS',
  contractId: CONTRACT_ID,
  propertyId: PROPERTY_ID,
  requiresUpfront: false,
  incurredAt: d('2026-10-20'),
  imputedLiquidacionId: null,
  imputedStatementId: null,
  ...over,
});

describe('ChargesService.create', () => {
  it('carga una reparación al inquilino: toma la propiedad del contrato, no pide anticipo y audita', async () => {
    const { service, client, audit } = build();
    const { items } = await service.create(input());
    expect(items).toHaveLength(1);
    expect(client.pendingCharge.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 'tenant-1',
      propertyId: PROPERTY_ID,
      contractId: CONTRACT_ID,
      chargedTo: 'Inquilino',
      kind: 'Reparacion',
      amount: '8000.50',
      currency: 'ARS',
      beneficiary: 'Locador',
      incurredAt: d('2026-10-20'),
      targetPeriod: null,
      requiresUpfront: false,
      installmentNo: 1,
      installmentOf: 1,
      installmentGroupId: null,
      createdById: 'user-1',
    });
    expect(audit.record).toHaveBeenCalledWith(client, expect.objectContaining({ action: 'CREATE', entity: 'PendingCharge' }));
  });

  it('un importe que supera 2 comisiones mensuales (28000) pide anticipo; el umbral exacto no', async () => {
    const over = await build().service.create(input({ amount: '28000.01' }));
    expect(over.items[0].requiresUpfront).toBe(true);
    const edge = await build().service.create(input({ amount: '28000' }));
    expect(edge.items[0].requiresUpfront).toBe(false);
  });

  it('usa la comisión pactada del contrato (fijo 5000: umbral 10000)', async () => {
    const agreed = contract({ commission: { type: 'FixedAmount', percentage: null, fixedAmount: money('5000'), currency: 'ARS' } });
    const over = await build({ contract: agreed }).service.create(input({ amount: '10000.01' }));
    expect(over.items[0].requiresUpfront).toBe(true);
    const under = await build({ contract: agreed }).service.create(input({ amount: '10000' }));
    expect(under.items[0].requiresUpfront).toBe(false);
  });

  it('el umbral del contrato manda sobre el de la inmobiliaria: 3 comisiones = 42000', async () => {
    const own = contract({ termsVersions: [{ validFrom: d('2026-01-01'), upfrontThresholdFees: 3, upfrontBasis: 'ComisionPactada' }] });
    const over = await build({ contract: own }).service.create(input({ amount: '42000.01' }));
    expect(over.items[0].requiresUpfront).toBe(true);
    const under = await build({ contract: own }).service.create(input({ amount: '42000' }));
    expect(under.items[0].requiresUpfront).toBe(false);
  });

  it('con la base PorcentajePorDefecto ignora la comisión pactada (fijo 5000): umbral 28000', async () => {
    const own = contract({
      commission: { type: 'FixedAmount', percentage: null, fixedAmount: money('5000'), currency: 'ARS' },
      termsVersions: [{ validFrom: d('2026-01-01'), upfrontThresholdFees: null, upfrontBasis: 'PorcentajePorDefecto' }],
    });
    const mid = await build({ contract: own }).service.create(input({ amount: '20000' }));
    expect(mid.items[0].requiresUpfront).toBe(false);
    const over = await build({ contract: own }).service.create(input({ amount: '28000.01' }));
    expect(over.items[0].requiresUpfront).toBe(true);
  });

  it('rigen las reglas a la fecha del gasto: una versión posterior no cuenta', async () => {
    const own = contract({
      termsVersions: [
        { validFrom: d('2026-01-01'), upfrontThresholdFees: 3, upfrontBasis: 'ComisionPactada' },
        { validFrom: d('2026-11-01'), upfrontThresholdFees: 1, upfrontBasis: 'ComisionPactada' },
      ],
    });
    // Gasto de octubre: umbral 3 x 14000 = 42000, no 14000 de la versión de noviembre.
    const october = await build({ contract: own }).service.create(input({ amount: '30000', incurredAt: '2026-10-20' }));
    expect(october.items[0].requiresUpfront).toBe(false);
    const november = await build({ contract: own }).service.create(input({ amount: '30000', incurredAt: '2026-11-20' }));
    expect(november.items[0].requiresUpfront).toBe(true);
  });

  it('sin versiones de reglas anteriores a la fecha usa la primera, y sin versiones los valores de la inmobiliaria', async () => {
    const early = contract({ termsVersions: [{ validFrom: d('2026-06-01'), upfrontThresholdFees: 1, upfrontBasis: 'ComisionPactada' }] });
    const first = await build({ contract: early }).service.create(input({ amount: '30000', incurredAt: '2026-03-01' }));
    expect(first.items[0].requiresUpfront).toBe(true);
    const none = await build({ contract: contract({ termsVersions: undefined }) }).service.create(input({ amount: '20000' }));
    expect(none.items[0].requiresUpfront).toBe(false);
  });

  it('una comisión fija en otra moneda que el alquiler no se compara', async () => {
    const agreed = contract({ commission: { type: 'FixedAmount', percentage: null, fixedAmount: money('50'), currency: 'USD' } });
    const { items } = await build({ contract: agreed }).service.create(input({ amount: '90000' }));
    expect(items[0].requiresUpfront).toBe(false);
  });

  it('un cargo en otra moneda que el alquiler no se compara', async () => {
    const { items } = await build().service.create(input({ amount: '90000', currency: 'USD' }));
    expect(items[0].requiresUpfront).toBe(false);
  });

  it('una devolución se guarda negativa aunque se cargue positiva y nunca pide anticipo', async () => {
    const { items } = await build().service.create(input({ kind: 'Devolucion', amount: '90000' }));
    expect(items[0].amount).toBe('-90000.00');
    expect(items[0].requiresUpfront).toBe(false);
  });

  it('el honorario por gestión es de la inmobiliaria aunque se indique otro destino', async () => {
    const { items } = await build().service.create(input({ kind: 'HonorarioGestion', beneficiary: 'Locador' }));
    expect(items[0].beneficiary).toBe('Inmobiliaria');
  });

  it('un cargo al locador de una propiedad vacía no lleva contrato ni evalúa anticipo', async () => {
    const { service, client, defaults } = build({ contract: null });
    const { items } = await service.create({
      propertyId: PROPERTY_ID,
      chargedTo: 'Locador',
      lessorPersonId: PERSON_ID,
      kind: 'ExpensaExtra',
      description: 'expensa extraordinaria',
      amount: 120000,
      incurredAt: '2026-10-05',
    });
    expect(items[0]).toMatchObject({ contractId: null, propertyId: PROPERTY_ID, chargedTo: 'Locador', requiresUpfront: false });
    expect(client.contract.findFirst).not.toHaveBeenCalled();
    expect(defaults.get).not.toHaveBeenCalled();
  });

  it('con cuotas crea una por mes (mayor resto) desde el mes elegido, evaluando el anticipo en cada una', async () => {
    const { service, store } = build();
    const { items } = await service.create(input({ amount: '100000.01', installments: 3, targetPeriod: '2026-11' }));
    expect(items.map((i) => i.amount)).toEqual(['33333.34', '33333.34', '33333.33']);
    expect(items.map((i) => i.targetPeriod)).toEqual([d('2026-11-01'), d('2026-12-01'), d('2027-01-01')]);
    expect(items.map((i) => [i.installmentNo, i.installmentOf])).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
    expect(new Set(items.map((i) => i.installmentGroupId)).size).toBe(1);
    expect(items[0].installmentGroupId).toEqual(expect.any(String));
    // 33333.34 > 28000: cada cuota pide anticipo.
    expect(items.every((i) => i.requiresUpfront)).toBe(true);
    expect(store).toHaveLength(3);
  });

  it('con cuotas sin mes elegido arranca en el mes del gasto', async () => {
    const { items } = await build().service.create(input({ amount: '3000', installments: 2 }));
    expect(items.map((i) => i.targetPeriod)).toEqual([d('2026-10-01'), d('2026-11-01')]);
  });

  it('rechaza un cargo al inquilino sin contrato y un importe en cero', async () => {
    const { service } = build();
    await expect(service.create(input({ contractId: undefined, propertyId: PROPERTY_ID }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(input({ amount: '0' }))).rejects.toBeInstanceOf(BadRequestException);
    await expect(service.create(input({ unknownField: 1 }))).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rechaza una propiedad que no es la del contrato', async () => {
    const { service } = build();
    await expect(service.create(input({ propertyId: '44444444-4444-4444-8444-444444444444' }))).rejects.toMatchObject({
      response: { error: 'PROPERTY_MISMATCH' },
    });
  });

  it('contrato, propiedad o persona inexistentes dan 404', async () => {
    await expect(build({ contract: null }).service.create(input())).rejects.toBeInstanceOf(NotFoundException);
    const noProperty = build({ contract: null });
    noProperty.client.property.findFirst.mockResolvedValue(null);
    await expect(
      noProperty.service.create({ propertyId: PROPERTY_ID, chargedTo: 'Locador', kind: 'Otro', description: 'x', amount: '1', incurredAt: '2026-10-01' }),
    ).rejects.toMatchObject({ response: { error: 'PROPERTY_NOT_FOUND' } });
    const noPerson = build();
    noPerson.client.person.findFirst.mockResolvedValue(null);
    await expect(noPerson.service.create(input({ lessorPersonId: PERSON_ID }))).rejects.toMatchObject({
      response: { error: 'PERSON_NOT_FOUND' },
    });
  });
});

describe('ChargesService.bulk', () => {
  it('guarda cada fila por separado e informa las que fallan', async () => {
    const { service } = build();
    const result = await service.bulk({ rows: [input(), input({ amount: '0' }), input({ kind: 'Otro' })] });
    expect(result.created).toBe(2);
    expect(result.failed).toBe(1);
    expect(result.results[0]).toMatchObject({ index: 0, status: 'created' });
    expect(result.results[1]).toMatchObject({ index: 1, status: 'error', error: { code: 'VALIDATION_ERROR' } });
    expect(result.results[2]).toMatchObject({ index: 2, status: 'created' });
  });

  it('una fila con un error que no es de validación informa su código', async () => {
    const { service } = build({ contract: null });
    const result = await service.bulk({ rows: [input()] });
    expect(result.results[0]).toMatchObject({ status: 'error', error: { code: 'CONTRACT_NOT_FOUND' } });
  });

  it('rechaza una planilla vacía', async () => {
    await expect(build().service.bulk({ rows: [] })).rejects.toBeInstanceOf(BadRequestException);
  });
});

describe('ChargesService.findAll / findOne', () => {
  it('filtra por contrato, estado y mes, y pagina', async () => {
    const { service, client } = build();
    client.pendingCharge.count.mockResolvedValue(51);
    const page = await service.findAll({ contractId: CONTRACT_ID, status: 'Pendiente', period: '2026-11', requiresUpfront: 'true', page: '2', limit: '50' });
    const args = client.pendingCharge.findMany.mock.calls[0][0];
    expect(args.where).toMatchObject({ contractId: CONTRACT_ID, status: 'Pendiente', requiresUpfront: true });
    expect(args.where.OR).toEqual([
      { targetPeriod: { gte: d('2026-11-01'), lt: d('2026-12-01') } },
      { targetPeriod: null, incurredAt: { gte: d('2026-11-01'), lt: d('2026-12-01') } },
    ]);
    expect(args.skip).toBe(50);
    expect(page).toMatchObject({ total: 51, page: 2, limit: 50, totalPages: 2 });
  });

  it('un cargo inexistente da 404', async () => {
    await expect(build().service.findOne('x')).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('ChargesService.update', () => {
  it('cambiar el importe vuelve a evaluar el anticipo', async () => {
    const { service, client } = build({ charge: pending() });
    await service.update('pc-1', { amount: '30000' });
    expect(client.pendingCharge.updateMany.mock.calls[0][0].data).toMatchObject({ amount: '30000.00', requiresUpfront: true });
  });

  it('requiresUpfront false fuerza la imputación en la liquidación', async () => {
    const { service, client } = build({ charge: pending({ requiresUpfront: true }) });
    await service.update('pc-1', { requiresUpfront: false });
    expect(client.pendingCharge.updateMany.mock.calls[0][0].data).toEqual({ requiresUpfront: false });
  });

  it('solo un cargo al inquilino puede pedir anticipo', async () => {
    const { service } = build({ charge: pending({ chargedTo: 'Locador' }) });
    await expect(service.update('pc-1', { requiresUpfront: true })).rejects.toMatchObject({ response: { error: 'UPFRONT_NOT_APPLICABLE' } });
  });

  it('corrige texto, fechas y destino; una devolución conserva su signo y el honorario su destino', async () => {
    const { service, client } = build({ charge: pending({ kind: 'Devolucion' }) });
    await service.update('pc-1', { description: 'otra', notes: 'n', incurredAt: '2026-10-21', targetPeriod: '2026-12', beneficiary: 'Inmobiliaria', amount: '500' });
    expect(client.pendingCharge.updateMany.mock.calls[0][0].data).toMatchObject({
      description: 'otra',
      notes: 'n',
      incurredAt: d('2026-10-21'),
      targetPeriod: d('2026-12-01'),
      beneficiary: 'Inmobiliaria',
      amount: '-500.00',
    });
    const fee = build({ charge: pending({ kind: 'HonorarioGestion' }) });
    await fee.service.update('pc-1', { beneficiary: 'Locador', targetPeriod: null });
    expect(fee.client.pendingCharge.updateMany.mock.calls[0][0].data).toMatchObject({ beneficiary: 'Inmobiliaria', targetPeriod: null });
  });

  it('un cargo ya imputado no se edita', async () => {
    const { service } = build({ charge: pending({ status: 'Imputado' }) });
    await expect(service.update('pc-1', { description: 'x' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('si el cargo cambió de estado mientras tanto, falla sin pisarlo', async () => {
    const { service } = build({ charge: pending(), updated: 0 });
    await expect(service.update('pc-1', { description: 'x' })).rejects.toBeInstanceOf(ConflictException);
  });
});

describe('ChargesService: anular, cobrar por adelantado y liberar', () => {
  it('anula un cargo Pendiente y audita el antes y el después', async () => {
    const { service, client, audit } = build({ charge: pending() });
    await service.cancel('pc-1');
    expect(client.pendingCharge.updateMany).toHaveBeenCalledWith({ where: { id: 'pc-1', status: 'Pendiente' }, data: { status: 'Anulado' } });
    expect(audit.record).toHaveBeenCalledWith(
      client,
      expect.objectContaining({ action: 'UPDATE', entity: 'PendingCharge', entityId: 'pc-1', before: expect.objectContaining({ status: 'Pendiente' }) }),
    );
  });

  it('no anula un cargo ya imputado', async () => {
    const { service } = build({ charge: pending({ status: 'Imputado' }) });
    await expect(service.cancel('pc-1')).rejects.toMatchObject({ response: { error: 'CHARGE_NOT_CANCELLABLE' } });
  });

  it('si otra operación lo cambió antes, la anulación falla', async () => {
    const { service } = build({ charge: pending(), updated: 0 });
    await expect(service.cancel('pc-1')).rejects.toBeInstanceOf(ConflictException);
  });

  it('marca cobrado por adelantado un cargo al inquilino', async () => {
    const { service, client } = build({ charge: pending({ requiresUpfront: true }) });
    await service.markPaidUpfront('pc-1');
    expect(client.pendingCharge.updateMany.mock.calls[0][0].data).toMatchObject({ status: 'CobradoAnticipado', imputedAt: expect.any(Date) });
  });

  it('un cargo al locador no se cobra por adelantado', async () => {
    const { service } = build({ charge: pending({ chargedTo: 'Locador' }) });
    await expect(service.markPaidUpfront('pc-1')).rejects.toMatchObject({ response: { error: 'UPFRONT_NOT_APPLICABLE' } });
  });

  it('libera un cargo imputado en una liquidación anulada', async () => {
    const { service, client } = build({
      charge: pending({ status: 'Imputado', imputedLiquidacionId: 'liq-1' }),
      liquidacion: { status: 'Anulada' },
    });
    await service.release('pc-1');
    expect(client.pendingCharge.updateMany).toHaveBeenCalledWith({
      where: { id: 'pc-1', status: 'Imputado' },
      data: { status: 'Pendiente', imputedLiquidacionId: null, imputedAt: null },
    });
  });

  it('libera un cargo cuya liquidación ya no existe', async () => {
    const { service } = build({ charge: pending({ status: 'Imputado', imputedLiquidacionId: 'liq-1' }), liquidacion: null });
    await expect(service.release('pc-1')).resolves.toBeDefined();
  });

  it('no libera si la liquidación sigue vigente, si no está imputado o si ya está en un estado del locador', async () => {
    const active = build({ charge: pending({ status: 'Imputado', imputedLiquidacionId: 'liq-1' }), liquidacion: { status: 'Emitida' } });
    await expect(active.service.release('pc-1')).rejects.toMatchObject({ response: { error: 'CHARGE_LIQUIDATION_ACTIVE' } });
    const open = build({ charge: pending() });
    await expect(open.service.release('pc-1')).rejects.toMatchObject({ response: { error: 'CHARGE_NOT_IMPUTED' } });
    const statement = build({ charge: pending({ status: 'Imputado', imputedStatementId: 'st-1' }) });
    await expect(statement.service.release('pc-1')).rejects.toMatchObject({ response: { error: 'CHARGE_IN_STATEMENT' } });
  });
});

describe('ChargesService: imputación en la liquidación', () => {
  it('pendingLines pide solo los Pendientes al inquilino, sin anticipo, de la moneda y del mes', async () => {
    const { service, client } = build();
    client.pendingCharge.findMany.mockResolvedValue([
      pending({ id: 'a', description: 'canilla', beneficiary: 'Locador', installmentNo: 1, installmentOf: 1 }),
      pending({ id: 'b', kind: 'Devolucion', amount: money('-3000.00'), description: 'arreglo', beneficiary: 'Locador', installmentNo: 1, installmentOf: 1 }),
      pending({ id: 'c', chargedTo: 'Locador', description: 'no va', beneficiary: 'Locador', installmentNo: 1, installmentOf: 1 }),
    ]);
    const lines = await service.pendingLines(CONTRACT_ID, d('2026-11-01'), 'ARS');
    expect(client.pendingCharge.findMany.mock.calls[0][0].where).toEqual({
      contractId: CONTRACT_ID,
      status: 'Pendiente',
      chargedTo: 'Inquilino',
      requiresUpfront: false,
      currency: 'ARS',
      OR: [{ targetPeriod: null }, { targetPeriod: { lte: d('2026-11-01') } }],
    });
    expect(lines.map((l) => [l.type, l.amount, l.commissionable, l.sourceId])).toEqual([
      ['Cargo', '8000.50', false, 'a'],
      ['Descuento', '3000.00', false, 'b'],
    ]);
  });

  it('markImputed marca los cargos y falla si alguno ya no está Pendiente', async () => {
    const { service, client } = build();
    client.pendingCharge.updateMany.mockResolvedValue({ count: 2 });
    await expect(service.markImputed(client, ['a', 'b'], 'liq-1')).resolves.toBe(2);
    expect(client.pendingCharge.updateMany.mock.calls[0][0]).toMatchObject({
      where: { id: { in: ['a', 'b'] }, status: 'Pendiente', requiresUpfront: false },
      data: { status: 'Imputado', imputedLiquidacionId: 'liq-1' },
    });
    client.pendingCharge.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.markImputed(client, ['a', 'b'], 'liq-2')).rejects.toMatchObject({ response: { error: 'CHARGE_ALREADY_IMPUTED' } });
    client.pendingCharge.updateMany.mockClear();
    await expect(service.markImputed(client, [], 'liq-3')).resolves.toBe(0);
    expect(client.pendingCharge.updateMany).not.toHaveBeenCalled();
  });

  it('releaseFromLiquidation vuelve a Pendiente los de una liquidación o de un renglón, salvo los ya en un estado del locador', async () => {
    const { service, client } = build();
    client.pendingCharge.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.releaseFromLiquidation(client, { liquidacionId: 'liq-1', ids: ['a'] })).resolves.toBe(3);
    expect(client.pendingCharge.updateMany.mock.calls[0][0]).toEqual({
      where: {
        OR: [{ imputedLiquidacionId: 'liq-1' }, { id: { in: ['a'] } }],
        status: 'Imputado',
        imputedStatementId: null,
      },
      data: { status: 'Pendiente', imputedLiquidacionId: null, imputedAt: null },
    });
    client.pendingCharge.updateMany.mockClear();
    await expect(service.releaseFromLiquidation(client, {})).resolves.toBe(0);
    expect(client.pendingCharge.updateMany).not.toHaveBeenCalled();
  });
});
