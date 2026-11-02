import { PrismaService } from '../../common/prisma/prisma.service';
import { TenantContextService } from '../../common/tenant/tenant-context.service';
import { ChargeRulesService } from './charge-rules.service';

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);
const SERVICE_ID = '11111111-1111-4111-8111-111111111111';
const AGREEMENT_ID = '22222222-2222-4222-8222-222222222222';

function stored(over: Record<string, unknown> = {}) {
  return {
    id: 'rule-1',
    contractId: 'con-1',
    serviceId: SERVICE_ID,
    payer: 'Inmobiliaria',
    splitMode: 'Porcentaje',
    tenantSharePct: '100',
    fixedAmount: null,
    paymentPlan: 'Mensual',
    annualRecovery: 'Prorrateado',
    annualInstallments: 12,
    annualDiscountBeneficiary: 'Inquilino',
    remainingInstallmentsOnEnd: 'CobrarEnLiquidacionFinal',
    validFrom: d('2026-01-01'),
    validTo: null,
    agreementId: null,
    ...over,
  };
}

function build(
  opts: { status?: string; siblings?: any[]; agreement?: any; serviceProperty?: string; used?: number; rule?: any } = {},
) {
  const client: any = {
    contract: {
      findFirst: jest.fn().mockResolvedValue({
        id: 'con-1',
        status: opts.status ?? 'Borrador',
        propertyId: 'prop-1',
        startDate: d('2026-01-01'),
        property: { id: 'prop-1', parentPropertyId: 'building-1' },
      }),
    },
    service: {
      findFirst: jest.fn().mockResolvedValue({ id: SERVICE_ID, propertyId: opts.serviceProperty ?? 'prop-1' }),
    },
    contractAgreement: { findFirst: jest.fn().mockResolvedValue(opts.agreement ?? null) },
    contractChargeRule: {
      findMany: jest.fn().mockResolvedValue(opts.siblings ?? []),
      findFirst: jest.fn().mockImplementation(async () => opts.rule ?? stored()),
      create: jest.fn().mockResolvedValue({ id: 'rule-new' }),
      update: jest.fn().mockResolvedValue({}),
    },
    serviceBillAllocation: { count: jest.fn().mockResolvedValue(opts.used ?? 0) },
  };
  client.$transaction = jest.fn((fn: (tx: any) => unknown) => fn(client));
  const bills = { reallocateService: jest.fn().mockResolvedValue(0) };
  const service = new ChargeRulesService(
    { client } as unknown as PrismaService,
    { getTenantId: () => 'tenant-1' } as unknown as TenantContextService,
    bills as any,
  );
  return { service, client, bills };
}

const body = (over: Record<string, unknown> = {}) => ({
  serviceId: SERVICE_ID,
  payer: 'Inmobiliaria',
  validFrom: '2026-01-01',
  ...over,
});

