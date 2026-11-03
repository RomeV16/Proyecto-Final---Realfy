import { ImportChargeRuleSchema, ImportServiceSchema } from '@realfy/shared';
import { ImportContext } from './import-types';
import { chargeRuleFields, chargeRuleImporter, serviceFields, serviceImporter } from './service.importer';

const reallocate = jest.fn().mockResolvedValue(undefined);
const ctx = { tenantId: 't1', defaults: {}, reallocateService: reallocate } as unknown as ImportContext;

const parseService = (extra: Record<string, unknown> = {}) =>
  ImportServiceSchema.parse({
    externalRef: 'SRV-1-agua',
    propertyRef: 'U-1',
    serviceType: 'Agua',
    providerName: 'Aguas Demo',
    amount: 15000,
    dueDay: 10,
    ...extra,
  });

const parseRule = (extra: Record<string, unknown> = {}) =>
  ImportChargeRuleSchema.parse({
    contractRef: 'C-1',
    serviceRef: 'SRV-1-agua',
    payer: 'Inquilino',
    validFrom: '2025-01-01',
    ...extra,
  });

const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('serviceImporter.upsert', () => {
  const stored = (extra: Record<string, unknown> = {}) => ({
    id: 's1',
    propertyId: 'p1',
    serviceType: 'Agua',
    providerName: 'Aguas Demo',
    accountNumber: null,
    amount: { toString: () => '15000.00', valueOf: () => 15000 },
    currency: 'ARS',
    dueDay: 10,
    billingFrequency: 'Mensual',
    hasAnnualOption: false,
    isActive: true,
    notes: null,
    ...extra,
  });
  function fakeDb(existing: any | null, property: any | null = { id: 'p1' }) {
    return {
      property: { findFirst: jest.fn().mockResolvedValue(property) },
      service: {
        findFirst: jest.fn().mockResolvedValue(existing),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new', ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
    };
  }

  it('crea el servicio con los valores por defecto y la referencia', async () => {
    const db = fakeDb(null);
    const out = await serviceImporter.upsert(db, ctx, parseService());
    expect(out).toEqual({ action: 'Creado', entityId: 'new' });
    expect(db.service.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 't1',
      externalRef: 'SRV-1-agua',
      propertyId: 'p1',
      currency: 'ARS',
      billingFrequency: 'Mensual',
      hasAnnualOption: false,
      isActive: true,
      amount: '15000.00',
    });
  });

  it('los mismos datos son SinCambios y no escriben', async () => {
    const db = fakeDb(stored());
    expect(await serviceImporter.upsert(db, ctx, parseService())).toEqual({ action: 'SinCambios', entityId: 's1' });
    expect(db.service.update).not.toHaveBeenCalled();
  });

  it('un importe distinto actualiza sólo ese campo', async () => {
    const db = fakeDb(stored());
    const out = await serviceImporter.upsert(db, ctx, parseService({ amount: 18000.5 }));
    expect(out.action).toBe('Actualizado');
    expect(db.service.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { amount: '18000.50' } });
  });

  it('un nulo explícito borra el proveedor y una clave ausente no toca la cuenta', async () => {
    const db = fakeDb(stored({ accountNumber: '123' }));
    const row = ImportServiceSchema.parse({
      externalRef: 'SRV-1-agua',
      propertyRef: 'U-1',
      serviceType: 'Agua',
      providerName: null,
      amount: 15000,
      dueDay: 10,
    });
    await serviceImporter.upsert(db, ctx, row);
    expect(db.service.update).toHaveBeenCalledWith({ where: { id: 's1' }, data: { providerName: null } });
  });

  it('una propiedad sin resolver es REFERENCE_NOT_FOUND en propertyRef', async () => {
    const db = fakeDb(null, null);
    await expect(serviceImporter.upsert(db, ctx, parseService())).rejects.toMatchObject({
      details: [{ code: 'REFERENCE_NOT_FOUND', field: 'propertyRef' }],
    });
  });

  it('el servicio ya cargado no cambia de propiedad', async () => {
    const db = fakeDb(stored({ propertyId: 'otra' }));
    await expect(serviceImporter.upsert(db, ctx, parseService())).rejects.toMatchObject({
      details: [{ code: 'PROPERTY_STATE_CONFLICT', field: 'propertyRef' }],
    });
  });

  it('serviceFields normaliza el importe a dos decimales', () => {
    expect(serviceFields(parseService({ amount: 0 })).amount).toBe('0.00');
  });
});

