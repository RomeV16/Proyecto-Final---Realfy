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

/**
 * La liquidación de un mes lleva el ajuste que rige desde el día 1 de ese mes,
 * aunque se genere antes (≈ el 20 del mes anterior). Contrato sintético: IPC
 * trimestral desde el 1/9/2026, $100.000, rezago 2 (valor de la inmobiliaria):
 * el ajuste del 1/12 usa septiembre y octubre.
 */
describe('El ajuste del mes en la liquidación (e2e)', () => {
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

  async function createContract(token: string, extra: Record<string, unknown> = {}) {
    const owner = (await post(token, '/persons', { firstName: 'Ana', lastName: 'Sintética' }).expect(201)).body.id;
    const tenantPerson = (await post(token, '/persons', { firstName: 'Ines', lastName: 'Sintética' }).expect(201))
      .body.id;
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = await post(token, '/properties', {
      title: `Unidad ${Math.random().toString(36).slice(2, 7)}`,
      type: PropertyType.Departamento,
    }).expect(201);
    const res = await post(token, '/contracts', {
      propertyId: property.body.id,
      contractType: ContractType.Alquiler,
      status: ContractStatus.Activo,
      startDate: '2026-09-01T00:00:00.000Z',
      endDate: '2028-08-31T00:00:00.000Z',
      rentAmount: '100000.00',
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

  /** IPC propio de la inmobiliaria: no depende de cómo se leen los índices de sistema. */
  const ipc = (tenantId: string, month: string, value: string, isEstimate = false) =>
    prisma.baseClient.indexData.create({
      data: {
        tenantId,
        indexType: 'IPC',
        period: new Date(`${month}-01T00:00:00.000Z`),
        value,
        source: 'INDEC',
        isEstimate,
        estimateSource: isEstimate ? 'REM' : null,
      },
    });

  const generate = (token: string, month: number, year: number) =>
    post(token, '/liquidaciones/generate', { month, year }).expect(201);

  async function liquidacionOf(token: string, contractId: string, period: string) {
    const items = (await get(token, `/liquidaciones?contractId=${contractId}&limit=100`).expect(200)).body
      .items as any[];
    const found = items.find((l) => String(l.period).startsWith(period));
    return found ? (await get(token, `/liquidaciones/${found.id}`).expect(200)).body : undefined;
  }

  const rentLines = (liq: any) => liq.lineItems.filter((l: any) => l.type === 'Alquiler');

  describe('el ajuste que vence en el mes se aplica antes de liquidarlo (DEF-130)', () => {
    it('CP-1260 — generar diciembre con el IPC de septiembre y octubre aplica el ajuste del 1/12 y liquida 105.060', async () => {
      const { tenantId, tokens } = await agency('d5-gen-1');
      const token = tokens[UserRole.Liquidaciones];
      await ipc(tenantId, '2026-09', '2.000000');
      await ipc(tenantId, '2026-10', '3.000000');
      const contract = await createContract(tokens[UserRole.Admin]);

      const res = await generate(token, 12, 2026);

      expect(res.body.created).toBe(1);
      expect(res.body.adjustments.applied).toEqual([
        expect.objectContaining({ contractId: contract.id, appliedPeriod: '2026-12', newRent: '105060' }),
      ]);
      expect(res.body.adjustments.pending).toEqual([]);
      const dec = await liquidacionOf(token, contract.id, '2026-12');
      expect(dec).toMatchObject({ total: '105060', isProvisional: false });
      expect(rentLines(dec).map((l: any) => l.amount)).toEqual(['105060']);
      const schedule = await prisma.baseClient.adjustmentSchedule.findFirstOrThrow({
        where: { contractId: contract.id, periodNumber: 1 },
      });
      expect(schedule.status).toBe('Applied');
      // Noviembre ya generado no cambia: el ajuste rige desde diciembre.
      await generate(token, 11, 2026);
      expect((await liquidacionOf(token, contract.id, '2026-11')).total).toBe('100000');
    });

    it('CP-1261 — el proceso diario del 21/11 genera diciembre con el ajuste del 1/12', async () => {
      const { tenantId, tokens } = await agency('d5-gen-2');
      await ipc(tenantId, '2026-09', '2.000000');
      await ipc(tenantId, '2026-10', '3.000000');
      const contract = await createContract(tokens[UserRole.Admin]);

      const run = await post(tokens[UserRole.Admin], '/liquidaciones/_run-now', { today: '2026-11-21' }).expect(200);

      expect(run.body.created).toBe(1);
      const dec = await liquidacionOf(tokens[UserRole.Admin], contract.id, '2026-12');
      expect(dec.total).toBe('105060');
      const audit = await prisma.baseClient.auditLog.findFirstOrThrow({
        where: { entity: 'adjustment_applied', entityId: contract.id },
      });
      expect(audit.changes).toMatchObject({ source: 'generation', appliedPeriod: '2026-12', newRent: '105060' });
    });
  });

  describe('sin el índice del ajuste la liquidación queda bloqueada (DEF-132)', () => {
    const transition = (token: string, id: string, status: string) =>
      post(token, `/liquidaciones/${id}/transition`, { status });

    it('CP-1263 — sin el IPC de octubre, diciembre sale con la advertencia ADJUSTMENT_PENDING y no se puede aprobar', async () => {
      const { tenantId, tokens } = await agency('d5-pend-1');
      const admin = tokens[UserRole.Admin];
      await ipc(tenantId, '2026-09', '2.000000');
      const contract = await createContract(admin);

      const res = await generate(admin, 12, 2026);

      expect(res.body).toMatchObject({ created: 1, adjustmentPending: 1 });
      expect(res.body.adjustments.applied).toEqual([]);
      expect(res.body.adjustments.pending).toEqual([
        expect.objectContaining({
          contractId: contract.id,
          appliedPeriod: '2026-12',
          reason: 'MISSING_INDEX_DATA',
          missingPeriods: ['2026-10'],
        }),
      ]);
      expect(res.body.results[0]).toMatchObject({ status: 'created', warnings: ['ADJUSTMENT_PENDING'] });

      const dec = await liquidacionOf(admin, contract.id, '2026-12');
      expect(dec.total).toBe('100000');
      expect(dec.warnings).toEqual([
        { code: 'ADJUSTMENT_PENDING', adjustmentDate: '2026-12-01', scheduleId: expect.any(String) },
      ]);
      const listed = (await get(admin, `/liquidaciones?contractId=${contract.id}`).expect(200)).body.items[0];
      expect(listed.warnings.map((w: any) => w.code)).toEqual(['ADJUSTMENT_PENDING']);

      // Se puede pasar a revisión, pero no aprobar (ni en lote) mientras el ajuste siga pendiente.
      await transition(admin, dec.id, 'Revision').expect(200);
      const blocked = await transition(admin, dec.id, 'Aprobada').expect(409);
      expect(blocked.body).toMatchObject({ error: 'ADJUSTMENT_PENDING', adjustmentDate: '2026-12-01' });
      const bulk = await post(admin, '/liquidaciones/bulk-approve', { ids: [dec.id] }).expect(201);
      expect(bulk.body).toMatchObject({ processed: 0, failed: 1 });
      const still = await liquidacionOf(admin, contract.id, '2026-12');
      expect(still).toMatchObject({ status: 'Revision', receiptNumber: null });
    });

    it('CP-1264 — con octubre estimado rige el pago a cuenta de ADR-0011; con el pago a cuenta apagado queda bloqueada', async () => {
      const { tenantId, tokens } = await agency('d5-pend-2');
      const admin = tokens[UserRole.Admin];
      await ipc(tenantId, '2026-09', '2.000000');
      await ipc(tenantId, '2026-10', '2.500000', true);
      const provisional = await createContract(admin);

      await generate(admin, 12, 2026);
      const dec = await liquidacionOf(admin, provisional.id, '2026-12');
      expect(dec).toMatchObject({ total: '104550', isProvisional: true, kind: 'PagoACuenta', warnings: [] });

      const other = await agency('d5-pend-3');
      await http()
        .put('/api/tenants/me/operational-defaults')
        .set(auth(other.tokens[UserRole.Admin]))
        .send({ allowProvisional: false })
        .expect(200);
      await ipc(other.tenantId, '2026-09', '2.000000');
      await ipc(other.tenantId, '2026-10', '2.500000', true);
      const blocked = await createContract(other.tokens[UserRole.Admin]);
      const res = await generate(other.tokens[UserRole.Admin], 12, 2026);
      expect(res.body.adjustments.pending[0]).toMatchObject({ contractId: blocked.id, reason: 'MISSING_INDEX_DATA' });
      const otherDec = await liquidacionOf(other.tokens[UserRole.Admin], blocked.id, '2026-12');
      expect(otherDec).toMatchObject({ total: '100000', isProvisional: false });
      expect(otherDec.warnings.map((w: any) => w.code)).toEqual(['ADJUSTMENT_PENDING']);
    });

    it('CP-1265 — un ajuste a mitad de mes con DesdePeriodoSiguiente no bloquea ese mes sino el siguiente', async () => {
      const { tokens } = await agency('d5-pend-4');
      const admin = tokens[UserRole.Admin];
      // Sin índices: el ajuste del 15/12 queda pendiente; rige desde enero.
      const contract = await createContract(admin, {
        startDate: '2026-09-15T00:00:00.000Z',
        endDate: '2028-09-14T00:00:00.000Z',
      });

      await generate(admin, 12, 2026);
      const dec = await liquidacionOf(admin, contract.id, '2026-12');
      expect(dec.warnings).toEqual([]);
      await transition(admin, dec.id, 'Revision').expect(200);
      await transition(admin, dec.id, 'Aprobada').expect(200);

      await generate(admin, 1, 2027);
      const jan = await liquidacionOf(admin, contract.id, '2027-01');
      expect(jan.warnings).toEqual([
        { code: 'ADJUSTMENT_PENDING', adjustmentDate: '2026-12-15', scheduleId: expect.any(String) },
      ]);
    });
  });

  describe('un ajuste aplicado después recalcula los borradores (DEF-133)', () => {
    /** Diciembre generado sin el IPC de octubre, con un cargo cargado a mano. */
    async function draftWithoutAdjustment(tag: string) {
      const { tenantId, tokens } = await agency(tag);
      const admin = tokens[UserRole.Admin];
      await ipc(tenantId, '2026-09', '2.000000');
      const contract = await createContract(admin);
      await generate(admin, 12, 2026);
      const dec = await liquidacionOf(admin, contract.id, '2026-12');
      expect(dec.total).toBe('100000');
      await post(admin, `/liquidaciones/${dec.id}/line-items`, {
        type: 'Cargo',
        description: 'Reposición de llave',
        amount: '5000.00',
      }).expect(201);
      return { tenantId, tokens, admin, contract, dec };
    }

    const expectRefreshed = async (token: string, contractId: string, id: string) => {
      const after = await liquidacionOf(token, contractId, '2026-12');
      expect(after.id).toBe(id);
      expect(after).toMatchObject({ status: 'Borrador', total: '110060', subtotal: '110060', warnings: [] });
      expect(rentLines(after).map((l: any) => l.amount)).toEqual(['105060']);
      // El cargo cargado a mano sigue; ningún renglón retroactivo sobre un borrador.
      expect(after.lineItems.map((l: any) => [l.type, l.amount])).toEqual([
        ['Alquiler', '105060'],
        ['Cargo', '5000'],
      ]);
      return after;
    };

    it('CP-1266 — aplicar el ajuste desde Ajustes del mes recalcula el borrador de diciembre y conserva lo cargado a mano', async () => {
      const { tenantId, admin, contract, dec } = await draftWithoutAdjustment('d5-ref-1');
      await ipc(tenantId, '2026-10', '3.000000');

      const applied = await post(admin, '/adjustments/apply-batch', {
        period: '2026-12',
        contractIds: [contract.id],
      }).expect(201);
      expect(applied.body.results[0]).toMatchObject({ result: 'applied', newRent: '105060' });

      await expectRefreshed(admin, contract.id, dec.id);
      const audit = await prisma.baseClient.auditLog.findFirstOrThrow({
        where: { entity: 'Liquidacion', entityId: dec.id },
        orderBy: { createdAt: 'desc' },
      });
      expect(audit.changes).toMatchObject({ operation: 'refresh-after-adjustment', adjustmentDate: '2026-12-01' });
      // Ya se puede aprobar.
      await post(admin, `/liquidaciones/${dec.id}/transition`, { status: 'Revision' }).expect(200);
      await post(admin, `/liquidaciones/${dec.id}/transition`, { status: 'Aprobada' }).expect(200);
    });

    it('CP-1267 — la corrida diaria siguiente, con el índice ya publicado, aplica el ajuste y recalcula el borrador', async () => {
      const { tenantId, admin, contract, dec } = await draftWithoutAdjustment('d5-ref-2');
      await ipc(tenantId, '2026-10', '3.000000');

      await post(admin, '/liquidaciones/_run-now', { today: '2026-11-22' }).expect(200);

      await expectRefreshed(admin, contract.id, dec.id);
    });

    it('CP-1268 — calcular y aplicar el ajuste desde el contrato también recalcula el borrador', async () => {
      const { tenantId, admin, contract, dec } = await draftWithoutAdjustment('d5-ref-3');
      await ipc(tenantId, '2026-10', '3.000000');
      const schedule = await prisma.baseClient.adjustmentSchedule.findFirstOrThrow({
        where: { contractId: contract.id, periodNumber: 1 },
      });

      const calc = await post(admin, `/contracts/${contract.id}/adjustments/calculate`, {
        scheduleId: schedule.id,
      }).expect(201);
      // Calculado pero sin aplicar: sigue bloqueada.
      expect((await liquidacionOf(admin, contract.id, '2026-12')).warnings.map((w: any) => w.code)).toEqual([
        'ADJUSTMENT_PENDING',
      ]);
      await post(admin, `/contracts/${contract.id}/adjustments/${calc.body.id}/apply`).expect(201);

      await expectRefreshed(admin, contract.id, dec.id);
    });
  });

  describe('un ajuste aplicado después de emitir la liquidación del mes no se pierde (DEF-134)', () => {
    /**
     * Diciembre generado sin el IPC de octubre y ya emitido con el alquiler anterior (como
     * quedó antes de esta corrección, o si el cronograma se corrige después de emitir).
     * Después se publica octubre y se aplica el ajuste del 1/12.
     */
    async function emittedThenAdjusted(tag: string, opts: { tenantDefault?: string; contractRule?: string } = {}) {
      const { tenantId, tokens } = await agency(tag);
      const admin = tokens[UserRole.Admin];
      if (opts.tenantDefault) {
        await http()
          .put('/api/tenants/me/operational-defaults')
          .set(auth(admin))
          .send({ lateAdjustmentBilling: opts.tenantDefault })
          .expect(200);
      }
      await ipc(tenantId, '2026-09', '2.000000');
      const contract = await createContract(
        admin,
        opts.contractRule ? { liquidationRules: { lateAdjustmentBilling: opts.contractRule } } : {},
      );
      await generate(admin, 12, 2026);
      const dec = await liquidacionOf(admin, contract.id, '2026-12');
      await prisma.baseClient.liquidacion.update({ where: { id: dec.id }, data: { status: 'Enviada', receiptSeq: 1 } });
      await ipc(tenantId, '2026-10', '3.000000');
      const applied = await post(admin, '/adjustments/apply-batch', {
        period: '2026-12',
        contractIds: [contract.id],
      }).expect(201);
      expect(applied.body.results[0]).toMatchObject({ result: 'applied', newRent: '105060' });
      // La emitida no se toca.
      expect((await liquidacionOf(admin, contract.id, '2026-12')).total).toBe('100000');
      return { admin, contract, dec };
    }

    it('CP-1269 — la diferencia de diciembre queda como cargo AjusteRetroactivo y entra en enero, con comisión', async () => {
      const { admin, contract, dec } = await emittedThenAdjusted('d5-late-1');

      const charges = (await get(admin, `/charges?contractId=${contract.id}`).expect(200)).body.items;
      expect(charges).toEqual([
        expect.objectContaining({
          kind: 'AjusteRetroactivo',
          chargedTo: 'Inquilino',
          amount: '5060',
          status: 'Pendiente',
          sourceType: 'ContractAdjustment',
        }),
      ]);
      expect(charges[0].description).toContain('2026-12');

      await generate(admin, 1, 2027);
      const jan = await liquidacionOf(admin, contract.id, '2027-01');
      expect(jan.lineItems.map((l: any) => [l.type, l.amount])).toEqual([
        ['Alquiler', '105060'],
        ['AjusteRetroactivo', '5060'],
      ]);
      expect(jan.total).toBe('110120');
      expect(jan.lineItems[1]).toMatchObject({ commissionable: true, beneficiary: 'Locador', sourceType: 'PendingCharge' });
      const charge = (await get(admin, `/charges?contractId=${contract.id}`).expect(200)).body.items[0];
      expect(charge).toMatchObject({ status: 'Imputado', imputedLiquidacionId: jan.id });
      // Diciembre sigue como se emitió.
      expect((await get(admin, `/liquidaciones/${dec.id}`).expect(200)).body.total).toBe('100000');
    });

    it('CP-1270 — con la convención SinRetroactivo de la inmobiliaria el ajuste rige desde enero y no hay cargo', async () => {
      const { admin, contract } = await emittedThenAdjusted('d5-late-2', { tenantDefault: 'SinRetroactivo' });

      expect((await get(admin, `/charges?contractId=${contract.id}`).expect(200)).body.items).toEqual([]);
      await generate(admin, 1, 2027);
      const jan = await liquidacionOf(admin, contract.id, '2027-01');
      expect(jan.lineItems.map((l: any) => [l.type, l.amount])).toEqual([['Alquiler', '105060']]);
    });

    it('CP-1271 — la convención es pactable por contrato: Retroactivo pactado pisa el SinRetroactivo de la inmobiliaria', async () => {
      const { admin, contract } = await emittedThenAdjusted('d5-late-3', {
        tenantDefault: 'SinRetroactivo',
        contractRule: 'Retroactivo',
      });

      const rules = (await get(admin, `/contracts/${contract.id}/terms`).expect(200)).body;
      expect(JSON.stringify(rules)).toContain('"lateAdjustmentBilling":"Retroactivo"');
      const charges = (await get(admin, `/charges?contractId=${contract.id}`).expect(200)).body.items;
      expect(charges.map((c: any) => [c.kind, c.amount])).toEqual([['AjusteRetroactivo', '5060']]);
    });
  });
});
