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

/**
 * Punitorios en la liquidación (ítem 35, FB-07): línea Multa en la liquidación
 * siguiente, cobro con punitorios al instante, monto a pagar y condonación.
 * La regla de la inmobiliaria es de monto fijo (100 por día) para que las
 * cifras no dependan de la fecha de la corrida.
 */
describe('Punitorios en la liquidación (e2e)', () => {
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
    for (const role of [UserRole.Gerente, UserRole.Lectura]) {
      const email = `${role.toLowerCase()}@${tag}.test`;
      await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    const token = tokens[UserRole.Admin];
    await http()
      .put('/api/tenants/me/penalty-config')
      .set(auth(token))
      .send({ mode: 'daily_fixed', value: '100', graceDays: 0, maxMultiplier: '1000' })
      .expect(200);
    return { tenantId: admin.user.tenantId as string, tokens, token };
  }

  async function createContract(token: string, extra: Record<string, unknown> = {}) {
    const owner = (await post(token, '/persons', { firstName: 'Ana', lastName: 'Sintética' }).expect(201)).body.id;
    const tenantPerson = (await post(token, '/persons', { firstName: 'Ines', lastName: 'Sintética' }).expect(201)).body.id;
    await post(token, `/persons/${tenantPerson}/roles`, { role: PersonRole.Inquilino }).expect(201);
    const property = await post(token, '/properties', { title: 'Unidad de prueba', type: PropertyType.Departamento }).expect(201);
    const res = await post(token, '/contracts', {
      propertyId: property.body.id,
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

  const generate = (token: string, month: number, year: number) =>
    post(token, '/liquidaciones/generate', { month, year }).expect(201);

  const liquidaciones = async (token: string) =>
    (await get(token, '/liquidaciones?limit=100').expect(200)).body.items as any[];

  const byMonth = async (token: string, month: string) =>
    (await liquidaciones(token)).find((l) => l.period.startsWith(month));

  /** Genera enero de 2026 y la deja Enviada: vence el 10 de enero. */
  async function enviadaDeEnero(token: string) {
    const contract = await createContract(token);
    await generate(token, 1, 2026);
    const jan = await byMonth(token, '2026-01');
    for (const status of ['Revision', 'Aprobada', 'Enviada']) {
      await post(token, `/liquidaciones/${jan.id}/transition`, { status }).expect(200);
    }
    return { contract, jan };
  }

  describe('Multa en la liquidación siguiente', () => {
    it('CP-360 — los punitorios devengados entran como renglón Multa de la liquidación siguiente, una sola vez', async () => {
      const { token } = await agency('pun-1');
      const { jan } = await enviadaDeEnero(token);

      await post(token, '/penalties/_run-now').expect(201);
      const rows = await prisma.baseClient.penalty.findMany({ where: { liquidacionId: jan.id } });
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const accrued = rows.reduce((acc, r) => acc + Number(r.amount), 0);
      expect(accrued).toBeGreaterThan(0);

      await generate(token, 2, 2026);
      const feb = await byMonth(token, '2026-02');
      const multa = feb.lineItems.find((l: any) => l.type === 'Multa');
      expect(multa).toMatchObject({
        sourceType: 'Penalty',
        sourceId: jan.id,
        commissionable: true,
        beneficiary: 'Locador',
      });
      expect(Number(multa.amount)).toBeCloseTo(accrued, 2);
      expect(Number(feb.total)).toBeCloseTo(300000 + accrued, 2);

      const marked = await prisma.baseClient.penalty.findMany({ where: { liquidacionId: jan.id } });
      expect(marked.every((r) => r.settledLiquidacionId === feb.id)).toBe(true);

      // Generar otra vez no duplica el renglón ni cobra de nuevo.
      await generate(token, 2, 2026);
      expect((await liquidaciones(token)).filter((l) => l.period.startsWith('2026-02'))).toHaveLength(1);

      // La corrida siguiente del cron no vuelve a devengar lo ya registrado.
      const again = await post(token, '/penalties/_run-now').expect(201);
      expect(again.body.penaltiesInserted).toBe(0);
    });

    it('CP-361 — borrar el borrador libera los punitorios para la próxima generación', async () => {
      const { token } = await agency('pun-2');
      const { jan } = await enviadaDeEnero(token);
      await post(token, '/penalties/_run-now').expect(201);
      await generate(token, 2, 2026);
      const feb = await byMonth(token, '2026-02');

      await http().delete(`/api/liquidaciones/${feb.id}`).set(auth(token)).expect(200);
      const released = await prisma.baseClient.penalty.findMany({ where: { liquidacionId: jan.id } });
      expect(released.every((r) => r.settledLiquidacionId === null)).toBe(true);

      await generate(token, 2, 2026);
      const again = await byMonth(token, '2026-02');
      expect(again.lineItems.some((l: any) => l.type === 'Multa')).toBe(true);
    });

    it('CP-362 — un punitorio condonado no entra en la liquidación siguiente y la condonación queda auditada', async () => {
      const { token, tenantId } = await agency('pun-3');
      const { jan } = await enviadaDeEnero(token);
      await post(token, '/penalties/_run-now').expect(201);
      const [row] = await prisma.baseClient.penalty.findMany({ where: { liquidacionId: jan.id } });

      const waived = await post(token, `/penalties/${row.id}/waive`, { reason: 'acuerdo con el locador' }).expect(201);
      expect(waived.body).toMatchObject({ status: 'waived', waiveReason: 'acuerdo con el locador' });

      const log = await prisma.baseClient.auditLog.findFirst({
        where: { tenantId, entity: 'Penalty', entityId: row.id, action: 'UPDATE' },
      });
      expect((log?.changes as any)?.reason).toBe('acuerdo con el locador');

      await post(token, `/penalties/${row.id}/waive`, { reason: 'otra vez' }).expect(409);
      await post(token, `/penalties/${row.id}/waive`, {}).expect(400);

      await generate(token, 2, 2026);
      const feb = await byMonth(token, '2026-02');
      expect(feb.lineItems.some((l: any) => l.type === 'Multa')).toBe(false);
      expect(feb.total).toBe('300000');

      // La corrida siguiente no vuelve a devengar lo condonado.
      expect((await post(token, '/penalties/_run-now').expect(201)).body.penaltiesInserted).toBe(0);
    });

    it('CP-363 — la condonación masiva de un contrato hasta una fecha, con motivo', async () => {
      const { token, tenantId } = await agency('pun-4');
      const { contract, jan } = await enviadaDeEnero(token);
      await post(token, '/penalties/_run-now').expect(201);

      await post(token, `/contracts/${contract.id}/penalties/waive-all?upTo=2026-01-01`, { reason: 'x' }).expect(201);
      expect((await prisma.baseClient.penalty.findMany({ where: { liquidacionId: jan.id, status: 'waived' } }))).toHaveLength(0);

      const res = await post(token, `/contracts/${contract.id}/penalties/waive-all`, { reason: 'bonificación de la inmobiliaria' }).expect(201);
      expect(res.body.waived).toBeGreaterThanOrEqual(1);
      const all = await prisma.baseClient.penalty.findMany({ where: { liquidacionId: jan.id } });
      expect(all.every((r) => r.status === 'waived')).toBe(true);

      const log = await prisma.baseClient.auditLog.findFirst({
        where: { tenantId, entity: 'Contract', entityId: contract.id, action: 'UPDATE' },
        orderBy: { createdAt: 'desc' },
      });
      expect((log?.changes as any)).toMatchObject({ source: 'waive-all', reason: 'bonificación de la inmobiliaria' });

      await post(token, `/contracts/${contract.id}/penalties/waive-all?upTo=10-01-2026`, { reason: 'x' }).expect(400);
      await post(token, '/contracts/no-existe/penalties/waive-all', { reason: 'x' }).expect(404);
    });
  });

  describe('Monto a pagar y cobro con punitorios', () => {
    it('CP-364 — GET payoff da el saldo más los punitorios a la fecha, sin guardar nada', async () => {
      const { token } = await agency('pun-5');
      const { jan } = await enviadaDeEnero(token);

      const res = await get(token, `/liquidaciones/${jan.id}/payoff?date=2026-01-20`).expect(200);
      expect(res.body).toMatchObject({ date: '2026-01-20', balance: '300000.00', total: '301000.00' });
      expect(res.body.penalty).toMatchObject({ accrued: '1000.00', due: '1000.00', daysOverdue: 10, graceDays: 0 });
      expect(res.body.penalty.rule).toMatchObject({ source: 'tenant', mode: 'daily_fixed' });
      expect(await prisma.baseClient.penalty.count({ where: { liquidacionId: jan.id } })).toBe(0);

      await get(token, `/liquidaciones/${jan.id}/payoff?date=20-01-2026`).expect(400);
      await get(token, '/liquidaciones/no-existe/payoff').expect(404);
      // Lo puede ver cualquier usuario autenticado, como el detalle.
    });

    it('CP-365 — un pago con settlePenalties agrega la Multa, exige el total y deja el recibo con punitorios', async () => {
      const { token, tokens } = await agency('pun-6');
      const { jan } = await enviadaDeEnero(token);
      const paidAt = '2026-01-20T00:00:00.000Z';

      const short = await post(token, `/liquidaciones/${jan.id}/payments`, {
        amount: '300000.00',
        method: 'Transferencia',
        paidAt,
        settlePenalties: true,
      }).expect(400);
      expect(short.body).toMatchObject({ error: 'PAYOFF_REQUIRES_FULL_AMOUNT', expectedAmount: '301000.00' });
      // El rechazo no deja nada a medias.
      expect(await prisma.baseClient.penalty.count({ where: { liquidacionId: jan.id } })).toBe(0);
      expect((await get(token, `/liquidaciones/${jan.id}`).expect(200)).body.lineItems).toHaveLength(1);

      const paid = await post(token, `/liquidaciones/${jan.id}/payments`, {
        amount: '301000.00',
        method: 'Transferencia',
        paidAt,
        settlePenalties: true,
      }).expect(200);
      expect(paid.body.penaltySettled).toEqual({ amount: '1000.00', days: 10 });
      expect(paid.body).toMatchObject({ status: 'Pagada', total: '301000' });
      const multa = paid.body.lineItems.find((l: any) => l.type === 'Multa');
      expect(multa).toMatchObject({ amount: '1000', commissionable: true, beneficiary: 'Locador', sourceType: 'Penalty' });

      const rows = await prisma.baseClient.penalty.findMany({ where: { liquidacionId: jan.id } });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({ settledLiquidacionId: jan.id, status: 'active' });

      // El recibo (PDF) es el de la liquidación, que ya trae el renglón de punitorios.
      const pdf = await get(tokens[UserRole.Lectura], `/liquidaciones/${jan.id}/pdf`).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');

      // Y la corrida del cron no devenga más sobre una liquidación pagada.
      expect((await post(token, '/penalties/_run-now').expect(201)).body.penaltiesInserted).toBe(0);
    });

    it('CP-366 — un pago tardío sin la marca fija el devengo y los punitorios pasan a la liquidación siguiente', async () => {
      const { token } = await agency('pun-7');
      const { jan } = await enviadaDeEnero(token);
      await post(token, `/liquidaciones/${jan.id}/payments`, {
        amount: '300000.00',
        method: 'Efectivo',
        paidAt: '2026-01-20T00:00:00.000Z',
      }).expect(200);

      const rows = await prisma.baseClient.penalty.findMany({ where: { liquidacionId: jan.id } });
      expect(rows).toHaveLength(1);
      expect(Number(rows[0].amount)).toBe(1000);

      await generate(token, 2, 2026);
      const feb = await byMonth(token, '2026-02');
      expect(feb.lineItems.find((l: any) => l.type === 'Multa')).toMatchObject({ amount: '1000' });
    });
  });

  describe('Permisos', () => {
    it('CP-367 — condonar es de Admin y Gerente; el monto a pagar lo ve cualquier usuario', async () => {
      const { tokens, token } = await agency('pun-8');
      const { contract, jan } = await enviadaDeEnero(token);
      await post(token, '/penalties/_run-now').expect(201);
      const [row] = await prisma.baseClient.penalty.findMany({ where: { liquidacionId: jan.id } });

      await post(tokens[UserRole.Lectura], `/penalties/${row.id}/waive`, { reason: 'x' }).expect(403);
      await post(tokens[UserRole.Lectura], `/contracts/${contract.id}/penalties/waive-all`, { reason: 'x' }).expect(403);
      await get(tokens[UserRole.Lectura], `/liquidaciones/${jan.id}/payoff`).expect(200);
      await post(tokens[UserRole.Gerente], `/penalties/${row.id}/waive`, { reason: 'visto bueno' }).expect(201);
    });
  });
});