describe('chargeRuleImporter', () => {
  const rule = (extra: Record<string, unknown> = {}) => ({
    id: 'r1',
    payer: 'Inquilino',
    splitMode: 'Porcentaje',
    tenantSharePct: '100.00',
    fixedAmount: null,
    paymentPlan: 'Mensual',
    annualRecovery: 'Prorrateado',
    annualInstallments: 12,
    annualDiscountBeneficiary: 'Inquilino',
    remainingInstallmentsOnEnd: 'CobrarEnLiquidacionFinal',
    notes: null,
    validFrom: day('2025-01-01'),
    validTo: null,
    ...extra,
  });

  function fakeDb(opts: { rules?: any[]; contract?: any; service?: any; billed?: number } = {}) {
    const contract = opts.contract === undefined ? { propertyId: 'p1', startDate: day('2025-01-01'), property: { parentPropertyId: null } } : opts.contract;
    const service = opts.service === undefined ? { propertyId: 'p1' } : opts.service;
    const ref = (model: 'contract' | 'service', found: any) => ({
      findFirst: jest.fn().mockImplementation(async (args: any) => {
        if (args.where.externalRef) return found ? { id: `${model}-1` } : null;
        return found;
      }),
    });
    return {
      contract: ref('contract', contract),
      service: ref('service', service),
      contractChargeRule: {
        findMany: jest.fn().mockResolvedValue(opts.rules ?? []),
        create: jest.fn().mockImplementation(async ({ data }: any) => ({ id: 'new', ...data })),
        update: jest.fn().mockResolvedValue({}),
      },
      serviceBillAllocation: { count: jest.fn().mockResolvedValue(opts.billed ?? 0) },
    };
  }

  beforeEach(() => reallocate.mockClear());

  it('crea la primera regla con los valores por defecto y recalcula las boletas', async () => {
    const db = fakeDb();
    const out = await chargeRuleImporter.upsert(db, ctx, parseRule());
    expect(out).toEqual({ action: 'Creado', entityId: 'new' });
    expect(db.contractChargeRule.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 't1',
      contractId: 'contract-1',
      serviceId: 'service-1',
      payer: 'Inquilino',
      splitMode: 'Porcentaje',
      tenantSharePct: '100.00',
      fixedAmount: null,
      validFrom: day('2025-01-01'),
      validTo: null,
      notes: null,
    });
    expect(reallocate).toHaveBeenCalledWith(db, 'service-1', day('2025-01-01'));
  });

  it('la misma regla de nuevo es SinCambios', async () => {
    const db = fakeDb({ rules: [rule()] });
    expect(await chargeRuleImporter.upsert(db, ctx, parseRule())).toEqual({ action: 'SinCambios', entityId: 'r1' });
    expect(db.contractChargeRule.update).not.toHaveBeenCalled();
    expect(db.contractChargeRule.create).not.toHaveBeenCalled();
  });

  it('con la misma fecha y otros valores corrige la regla en su lugar', async () => {
    const db = fakeDb({ rules: [rule()] });
    const out = await chargeRuleImporter.upsert(db, ctx, parseRule({ payer: 'Propietario', tenantSharePct: 50 }));
    expect(out).toEqual({ action: 'Actualizado', entityId: 'r1' });
    expect(db.contractChargeRule.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: { payer: 'Propietario', tenantSharePct: '50.00' },
    });
    expect(reallocate).toHaveBeenCalled();
  });

  it('una regla ya liquidada no se corrige', async () => {
    const db = fakeDb({ rules: [rule()], billed: 2 });
    await expect(chargeRuleImporter.upsert(db, ctx, parseRule({ payer: 'Propietario' }))).rejects.toMatchObject({
      details: [{ code: 'CHARGE_RULE_IN_USE' }],
    });
    expect(db.contractChargeRule.update).not.toHaveBeenCalled();
  });

  it('con otra fecha y otros valores cierra la abierta el día anterior y crea la nueva', async () => {
    const db = fakeDb({ rules: [rule()] });
    const out = await chargeRuleImporter.upsert(db, ctx, parseRule({ validFrom: '2025-07-01', payer: 'Propietario' }));
    expect(out).toEqual({ action: 'Creado', entityId: 'new' });
    expect(db.contractChargeRule.update).toHaveBeenCalledWith({ where: { id: 'r1' }, data: { validTo: day('2025-06-30') } });
    expect(db.contractChargeRule.create.mock.calls[0][0].data).toMatchObject({ payer: 'Propietario', validFrom: day('2025-07-01') });
  });

  it('con otra fecha pero los mismos valores que la vigente no agrega una versión', async () => {
    const db = fakeDb({ rules: [rule()] });
    const out = await chargeRuleImporter.upsert(db, ctx, parseRule({ validFrom: '2025-07-01' }));
    expect(out).toEqual({ action: 'SinCambios', entityId: 'r1' });
    expect(db.contractChargeRule.create).not.toHaveBeenCalled();
  });

  it('una versión anterior a otra ya cargada termina el día antes de la siguiente', async () => {
    const db = fakeDb({ rules: [rule({ validFrom: day('2025-07-01'), payer: 'Propietario' })] });
    await chargeRuleImporter.upsert(db, ctx, parseRule({ validFrom: '2025-01-01' }));
    expect(db.contractChargeRule.create.mock.calls[0][0].data.validTo).toEqual(day('2025-06-30'));
  });

  it('un reparto Fijo guarda el importe y uno por porcentaje lo descarta', async () => {
    expect(chargeRuleFields(parseRule({ splitMode: 'Fijo', fixedAmount: 1234.5 })).fixedAmount).toBe('1234.50');
    expect(chargeRuleFields(parseRule({ fixedAmount: 99 })).fixedAmount).toBeNull();
  });

  it.each([
    ['contrato', { contract: null }, 'contractRef'],
    ['servicio', { service: null }, 'serviceRef'],
  ])('un %s sin resolver es REFERENCE_NOT_FOUND', async (_n, opts, field) => {
    const db = fakeDb(opts);
    await expect(chargeRuleImporter.upsert(db, ctx, parseRule())).rejects.toMatchObject({
      details: [{ code: 'REFERENCE_NOT_FOUND', field }],
    });
  });

  it('un servicio de otra propiedad es SERVICE_NOT_APPLICABLE', async () => {
    const db = fakeDb({ service: { propertyId: 'otra' } });
    await expect(chargeRuleImporter.upsert(db, ctx, parseRule())).rejects.toMatchObject({
      details: [{ code: 'SERVICE_NOT_APPLICABLE', field: 'serviceRef' }],
    });
  });

  it('un servicio del edificio del contrato sí aplica', async () => {
    const db = fakeDb({
      contract: { propertyId: 'p1', startDate: day('2025-01-01'), property: { parentPropertyId: 'edif' } },
      service: { propertyId: 'edif' },
    });
    expect((await chargeRuleImporter.upsert(db, ctx, parseRule())).action).toBe('Creado');
  });

  it('una fecha anterior al inicio del contrato es INVALID_DATES', async () => {
    const db = fakeDb();
    await expect(chargeRuleImporter.upsert(db, ctx, parseRule({ validFrom: '2024-12-31' }))).rejects.toMatchObject({
      details: [{ code: 'INVALID_DATES', field: 'validFrom' }],
    });
  });

  it('la clave de la fila y la referencia del registro son contrato, servicio y fecha', () => {
    expect(chargeRuleImporter.keyOf!(parseRule())).toBe('C-1|SRV-1-agua|2025-01-01');
    expect(chargeRuleImporter.refOf!({ contractRef: 'C-1', serviceRef: 'S', validFrom: '2025-01-01' })).toBe('C-1|S|2025-01-01');
    expect(chargeRuleImporter.refOf!({ contractRef: 'C-1' })).toBeNull();
    expect(chargeRuleImporter.refOf!(null)).toBeNull();
  });

  it('sin recalculador inyectado no falla', async () => {
    const db = fakeDb();
    const bare = { tenantId: 't1', defaults: {} } as unknown as ImportContext;
    expect((await chargeRuleImporter.upsert(db, bare, parseRule())).action).toBe('Creado');
  });
});