describe('ChargeRulesService.create', () => {
  it('en un contrato borrador crea la regla sin acuerdo, con los valores por defecto', async () => {
    const { service, client, bills } = build();
    await service.create('con-1', body());
    expect(client.contractChargeRule.create.mock.calls[0][0].data).toMatchObject({
      tenantId: 'tenant-1',
      contractId: 'con-1',
      payer: 'Inmobiliaria',
      splitMode: 'Porcentaje',
      tenantSharePct: '100',
      paymentPlan: 'Mensual',
      annualRecovery: 'Prorrateado',
      annualInstallments: 12,
      annualDiscountBeneficiary: 'Inquilino',
      remainingInstallmentsOnEnd: 'CobrarEnLiquidacionFinal',
      validFrom: d('2026-01-01'),
      validTo: null,
      agreementId: null,
    });
    expect(bills.reallocateService).toHaveBeenCalledWith(client, SERVICE_ID, d('2026-01-01'));
  });

  it('en un contrato en vigor exige el acuerdo', async () => {
    const { service } = build({ status: 'Activo' });
    await expect(service.create('con-1', body({ validFrom: '2026-06-01' }))).rejects.toMatchObject({
      response: { error: 'CHARGE_RULE_REQUIRES_AGREEMENT' },
    });
  });

  it('con el acuerdo CambioCargo de la misma fecha cierra la regla anterior sin pisarla', async () => {
    const previous = stored({ id: 'old' });
    const { service, client } = build({
      status: 'Activo',
      siblings: [previous],
      agreement: { id: AGREEMENT_ID, kind: 'CambioCargo', effectiveFrom: d('2026-06-01') },
    });
    await service.create('con-1', body({ validFrom: '2026-06-01', payer: 'Propietario', agreementId: AGREEMENT_ID }));

    expect(client.contractChargeRule.update).toHaveBeenCalledWith({
      where: { id: 'old' },
      data: { validTo: d('2026-05-31') },
    });
    expect(client.contractChargeRule.create.mock.calls[0][0].data).toMatchObject({
      payer: 'Propietario',
      agreementId: AGREEMENT_ID,
      validFrom: d('2026-06-01'),
    });
  });

  it('una regla insertada entre dos versiones termina el día anterior a la siguiente', async () => {
    const first = stored({ id: 'a', validTo: d('2026-08-31') });
    const third = stored({ id: 'c', validFrom: d('2026-09-01') });
    const { service, client } = build({ siblings: [first, third] });
    await service.create('con-1', body({ validFrom: '2026-05-01', validTo: '2026-12-31' }));
    expect(client.contractChargeRule.create.mock.calls[0][0].data.validTo).toEqual(d('2026-08-31'));
    expect(client.contractChargeRule.update).toHaveBeenCalledWith({
      where: { id: 'a' },
      data: { validTo: d('2026-04-30') },
    });
  });

  it('rechaza una fecha repetida, un acuerdo de otro tipo o con otra fecha, o inexistente', async () => {
    const dup = build({ siblings: [stored()] });
    await expect(dup.service.create('con-1', body())).rejects.toMatchObject({
      response: { error: 'CHARGE_RULE_EXISTS' },
    });

    const kind = build({ status: 'Activo', agreement: { id: AGREEMENT_ID, kind: 'Rebaja', effectiveFrom: d('2026-06-01') } });
    await expect(
      kind.service.create('con-1', body({ validFrom: '2026-06-01', agreementId: AGREEMENT_ID })),
    ).rejects.toMatchObject({ response: { error: 'AGREEMENT_KIND_MISMATCH' } });

    const date = build({
      status: 'Activo',
      agreement: { id: AGREEMENT_ID, kind: 'CambioCargo', effectiveFrom: d('2026-07-01') },
    });
    await expect(
      date.service.create('con-1', body({ validFrom: '2026-06-01', agreementId: AGREEMENT_ID })),
    ).rejects.toMatchObject({ response: { error: 'CHARGE_RULE_DATE_MISMATCH' } });

    const missing = build({ status: 'Activo' });
    await expect(
      missing.service.create('con-1', body({ validFrom: '2026-06-01', agreementId: AGREEMENT_ID })),
    ).rejects.toMatchObject({ response: { error: 'AGREEMENT_NOT_FOUND' } });
  });

  it('el servicio debe ser de la propiedad del contrato o de su edificio', async () => {
    const other = build({ serviceProperty: 'prop-9' });
    await expect(other.service.create('con-1', body())).rejects.toMatchObject({
      response: { error: 'SERVICE_NOT_APPLICABLE' },
    });
    const building = build({ serviceProperty: 'building-1' });
    await expect(building.service.create('con-1', body())).resolves.toBeDefined();
  });

  it('no admite una regla anterior al inicio del contrato ni datos inválidos', async () => {
    const { service } = build();
    await expect(service.create('con-1', body({ validFrom: '2025-12-31' }))).rejects.toMatchObject({
      response: { error: 'CHARGE_RULE_BEFORE_START' },
    });
    await expect(service.create('con-1', body({ splitMode: 'Fijo' }))).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
    await expect(service.create('con-1', body({ tenantSharePct: '101' }))).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
  });

  it('el importe fijo se guarda solo con el modo Fijo', async () => {
    const { service, client } = build();
    await service.create('con-1', body({ splitMode: 'Fijo', fixedAmount: '2500.00' }));
    expect(client.contractChargeRule.create.mock.calls[0][0].data.fixedAmount).toBe('2500.00');
    await service.create('con-1', body({ fixedAmount: '2500.00', validFrom: '2026-02-01' }));
    expect(client.contractChargeRule.create.mock.calls[1][0].data.fixedAmount).toBeNull();
  });

  it('las cuotas anuales, el beneficiario del descuento y las cuotas restantes se eligen por regla', async () => {
    const { service, client } = build();
    await service.create(
      'con-1',
      body({
        paymentPlan: 'Anual',
        annualInstallments: 6,
        annualDiscountBeneficiary: 'Locador',
        remainingInstallmentsOnEnd: 'Descartar',
      }),
    );
    expect(client.contractChargeRule.create.mock.calls[0][0].data).toMatchObject({
      annualInstallments: 6,
      annualDiscountBeneficiary: 'Locador',
      remainingInstallmentsOnEnd: 'Descartar',
    });
    for (const bad of [{ annualInstallments: 0 }, { annualInstallments: 13 }, { annualDiscountBeneficiary: 'Ente' }]) {
      await expect(service.create('con-1', body(bad))).rejects.toMatchObject({
        response: { error: 'VALIDATION_ERROR' },
      });
    }
  });

  it('servicio inexistente es 404', async () => {
    const { service, client } = build();
    client.service.findFirst.mockResolvedValue(null);
    await expect(service.create('con-1', body())).rejects.toMatchObject({ response: { error: 'SERVICE_NOT_FOUND' } });
  });
});

