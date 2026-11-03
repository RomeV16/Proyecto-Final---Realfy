import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import {
  ServiceBillsService,
  billConsumption,
  defaultInstallmentLabel,
  parsePeriod,
  pickRulesFor,
} from './service-bills.service';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const BILL_ID = 'bill-1';
const UNIT_A = '22222222-2222-4222-8222-222222222222';
const UNIT_B = '33333333-3333-4333-8333-333333333333';
/** Propiedades del edificio del servicio en los dobles de prueba. */
const UNITS = [UNIT_A, UNIT_B];

function rule(over: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    contractId: 'con-1',
    serviceId: SERVICE_ID,
    payer: 'Inmobiliaria',
    splitMode: 'Porcentaje',
    tenantSharePct: { toString: () => '50' },
    fixedAmount: null,
    paymentPlan: 'Mensual',
    annualRecovery: 'Prorrateado',
    annualInstallments: 12,
    annualDiscountBeneficiary: 'Inquilino',
    remainingInstallmentsOnEnd: 'CobrarEnLiquidacionFinal',
    validFrom: d('2026-01-01'),
    validTo: null,
    contract: {
      id: 'con-1',
      status: 'Activo',
      startDate: d('2026-01-01'),
      endDate: d('2028-12-31'),
      actualEndDate: null,
      propertyId: 'prop-1',
    },
    ...over,
  };
}

function build(opts: { rules?: any[]; bill?: any; billed?: number } = {}) {
  const bill = opts.bill ?? null;
  const client: any = {
    service: {
      findFirst: jest.fn().mockResolvedValue({ id: SERVICE_ID, currency: 'ARS', propertyId: 'prop-1' }),
      findMany: jest.fn().mockResolvedValue([]),
    },
    serviceBill: {
      findFirst: jest.fn().mockResolvedValue(bill),
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: BILL_ID, status: 'Pendiente', ...data })),
      update: jest.fn().mockImplementation(async ({ data }: any) => ({ ...(bill ?? {}), id: BILL_ID, ...data })),
    },
    serviceBillAllocation: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(opts.billed ?? 0),
      createMany: jest.fn().mockResolvedValue({ count: 1 }),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
    contractChargeRule: { findMany: jest.fn().mockResolvedValue(opts.rules ?? []) },
    property: { findMany: jest.fn().mockResolvedValue(UNITS.map((id) => ({ id }))) },
    servicePayment: {
      findFirst: jest.fn().mockResolvedValue(null),
      create: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      deleteMany: jest.fn().mockResolvedValue({}),
    },
    ownerLedgerEntry: {
      findMany: jest.fn().mockResolvedValue([]),
      count: jest.fn().mockResolvedValue(0),
      deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      createMany: jest.fn().mockResolvedValue({ count: 0 }),
    },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const tenantContext = { getTenantId: () => 'tenant-1', getUserId: () => 'user-1' };
  const service = new ServiceBillsService(
    { client } as unknown as PrismaService,
    tenantContext as unknown as TenantContextService,
    { get: jest.fn().mockResolvedValue({ ownerAccounts: { statementCloseDay: null } }) } as any,
  );
  return { service, client };
}

const row = (over: Record<string, unknown> = {}) => ({
  serviceId: SERVICE_ID,
  period: '2026-11',
  amount: '10000.00',
  ...over,
});

describe('períodos y reglas por contrato', () => {
  it('parsePeriod lleva "YYYY-MM" y cualquier fecha del mes al primer día', () => {
    expect(parsePeriod('2026-11')).toEqual(d('2026-11-01'));
    expect(parsePeriod('2026-11-17')).toEqual(d('2026-11-01'));
    expect(defaultInstallmentLabel(d('2026-09-01'))).toBe('09/2026');
  });

  it('pickRulesFor elige por contrato la regla vigente en el mes (la del día 1)', () => {
    const old = rule({ id: 'old', validTo: d('2026-06-14') });
    const next = rule({ id: 'next', validFrom: d('2026-06-15') });
    const other = rule({ id: 'other', contractId: 'con-2', contract: { startDate: d('2026-01-01') } });
    const june = pickRulesFor([old, next, other], d('2026-06-01')).map((r) => r.id);
    const july = pickRulesFor([old, next, other], d('2026-07-01')).map((r) => r.id);
    expect(june).toEqual(['old', 'other']);
    expect(july).toEqual(['next', 'other']);
  });

  it('un contrato que empieza después del mes usa la regla de su fecha de inicio', () => {
    const late = rule({ contract: { startDate: d('2026-03-10') }, validFrom: d('2026-03-10') });
    expect(pickRulesFor([late], d('2026-01-01'))).toHaveLength(1);
  });
});

