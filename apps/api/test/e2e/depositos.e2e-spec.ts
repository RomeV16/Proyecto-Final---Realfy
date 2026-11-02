import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AdjustmentPeriod, AdjustmentType, ContractType, PersonRole, UserRole, todayInAR } from '@realfy/shared';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  cleanDatabase,
  createUserDirect,
  loginUser,
  registerUser,
  setupTestApp,
  teardownTestApp,
} from '../helpers/test-utils';

const PASSWORD = 'Password123!';
const DAY_MS = 86_400_000;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const inDays = (n: number) => new Date(todayInAR().getTime() + n * DAY_MS);

/** CP-560 a CP-570: depósitos de los contratos y liquidación de egreso. */
describe('Depósitos y liquidación de egreso (e2e)', () => {
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

  async function agency(prefix: string) {
    const admin = await registerUser(app, {
      email: `${prefix}-admin@dep.test`,
      password: PASSWORD,
      firstName: 'Admin',
      lastName: 'Depósitos',
    });
    const tokens: Record<string, string> = { [UserRole.Admin]: admin.accessToken };
    for (const role of [UserRole.Gerente, UserRole.Liquidaciones, UserRole.Lectura, UserRole.Ventas]) {
      const email = `${prefix}-${role.toLowerCase()}@dep.test`;
      await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { token: admin.accessToken, tenantId: admin.user.tenantId as string, tokens };
  }

  async function person(token: string, role: PersonRole, email: string) {
    const p = await http().post('/api/persons').set(auth(token)).send({ firstName: role, lastName: 'Sintético', email }).expect(201);
    await http().post(`/api/persons/${p.body.id}/roles`).set(auth(token)).send({ role }).expect(201);
    return p.body.id as string;
  }

  /** Contrato activo que empezó hace 400 días y termina en 30. */
  async function contract(token: string, prefix: string, extra: Record<string, unknown> = {}) {
    const prop = await http()
      .post('/api/properties')
      .set(auth(token))
      .send({
        title: `Depto ${prefix}`,
        type: 'Departamento',
        street: 'Calle Ficticia',
        number: '100',
        city: 'Buenos Aires',
        province: 'CABA',
        area: 55,
        rooms: 2,
        bedrooms: 1,
        bathrooms: 1,
        price: 150000,
        currency: 'ARS',
      })
      .expect(201);
    const owner = await person(token, PersonRole.Propietario, `${prefix}-o@dep.test`);
    const tenant = await person(token, PersonRole.Inquilino, `${prefix}-t@dep.test`);
    const res = await http()
      .post('/api/contracts')
      .set(auth(token))
      .send({
        propertyId: prop.body.id,
        contractType: ContractType.Alquiler,
        startDate: `${iso(inDays(-400))}T00:00:00.000Z`,
        endDate: `${iso(inDays(330))}T00:00:00.000Z`,
        rentAmount: '100000.00',
        rentCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        persons: [
          { personId: owner, role: PersonRole.Propietario },
          { personId: tenant, role: PersonRole.Inquilino },
        ],
        guarantees: [],
        ...extra,
      })
      .expect(201);
    await http().post(`/api/contracts/${res.body.id}/activate`).set(auth(token)).expect(201);
    return { id: res.body.id as string, propertyId: prop.body.id as string, owner, tenant };
  }

  const deposit = (over: Record<string, unknown> = {}) => ({
    amount: '100000.00',
    currency: 'ARS',
    heldBy: 'Inmobiliaria',
    installments: 2,
    refundRule: 'MismaMoneda',
    ...over,
  });

  const putDeposit = (token: string, id: string, body: unknown, status = 200) =>
    http().put(`/api/contracts/${id}/deposit`).set(auth(token)).send(body as object).expect(status);

  describe('depósito', () => {
    it('CP-560: se carga con sus cuotas, se consulta y el contrato queda sincronizado', async () => {
      const { token, tokens } = await agency('d560');
      const c = await contract(token, 'd560');
      const empty = await http().get(`/api/contracts/${c.id}/deposit`).set(auth(tokens[UserRole.Lectura])).expect(200);
      expect(empty.body.deposit).toBeNull();
      expect(empty.body.defaults).toMatchObject({ defaultHeldBy: 'Locador', refundDueDays: 30 });

      const res = await putDeposit(tokens[UserRole.Gerente], c.id, deposit());
      expect(res.body.installmentRows).toHaveLength(2);
      expect(res.body).toMatchObject({ status: 'Pendiente', collectedAmount: '0.00', pendingAmount: '100000.00', refundDueDays: 30 });
      const contractRow = await prisma.baseClient.contract.findUniqueOrThrow({ where: { id: c.id } });
      expect(contractRow.depositAmount?.toString()).toBe('100000');

      // Cambiar antes de cobrar rehace las cuotas.
      const changed = await putDeposit(token, c.id, deposit({ installments: 3, refundDueDays: 15 }));
      expect(changed.body.installmentRows).toHaveLength(3);
      expect(changed.body.refundDueDays).toBe(15);
    });

    it('CP-570: el depósito declarado al crear el contrato nace pendiente, en una cuota y con la regla habitual', async () => {
      const { token } = await agency('d570');
      const c = await contract(token, 'd570', { depositAmount: '100000.00', depositCurrency: 'ARS' });
      const res = await http().get(`/api/contracts/${c.id}/deposit`).set(auth(token)).expect(200);
      expect(res.body.deposit).toMatchObject({
        amount: '100000',
        currency: 'ARS',
        heldBy: 'Locador',
        heldByPersonId: c.owner,
        refundRule: 'PesosActualizado',
        refundDueDays: 30,
        status: 'Pendiente',
      });
      expect(res.body.deposit.installmentRows).toHaveLength(1);
      const usd = await contract(token, 'd570u', { depositAmount: '1500.00', depositCurrency: 'USD' });
      const u = await http().get(`/api/contracts/${usd.id}/deposit`).set(auth(token)).expect(200);
      expect(u.body.deposit).toMatchObject({ currency: 'USD', refundRule: 'MismaMoneda' });
    });

    it('CP-561: valida la regla, el titular y los permisos', async () => {
      const { token, tokens } = await agency('d561');
      const c = await contract(token, 'd561');
      await putDeposit(token, c.id, deposit({ currency: 'USD', refundRule: 'PesosActualizado' }), 400);
      await putDeposit(token, c.id, deposit({ heldBy: 'Locador' }), 400);
      await putDeposit(token, c.id, deposit({ heldByPersonId: '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11' }), 400);
      await putDeposit(tokens[UserRole.Lectura], c.id, deposit(), 403);
      await putDeposit(tokens[UserRole.Liquidaciones], c.id, deposit(), 403);
      await http().get(`/api/contracts/${c.id}/deposit`).set(auth(tokens[UserRole.Ventas])).expect(403);
    });

    it('CP-562: cobrar una cuota que guarda la inmobiliaria entra a la custodia del locador, una sola vez', async () => {
      const { token, tokens } = await agency('d562');
      const c = await contract(token, 'd562');
      await putDeposit(token, c.id, deposit({ heldByPersonId: c.owner }));
      const url = `/api/contracts/${c.id}/deposit/installments/1/collect`;
      const res = await http().post(url).set(auth(tokens[UserRole.Liquidaciones])).send({}).expect(200);
      expect(res.body).toMatchObject({ status: 'Parcial', collectedAmount: '50000.00' });
      await http().post(url).set(auth(token)).send({}).expect(409);
      const moves = await prisma.baseClient.cashMovement.findMany({ where: { contractId: c.id } });
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ direction: 'In', category: 'Deposito', sourceType: 'DepositInstallment' });
      expect(moves[0].amount.toString()).toBe('50000');
      const account = await prisma.baseClient.financialAccount.findUniqueOrThrow({ where: { id: moves[0].accountId } });
      expect(account).toMatchObject({ kind: 'Custodia', ownerPersonId: c.owner });

      const done = await http().post(`/api/contracts/${c.id}/deposit/installments/2/collect`).set(auth(token)).send({}).expect(200);
      expect(done.body.status).toBe('Cobrado');
      await http().post(`/api/contracts/${c.id}/deposit/installments/9/collect`).set(auth(token)).send({}).expect(404);
      await http().post(url).set(auth(tokens[UserRole.Lectura])).send({}).expect(403);
    });

    it('CP-563: si lo guarda el locador, el cobro se anota sin tocar la caja', async () => {
      const { token } = await agency('d563');
      const c = await contract(token, 'd563');
      await putDeposit(token, c.id, deposit({ heldBy: 'Locador', heldByPersonId: c.owner, installments: 1 }));
      const res = await http().post(`/api/contracts/${c.id}/deposit/installments/1/collect`).set(auth(token)).send({}).expect(200);
      expect(res.body.status).toBe('Cobrado');
      expect(await prisma.baseClient.cashMovement.count({ where: { contractId: c.id } })).toBe(0);
    });
  });

  describe('liquidación de egreso', () => {
    async function withDeposit(prefix: string, over: Record<string, unknown> = {}) {
      const a = await agency(prefix);
      const c = await contract(a.token, prefix);
      await putDeposit(a.token, c.id, deposit({ heldByPersonId: c.owner, installments: 1, ...over }));
      await http().post(`/api/contracts/${c.id}/deposit/installments/1/collect`).set(auth(a.token)).send({ paidAt: iso(inDays(-390)) }).expect(200);
      return { ...a, c };
    }

    const charge = (a: { tenantId: string }, c: { id: string; propertyId: string }, amount: string, kind = 'Reparacion') =>
      prisma.baseClient.pendingCharge.create({
        data: {
          tenantId: a.tenantId,
          propertyId: c.propertyId,
          contractId: c.id,
          chargedTo: 'Inquilino',
          kind: kind as any,
          description: `Cargo ${amount}`,
          amount,
          incurredAt: inDays(-5),
        },
      });

    it('CP-564: la vista previa trae los cargos pendientes y el depósito, y no guarda nada', async () => {
      const a = await withDeposit('m564');
      await charge(a, a.c, '8000.00');
      const res = await http()
        .post(`/api/contracts/${a.c.id}/move-out/preview?date=${iso(inDays(0))}`)
        .set(auth(a.tokens[UserRole.Lectura]))
        .expect(200);
      expect(res.body.items).toHaveLength(1);
      expect(res.body.items[0]).toMatchObject({ kind: 'Reparacion', amount: '8000.00', included: true });
      expect(res.body).toMatchObject({ totalOwed: '8000.00', depositAvailable: '100000.00', refundToTenant: '92000.00', owedByTenant: '0.00' });
      expect(res.body.deposit).toMatchObject({ heldBy: 'Inmobiliaria', refundable: '100000.00' });
      expect(await prisma.baseClient.moveOutSettlement.count()).toBe(0);
      await http().post(`/api/contracts/${a.c.id}/move-out/preview`).set(auth(a.tokens[UserRole.Ventas])).expect(403);
    });

    it('CP-565: pesos actualizado sigue los ajustes aplicados del alquiler', async () => {
      const a = await withDeposit('m565', { refundRule: 'PesosActualizado' });
      await prisma.baseClient.contractAdjustment.createMany({
        data: [
          { tenantId: a.tenantId, contractId: a.c.id, periodNumber: 1, adjustmentDate: inDays(-200), previousAmount: '100000', newAmount: '130000', percentage: '30', calculatedAt: inDays(-200), appliedAt: inDays(-200) },
          { tenantId: a.tenantId, contractId: a.c.id, periodNumber: 2, adjustmentDate: inDays(-100), previousAmount: '130000', newAmount: '182000', percentage: '40', calculatedAt: inDays(-100), appliedAt: inDays(-100) },
        ],
      });
      const res = await http().post(`/api/contracts/${a.c.id}/move-out/preview?date=${iso(inDays(0))}`).set(auth(a.token)).expect(200);
      expect(res.body.deposit.refundable).toBe('182000.00');
      expect(res.body.depositAvailable).toBe('182000.00');
      const early = await http().post(`/api/contracts/${a.c.id}/move-out/preview?date=${iso(inDays(-150))}`).set(auth(a.token)).expect(200);
      expect(early.body.deposit.refundable).toBe('130000.00');
    });

    it('CP-566: el borrador se edita y se confirma una sola vez: devuelve desde la custodia, imputa el cargo y cierra el paso del seguimiento', async () => {
      const a = await withDeposit('m566');
      const ch = await charge(a, a.c, '8000.00');
      const fu = await prisma.baseClient.contractFollowUp.create({
        data: {
          tenantId: a.tenantId,
          contractId: a.c.id,
          kind: 'Devolucion',
          dueDate: inDays(30),
          tasks: { create: [{ tenantId: a.tenantId, code: 'DEPOSITO', label: 'Devolución del depósito', position: 1 }] },
        },
      });
      const preview = await http().post(`/api/contracts/${a.c.id}/move-out/preview?date=${iso(inDays(0))}`).set(auth(a.token)).expect(200);
      const items = [...preview.body.items, { kind: 'Deduccion', description: 'Pintura', amount: '12000.00', included: true }];
      await http().post(`/api/contracts/${a.c.id}/move-out`).set(auth(a.tokens[UserRole.Liquidaciones])).send({ date: iso(inDays(0)), items }).expect(403);
      const draft = await http().post(`/api/contracts/${a.c.id}/move-out`).set(auth(a.token)).send({ date: iso(inDays(0)), items, notes: 'Entrega ok' }).expect(201);
      expect(draft.body).toMatchObject({ status: 'Borrador', totalOwed: '20000', netAmount: '80000' });
      // Editar el borrador lo reemplaza.
      const edited = await http().post(`/api/contracts/${a.c.id}/move-out`).set(auth(a.token)).send({ date: iso(inDays(0)), items }).expect(201);
      expect(edited.body.id).toBe(draft.body.id);

      const confirmed = await http().post(`/api/move-outs/${draft.body.id}/confirm`).set(auth(a.token)).send({}).expect(200);
      expect(confirmed.body.status).toBe('Confirmada');
      await http().post(`/api/move-outs/${draft.body.id}/confirm`).set(auth(a.token)).send({}).expect(409);
      await http().post(`/api/contracts/${a.c.id}/move-out`).set(auth(a.token)).send({ date: iso(inDays(0)), items }).expect(409);

      const out = await prisma.baseClient.cashMovement.findMany({ where: { contractId: a.c.id, direction: 'Out' } });
      expect(out).toHaveLength(1);
      expect(out[0].amount.toString()).toBe('80000');
      expect(out[0].category).toBe('Deposito');
      const dep = await prisma.baseClient.contractDeposit.findFirstOrThrow({ where: { contractId: a.c.id } });
      expect(dep).toMatchObject({ status: 'Devuelto' });
      expect(dep.refundedAmount?.toString()).toBe('80000');
      expect((await prisma.baseClient.pendingCharge.findUniqueOrThrow({ where: { id: ch.id } })).status).toBe('Imputado');
      const task = await prisma.baseClient.followUpTask.findFirstOrThrow({ where: { followUpId: fu.id, code: 'DEPOSITO' } });
      expect(task.done).toBe(true);
      const audits = await prisma.baseClient.auditLog.count({ where: { entity: 'MoveOutSettlement' } });
      expect(audits).toBeGreaterThanOrEqual(2);
      const got = await http().get(`/api/contracts/${a.c.id}/move-out`).set(auth(a.token)).expect(200);
      expect(got.body.settlement.status).toBe('Confirmada');
    });

    it('CP-567: si la deuda supera al depósito no sale dinero y el saldo queda como cargo del inquilino', async () => {
      const a = await withDeposit('m567');
      const draft = await http()
        .post(`/api/contracts/${a.c.id}/move-out`)
        .set(auth(a.token))
        .send({ date: iso(inDays(0)), items: [{ kind: 'Deduccion', description: 'Daños', amount: '130000.00', included: true }] })
        .expect(201);
      expect(draft.body.netAmount).toBe('-30000');
      await http().post(`/api/move-outs/${draft.body.id}/confirm`).set(auth(a.token)).send({}).expect(200);
      expect(await prisma.baseClient.cashMovement.count({ where: { contractId: a.c.id, direction: 'Out' } })).toBe(0);
      const pending = await prisma.baseClient.pendingCharge.findFirstOrThrow({ where: { contractId: a.c.id, sourceType: 'MoveOutSettlement' } });
      expect(pending).toMatchObject({ chargedTo: 'Inquilino', status: 'Pendiente' });
      expect(pending.amount.toString()).toBe('30000');
    });

    it('CP-568: si lo guarda el locador, lo retenido queda en su cuenta corriente', async () => {
      const a = await withDeposit('m568', { heldBy: 'Locador' });
      const draft = await http()
        .post(`/api/contracts/${a.c.id}/move-out`)
        .set(auth(a.token))
        .send({ date: iso(inDays(0)), items: [{ kind: 'Deduccion', description: 'Pintura', amount: '20000.00', included: true }] })
        .expect(201);
      await http().post(`/api/move-outs/${draft.body.id}/confirm`).set(auth(a.token)).send({}).expect(200);
      expect(await prisma.baseClient.cashMovement.count({ where: { contractId: a.c.id } })).toBe(0);
      const entries = await prisma.baseClient.ownerLedgerEntry.findMany({ where: { personId: a.c.owner } });
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ type: 'CobroDirecto', sourceType: 'MoveOutSettlement', sourceId: draft.body.id });
      expect(entries[0].amount.toString()).toBe('-20000');
    });

    it('CP-569: la liquidación de egreso se baja en PDF', async () => {
      const a = await withDeposit('m569');
      const draft = await http()
        .post(`/api/contracts/${a.c.id}/move-out`)
        .set(auth(a.token))
        .send({ date: iso(inDays(0)), items: [{ kind: 'Deduccion', description: 'Pintura', amount: '20000.00', included: true }] })
        .expect(201);
      const pdf = await http().get(`/api/move-outs/${draft.body.id}/pdf`).set(auth(a.tokens[UserRole.Lectura])).buffer(true).expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect(Buffer.from(pdf.body).subarray(0, 4).toString()).toBe('%PDF');
      await http().get(`/api/move-outs/${draft.body.id}`).set(auth(a.token)).expect(200);
      await http().get(`/api/move-outs/00000000-0000-4000-8000-000000000000`).set(auth(a.token)).expect(404);
    });
  });
});
