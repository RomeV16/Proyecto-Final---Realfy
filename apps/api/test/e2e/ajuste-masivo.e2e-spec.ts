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
  AdjustmentType,
  AdjustmentPeriod,
} from '@realfy/shared';

const START = '2026-01-01T00:00:00.000Z';
const END = '2028-01-01T00:00:00.000Z';
const PASSWORD = 'Password123!';
const ALL_ROLES = Object.values(UserRole);
const BILLING = [UserRole.Admin, UserRole.Gerente, UserRole.Liquidaciones];
const PERIOD = '2026-04';

describe('Ajustes del mes: cron, aplicación masiva, provisorios y corrección (e2e)', () => {
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

  /** Contrato activo de $100.000, trimestral desde enero de 2026 (primer ajuste el 1 de abril). */
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
      startDate: START,
      endDate: END,
      rentAmount: '100000.00',
      adjustmentType: AdjustmentType.IPC,
      adjustmentPeriod: AdjustmentPeriod.Trimestral,
      guarantees: [],
      persons: [
        { personId: owner, role: PersonRole.Propietario },
        { personId: tenantPerson, role: PersonRole.Inquilino },
      ],
      ...extra,
    }).expect(201);
    await prisma.baseClient.contract.update({ where: { id: res.body.id }, data: { status: 'Activo' } });
    return res.body as any;
  }

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

  const previewRow = (body: any, contractId: string) => body.rows.find((r: any) => r.contractId === contractId);

  describe('previsualización', () => {
    it('CP-284 — lista el alquiler nuevo, el factor, los meses usados y los datos que faltan', async () => {
      const { tenantId, tokens } = await agency('prev-1');
      const admin = tokens[UserRole.Admin];
      // Rezago 2 (valor de la inmobiliaria): el ajuste de abril usa enero y febrero.
      await ipc(tenantId, '2026-01', '2.000000');
      await ipc(tenantId, '2026-02', '3.000000');
      const withData = await createContract(admin);
      const noData = await createContract(admin, { adjustmentType: AdjustmentType.CCP });
      const fixed = await createContract(admin, {
        adjustmentType: AdjustmentType.FixedPercent,
        customAdjustmentPct: '10.00',
      });

      const res = await post(admin, '/adjustments/preview-batch', { period: PERIOD }).expect(201);

      expect(res.body.period).toBe(PERIOD);
      expect(res.body.rows).toHaveLength(3);
      expect(previewRow(res.body, withData.id)).toMatchObject({
        status: 'ready',
        currentRent: '100000.00',
        newRent: '105060.00',
        factor: '1.050600',
        isProvisional: false,
        selectable: true,
        overdue: false,
      });
      expect(previewRow(res.body, withData.id).indexValues.map((v: any) => v.period)).toEqual(['2026-01', '2026-02']);
      expect(previewRow(res.body, fixed.id)).toMatchObject({ status: 'ready', newRent: '110000.00' });
      const missing = previewRow(res.body, noData.id);
      expect(missing).toMatchObject({ status: 'missing_data', selectable: false, newRent: null });
      expect(missing.missing.indexTypes).toEqual(['CVS', 'CER']);
      // Nada se escribió.
      expect(await prisma.baseClient.contractAdjustment.count()).toBe(0);
    });

    it('CP-285 — un mes sin publicar no se rellena: el contrato queda sin seleccionar con el mes que falta', async () => {
      const { tenantId, tokens } = await agency('prev-2');
      await ipc(tenantId, '2026-01', '2.000000');
      const contract = await createContract(tokens[UserRole.Admin]);

      const res = await post(tokens[UserRole.Admin], '/adjustments/preview-batch', { period: PERIOD }).expect(201);

      expect(previewRow(res.body, contract.id)).toMatchObject({
        status: 'missing_data',
        selectable: false,
        missing: { indexTypes: ['IPC'], missingPeriods: ['2026-02'], estimatesOnly: false },
      });
    });

    it('CP-286 — Admin, Gerente y Liquidaciones previsualizan y aplican; el resto recibe 403; el período se valida', async () => {
      const { tokens } = await agency('rbac-1');
      for (const role of ALL_ROLES) {
        const expected = BILLING.includes(role) ? 201 : 403;
        await post(tokens[role], '/adjustments/preview-batch', { period: PERIOD }).expect(expected);
        await post(tokens[role], '/adjustments/apply-batch', { period: PERIOD, contractIds: ['x'] }).expect(expected);
      }
      const bad = await post(tokens[UserRole.Admin], '/adjustments/preview-batch', { period: '2026-13' }).expect(400);
      expect(bad.body.error).toBe('VALIDATION_ERROR');
      await post(tokens[UserRole.Admin], '/adjustments/apply-batch', { period: PERIOD, contractIds: [] }).expect(400);
    });

    it('CP-287 — una inmobiliaria no ve ni aplica los ajustes de otra', async () => {
      const a = await agency('iso-a');
      const b = await agency('iso-b');
      await ipc(a.tenantId, '2026-01', '2.000000');
      await ipc(a.tenantId, '2026-02', '3.000000');
      const contract = await createContract(a.tokens[UserRole.Admin]);

      const preview = await post(b.tokens[UserRole.Admin], '/adjustments/preview-batch', { period: PERIOD }).expect(201);
      expect(preview.body.rows).toEqual([]);

      const apply = await post(b.tokens[UserRole.Admin], '/adjustments/apply-batch', {
        period: PERIOD,
        contractIds: [contract.id],
      }).expect(201);
      expect(apply.body.results).toEqual([
        expect.objectContaining({ contractId: contract.id, result: 'skipped', reason: 'CONTRACT_NOT_FOUND' }),
      ]);
      const untouched = await prisma.baseClient.contract.findUnique({ where: { id: contract.id } });
      expect(Number(untouched!.rentAmount)).toBe(100000);
    });
  });

  describe('aplicación masiva', () => {
    it('CP-288 — aplica los elegidos, saltea los que faltan, audita y no repite', async () => {
      const { tenantId, tokens } = await agency('apply-1');
      const liquidaciones = tokens[UserRole.Liquidaciones];
      await ipc(tenantId, '2026-01', '2.000000');
      await ipc(tenantId, '2026-02', '3.000000');
      const withData = await createContract(tokens[UserRole.Admin]);
      const noData = await createContract(tokens[UserRole.Admin], { adjustmentType: AdjustmentType.CCP });

      const res = await post(liquidaciones, '/adjustments/apply-batch', {
        period: PERIOD,
        contractIds: [withData.id, noData.id, withData.id],
      }).expect(201);

      expect(res.body.results).toHaveLength(2);
      expect(res.body.results[0]).toMatchObject({
        contractId: withData.id,
        result: 'applied',
        status: 'applied',
        previousRent: '100000',
        newRent: '105060',
      });
      expect(res.body.results[1]).toMatchObject({
        contractId: noData.id,
        result: 'skipped',
        reason: 'MISSING_INDEX_DATA',
        indexTypes: ['CVS', 'CER'],
      });

      const contract = await prisma.baseClient.contract.findUnique({ where: { id: withData.id } });
      expect(Number(contract!.rentAmount)).toBe(105060);
      const adjustment = await prisma.baseClient.contractAdjustment.findFirstOrThrow({
        where: { contractId: withData.id },
      });
      expect(adjustment).toMatchObject({ periodNumber: 1, isProvisional: false, trueUpOfId: null });
      expect(Number(adjustment.newAmount)).toBe(105060);
      const schedule = await prisma.baseClient.adjustmentSchedule.findFirstOrThrow({
        where: { contractId: withData.id, periodNumber: 1 },
      });
      expect(schedule.status).toBe('Applied');
      const untouched = await prisma.baseClient.contract.findUnique({ where: { id: noData.id } });
      expect(Number(untouched!.rentAmount)).toBe(100000);

      const audit = await prisma.baseClient.auditLog.findFirstOrThrow({
        where: { entity: 'adjustment_applied', entityId: withData.id },
      });
      expect(audit.userId).not.toBeNull();
      expect(audit.changes).toMatchObject({ source: 'batch', newRent: '105060', provisional: false });

      // El mismo mes otra vez: el contrato ya no tiene ajuste que vencer en abril.
      const again = await post(liquidaciones, '/adjustments/apply-batch', {
        period: PERIOD,
        contractIds: [withData.id],
      }).expect(201);
      expect(again.body.results[0]).toMatchObject({ result: 'skipped', reason: 'NO_DUE_ADJUSTMENT' });
    });
  });

  describe('series diarias con cobertura incompleta (DEF-120)', () => {
    const SYSTEM = '__system__';
    const iclDay = (day: string, value: string) =>
      prisma.baseClient.indexData.create({
        data: {
          tenantId: SYSTEM,
          indexType: 'ICL',
          period: new Date(`${day}T00:00:00.000Z`),
          value,
          source: 'bcra-v4-icl',
        },
      });

    it('CP-1227 — con la serie de sistema desde después del inicio de la ventana, previsualizar y aplicar informan los días que faltan', async () => {
      const { tokens } = await agency('cob-1');
      const admin = tokens[UserRole.Admin];
      // Rezago 2: el ajuste de abril usa del 1 de enero al 1 de febrero. La serie arranca el 15 de enero.
      await iclDay('2026-01-15', '1200');
      await iclDay('2026-02-01', '1210');
      const contract = await createContract(admin, { adjustmentType: AdjustmentType.ICL });

      const preview = await post(admin, '/adjustments/preview-batch', { period: PERIOD }).expect(201);
      expect(previewRow(preview.body, contract.id)).toMatchObject({
        status: 'missing_data',
        selectable: false,
        missing: { indexTypes: ['ICL'], missingPeriods: ['2026-01-01'] },
      });

      const applied = await post(admin, '/adjustments/apply-batch', {
        period: PERIOD,
        contractIds: [contract.id],
      }).expect(201);
      expect(applied.body.results[0]).toMatchObject({ result: 'skipped', reason: 'MISSING_INDEX_DATA' });
      const after = await prisma.baseClient.contract.findUnique({ where: { id: contract.id } });
      expect(Number(after!.rentAmount)).toBe(100000);
      expect(await prisma.baseClient.contractAdjustment.count()).toBe(0);
    });

    it('CP-1228 — con los dos extremos de la ventana en la serie de sistema el ajuste se calcula con ese cociente', async () => {
      const { tokens } = await agency('cob-2');
      const admin = tokens[UserRole.Admin];
      await iclDay('2026-01-01', '1000');
      await iclDay('2026-01-20', '1100');
      await iclDay('2026-02-01', '1050');
      const contract = await createContract(admin, { adjustmentType: AdjustmentType.ICL });

      const preview = await post(admin, '/adjustments/preview-batch', { period: PERIOD }).expect(201);

      expect(previewRow(preview.body, contract.id)).toMatchObject({ status: 'ready', newRent: '105000.00' });
      expect(previewRow(preview.body, contract.id).indexValues.map((v: any) => v.period)).toEqual([
        '2026-01-01',
        '2026-02-01',
      ]);
    });
  });

  describe('provisorio y corrección', () => {
    it('CP-289 — con el febrero estimado se aplica a cuenta y al publicarse el oficial se corrige', async () => {
      const { tenantId, tokens } = await agency('prov-1');
      const admin = tokens[UserRole.Admin];
      await ipc(tenantId, '2026-01', '2.000000');
      await ipc(tenantId, '2026-02', '2.500000', true);
      const contract = await createContract(admin);

      const preview = await post(admin, '/adjustments/preview-batch', { period: PERIOD }).expect(201);
      expect(previewRow(preview.body, contract.id)).toMatchObject({
        status: 'provisional',
        isProvisional: true,
        estimatedPeriods: ['2026-02'],
        newRent: '104550.00',
        selectable: true,
      });

      const applied = await post(admin, '/adjustments/apply-batch', {
        period: PERIOD,
        contractIds: [contract.id],
      }).expect(201);
      expect(applied.body.results[0]).toMatchObject({ status: 'provisional', estimatedPeriods: ['2026-02'] });
      const provisional = await prisma.baseClient.contractAdjustment.findFirstOrThrow({
        where: { contractId: contract.id },
      });
      expect(provisional.isProvisional).toBe(true);

      // Mientras el oficial no llega no hay corrección pendiente.
      const early = await post(admin, '/adjustments/_run-now').expect(201);
      expect(early.body.trueUps).toEqual([]);
      expect(early.body.trueUpsWaiting.map((w: any) => w.contractId)).toEqual([contract.id]);

      // Se publica el oficial de febrero: 2,8 % en lugar del 2,5 % estimado.
      await post(admin, '/index-data', {
        indexType: 'IPC',
        period: '2026-02-01T00:00:00.000Z',
        value: '2.800000',
        source: 'INDEC',
      }).expect(201);
      const run = await post(admin, '/adjustments/_run-now').expect(201);

      expect(run.body.trueUps).toHaveLength(1);
      expect(run.body.trueUps[0]).toMatchObject({
        contractId: contract.id,
        provisionalRent: '104550',
        officialRent: '104856',
        monthlyDelta: '306.00',
        rentUpdated: true,
      });
      const final = await prisma.baseClient.contractAdjustment.findFirstOrThrow({
        where: { contractId: contract.id, isProvisional: false },
      });
      expect(final.trueUpOfId).toBe(provisional.id);
      expect(Number(final.newAmount)).toBe(104856);
      const rent = await prisma.baseClient.contract.findUnique({ where: { id: contract.id } });
      expect(Number(rent!.rentAmount)).toBe(104856);
      expect(await prisma.baseClient.auditLog.count({ where: { entity: 'adjustment_trued_up' } })).toBe(1);

      // La diferencia retroactiva queda como dato para la liquidación.
      const pending = await get(admin, `/contracts/${contract.id}/adjustments?pendingTrueUp=true&upTo=2026-06`).expect(200);
      expect(pending.body).toHaveLength(1);
      expect(pending.body[0]).toMatchObject({
        adjustmentId: final.id,
        provisionalAdjustmentId: provisional.id,
        effectiveFrom: '2026-04',
        monthlyDelta: '306.00',
        total: '918.00',
      });
      expect(pending.body[0].months.map((m: any) => m.period)).toEqual(['2026-04', '2026-05', '2026-06']);

      // Una segunda pasada no corrige dos veces.
      const second = await post(admin, '/adjustments/_run-now').expect(201);
      expect(second.body.trueUps).toEqual([]);
      expect(await prisma.baseClient.contractAdjustment.count({ where: { trueUpOfId: { not: null } } })).toBe(1);
    });

    it('CP-290 — con el pago a cuenta apagado el estimado no alcanza: el contrato queda sin seleccionar', async () => {
      const { tenantId, tokens } = await agency('prov-2');
      const admin = tokens[UserRole.Admin];
      await http()
        .put('/api/tenants/me/operational-defaults')
        .set(auth(admin))
        .send({ allowProvisional: false })
        .expect(200);
      await ipc(tenantId, '2026-01', '2.000000');
      await ipc(tenantId, '2026-02', '2.500000', true);
      const contract = await createContract(admin);

      const preview = await post(admin, '/adjustments/preview-batch', { period: PERIOD }).expect(201);
      expect(previewRow(preview.body, contract.id)).toMatchObject({
        status: 'missing_data',
        selectable: false,
        missing: { missingPeriods: ['2026-02'], estimatesOnly: true },
      });

      const applied = await post(admin, '/adjustments/apply-batch', {
        period: PERIOD,
        contractIds: [contract.id],
      }).expect(201);
      expect(applied.body.results[0]).toMatchObject({ result: 'skipped', reason: 'MISSING_INDEX_DATA' });
      expect(await prisma.baseClient.contractAdjustment.count()).toBe(0);
    });
  });

  describe('cron', () => {
    it('CP-291 — _run-now aplica los vencidos, informa los que faltan de índice y solo lo corre el Admin', async () => {
      const { tokens } = await agency('cron-1');
      const admin = tokens[UserRole.Admin];
      const fixed = await createContract(admin, {
        adjustmentType: AdjustmentType.FixedPercent,
        customAdjustmentPct: '10.00',
      });
      const noData = await createContract(admin, { adjustmentType: AdjustmentType.CCP });

      for (const role of ALL_ROLES.filter((r) => r !== UserRole.Admin)) {
        await post(tokens[role], '/adjustments/_run-now').expect(403);
      }
      const run = await post(admin, '/adjustments/_run-now').expect(201);

      // Abril, julio y octubre de 2026 ya vencieron: 100.000 → 110.000 → 121.000 → 133.100.
      expect(run.body.applied.filter((a: any) => a.contractId === fixed.id)).toHaveLength(3);
      const rent = await prisma.baseClient.contract.findUnique({ where: { id: fixed.id } });
      expect(Number(rent!.rentAmount)).toBeCloseTo(133100, 2);
      expect(await prisma.baseClient.auditLog.count({ where: { entity: 'adjustment_applied', entityId: fixed.id } })).toBe(3);

      const skipped = run.body.skipped.filter((s: any) => s.contractId === noData.id);
      expect(skipped.length).toBeGreaterThan(0);
      expect(skipped[0]).toMatchObject({ reason: 'MISSING_INDEX_DATA', indexTypes: ['CVS', 'CER'] });
      const pendingSchedules = await prisma.baseClient.adjustmentSchedule.count({
        where: { contractId: noData.id, status: 'Pending', nextAdjustmentDate: { lte: new Date() } },
      });
      expect(pendingSchedules).toBeGreaterThan(0);
    });
  });

  // DEF-115: el lector diario guarda los índices bajo `__system__`. La
  // previsualización los veía y la aplicación (dentro de una transacción) no.
  describe('índices de sistema', () => {
    const SYSTEM = '__system__';

    /** IPC de sistema de 1 % para cada mes desde junio de 2025 hasta el mes en curso. */
    async function systemIpcUntilNow() {
      const now = new Date();
      for (let d = new Date(Date.UTC(2025, 5, 1)); d <= now; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
        await ipc(SYSTEM, d.toISOString().slice(0, 7), '1.000000');
      }
    }

    it('CP-1200 — con el IPC solo de sistema, lo que la previsualización da por listo se aplica', async () => {
      const { tokens } = await agency('sys-1');
      const admin = tokens[UserRole.Admin];
      await ipc(SYSTEM, '2026-01', '2.000000');
      await ipc(SYSTEM, '2026-02', '3.000000');
      const contract = await createContract(admin);

      const preview = await post(admin, '/adjustments/preview-batch', { period: PERIOD }).expect(201);
      expect(previewRow(preview.body, contract.id)).toMatchObject({ status: 'ready', newRent: '105060.00' });

      const applied = await post(admin, '/adjustments/apply-batch', {
        period: PERIOD,
        contractIds: [contract.id],
      }).expect(201);
      expect(applied.body.results[0]).toMatchObject({
        contractId: contract.id,
        result: 'applied',
        newRent: '105060',
      });
      const adjustment = await prisma.baseClient.contractAdjustment.findFirstOrThrow({
        where: { contractId: contract.id },
      });
      expect(Number(adjustment.newAmount)).toBe(105060);
      expect((adjustment.indexValues as any).observations.map((v: any) => v.period)).toEqual(['2026-01', '2026-02']);
      const rent = await prisma.baseClient.contract.findUnique({ where: { id: contract.id } });
      expect(Number(rent!.rentAmount)).toBe(105060);
    });

    it('CP-1201 — el barrido diario aplica todos los vencidos con el IPC de sistema', async () => {
      const { tokens } = await agency('sys-cron');
      const contract = await createContract(tokens[UserRole.Admin]);
      await systemIpcUntilNow();
      const due = await prisma.baseClient.adjustmentSchedule.count({
        where: { contractId: contract.id, status: 'Pending', nextAdjustmentDate: { lte: new Date() } },
      });
      expect(due).toBeGreaterThan(0);

      const run = await post(tokens[UserRole.Admin], '/adjustments/_run-now').expect(201);

      expect(run.body.skipped.filter((s: any) => s.contractId === contract.id)).toEqual([]);
      expect(run.body.applied.filter((a: any) => a.contractId === contract.id)).toHaveLength(due);
      const pending = await prisma.baseClient.adjustmentSchedule.count({
        where: { contractId: contract.id, status: 'Pending', nextAdjustmentDate: { lte: new Date() } },
      });
      expect(pending).toBe(0);
      const rent = await prisma.baseClient.contract.findUnique({ where: { id: contract.id } });
      expect(Number(rent!.rentAmount)).toBeGreaterThan(100000);
    });

    it('CP-1202 — el oficial publicado como dato de sistema corrige el provisorio', async () => {
      const { tenantId, tokens } = await agency('sys-trueup');
      const admin = tokens[UserRole.Admin];
      await ipc(tenantId, '2026-01', '2.000000');
      await ipc(tenantId, '2026-02', '2.500000', true);
      const contract = await createContract(admin);
      await post(admin, '/adjustments/apply-batch', { period: PERIOD, contractIds: [contract.id] }).expect(201);

      // El lector diario publica el oficial de febrero: 2,8 % en lugar del 2,5 % estimado.
      await ipc(SYSTEM, '2026-02', '2.800000');
      const run = await post(admin, '/adjustments/_run-now').expect(201);

      expect(run.body.trueUpsWaiting.filter((w: any) => w.contractId === contract.id)).toEqual([]);
      expect(run.body.trueUps).toEqual([
        expect.objectContaining({ contractId: contract.id, provisionalRent: '104550', officialRent: '104856' }),
      ]);
    });

    it('CP-1203 — cada inmobiliaria suma solo los de sistema: nunca los índices propios de otra', async () => {
      const a = await agency('sys-iso-a');
      const b = await agency('sys-iso-b');
      await ipc(SYSTEM, '2026-01', '2.000000');
      await ipc(SYSTEM, '2026-02', '3.000000');
      // B cargó a mano su propio IPC: para B le gana al de sistema; A no lo ve.
      await ipc(b.tenantId, '2026-01', '10.000000');
      await ipc(b.tenantId, '2026-02', '10.000000');
      const contractA = await createContract(a.tokens[UserRole.Admin]);
      const contractB = await createContract(b.tokens[UserRole.Admin]);

      const applyA = await post(a.tokens[UserRole.Admin], '/adjustments/apply-batch', {
        period: PERIOD,
        contractIds: [contractA.id],
      }).expect(201);
      const applyB = await post(b.tokens[UserRole.Admin], '/adjustments/apply-batch', {
        period: PERIOD,
        contractIds: [contractB.id],
      }).expect(201);

      expect(applyA.body.results[0]).toMatchObject({ result: 'applied', newRent: '105060' });
      expect(applyB.body.results[0]).toMatchObject({ result: 'applied', newRent: '121000' });
    });
  });
});