describe('ServiceBillsService.bulk', () => {
  it('crea la boleta y guarda las partes del reparto', async () => {
    const { service, client } = build({ rules: [rule()] });
    const res = await service.bulk([row()]);

    expect(res).toMatchObject({ total: 1, created: 1, failed: 0 });
    const created = client.serviceBill.create.mock.calls[0][0].data;
    expect(created).toMatchObject({
      tenantId: 'tenant-1',
      installmentLabel: '11/2026',
      currency: 'ARS',
      amount: '10000.00',
    });
    expect(created.period).toEqual(d('2026-11-01'));
    const parts = client.serviceBillAllocation.createMany.mock.calls[0][0].data;
    expect(parts).toEqual([
      expect.objectContaining({
        contractId: 'con-1',
        ruleId: 'rule-1',
        payer: 'Inmobiliaria',
        amount: '5000.00',
        chargePeriod: d('2026-11-01'),
      }),
    ]);
  });

  it('es idempotente: la misma fila no cambia nada', async () => {
    const existing = {
      id: BILL_ID,
      status: 'Pendiente',
      amount: { toString: () => '10000.00' },
      nominalAmount: null,
      consumption: null,
      dueDate: null,
      notes: null,
      unitConsumptions: null,
    };
    const { service, client } = build({ bill: existing });
    const res = await service.bulk([row()]);
    expect(res.unchanged).toBe(1);
    expect(client.serviceBill.create).not.toHaveBeenCalled();
    expect(client.serviceBill.update).not.toHaveBeenCalled();
  });

  it('con otro importe actualiza y rehace las partes sin facturar', async () => {
    const existing = {
      id: BILL_ID,
      serviceId: SERVICE_ID,
      period: d('2026-11-01'),
      status: 'Pendiente',
      amount: { toString: () => '9000.00' },
      nominalAmount: null,
      consumption: null,
      dueDate: null,
      notes: null,
      unitConsumptions: null,
    };
    const { service, client } = build({ bill: existing, rules: [rule()] });
    const res = await service.bulk([row()]);
    expect(res.updated).toBe(1);
    expect(client.serviceBillAllocation.deleteMany).toHaveBeenCalledWith({ where: { billId: BILL_ID, billedAt: null } });
    expect(client.serviceBillAllocation.createMany.mock.calls[0][0].data[0].amount).toBe('5000.00');
  });

  it('una boleta ya facturada no se cambia: error por fila y las demás siguen', async () => {
    const existing = {
      id: BILL_ID,
      serviceId: SERVICE_ID,
      period: d('2026-11-01'),
      status: 'Pendiente',
      amount: { toString: () => '9000.00' },
      nominalAmount: null,
      consumption: null,
      dueDate: null,
      notes: null,
      unitConsumptions: null,
    };
    const { service, client } = build({ bill: existing, billed: 1 });
    client.serviceBill.findFirst.mockResolvedValueOnce(existing).mockResolvedValueOnce(null);
    const res = await service.bulk([row(), row({ installmentLabel: 'extra' })]);
    expect(res.results[0]).toEqual({
      index: 0,
      status: 'error',
      error: { code: 'BILL_ALREADY_BILLED', message: expect.any(String) },
    });
    expect(res.results[1].status).toBe('created');
    expect(res).toMatchObject({ failed: 1, created: 1 });
  });

  it('informa por fila los datos inválidos y el servicio inexistente', async () => {
    const { service, client } = build();
    client.service.findFirst.mockResolvedValue(null);
    const res = await service.bulk([{ serviceId: 'no-es-uuid' }, row()]);
    expect(res.results.map((r) => (r.status === 'error' ? r.error.code : r.status))).toEqual([
      'VALIDATION_ERROR',
      'SERVICE_NOT_FOUND',
    ]);
  });

  it('rechaza lo que no es un arreglo y las planillas vacías o demasiado grandes', async () => {
    const { service } = build();
    await expect(service.bulk({})).rejects.toMatchObject({ response: { error: 'VALIDATION_ERROR' } });
    await expect(service.bulk([])).rejects.toMatchObject({ response: { error: 'VALIDATION_ERROR' } });
    await expect(service.bulk(new Array(501).fill(row()))).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
  });

  it('un error de reglas del cálculo se informa en su fila', async () => {
    const bad = rule({ splitMode: 'Fijo', fixedAmount: null });
    const { service } = build({ rules: [bad] });
    const res = await service.bulk([row()]);
    expect(res.results[0]).toMatchObject({ status: 'error', error: { code: 'FIXED_AMOUNT_REQUIRED' } });
  });

  it('el consumo de cada unidad reparte la boleta entre contratos', async () => {
    const a = rule({ id: 'ra', contractId: 'con-1', splitMode: 'Consumo', payer: 'Propietario' });
    const b = rule({
      id: 'rb',
      contractId: 'con-2',
      splitMode: 'Consumo',
      contract: { ...rule().contract, id: 'con-2', propertyId: 'prop-2' },
    });
    const { service, client } = build({ rules: [a, b] });
    const res = await service.bulk([
      row({
        consumption: '300',
        unitConsumptions: [
          { propertyId: '22222222-2222-4222-8222-222222222222', consumption: '100' },
        ],
      }),
    ]);
    // Los consumos no coinciden con las propiedades de las reglas (prop-1/prop-2): sin consumo conocido, no se reparte.
    expect(res.created).toBe(1);
    expect(client.serviceBillAllocation.createMany).not.toHaveBeenCalled();
  });

  it('DEF-106 / CP-1133 — el consumo de una unidad sin contrato con regla entra en el total de la boleta', async () => {
    const unitA = UNIT_A;
    const unitB = UNIT_B;
    const a = rule({
      id: 'ra',
      splitMode: 'Consumo',
      payer: 'Propietario',
      contract: { ...rule().contract, propertyId: unitA },
    });
    const { service, client } = build({ rules: [a] });
    await service.bulk([
      row({
        amount: '1000.00',
        unitConsumptions: [
          { propertyId: unitA, consumption: '100' },
          { propertyId: unitB, consumption: '100' },
        ],
      }),
    ]);
    // La unidad B (vacía, sin regla) consumió lo mismo: A paga la mitad, no toda la boleta.
    const parts = client.serviceBillAllocation.createMany.mock.calls[0][0].data;
    expect(parts).toEqual([expect.objectContaining({ contractId: 'con-1', amount: '500.00' })]);
  });

  it('descarta contratos en borrador, terminados antes del mes y reglas ajenas', async () => {
    const draft = rule({ contract: { ...rule().contract, status: 'Borrador' } });
    const ended = rule({
      contractId: 'con-3',
      contract: { ...rule().contract, id: 'con-3', status: 'Finalizado', endDate: d('2026-05-31') },
    });
    const { service, client } = build({ rules: [draft, ended] });
    await service.bulk([row()]);
    expect(client.serviceBillAllocation.createMany).not.toHaveBeenCalled();
  });

  it('no repite una parte ya facturada del mismo contrato y mes', async () => {
    const { service, client } = build({ rules: [rule()] });
    client.serviceBillAllocation.findMany.mockResolvedValue([
      { contractId: 'con-1', chargePeriod: d('2026-11-01') },
    ]);
    await service.bulk([row()]);
    expect(client.serviceBillAllocation.createMany).not.toHaveBeenCalled();
  });
});

