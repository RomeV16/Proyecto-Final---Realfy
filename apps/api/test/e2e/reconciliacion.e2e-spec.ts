import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupTestApp, cleanDatabase, teardownTestApp, registerUser } from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  AdjustmentType,
  ChargeSplitMode,
  ContractType,
  PersonRole,
  PropertyType,
  RECONCILIATION_CYCLE as CYCLE,
  RECONCILIATION_EXPECTED,
  ServicePaymentPlan,
  compareReconciliation,
  contractConcepts,
  formatDifferences,
  statementConcepts,
  statementKey,
} from '@realfy/shared';
import type { CycleBill, CycleContract, ReconciliationResult } from '@realfy/shared';

/**
 * Reconciliación de punta a punta (CP-666 y CP-667): el ciclo sintético de julio
 * de 2026 del caso de caracterización (`packages/shared/src/reconciliation`) se
 * carga por la API como lo haría la inmobiliaria —índices, personas, unidades,
 * contratos, comisiones, ajustes, boletas con sus reglas, cargos, liquidaciones,
 * cobros, compensación, pagos a locadores y estados de cuenta— y el resultado que
 * devuelve la API se compara con el calculado a mano, con tolerancia cero.
 *
 * Las reglas que el alta por API no recibe (rezago, flujo de cobro, punitorio
 * pactado, escalones y bonificación) se fijan en la versión inicial de reglas
 * del contrato, como las deja la importación del sistema anterior.
 */
