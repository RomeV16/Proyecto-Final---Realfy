import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createUserDirect,
  loginUser,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  UserRole,
  PersonRole,
  PropertyType,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
} from '@realfy/shared';

const PASSWORD = 'Password123!';
const ALL_ROLES = Object.values(UserRole);

describe('Boletas de servicios y reglas de traslado (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await teardownTestApp();
  });

  beforeEach(async () => {
    await cleanDatabase(prisma);
  });

  const http = () => request(app.getHttpServer());
  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });
  const get = (token: string, path: string) => http().get(`/api${path}`).set(auth(token));
  const post = (token: string, path: string, body: object = {}) =>
    http().post(`/api${path}`).set(auth(token)).send(body);
  const patch = (token: string, path: string, body: object = {}) =>
    http().patch(`/api${path}`).set(auth(token)).send(body);

  async function agency(tag: string) {
    const admin = await registerUser(app, {
      email: `admin@${tag}.test`,
      password: PASSWORD,
      firstName: 'Admin',
      lastName: 'Prueba',
    });
    const tokens = { [UserRole.Admin]: admin.accessToken } as Record<UserRole, string>;
    for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin)) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { tenantId: admin.user.tenantId as string, tokens };
  }

  async function createContract(token: string, extra: Record<string, unknown> = {}, propertyId?: string) {
    const owner = (await post(token, '/persons', { firstName: 'Ana', lastName: 'Sintética' }).expect(201)).body.id;
    const tenantPerson = (await post(token, '/persons', { firstName: 'Ines', lastName: 'Sintética' }).expect(201)).body.id;
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property =
      propertyId ??
      (await post(token, '/properties', { title: 'Unidad de prueba', type: PropertyType.Departamento }).expect(201))
        .body.id;
    const res = await post(token, '/contracts', {
      propertyId: property,
      contractType: ContractType.Alquiler,
      status: ContractStatus.Activo,
      startDate: '2026-01-01T00:00:00.000Z',
      endDate: '2028-12-31T00:00:00.000Z',
      rentAmount: '300000.00',
      rentCurrency: 'ARS',
      adjustmentType: AdjustmentType.IPC,
      adjustmentPeriod: AdjustmentPeriod.Trimestral,
      guarantees: [],
      persons: [
        { personId: owner, role: PersonRole.Propietario },
        { personId: tenantPerson, role: PersonRole.Inquilino },
      ],
      ...extra,
    }).expect(201);
    return res.body as any;
  }

  const createService = async (token: string, propertyId: string, extra: Record<string, unknown> = {}) =>
    (
      await post(token, '/services', {
        propertyId,
        serviceType: 'Electricidad',
        providerName: 'Ente de prueba',
        amount: 10000,
        dueDay: 10,
        ...extra,
      }).expect(201)
    ).body as any;

  /** Regla de un contrato en vigor: nace de un acuerdo CambioCargo de la misma fecha. */
  async function addRule(
    token: string,
    contract: any,
    serviceId: string,
    body: Record<string, unknown> = {},
    validFrom = '2026-01-01',
  ) {
    const agreement = await post(token, `/contracts/${contract.id}/agreements`, {
      kind: 'CambioCargo',
      effectiveFrom: `${validFrom}T00:00:00.000Z`,
      notes: 'Acuerdo escrito de prueba',
    }).expect(201);
    return (
      await post(token, `/contracts/${contract.id}/charge-rules`, {
        serviceId,
        payer: 'Inmobiliaria',
        validFrom,
        agreementId: agreement.body.id,
        ...body,
      }).expect(201)
    ).body as any;
  }

  const bulk = (token: string, rows: object[]) => post(token, '/service-bills/bulk', rows as any);
  const generate = (token: string, month: number, year: number) =>
    post(token, '/liquidaciones/generate', { month, year }).expect(201);
  const liquidaciones = async (token: string) =>
    (await get(token, '/liquidaciones?limit=100').expect(200)).body.items as any[];

  // ─── Carga masiva ───

  it('CP-341 — la carga masiva es idempotente y informa cada fila', async () => {
    const { tokens } = await agency('bol-1');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const service = await createService(token, contract.propertyId);
    // El servicio nuevo nace mensual y sin opción de pago anual.
    expect(service).toMatchObject({ billingFrequency: 'Mensual', hasAnnualOption: false });

    const first = await bulk(token, [
      { serviceId: service.id, period: '2026-11', amount: '12000.00', dueDate: '2026-11-10' },
      { serviceId: service.id, period: '2026-10', amount: '11000.50', installmentLabel: '10/2026' },
      { serviceId: service.id, period: '2026-12', amount: '-5' },
    ]).expect(200);
    expect(first.body).toMatchObject({ total: 3, created: 2, unchanged: 0, failed: 1 });
    expect(first.body.results[2]).toMatchObject({ index: 2, status: 'error', error: { code: 'VALIDATION_ERROR' } });

    const again = await bulk(token, [
      { serviceId: service.id, period: '2026-11', amount: '12000.00', dueDate: '2026-11-10' },
      { serviceId: service.id, period: '2026-10', amount: '11500.00', installmentLabel: '10/2026' },
    ]).expect(200);
    expect(again.body).toMatchObject({ created: 0, unchanged: 1, updated: 1, failed: 0 });
    expect(await prisma.baseClient.serviceBill.count()).toBe(2);

    const month = await get(token, '/service-bills?period=2026-11').expect(200);
    expect(month.body.items).toHaveLength(1);
    expect(month.body.items[0]).toMatchObject({ amount: '12000', installmentLabel: '11/2026' });
  });

  it('CP-342 — la planilla del mes lista los servicios con quién paga según las reglas', async () => {
    const { tokens } = await agency('bol-2');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const service = await createService(token, contract.propertyId);
    await addRule(token, contract, service.id, { payer: 'Propietario', tenantSharePct: '100' });
    await bulk(token, [{ serviceId: service.id, period: '2026-11', amount: '8000.00' }]).expect(200);

    const sheet = await get(token, '/service-bills/sheet?period=2026-11').expect(200);
    expect(sheet.body.period).toBe('2026-11-01');
    expect(sheet.body.rows).toHaveLength(1);
    expect(sheet.body.rows[0].service.id).toBe(service.id);
    expect(sheet.body.rows[0].bills).toHaveLength(1);
    expect(sheet.body.rows[0].rules[0]).toMatchObject({ contractId: contract.id, payer: 'Propietario' });
    await get(token, '/service-bills/sheet').expect(400);
  });

  // ─── Reglas versionadas con acuerdo ───

  it('CP-343 — en un contrato en vigor la regla exige un acuerdo y el cambio crea una versión nueva', async () => {
    const { tokens } = await agency('bol-3');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const service = await createService(token, contract.propertyId);

    // Sin acuerdo, no.
    const noAgreement = await post(token, `/contracts/${contract.id}/charge-rules`, {
      serviceId: service.id,
      payer: 'Inmobiliaria',
      validFrom: '2026-01-01',
    }).expect(409);
    expect(noAgreement.body.error).toBe('CHARGE_RULE_REQUIRES_AGREEMENT');

    const v1 = await addRule(token, contract, service.id, { payer: 'Inmobiliaria', tenantSharePct: '50' });
    expect(v1).toMatchObject({ payer: 'Inmobiliaria', validTo: null, tenantSharePct: '50' });

    // Un acuerdo que no es de cargos o con otra fecha no sirve.
    const rebaja = await post(token, `/contracts/${contract.id}/agreements`, {
      kind: 'Rebaja',
      effectiveFrom: '2026-07-01T00:00:00.000Z',
      termsPatch: { discountPct: '5' },
    }).expect(201);
    const wrongKind = await post(token, `/contracts/${contract.id}/charge-rules`, {
      serviceId: service.id,
      payer: 'Propietario',
      validFrom: '2026-07-01',
      agreementId: rebaja.body.id,
    }).expect(400);
    expect(wrongKind.body.error).toBe('AGREEMENT_KIND_MISMATCH');

    // Desde julio, paga el propietario: la regla de enero se cierra y no se borra.
    const v2 = await addRule(token, contract, service.id, { payer: 'Propietario' }, '2026-07-01');
    expect(v2).toMatchObject({ payer: 'Propietario', validTo: null });

    const rules = (await get(token, `/contracts/${contract.id}/charge-rules?at=2026-03-15`).expect(200)).body;
    expect(rules.versions).toHaveLength(2);
    expect(rules.current.map((r: any) => r.id)).toEqual([v1.id]);
    const old = rules.versions.find((r: any) => r.id === v1.id);
    expect(old.validTo.slice(0, 10)).toBe('2026-06-30');
    const later = (await get(token, `/contracts/${contract.id}/charge-rules?at=2026-08-01`).expect(200)).body;
    expect(later.current.map((r: any) => r.id)).toEqual([v2.id]);

    // Una regla que todavía no se usó para facturar se corrige; con la misma fecha no se repite.
    await patch(token, `/contracts/${contract.id}/charge-rules/${v2.id}`, { tenantSharePct: '60' }).expect(200);
    const dup = await post(token, `/contracts/${contract.id}/charge-rules`, {
      serviceId: service.id,
      payer: 'Inquilino',
      validFrom: '2026-07-01',
      agreementId: v2.agreementId,
    }).expect(409);
    expect(dup.body.error).toBe('CHARGE_RULE_EXISTS');
  });

  it('CP-344 — un contrato borrador admite reglas sin acuerdo; el servicio debe ser de su propiedad', async () => {
    const { tokens } = await agency('bol-4');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token, { status: ContractStatus.Borrador });
    const service = await createService(token, contract.propertyId);
    const other = await post(token, '/properties', { title: 'Otra', type: PropertyType.Casa }).expect(201);
    const foreign = await createService(token, other.body.id);

    await post(token, `/contracts/${contract.id}/charge-rules`, {
      serviceId: service.id,
      payer: 'Inquilino',
      validFrom: '2026-01-01',
    }).expect(201);
    const notApplicable = await post(token, `/contracts/${contract.id}/charge-rules`, {
      serviceId: foreign.id,
      payer: 'Inquilino',
      validFrom: '2026-01-01',
    }).expect(400);
    expect(notApplicable.body.error).toBe('SERVICE_NOT_APPLICABLE');
  });

  // ─── Reparto ───

  it('CP-345 — el reparto por porcentaje, importe fijo y consumo da lo esperado', async () => {
    const { tokens } = await agency('bol-5');
    const token = tokens[UserRole.Admin];

    // Porcentaje: 50 % de 12345,67 = 6172,835 -> 6172,84.
    const byPct = await createContract(token);
    const pctService = await createService(token, byPct.propertyId);
    await addRule(token, byPct, pctService.id, { tenantSharePct: '50' });
    const pctBill = (
      await bulk(token, [{ serviceId: pctService.id, period: '2026-11', amount: '12345.67' }]).expect(200)
    ).body.results[0].billId;
    const pctAlloc = (await get(token, `/service-bills/${pctBill}/allocations`).expect(200)).body;
    expect(pctAlloc.stored.map((a: any) => [a.contractId, a.amount, a.payer])).toEqual([
      [byPct.id, '6172.84', 'Inmobiliaria'],
    ]);
    expect(pctAlloc.preview.allocations[0]).toMatchObject({ amount: '6172.84', chargePeriod: '2026-11-01' });

    // Importe fijo: nunca más que la boleta.
    const byFixed = await createContract(token);
    const fixedService = await createService(token, byFixed.propertyId, { serviceType: 'Gas' });
    await addRule(token, byFixed, fixedService.id, { splitMode: 'Fijo', fixedAmount: '5000.00' });
    const fixedRes = await bulk(token, [
      { serviceId: fixedService.id, period: '2026-11', amount: '4200.00' },
      { serviceId: fixedService.id, period: '2026-12', amount: '9000.00' },
    ]).expect(200);
    const amounts = await Promise.all(
      fixedRes.body.results.map(async (r: any) =>
        (await get(token, `/service-bills/${r.billId}/allocations`).expect(200)).body.stored[0].amount,
      ),
    );
    expect(amounts).toEqual(['4200', '5000']);

    // Consumo: un edificio con dos unidades; 100/200/300 sobre 1000 deja 166,67 + 333,33 (el resto, al propietario).
    const building = (await post(token, '/properties', { title: 'Edificio', type: PropertyType.Departamento }).expect(201)).body;
    const unitA = (
      await post(token, '/properties', { title: 'Unidad A', type: PropertyType.Departamento, parentPropertyId: building.id }).expect(201)
    ).body;
    const unitB = (
      await post(token, '/properties', { title: 'Unidad B', type: PropertyType.Departamento, parentPropertyId: building.id }).expect(201)
    ).body;
    const contractA = await createContract(token, {}, unitA.id);
    const contractB = await createContract(token, {}, unitB.id);
    const water = await createService(token, building.id, { serviceType: 'Agua' });
    await addRule(token, contractA, water.id, { splitMode: 'Consumo', payer: 'Propietario' });
    await addRule(token, contractB, water.id, { splitMode: 'Consumo', payer: 'Inmobiliaria' });
    const waterBill = (
      await bulk(token, [
        {
          serviceId: water.id,
          period: '2026-11',
          amount: '1000.00',
          consumption: '600',
          unitConsumptions: [
            { propertyId: unitA.id, consumption: '100' },
            { propertyId: unitB.id, consumption: '200' },
          ],
        },
      ]).expect(200)
    ).body.results[0].billId;
    const alloc = (await get(token, `/service-bills/${waterBill}/allocations`).expect(200)).body.stored;
    const byContract = Object.fromEntries(alloc.map((a: any) => [a.contractId, a.amount]));
    // 100/600 x 1000 = 166,666.. y 200/600 x 1000 = 333,333.. ; el resto (300) no se traslada.
    expect(byContract).toEqual({ [contractA.id]: '166.67', [contractB.id]: '333.33' });
  });

  it('CP-346 — un plan anual prorrateado reparte la boleta en 12 cuotas por mes de liquidación', async () => {
    const { tokens } = await agency('bol-6');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const tax = await createService(token, contract.propertyId, {
      serviceType: 'ImpuestoInmobiliario',
      billingFrequency: 'Anual',
      hasAnnualOption: true,
    });
    await addRule(token, contract, tax.id, { paymentPlan: 'Anual', annualRecovery: 'Prorrateado' });
    const bill = (
      await bulk(token, [{ serviceId: tax.id, period: '2026-01', amount: '1000.00', installmentLabel: '2026' }]).expect(200)
    ).body.results[0].billId;
    const alloc = (await get(token, `/service-bills/${bill}/allocations`).expect(200)).body.stored;
    expect(alloc).toHaveLength(12);
    expect(alloc.slice(0, 5).map((a: any) => a.amount)).toEqual(['83.34', '83.34', '83.34', '83.34', '83.33']);
    expect(alloc[11].chargePeriod.slice(0, 7)).toBe('2026-12');

    // Cada mes cobra su cuota; una liquidación atrasada junta las cuotas pendientes.
    await generate(token, 1, 2026);
    await generate(token, 2, 2026);
    await generate(token, 4, 2026);
    const taxLines = async (period: string) =>
      (await liquidaciones(token))
        .find((l) => l.period.startsWith(period))
        .lineItems.filter((l: any) => l.type === 'Impuesto');
    const jan = await taxLines('2026-01');
    expect(jan).toHaveLength(1);
    expect(jan[0]).toMatchObject({ amount: '83.34', beneficiary: 'Ente', commissionable: false });
    expect(jan[0].description).toBe('Impuesto inmobiliario 2026, cuota 1/12');
    expect((await taxLines('2026-02'))[0].description).toBe('Impuesto inmobiliario 2026, cuota 2/12');
    // Marzo no se generó: abril cobra las cuotas 3 y 4.
    expect((await taxLines('2026-04')).map((l: any) => l.description)).toEqual([
      'Impuesto inmobiliario 2026, cuota 3/12',
      'Impuesto inmobiliario 2026, cuota 4/12',
    ]);
  });

  it('CP-356 — las cuotas del plan anual se eligen por regla (1 a 12)', async () => {
    const { tokens } = await agency('bol-13');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const tax = await createService(token, contract.propertyId, { serviceType: 'Municipal', hasAnnualOption: true });
    const rule = await addRule(token, contract, tax.id, { paymentPlan: 'Anual', annualInstallments: 6 });
    expect(rule.annualInstallments).toBe(6);
    const bill = (
      await bulk(token, [{ serviceId: tax.id, period: '2026-01', amount: '1000.00', installmentLabel: '2026' }]).expect(200)
    ).body.results[0].billId;
    const alloc = (await get(token, `/service-bills/${bill}/allocations`).expect(200)).body.stored;
    expect(alloc.map((a: any) => a.amount)).toEqual(['166.67', '166.67', '166.67', '166.67', '166.66', '166.66']);
    expect(alloc.every((a: any) => a.installmentsTotal === 6)).toBe(true);

    const agreement = await post(token, `/contracts/${contract.id}/agreements`, {
      kind: 'CambioCargo',
      effectiveFrom: '2026-06-01T00:00:00.000Z',
    }).expect(201);
    for (const bad of [0, 13]) {
      await post(token, `/contracts/${contract.id}/charge-rules`, {
        serviceId: tax.id,
        payer: 'Inmobiliaria',
        validFrom: '2026-06-01',
        agreementId: agreement.body.id,
        annualInstallments: bad,
      }).expect(400);
    }
  });

  it('CP-357 — el descuento por pago anual va al inquilino, al locador o a la inmobiliaria', async () => {
    const { tokens } = await agency('bol-14');
    const token = tokens[UserRole.Admin];
    const run = async (beneficiary: string) => {
      const contract = await createContract(token);
      const tax = await createService(token, contract.propertyId, { serviceType: 'ImpuestoInmobiliario' });
      await addRule(token, contract, tax.id, {
        paymentPlan: 'Anual',
        annualRecovery: 'Unico',
        tenantSharePct: '50',
        annualDiscountBeneficiary: beneficiary,
      });
      await bulk(token, [
        { serviceId: tax.id, period: '2026-11', amount: '9000.00', nominalAmount: '10000.00', installmentLabel: '2026' },
      ]).expect(200);
      return contract.id as string;
    };
    const ids = {
      Inquilino: await run('Inquilino'),
      Locador: await run('Locador'),
      Inmobiliaria: await run('Inmobiliaria'),
    };
    await generate(token, 11, 2026);
    const items = await liquidaciones(token);
    const lines = (id: string) =>
      items
        .find((l) => l.contractId === id)
        .lineItems.filter((l: any) => l.type !== 'Alquiler')
        .map((l: any) => [l.type, l.amount, l.beneficiary, l.commissionable]);

    // Inquilino: 50 % de lo pagado (9000) = 4500. Los otros cobran 50 % de 10000 = 5000: 4500 al ente y 500 de diferencia.
    expect(lines(ids.Inquilino)).toEqual([['Impuesto', '4500', 'Ente', false]]);
    expect(lines(ids.Locador)).toEqual([
      ['Impuesto', '4500', 'Ente', false],
      ['Cargo', '500', 'Locador', false],
    ]);
    expect(lines(ids.Inmobiliaria)).toEqual([
      ['Impuesto', '4500', 'Ente', false],
      ['Cargo', '500', 'Inmobiliaria', false],
    ]);
    expect(items.find((l) => l.contractId === ids.Locador).total).toBe('305000');
    expect(await prisma.baseClient.serviceBillAllocation.count({ where: { billedAt: { not: null } } })).toBe(3);
  });

  it('CP-358 — las cuotas que quedan al terminar el contrato se cobran en la liquidación final o se descartan', async () => {
    const { tokens } = await agency('bol-15');
    const token = tokens[UserRole.Admin];
    const run = async (onEnd?: string) => {
      const contract = await createContract(token);
      await patch(token, `/contracts/${contract.id}`, { actualEndDate: '2026-03-31T00:00:00.000Z' }).expect(200);
      const tax = await createService(token, contract.propertyId, { serviceType: 'Municipal', hasAnnualOption: true });
      await addRule(token, contract, tax.id, {
        paymentPlan: 'Anual',
        ...(onEnd && { remainingInstallmentsOnEnd: onEnd }),
      });
      const bill = (
        await bulk(token, [{ serviceId: tax.id, period: '2026-01', amount: '1200.00', installmentLabel: '2026' }]).expect(200)
      ).body.results[0].billId;
      const res = (await get(token, `/service-bills/${bill}/allocations`).expect(200)).body;
      return { amounts: res.stored.map((a: any) => a.amount), warnings: res.preview.warnings };
    };

    const collect = await run();
    expect(collect.amounts).toEqual(['100', '100', '1000']);
    expect(collect.warnings[0]).toMatchObject({ code: 'CollectedInFinalLiquidation', collectedInstallments: 9 });

    const discard = await run('Descartar');
    expect(discard.amounts).toEqual(['100', '100', '100']);
    expect(discard.warnings[0]).toMatchObject({ code: 'AfterContractEnd', droppedInstallments: 9 });
  });

  // ─── Liquidación ───

  it('CP-347 — la liquidación suma una línea por regla de cada contrato, con su destino y sin comisión', async () => {
    const { tokens } = await agency('bol-7');
    const token = tokens[UserRole.Admin];

    const agencyPays = await createContract(token);
    const ownerPays = await createContract(token);
    const tenantPays = await createContract(token);
    const eAgency = await createService(token, agencyPays.propertyId);
    const eOwner = await createService(token, ownerPays.propertyId, { serviceType: 'Municipal' });
    const eTenant = await createService(token, tenantPays.propertyId);
    await addRule(token, agencyPays, eAgency.id, { payer: 'Inmobiliaria', tenantSharePct: '100' });
    await addRule(token, ownerPays, eOwner.id, { payer: 'Propietario', tenantSharePct: '100' });
    await addRule(token, tenantPays, eTenant.id, { payer: 'Inquilino' });
    await bulk(token, [
      { serviceId: eAgency.id, period: '2026-11', amount: '12500.00' },
      { serviceId: eOwner.id, period: '2026-11', amount: '4000.00' },
      { serviceId: eTenant.id, period: '2026-11', amount: '9999.00' },
    ]).expect(200);

    await generate(token, 11, 2026);
    const items = await liquidaciones(token);
    const of = (contractId: string) => items.find((l) => l.contractId === contractId);

    const a = of(agencyPays.id);
    const service = a.lineItems.find((l: any) => l.type === 'Servicio');
    expect(service).toMatchObject({
      amount: '12500',
      beneficiary: 'Ente',
      commissionable: false,
      sourceType: 'ServiceBillAllocation',
    });
    expect(a.total).toBe('312500');

    const o = of(ownerPays.id);
    const tax = o.lineItems.find((l: any) => l.type === 'Impuesto');
    expect(tax).toMatchObject({ amount: '4000', beneficiary: 'Locador', commissionable: false });
    expect(tax.description).toContain('por cuenta y orden del locador');
    expect(o.total).toBe('304000');

    // El inquilino que paga directo no tiene renglón: solo el alquiler.
    const t = of(tenantPays.id);
    expect(t.lineItems.map((l: any) => l.type)).toEqual(['Alquiler']);
    expect(t.total).toBe('300000');
  });

  it('CP-348 — cada parte se factura una sola vez; la boleta cargada tarde entra en la próxima', async () => {
    const { tokens } = await agency('bol-8');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const service = await createService(token, contract.propertyId);
    await addRule(token, contract, service.id, { payer: 'Inmobiliaria', tenantSharePct: '100' });
    await bulk(token, [{ serviceId: service.id, period: '2026-11', amount: '7000.00' }]).expect(200);

    // Dos generaciones simultáneas: una liquidación y un solo renglón.
    await Promise.all([
      post(token, '/liquidaciones/generate', { month: 11, year: 2026 }),
      post(token, '/liquidaciones/generate', { month: 11, year: 2026 }),
    ]);
    let items = await liquidaciones(token);
    expect(items).toHaveLength(1);
    expect(items[0].lineItems.filter((l: any) => l.type === 'Servicio')).toHaveLength(1);
    expect(await prisma.baseClient.serviceBillAllocation.count({ where: { billedAt: { not: null } } })).toBe(1);

    // Una boleta de noviembre cargada con la liquidación de noviembre ya hecha no la modifica...
    await bulk(token, [{ serviceId: service.id, period: '2026-11', installmentLabel: 'extra', amount: '1500.00' }]).expect(200);
    await generate(token, 11, 2026);
    items = await liquidaciones(token);
    expect(items).toHaveLength(1);
    expect(items[0].lineItems.filter((l: any) => l.type === 'Servicio')).toHaveLength(1);

    // ...y entra en la liquidación de diciembre, que no repite la de noviembre.
    await generate(token, 12, 2026);
    const dec = (await liquidaciones(token)).find((l) => l.period.startsWith('2026-12'));
    const lines = dec.lineItems.filter((l: any) => l.type === 'Servicio');
    expect(lines.map((l: any) => l.amount)).toEqual(['1500']);
    expect(dec.total).toBe('301500');

    // Una boleta ya facturada no se cambia.
    const billed = await get(token, '/service-bills?period=2026-11').expect(200);
    const first = billed.body.items.find((b: any) => b.installmentLabel === '11/2026');
    const blocked = await patch(token, `/service-bills/${first.id}`, { amount: '1.00' }).expect(409);
    expect(blocked.body.error).toBe('BILL_ALREADY_BILLED');
  });

  it('CP-349 — al borrar una liquidación en borrador, sus boletas vuelven a quedar pendientes', async () => {
    const { tokens } = await agency('bol-9');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const service = await createService(token, contract.propertyId);
    await addRule(token, contract, service.id, { payer: 'Inmobiliaria' });
    await bulk(token, [{ serviceId: service.id, period: '2026-11', amount: '7000.00' }]).expect(200);

    await generate(token, 11, 2026);
    const [liq] = await liquidaciones(token);
    await http().delete(`/api/liquidaciones/${liq.id}`).set(auth(token)).expect(200);
    expect(await prisma.baseClient.serviceBillAllocation.count({ where: { billedAt: null } })).toBe(1);

    await generate(token, 11, 2026);
    const [again] = await liquidaciones(token);
    expect(again.lineItems.filter((l: any) => l.type === 'Servicio')).toHaveLength(1);
  });

  // ─── Pago de la boleta ───

  it('CP-350 — registrar el pago de la boleta deja el pago ligado y exige quién pagó', async () => {
    const { tokens } = await agency('bol-10');
    const token = tokens[UserRole.Admin];
    const contract = await createContract(token);
    const service = await createService(token, contract.propertyId);
    const bill = (await bulk(token, [{ serviceId: service.id, period: '2026-11', amount: '7000.00' }]).expect(200)).body
      .results[0].billId;

    const missing = await patch(token, `/service-bills/${bill}`, { status: 'Pagada' }).expect(400);
    expect(missing.body.error).toBe('BILL_PAYMENT_DATA_REQUIRED');

    const paid = await patch(token, `/service-bills/${bill}`, {
      paidBy: 'Inmobiliaria',
      paidAt: '2026-11-08',
      receiptUrl: 'https://ejemplo.invalid/comprobante.pdf',
    }).expect(200);
    expect(paid.body).toMatchObject({ status: 'Pagada', paidBy: 'Inmobiliaria' });
    const payments = await prisma.baseClient.servicePayment.findMany({ where: { billId: bill } });
    expect(payments).toHaveLength(1);
    expect(payments[0].amount.toString()).toBe('7000');

    await patch(token, `/service-bills/${bill}`, { status: 'Pendiente' }).expect(200);
    expect(await prisma.baseClient.servicePayment.count({ where: { billId: bill } })).toBe(0);
  });

  // ─── Permisos y aislamiento ───

  it('CP-351 — solo la facturación escribe boletas y reglas; todos los roles leen', async () => {
    const { tokens } = await agency('bol-11');
    const admin = tokens[UserRole.Admin];
    const contract = await createContract(admin);
    const service = await createService(admin, contract.propertyId);
    const bill = (await bulk(admin, [{ serviceId: service.id, period: '2026-11', amount: '100.00' }]).expect(200)).body
      .results[0].billId;

    const writers = [UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones];
    for (const role of ALL_ROLES) {
      const token = tokens[role];
      const expected = writers.includes(role) ? 200 : 403;
      await bulk(token, [{ serviceId: service.id, period: '2026-11', amount: '100.00' }]).expect(expected);
      await patch(token, `/service-bills/${bill}`, { notes: 'x' }).expect(expected);
      await post(token, `/contracts/${contract.id}/charge-rules`, {}).expect(expected === 200 ? 400 : 403);
      await get(token, '/service-bills?period=2026-11').expect(200);
      await get(token, `/contracts/${contract.id}/charge-rules`).expect(200);
    }
  });

  it('CP-352 — una inmobiliaria no ve ni toca las boletas ni las reglas de otra', async () => {
    const a = await agency('bol-12a');
    const b = await agency('bol-12b');
    const tokenA = a.tokens[UserRole.Admin];
    const tokenB = b.tokens[UserRole.Admin];
    const contract = await createContract(tokenA);
    const service = await createService(tokenA, contract.propertyId);
    await addRule(tokenA, contract, service.id);
    const bill = (await bulk(tokenA, [{ serviceId: service.id, period: '2026-11', amount: '100.00' }]).expect(200)).body
      .results[0].billId;

    expect((await get(tokenB, '/service-bills?period=2026-11').expect(200)).body.total).toBe(0);
    await get(tokenB, `/service-bills/${bill}`).expect(404);
    await get(tokenB, `/service-bills/${bill}/allocations`).expect(404);
    await patch(tokenB, `/service-bills/${bill}`, { notes: 'x' }).expect(404);
    await get(tokenB, `/contracts/${contract.id}/charge-rules`).expect(404);
    await post(tokenB, `/contracts/${contract.id}/charge-rules`, {
      serviceId: service.id,
      payer: 'Inquilino',
      validFrom: '2026-01-01',
    }).expect(404);

    // La otra inmobiliaria no puede cargar boletas de un servicio ajeno.
    const res = await bulk(tokenB, [{ serviceId: service.id, period: '2026-11', amount: '100.00' }]).expect(200);
    expect(res.body.results[0]).toMatchObject({ status: 'error', error: { code: 'SERVICE_NOT_FOUND' } });
    expect((await get(tokenB, '/service-bills/sheet?period=2026-11').expect(200)).body.rows).toHaveLength(0);
  });
});