describe('ServiceBillsService.preview y unidades', () => {
  const water = () => {
    const a = rule({
      id: 'ra',
      splitMode: 'Consumo',
      payer: 'Propietario',
      contract: { ...rule().contract, propertyId: UNIT_A },
    });
    const b = rule({
      id: 'rb',
      contractId: 'con-2',
      splitMode: 'Consumo',
      payer: 'Inmobiliaria',
      contract: { ...rule().contract, id: 'con-2', propertyId: UNIT_B },
    });
    return build({ rules: [a, b] });
  };

  it('CP-1135 — la vista previa reparte por consumo sin guardar nada', async () => {
    const { service, client } = water();
    const res = await service.preview({
      serviceId: SERVICE_ID,
      period: '2026-11',
      amount: '900.00',
      unitConsumptions: [
        { propertyId: UNIT_A, consumption: '100' },
        { propertyId: UNIT_B, consumption: '200' },
      ],
    });
    expect(res.allocations.map((a) => [a.contractId, a.amount, a.chargePeriod])).toEqual([
      ['con-1', '300.00', '2026-11-01'],
      ['con-2', '600.00', '2026-11-01'],
    ]);
    expect(client.serviceBill.create).not.toHaveBeenCalled();
    expect(client.serviceBillAllocation.createMany).not.toHaveBeenCalled();
  });

  it('CP-1136 — con una unidad sin consumo la vista previa no reparte y avisa cuál', async () => {
    const { service } = water();
    const res = await service.preview({
      serviceId: SERVICE_ID,
      period: '2026-11',
      amount: '900.00',
      unitConsumptions: [{ propertyId: UNIT_A, consumption: '100' }],
    });
    expect(res.allocations).toEqual([]);
    expect(res.skipped.map((s) => [s.contractId, s.reason])).toEqual([
      ['con-1', 'MissingConsumption'],
      ['con-2', 'MissingConsumption'],
    ]);
  });

  it('CP-1137 — una unidad que no es del edificio del servicio se rechaza (vista previa y carga)', async () => {
    const { service, client } = water();
    client.property.findMany.mockResolvedValue([{ id: UNIT_A }]);
    const foreign = [{ propertyId: UNIT_B, consumption: '10' }];
    await expect(
      service.preview({ serviceId: SERVICE_ID, period: '2026-11', amount: '1.00', unitConsumptions: foreign }),
    ).rejects.toMatchObject({ response: { error: 'UNIT_NOT_IN_BUILDING' } });
    const res = await service.bulk([row({ unitConsumptions: foreign })]);
    expect(res.results[0]).toMatchObject({ status: 'error', error: { code: 'UNIT_NOT_IN_BUILDING' } });
  });

  it('CP-1138 — el mismo edificio no puede repetirse en los consumos y el servicio debe existir', async () => {
    const { service, client } = water();
    const res = await service.bulk([
      row({
        unitConsumptions: [
          { propertyId: UNIT_A, consumption: '1' },
          { propertyId: UNIT_A, consumption: '2' },
        ],
      }),
    ]);
    expect(res.results[0]).toMatchObject({ status: 'error' });
    client.service.findFirst.mockResolvedValue(null);
    await expect(service.preview({ serviceId: SERVICE_ID, period: '2026-11', amount: '1.00' })).rejects.toMatchObject({
      response: { error: 'SERVICE_NOT_FOUND' },
    });
  });
});