describe('Reconciliación del ciclo mensual (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
    await cleanDatabase(prisma);
  });

  afterAll(async () => {
    await cleanDatabase(prisma);
    await teardownTestApp();
  });

  const http = () => request(app.getHttpServer());
  let token = '';
  const auth = () => ({ Authorization: `Bearer ${token}` });
  const get = async (path: string) => (await http().get(`/api${path}`).set(auth()).expect(200)).body;
  const post = async (path: string, body: object | object[] = {}, status = 201) =>
    (await http().post(`/api${path}`).set(auth()).send(body).expect(status)).body;
  const iso = (day: string) => `${day}T00:00:00.000Z`;

  const lessorIds = new Map<string, string>();
  const contractIds = new Map<string, string>();
  const propertyIds = new Map<string, string>();
  const paymentIds = new Map<string, string>();
  const keyOfPerson = (id: string) => [...lessorIds].find(([, v]) => v === id)?.[0] ?? id;

  async function loadIndexes() {
    const rows = [
      ...Object.entries(CYCLE.indexes.IPC ?? {}).map(([m, value]) => ({ indexType: 'IPC', period: iso(`${m}-01`), value })),
      ...Object.entries(CYCLE.indexes.ICL ?? {}).map(([d, value]) => ({ indexType: 'ICL', period: iso(d), value })),
      ...Object.entries(CYCLE.indexes.TasaActivaBNA ?? {}).map(([m, value]) => ({
        indexType: 'TasaActivaBNA',
        period: iso(`${m}-01`),
        value,
      })),
    ];
    await post('/index-data/bulk', rows);
  }

  async function person(firstName: string, lastName: string, role?: PersonRole) {
    const id = (await post('/persons', { firstName, lastName })).id as string;
    if (role) await post(`/persons/${id}/roles`, { role });
    return id;
  }

  async function createContract(c: CycleContract, building: string | null) {
    const property = await post('/properties', {
      title: c.property,
      type: PropertyType.Departamento,
      ...(building ? { parentPropertyId: building } : {}),
    });
    propertyIds.set(c.key, property.id);
    if (c.lessors.length > 1) {
      // La titularidad es 50/50; el porcentaje de cobro, el pactado en el contrato.
      for (const l of c.lessors) await post(`/properties/${property.id}/ownerships`, { personId: lessorIds.get(l.lessor), sharePct: '50' });
    }
    const tenant = await person('Inquilino', `Sintético ${c.key}`, PersonRole.Inquilino);
    const contract = await post('/contracts', {
      propertyId: property.id,
      contractType: ContractType.Alquiler,
      status: 'Activo',
      startDate: iso(c.start),
      endDate: iso(c.end),
      rentAmount: c.rent,
      rentCurrency: c.currency,
      adjustmentType: c.adjustment.type,
      adjustmentPeriod: c.adjustment.period,
      ...(c.adjustment.customPct ? { customAdjustmentPct: c.adjustment.customPct } : {}),
      guarantees: [],
      persons: [{ personId: tenant, role: PersonRole.Inquilino }],
      lessors: c.lessors.map((l) => ({ personId: lessorIds.get(l.lessor), payoutPct: l.payoutPct })),
    });
    contractIds.set(c.key, contract.id);
    await prisma.baseClient.contractTermsVersion.updateMany({
      where: { contractId: contract.id },
      data: {
        indexLagMonths: c.adjustment.lagMonths,
        ...(c.paymentFlow ? { paymentFlow: c.paymentFlow } : {}),
        ...(c.penalty ? { penaltyConfig: c.penalty as object } : {}),
        ...(c.adjustment.steps ? { customSteps: c.adjustment.steps } : {}),
        ...(c.discountPct ? { discountPct: c.discountPct } : {}),
      },
    });
    if (c.commission) {
      await post(`/contracts/${contract.id}/commission`, {
        type: c.commission.type,
        ...(c.commission.percentage ? { percentage: c.commission.percentage } : {}),
        ...(c.commission.fixedAmount ? { fixedAmount: c.commission.fixedAmount, currency: c.currency } : {}),
        ...(c.commission.repairMgmtFeePct ? { repairMgmtFeePct: c.commission.repairMgmtFeePct } : {}),
      });
    }
  }

  async function applyAdjustments() {
    const byMonth = new Map<string, string[]>();
    for (const c of CYCLE.contracts) {
      for (const a of c.adjustments) {
        const month = a.date.slice(0, 7);
        byMonth.set(month, [...(byMonth.get(month) ?? []), contractIds.get(c.key)!]);
      }
    }
    for (const month of [...byMonth.keys()].sort((a, b) => a.localeCompare(b))) {
      const res = await post('/adjustments/apply-batch', { period: month, contractIds: byMonth.get(month) });
      expect(res.results.map((r: any) => r.result)).toEqual(byMonth.get(month)!.map(() => 'applied'));
    }
  }

  const liquidacionOf = async (contractKey: string, period: string) => {
    const list = (await get(`/liquidaciones?contractId=${contractIds.get(contractKey)}&limit=100`)).items as any[];
    return list.find((l) => String(l.period).startsWith(period));
  };

  async function send(id: string) {
    for (const status of ['Revision', 'Aprobada', 'Enviada']) {
      await http().post(`/api/liquidaciones/${id}/transition`).set(auth()).send({ status }).expect(200);
    }
  }

  async function pay(liquidacionId: string, body: Record<string, unknown>) {
    return (await http().post(`/api/liquidaciones/${liquidacionId}/payments`).set(auth()).send(body).expect(200)).body
      .registeredPayment;
  }

  /** Junio: solo la liquidación del contrato que se pagó tarde (origen del punitorio de julio). */
  async function previousMonth() {
    await post('/liquidaciones/generate', { month: 6, year: 2026 });
    for (const c of CYCLE.contracts) {
      const june = await liquidacionOf(c.key, '2026-06');
      if (!june) continue;
      if (!c.previousPaidAt) {
        await http().delete(`/api/liquidaciones/${june.id}`).set(auth()).expect(200);
        continue;
      }
      await send(june.id);
      await pay(june.id, { amount: june.total, method: 'Transferencia', paidAt: `${c.previousPaidAt}T12:00:00.000Z` });
    }
    for (const o of CYCLE.openingBalances) {
      await http()
        .post(`/api/owners/${lessorIds.get(o.lessor)}/opening-balance`)
        .set(auth())
        .send({ currency: o.currency, amount: o.amount, date: o.date, reason: 'Saldo del sistema anterior' })
        .expect(200);
    }
    // El estado de junio se emite: su cierre abre el de julio.
    await http().post('/api/owner-statements/generate?period=2026-06').set(auth()).expect(200);
    for (const s of (await get('/owner-statements?period=2026-06&limit=100')).items) {
      await http().post(`/api/owner-statements/${s.id}/issue`).set(auth()).expect(200);
    }
  }

  async function loadBill(bill: CycleBill) {
    // Una boleta que se reparte por consumo es del edificio que comparten las unidades.
    const host = bill.units ? buildingId : propertyIds.get(bill.property)!;
    const service = await post('/services', {
      propertyId: host,
      serviceType: bill.serviceType,
      providerName: `Ente ${bill.key}`,
      amount: Number(bill.amount),
      dueDay: 10,
      ...(bill.annual ? { billingFrequency: 'Anual', hasAnnualOption: true } : {}),
    });
    for (const rule of bill.rules) {
      const contractId = contractIds.get(rule.contract)!;
      const agreement = await post(`/contracts/${contractId}/agreements`, {
        kind: 'CambioCargo',
        effectiveFrom: iso('2026-07-01'),
        notes: 'Regla de traslado del contrato',
      });
      await post(`/contracts/${contractId}/charge-rules`, {
        serviceId: service.id,
        payer: rule.payer,
        splitMode: rule.splitMode ?? ChargeSplitMode.Porcentaje,
        tenantSharePct: rule.tenantSharePct ?? '100',
        paymentPlan: rule.paymentPlan ?? ServicePaymentPlan.Mensual,
        ...(rule.annualRecovery ? { annualRecovery: rule.annualRecovery } : {}),
        ...(rule.annualInstallments ? { annualInstallments: rule.annualInstallments } : {}),
        validFrom: '2026-07-01',
        agreementId: agreement.id,
      });
    }
    const loaded = await http()
      .post('/api/service-bills/bulk')
      .set(auth())
      .send([
        {
          serviceId: service.id,
          period: bill.period,
          amount: bill.amount,
          ...(bill.consumption ? { consumption: bill.consumption } : {}),
          ...(bill.units
            ? { unitConsumptions: bill.units.map((u) => ({ propertyId: propertyIds.get(u.contract), consumption: u.consumption })) }
            : {}),
        },
      ])
      .expect(200);
    expect(loaded.body.failed).toBe(0);
    if (bill.paidByAgency) {
      const [row] = (await get(`/service-bills?serviceId=${service.id}`)).items;
      await http()
        .patch(`/api/service-bills/${row.id}`)
        .set(auth())
        .send({ status: 'Pagada', paidBy: 'Inmobiliaria', paidAt: bill.paidByAgency })
        .expect(200);
    }
  }

  let buildingId = '';

  /** Lo que devuelve la API, en el formato de la reconciliación. */
  async function actualResult(): Promise<ReconciliationResult> {
    const contracts: ReconciliationResult['contracts'] = {};
    for (const c of CYCLE.contracts) {
      const id = contractIds.get(c.key)!;
      const liq = await get(`/liquidaciones/${(await liquidacionOf(c.key, CYCLE.period)).id}`);
      const contract = await get(`/contracts/${id}`);
      const adjustments = (await get(`/contracts/${id}/adjustments`)) as any[];
      const ofMonth = adjustments.find((a) => String(a.adjustmentDate).startsWith(CYCLE.period));
      const settlements = (liq.payments as any[]).map((p) => p.settlement);
      // Un cobro sin reparto no tiene con qué compararse: se informa con su motivo.
      for (const s of settlements) expect({ contract: c.key, error: s.error ?? null }).toEqual({ contract: c.key, error: null });
      contracts[c.key] = contractConcepts({
        lines: liq.lineItems.map((l: any) => ({ type: l.type, amount: String(l.amount), beneficiary: l.beneficiary })),
        total: String(liq.total),
        rent: { monthly: String(contract.rentAmount), adjustmentPct: ofMonth ? String(ofMonth.percentage) : null },
        buckets: settlements[0]?.buckets ?? null,
        payments: (liq.payments as any[]).map((p) => ({
          amount: String(p.amount),
          shares: p.settlement.positions.map((pos: any) => ({ lessor: keyOfPerson(pos.personId), share: pos.share })),
        })),
      });
    }
    const statements: ReconciliationResult['statements'] = {};
    for (const s of (await get(`/owner-statements?period=${CYCLE.period}&limit=100`)).items) {
      statements[statementKey(keyOfPerson(s.personId), s.currency)] = statementConcepts(s);
    }
    return { period: CYCLE.period, contracts, statements };
  }

  it('CP-666 y CP-667 — la API reproduce al centavo el recibo, la comisión y el neto de cada contrato y el estado de cada locador', async () => {
    token = (
      await registerUser(app, { email: 'admin@reconciliacion.test', password: 'Password123!', firstName: 'Admin', lastName: 'Prueba' })
    ).accessToken;

    await loadIndexes();
    for (const l of CYCLE.lessors) lessorIds.set(l.key, await person('Locador', l.name.replace('Locador ', '')));
    buildingId = (await post('/properties', { title: 'Edificio 1', type: PropertyType.Departamento })).id;
    const inBuilding = new Set(CYCLE.bills.flatMap((b) => (b.units ?? []).map((u) => u.contract)));
    for (const c of CYCLE.contracts) await createContract(c, inBuilding.has(c.key) ? buildingId : null);
    await applyAdjustments();
    await previousMonth();

    // Boletas, reglas y cargos del mes.
    for (const bill of CYCLE.bills) await loadBill(bill);
    for (const k of CYCLE.charges) {
      const charged = await post('/charges', {
        contractId: contractIds.get(k.contract),
        chargedTo: k.chargedTo,
        kind: k.kind,
        description: k.description,
        amount: k.amount,
        beneficiary: k.beneficiary,
        incurredAt: k.incurredAt,
      });
      // La reparación grande de C03 pide anticipo y no entra sola en la liquidación.
      expect(charged.items[0].requiresUpfront).toBe(k.key === 'K03');
    }

    // Liquidaciones de julio, enviadas, y los cobros del mes.
    const generated = await post('/liquidaciones/generate', { month: 7, year: 2026 });
    expect(generated).toMatchObject({ created: CYCLE.contracts.length, failed: 0 });
    for (const c of CYCLE.contracts) await send((await liquidacionOf(c.key, CYCLE.period)).id);
    for (const p of CYCLE.payments) {
      const liq = await liquidacionOf(p.contract, CYCLE.period);
      const payment = await pay(liq.id, {
        amount: p.amount,
        method: p.method,
        paidAt: `${p.date}T12:00:00.000Z`,
        ...(p.receivedBy ? { receivedBy: p.receivedBy } : {}),
        ...(p.inCustody ? { inCustody: true } : {}),
      });
      paymentIds.set(p.key, payment.id);
    }
    for (const comp of CYCLE.compensations) {
      await post('/compensations', {
        paymentId: paymentIds.get(comp.payment),
        fromLessorId: lessorIds.get(comp.from),
        toLessorId: lessorIds.get(comp.to),
        ...(comp.amount ? { amount: comp.amount } : {}),
      });
    }
    for (const payout of CYCLE.payouts) {
      const lessorId = lessorIds.get(payout.lessor);
      if (payout.kind === 'EntregaEfectivo') {
        const [custody] = (await get(`/financial-accounts?kind=Custodia&ownerPersonId=${lessorId}`)).items;
        await http()
          .post(`/api/custody/${custody.id}/deliver`)
          .set(auth())
          .send({ date: payout.date, amount: payout.amount })
          .expect(200);
        continue;
      }
      const banks = (await get('/financial-accounts?kind=Banco')).items as any[];
      const bank = banks.find((b) => b.currency === payout.currency);
      await post(`/owners/${lessorId}/payouts`, { accountId: bank.id, method: payout.kind, amount: payout.amount, date: payout.date });
    }
    await http().post(`/api/owner-statements/generate?period=${CYCLE.period}`).set(auth()).expect(200);

    const actual = await actualResult();
    expect(formatDifferences(compareReconciliation(RECONCILIATION_EXPECTED, actual))).toBe('');
    // La modalidad de cada contrato es la del caso (el resultado no depende de un valor por defecto).
    const types = await prisma.baseClient.contract.findMany({ select: { id: true, adjustmentType: true } });
    expect(new Set(types.map((t) => t.adjustmentType))).toEqual(
      new Set([AdjustmentType.IPC, AdjustmentType.ICL, AdjustmentType.FixedPercent, AdjustmentType.Escalonado]),
    );
  });
});