describe('ChargeRulesService.update', () => {
  it('corrige una regla de un contrato borrador y rehace el reparto', async () => {
    const { service, client, bills } = build({ rule: stored() });
    await service.update('con-1', 'rule-1', {
      tenantSharePct: '50',
      notes: 'por escrito',
      annualInstallments: 10,
      annualDiscountBeneficiary: 'Inmobiliaria',
      remainingInstallmentsOnEnd: 'Descartar',
    });
    expect(client.contractChargeRule.update.mock.calls[0][0].data).toMatchObject({
      splitMode: 'Porcentaje',
      tenantSharePct: '50',
      notes: 'por escrito',
      annualInstallments: 10,
      annualDiscountBeneficiary: 'Inmobiliaria',
      remainingInstallmentsOnEnd: 'Descartar',
    });
    expect(bills.reallocateService).toHaveBeenCalledWith(client, SERVICE_ID, d('2026-01-01'));
  });

  it('en un contrato en vigor solo se corrige una regla que nació de un acuerdo', async () => {
    const signed = build({ status: 'Activo', rule: stored({ agreementId: null }) });
    await expect(signed.service.update('con-1', 'rule-1', { payer: 'Propietario' })).rejects.toMatchObject({
      response: { error: 'CHARGE_RULE_REQUIRES_AGREEMENT' },
    });
    const fromAgreement = build({ status: 'Activo', rule: stored({ agreementId: AGREEMENT_ID }) });
    await expect(fromAgreement.service.update('con-1', 'rule-1', { payer: 'Propietario' })).resolves.toBeDefined();
  });

  it('una regla ya usada en una liquidación no se cambia', async () => {
    const { service } = build({ used: 1 });
    await expect(service.update('con-1', 'rule-1', { payer: 'Propietario' })).rejects.toMatchObject({
      response: { error: 'CHARGE_RULE_IN_USE' },
    });
  });

  it('pasar a Fijo exige el importe y validTo no puede ser anterior al inicio', async () => {
    const { service } = build();
    await expect(service.update('con-1', 'rule-1', { splitMode: 'Fijo' })).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
    await expect(service.update('con-1', 'rule-1', { validTo: '2025-12-31' })).rejects.toMatchObject({
      response: { error: 'VALIDATION_ERROR' },
    });
    await expect(service.update('con-1', 'rule-1', { splitMode: 'Fijo', fixedAmount: '10.00' })).resolves.toBeDefined();
  });

  it('regla inexistente y cuerpo vacío', async () => {
    const { service, client } = build();
    client.contractChargeRule.findFirst.mockResolvedValue(null);
    await expect(service.update('con-1', 'x', { payer: 'Inquilino' })).rejects.toMatchObject({
      response: { error: 'CHARGE_RULE_NOT_FOUND' },
    });
    await expect(service.update('con-1', 'x', {})).rejects.toMatchObject({ response: { error: 'VALIDATION_ERROR' } });
  });
});

describe('ChargeRulesService.list', () => {
  it('devuelve las vigentes a la fecha y todas las versiones', async () => {
    const old = stored({ id: 'old', validTo: d('2026-05-31') });
    const next = stored({ id: 'new', validFrom: d('2026-06-01'), payer: 'Propietario' });
    const { service, client } = build({ siblings: [old, next] });
    const res = await service.list('con-1', { at: '2026-03-15' });
    expect(res.current.map((r: any) => r.id)).toEqual(['old']);
    expect(res.versions).toHaveLength(2);
    const later = await service.list('con-1', { at: '2026-07-01' });
    expect(later.current.map((r: any) => r.id)).toEqual(['new']);
    expect(client.contractChargeRule.findMany.mock.calls[0][0].where).toEqual({ contractId: 'con-1' });
  });

  it('sin fecha usa hoy y filtra por servicio; un contrato inexistente es 404', async () => {
    const { service, client } = build();
    const res = await service.list('con-1', { serviceId: SERVICE_ID });
    expect(res.versions).toEqual([]);
    expect(client.contractChargeRule.findMany.mock.calls[0][0].where).toEqual({
      contractId: 'con-1',
      serviceId: SERVICE_ID,
    });
    client.contract.findFirst.mockResolvedValue(null);
    await expect(service.list('x', {})).rejects.toMatchObject({ response: { error: 'CONTRACT_NOT_FOUND' } });
  });
});