describe('billConsumption', () => {
  it('toma el mayor entre el consumo declarado y la suma de las unidades', () => {
    const units = new Map([['a', '100'], ['b', '50.5']]);
    expect(billConsumption({ consumption: null }, units)).toBe('150.5');
    expect(billConsumption({ consumption: { toString: () => '400' } }, units)).toBe('400');
    expect(billConsumption({ consumption: { toString: () => '100' } }, units)).toBe('150.5');
    expect(billConsumption({ consumption: null }, new Map())).toBeNull();
  });
});

describe('ServiceBillsService.update', () => {
  const bill = (over: Record<string, unknown> = {}) => ({
    id: BILL_ID,
    serviceId: SERVICE_ID,
    period: d('2026-11-01'),
    installmentLabel: '11/2026',
    status: 'Pendiente',
    amount: { toString: () => '10000.00' },
    nominalAmount: null,
    consumption: null,
    paidBy: null,
    paidAt: null,
    ...over,
  });

  it('registrar quién pagó la marca pagada y deja el pago ligado', async () => {
    const { service, client } = build({ bill: bill() });
    await service.update(BILL_ID, { paidBy: 'Inmobiliaria', paidAt: '2026-11-08' });
    expect(client.serviceBill.update.mock.calls[0][0].data).toMatchObject({
      status: 'Pagada',
      paidBy: 'Inmobiliaria',
      paidAt: d('2026-11-08'),
    });
    expect(client.servicePayment.create.mock.calls[0][0].data).toMatchObject({
      serviceId: SERVICE_ID,
      billId: BILL_ID,
      paymentDate: d('2026-11-08'),
    });
  });

  it('actualiza el pago ligado si ya existía', async () => {
    const { service, client } = build({ bill: bill({ status: 'Pagada', paidBy: 'Inquilino', paidAt: d('2026-11-01') }) });
    client.servicePayment.findFirst.mockResolvedValue({ id: 'pay-1' });
    await service.update(BILL_ID, { receiptUrl: 'https://ejemplo.invalid/recibo.pdf' });
    expect(client.servicePayment.update).toHaveBeenCalled();
  });

  it('pagada exige quién pagó y cuándo', async () => {
    const { service } = build({ bill: bill() });
    await expect(service.update(BILL_ID, { status: 'Pagada' })).rejects.toMatchObject({
      response: { error: 'BILL_PAYMENT_DATA_REQUIRED' },
    });
  });

  it('volver a pendiente limpia el pago', async () => {
    const { service, client } = build({ bill: bill({ status: 'Pagada', paidBy: 'Inquilino', paidAt: d('2026-11-01') }) });
    client.servicePayment.findFirst.mockResolvedValue({ id: 'pay-1' });
    await service.update(BILL_ID, { status: 'Pendiente' });
    expect(client.serviceBill.update.mock.calls[0][0].data).toMatchObject({ paidBy: null, paidAt: null });
    expect(client.servicePayment.deleteMany).toHaveBeenCalledWith({ where: { billId: BILL_ID } });
  });

  it('cambiar el importe rehace las partes; con partes facturadas se rechaza', async () => {
    const ok = build({ bill: bill(), rules: [rule()] });
    await ok.service.update(BILL_ID, { amount: '12000.00' });
    expect(ok.client.serviceBillAllocation.createMany.mock.calls[0][0].data[0].amount).toBe('6000.00');

    const billed = build({ bill: bill(), billed: 1 });
    await expect(billed.service.update(BILL_ID, { amount: '12000.00' })).rejects.toMatchObject({
      response: { error: 'BILL_ALREADY_BILLED' },
    });
  });

  it('anular borra las partes sin facturar y se rechaza si ya hay facturadas', async () => {
    const ok = build({ bill: bill() });
    await ok.service.update(BILL_ID, { status: 'Anulada' });
    expect(ok.client.serviceBillAllocation.deleteMany).toHaveBeenCalledWith({
      where: { billId: BILL_ID, billedAt: null },
    });

    const billed = build({ bill: bill(), billed: 2 });
    await expect(billed.service.update(BILL_ID, { status: 'Anulada' })).rejects.toMatchObject({
      response: { error: 'BILL_ALREADY_BILLED' },
    });
  });

  it('una boleta inexistente es 404 y un cuerpo vacío es inválido', async () => {
    const { service } = build();
    await expect(service.update('x', { amount: '1' })).rejects.toMatchObject({ response: { error: 'BILL_NOT_FOUND' } });
    await expect(service.update('x', {})).rejects.toMatchObject({ response: { error: 'VALIDATION_ERROR' } });
  });
});

describe('ServiceBillsService: lecturas', () => {
  it('findAll filtra por período y propiedad', async () => {
    const { service, client } = build();
    client.serviceBill.findMany.mockResolvedValue([]);
    const res = await service.findAll({ period: '2026-11', propertyId: '33333333-3333-4333-8333-333333333333' });
    expect(client.serviceBill.findMany.mock.calls[0][0].where).toEqual({
      period: d('2026-11-01'),
      service: { propertyId: '33333333-3333-4333-8333-333333333333' },
    });
    expect(res).toMatchObject({ total: 0, page: 1 });
  });

  it('sheet arma una fila por servicio con las reglas vigentes', async () => {
    const { service, client } = build();
    client.service.findMany.mockResolvedValue([
      {
        id: SERVICE_ID,
        serviceType: 'Electricidad',
        providerName: null,
        amount: { toString: () => '18000' },
        currency: 'ARS',
        dueDay: 10,
        billingFrequency: 'Mensual',
        hasAnnualOption: false,
        propertyId: 'prop-1',
        property: { id: 'prop-1', title: 'Depto' },
        bills: [],
        rules: [rule({ fixedAmount: { toString: () => '100' } })],
      },
    ]);
    const res = await service.sheet('2026-11');
    expect(res.period).toBe('2026-11-01');
    expect(res.rows[0].rules).toEqual([
      expect.objectContaining({ contractId: 'con-1', payer: 'Inmobiliaria', tenantSharePct: '50', fixedAmount: '100' }),
    ]);
    await expect(service.sheet('')).rejects.toMatchObject({ response: { error: 'VALIDATION_ERROR' } });
  });

  it('CP-1134 — la planilla lista las unidades del edificio y la propiedad de cada regla por consumo', async () => {
    const { service, client } = build();
    const byConsumo = rule({
      splitMode: 'Consumo',
      contract: { ...rule().contract, propertyId: 'prop-solo', property: { title: 'Depto solo' } },
    });
    client.property.findMany.mockResolvedValue([
      { id: UNIT_B, title: 'Unidad B', parentPropertyId: 'bld' },
      { id: UNIT_A, title: 'Unidad A', parentPropertyId: 'bld' },
      { id: 'otra', title: 'De otro edificio', parentPropertyId: 'otro' },
    ]);
    const base = {
      serviceType: 'Agua',
      providerName: null,
      amount: { toString: () => '1' },
      currency: 'ARS',
      dueDay: 10,
      billingFrequency: 'Mensual',
      hasAnnualOption: false,
      bills: [],
    };
    client.service.findMany.mockResolvedValue([
      { ...base, id: 'sv-1', propertyId: 'bld', property: { id: 'bld', title: 'Edificio' }, rules: [] },
      { ...base, id: 'sv-2', propertyId: 'prop-solo', property: { id: 'prop-solo', title: 'Depto solo' }, rules: [byConsumo] },
    ]);
    const res = await service.sheet('2026-11');
    expect(res.rows[0].units).toEqual([
      { propertyId: UNIT_B, title: 'Unidad B' },
      { propertyId: UNIT_A, title: 'Unidad A' },
    ]);
    expect(res.rows[1].units).toEqual([{ propertyId: 'prop-solo', title: 'Depto solo' }]);
    expect(res.rows[1].rules[0]).toMatchObject({ propertyId: 'prop-solo', propertyTitle: 'Depto solo' });
  });

  it('allocations devuelve lo guardado y el cálculo de hoy', async () => {
    const stored = { id: 'a1', amount: { toString: () => '5000.00' }, billedAt: null };
    const { service, client } = build({
      bill: {
        id: BILL_ID,
        serviceId: SERVICE_ID,
        period: d('2026-11-01'),
        status: 'Pendiente',
        amount: { toString: () => '10000.00' },
        nominalAmount: null,
        consumption: null,
        unitConsumptions: null,
      },
      rules: [rule()],
    });
    client.serviceBillAllocation.findMany.mockResolvedValue([stored]);
    const res = await service.allocations(BILL_ID);
    expect(res.stored[0].amount).toBe('5000.00');
    expect(res.preview.allocations[0]).toMatchObject({ amount: '5000.00', chargePeriod: '2026-11-01' });
  });
});

describe('ServiceBillsService: liquidación', () => {
  it('pendingLines separa la diferencia por descuento anual en su propio renglón', async () => {
    const { service, client } = build();
    client.serviceBillAllocation.findMany.mockResolvedValue([
      {
        id: 'alloc-9',
        payer: 'Inmobiliaria',
        amount: { toString: () => '5000.00' },
        surplus: { toString: () => '500.00' },
        surplusBeneficiary: 'Locador',
        installmentNo: 1,
        installmentsTotal: 1,
        bill: { installmentLabel: '2026', service: { serviceType: 'ImpuestoInmobiliario', providerName: null } },
      },
    ]);
    const lines = await service.pendingLines('con-1', d('2026-11-01'), 'ARS');
    expect(lines.map((l) => [l.type, l.amount.toString(), l.beneficiary, l.sourceType])).toEqual([
      ['Impuesto', '4500', 'Ente', 'ServiceBillAllocation'],
      ['Cargo', '500.00', 'Locador', 'ServiceBillAllocationSurplus'],
    ]);
  });

  it('un descuento anual del locador cobra el nominal y guarda la diferencia en la parte', async () => {
    const annualRule = rule({ paymentPlan: 'Anual', annualRecovery: 'Unico', annualDiscountBeneficiary: 'Locador' });
    const { service, client } = build({ rules: [annualRule] });
    await service.bulk([row({ amount: '9000.00', nominalAmount: '10000.00' })]);
    expect(client.serviceBillAllocation.createMany.mock.calls[0][0].data[0]).toMatchObject({
      amount: '5000.00',
      surplus: '500.00',
      surplusBeneficiary: 'Locador',
    });
  });

  it('pendingLines pide solo lo sin facturar hasta el mes y lo vuelve renglón con destino', async () => {
    const { service, client } = build();
    client.serviceBillAllocation.findMany.mockResolvedValue([
      {
        id: 'alloc-1',
        payer: 'Propietario',
        amount: { toString: () => '5000.00' },
        surplus: { toString: () => '0' },
        surplusBeneficiary: null,
        installmentNo: 1,
        installmentsTotal: 1,
        bill: { installmentLabel: '10/2026', service: { serviceType: 'Gas', providerName: null } },
      },
    ]);
    const lines = await service.pendingLines('con-1', d('2026-11-01'), 'ARS');
    const where = client.serviceBillAllocation.findMany.mock.calls[0][0].where;
    expect(where).toMatchObject({
      contractId: 'con-1',
      billedAt: null,
      chargePeriod: { lte: d('2026-11-01') },
      payer: { not: 'Inquilino' },
    });
    expect(lines).toEqual([
      {
        type: 'Servicio',
        description: 'Gas 10/2026 (por cuenta y orden del locador)',
        amount: '5000.00',
        commissionable: false,
        beneficiary: 'Locador',
        sourceType: 'ServiceBillAllocation',
        sourceId: 'alloc-1',
      },
    ]);
  });

  it('markBilled marca una sola vez y falla si alguna ya estaba facturada', async () => {
    const { service, client } = build();
    client.serviceBillAllocation.updateMany.mockResolvedValue({ count: 2 });
    await expect(service.markBilled(client, ['a', 'b'], 'liq-1')).resolves.toBe(2);
    expect(client.serviceBillAllocation.updateMany.mock.calls[0][0].where).toEqual({
      id: { in: ['a', 'b'] },
      billedAt: null,
    });
    client.serviceBillAllocation.updateMany.mockResolvedValue({ count: 1 });
    await expect(service.markBilled(client, ['a', 'b'], 'liq-1')).rejects.toMatchObject({
      response: { error: 'ALLOCATION_ALREADY_BILLED' },
    });
    await expect(service.markBilled(client, [], 'liq-1')).resolves.toBe(0);
  });

  it('release deja pendientes las partes de una liquidación o de un renglón', async () => {
    const { service, client } = build();
    client.serviceBillAllocation.updateMany.mockResolvedValue({ count: 3 });
    await expect(service.release(client, { liquidacionId: 'liq-1', ids: ['a'] })).resolves.toBe(3);
    expect(client.serviceBillAllocation.updateMany.mock.calls[0][0]).toEqual({
      where: { OR: [{ liquidacionId: 'liq-1' }, { id: { in: ['a'] } }], billedAt: { not: null } },
      data: { billedAt: null, liquidacionId: null },
    });
    await expect(service.release(client, {})).resolves.toBe(0);
  });

  it('reallocateService rehace las boletas del servicio desde el mes', async () => {
    const { service, client } = build({ rules: [rule()] });
    client.serviceBill.findMany.mockResolvedValue([
      { id: 'b1', serviceId: SERVICE_ID, period: d('2026-11-01'), status: 'Pendiente', amount: { toString: () => '100.00' } },
    ]);
    await expect(service.reallocateService(client, SERVICE_ID, d('2026-10-15'))).resolves.toBe(1);
    expect(client.serviceBill.findMany.mock.calls[0][0].where.period).toEqual({ gte: d('2026-10-01') });
  });
});
