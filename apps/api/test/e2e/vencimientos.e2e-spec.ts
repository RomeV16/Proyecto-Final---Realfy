import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  AdjustmentPeriod,
  AdjustmentType,
  ContractType,
  PersonRole,
  UserRole,
  todayInAR,
} from '@realfy/shared';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { FollowUpsScheduler } from '../../src/modules/follow-ups/follow-ups.scheduler';
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

/** CP-470 a CP-479: vencimientos (semáforo, seguimientos, checklist) y prórroga de palabra; CP-480 a CP-485: renovación como período; CP-490 a CP-492: contratos vencidos que siguen corriendo. */
describe('Vencimientos (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let scheduler: FollowUpsScheduler;

  beforeAll(async () => {
    const setup = await setupTestApp();
    app = setup.app;
    prisma = setup.prisma;
    scheduler = app.get(FollowUpsScheduler);
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
      email: `${prefix}-admin@venc.test`,
      password: PASSWORD,
      firstName: 'Admin',
      lastName: 'Vencimientos',
    });
    const tokens: Record<string, string> = { [UserRole.Admin]: admin.accessToken };
    for (const role of [UserRole.Gerente, UserRole.Ventas, UserRole.Lectura]) {
      const email = `${prefix}-${role.toLowerCase()}@venc.test`;
      await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { admin, token: admin.accessToken, tokens };
  }

  async function person(token: string, role: PersonRole, email: string) {
    const p = await http()
      .post('/api/persons')
      .set(auth(token))
      .send({ firstName: role, lastName: 'Sintético', email })
      .expect(201);
    await http().post(`/api/persons/${p.body.id}/roles`).set(auth(token)).send({ role }).expect(201);
    return p.body.id as string;
  }

  /** Contrato de alquiler activo que termina dentro de `endInDays` días. */
  async function activeContract(
    token: string,
    prefix: string,
    endInDays: number,
    extraParties: Array<{ personId: string; role: PersonRole }> = [],
  ) {
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
    const owner = await person(token, PersonRole.Propietario, `${prefix}-o@venc.test`);
    const tenant = await person(token, PersonRole.Inquilino, `${prefix}-t@venc.test`);
    const res = await http()
      .post('/api/contracts')
      .set(auth(token))
      .send({
        propertyId: prop.body.id,
        contractType: ContractType.Alquiler,
        startDate: `${iso(inDays(endInDays - 730))}T00:00:00.000Z`,
        endDate: `${iso(inDays(endInDays))}T00:00:00.000Z`,
        rentAmount: '100000.00',
        rentCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        persons: [
          { personId: owner, role: PersonRole.Propietario },
          { personId: tenant, role: PersonRole.Inquilino },
          ...extraParties,
        ],
        guarantees: [],
      })
      .expect(201);
    await http().post(`/api/contracts/${res.body.id}/activate`).set(auth(token)).expect(201);
    return res.body.id as string;
  }

  const list = (token: string, query = '') =>
    http().get(`/api/follow-ups${query}`).set(auth(token)).expect(200);

  describe('proceso diario', () => {
    it('CP-470: abre el seguimiento de los contratos en la ventana, una sola vez', async () => {
      const { token } = await agency('cron');
      const soon = await activeContract(token, 'soon', 45);
      const expired = await activeContract(token, 'old', -10);
      const far = await activeContract(token, 'far', 400);

      const first = await scheduler.openForAllTenants();
      expect(first.opened).toBe(2);
      expect(first.tenantsFailed).toBe(0);
      const second = await scheduler.openForAllTenants();
      expect(second.opened).toBe(0);

      const res = await list(token);
      const byContract = new Map<string, any>(res.body.items.map((i: any) => [i.contractId, i]));
      expect(byContract.has(far)).toBe(false);
      expect(byContract.get(soon)).toMatchObject({ kind: 'Renovacion', status: 'Abierto', outcome: 'Pendiente', light: 'yellow' });
      expect(byContract.get(expired)).toMatchObject({ light: 'expired' });
      expect(byContract.get(soon).tasks.map((t: any) => t.code)).toEqual([
        'VISITA',
        'PRECIO',
        'REGLA',
        'GARANTES',
        'HONORARIOS',
        'SELLOS_FIRMA',
      ]);
      expect(byContract.get(soon).tenantName).toContain('Inquilino');
    });

    it('CP-471: respeta los umbrales de la inmobiliaria', async () => {
      const { token } = await agency('thr');
      await activeContract(token, 'thr', 80);
      await http()
        .put('/api/tenants/me/operational-defaults')
        .set(auth(token))
        .send({ expiryLight: { redDays: 30, yellowDays: 90 } })
        .expect(200);

      expect((await scheduler.openForAllTenants()).opened).toBe(1);
      const res = await list(token);
      expect(res.body.items[0].light).toBe('yellow');
      expect(res.body.items[0].daysLeft).toBe(80);
      expect((await list(token, '?light=red')).body.total).toBe(0);
      expect((await list(token, '?light=yellow')).body.total).toBe(1);
    });

    it('CP-472: filtra por color, tipo, estado y responsable', async () => {
      const { token, admin } = await agency('flt');
      const a = await activeContract(token, 'a', 45);
      await activeContract(token, 'b', -5);
      await scheduler.openForAllTenants();

      expect((await list(token, '?light=yellow')).body.items.map((i: any) => i.contractId)).toEqual([a]);
      expect((await list(token, '?light=expired')).body.total).toBe(1);
      expect((await list(token, '?light=green')).body.total).toBe(0);
      expect((await list(token, '?kind=Devolucion')).body.total).toBe(0);
      expect((await list(token, '?status=Abierto')).body.total).toBe(2);
      expect((await list(token, `?assigneeId=${admin.user.id}`)).body.total).toBe(0);
      await http().get('/api/follow-ups?light=azul').set(auth(token)).expect(400);
    });
  });

  describe('seguimiento y checklist', () => {
    async function opened(prefix: string) {
      const ctx = await agency(prefix);
      const contractId = await activeContract(ctx.token, prefix, 15);
      await scheduler.openForAllTenants();
      const followUp = (await list(ctx.token)).body.items[0];
      return { ...ctx, contractId, followUp };
    }

    it('CP-473: asigna un responsable y rechaza uno que no es de la inmobiliaria', async () => {
      const { token, admin, followUp } = await opened('asg');
      const res = await http()
        .patch(`/api/follow-ups/${followUp.id}`)
        .set(auth(token))
        .send({ assigneeId: admin.user.id })
        .expect(200);
      expect(res.body.assigneeId).toBe(admin.user.id);
      expect((await list(token, `?assigneeId=${admin.user.id}`)).body.total).toBe(1);

      await http()
        .patch(`/api/follow-ups/${followUp.id}`)
        .set(auth(token))
        .send({ assigneeId: '00000000-0000-4000-8000-000000000000' })
        .expect(400);
      await http().patch(`/api/follow-ups/${followUp.id}`).set(auth(token)).send({}).expect(400);
      await http().patch('/api/follow-ups/no-existe').set(auth(token)).send({ notes: 'x' }).expect(404);
    });

    it('CP-474: marca y desmarca pasos del checklist con quién y cuándo', async () => {
      const { token, admin, followUp } = await opened('chk');
      const task = followUp.tasks[0];
      const on = await http()
        .patch(`/api/follow-ups/${followUp.id}/tasks/${task.id}`)
        .set(auth(token))
        .send({ done: true })
        .expect(200);
      expect(on.body.progress).toEqual({ done: 1, total: 6 });
      expect(on.body.tasks[0]).toMatchObject({ done: true, doneById: admin.user.id });
      expect(on.body.tasks[0].doneAt).toBeTruthy();

      const off = await http()
        .patch(`/api/follow-ups/${followUp.id}/tasks/${task.id}`)
        .set(auth(token))
        .send({ done: false })
        .expect(200);
      expect(off.body.progress.done).toBe(0);
      expect(off.body.tasks[0].doneById).toBeNull();
      await http()
        .patch(`/api/follow-ups/${followUp.id}/tasks/00000000-0000-4000-8000-000000000000`)
        .set(auth(token))
        .send({ done: true })
        .expect(404);
    });

    it('CP-475: pasar a devolución cambia el checklist y conserva lo hecho', async () => {
      const { token, followUp } = await opened('knd');
      await http()
        .patch(`/api/follow-ups/${followUp.id}/tasks/${followUp.tasks[0].id}`)
        .set(auth(token))
        .send({ done: true })
        .expect(200);
      const res = await http()
        .patch(`/api/follow-ups/${followUp.id}`)
        .set(auth(token))
        .send({ kind: 'Devolucion' })
        .expect(200);
      expect(res.body.kind).toBe('Devolucion');
      expect(res.body.tasks.map((t: any) => t.code)).toEqual(['VISITA', 'FECHA_ENTREGA', 'PUBLICAR', 'LIBRE_DEUDA', 'PINTURA', 'LLAVES', 'DEPOSITO']);
      expect(res.body.tasks.filter((t: any) => t.done).map((t: any) => t.code)).toEqual(['VISITA']);
    });

    it('CP-476: un seguimiento cerrado no cambia de checklist y puede reabrirse', async () => {
      const { token, followUp } = await opened('cls');
      const closed = await http()
        .patch(`/api/follow-ups/${followUp.id}`)
        .set(auth(token))
        .send({ outcome: 'Devuelto', notes: 'Entregó las llaves' })
        .expect(200);
      expect(closed.body).toMatchObject({ status: 'Cerrado', outcome: 'Devuelto', light: null });
      expect(closed.body.closedAt).toBeTruthy();
      await http()
        .patch(`/api/follow-ups/${followUp.id}/tasks/${followUp.tasks[0].id}`)
        .set(auth(token))
        .send({ done: true })
        .expect(409);
      await http().patch(`/api/follow-ups/${followUp.id}`).set(auth(token)).send({ kind: 'Devolucion' }).expect(409);

      const reopened = await http()
        .patch(`/api/follow-ups/${followUp.id}`)
        .set(auth(token))
        .send({ outcome: 'Pendiente' })
        .expect(200);
      expect(reopened.body).toMatchObject({ status: 'Abierto', closedAt: null });
    });

    it('CP-477: solo Admin, Gerente y Ventas editan; todos leen; otra inmobiliaria no ve nada', async () => {
      const { tokens, followUp } = await opened('rol');
      await http()
        .patch(`/api/follow-ups/${followUp.id}`)
        .set(auth(tokens[UserRole.Lectura]))
        .send({ notes: 'no' })
        .expect(403);
      await http().patch(`/api/follow-ups/${followUp.id}`).set(auth(tokens[UserRole.Ventas])).send({ notes: 'sí' }).expect(200);
      await http().get(`/api/follow-ups/${followUp.id}`).set(auth(tokens[UserRole.Lectura])).expect(200);

      const other = await agency('otra');
      expect((await list(other.token)).body.total).toBe(0);
      await http().get(`/api/follow-ups/${followUp.id}`).set(auth(other.token)).expect(404);
      await http().patch(`/api/follow-ups/${followUp.id}`).set(auth(other.token)).send({ notes: 'x' }).expect(404);
    });
  });

  describe('prórroga de palabra', () => {
    it('CP-478: mueve el fin real, deja el pactado, cierra el seguimiento y se audita', async () => {
      const { token, tokens } = await agency('prr');
      const contractId = await activeContract(token, 'prr', 10);
      await scheduler.openForAllTenants();
      const stats = () => http().get('/api/dashboard/stats').set(auth(token)).expect(200);
      expect((await stats()).body.expiringContracts.within30).toBe(1);
      const signedEnd = (await http().get(`/api/contracts/${contractId}`).set(auth(token)).expect(200)).body.endDate;
      const until = iso(inDays(190));

      await http()
        .post(`/api/contracts/${contractId}/oral-extension`)
        .set(auth(tokens[UserRole.Ventas]))
        .send({ until, note: 'Hablado con el inquilino' })
        .expect(403);
      const res = await http()
        .post(`/api/contracts/${contractId}/oral-extension`)
        .set(auth(tokens[UserRole.Gerente]))
        .send({ until, note: 'Hablado con el inquilino' })
        .expect(201);
      expect(res.body.agreement).toMatchObject({ kind: 'Prorroga', notes: 'Hablado con el inquilino' });
      expect(res.body.contract.endDate).toBe(signedEnd);
      expect(iso(new Date(res.body.contract.actualEndDate))).toBe(until);

      // Los paneles miden con el fin efectivo: la prórroga saca el contrato de la ventana.
      expect((await stats()).body.expiringContracts).toEqual({ within30: 0, within60: 0, within90: 0 });

      const closed = (await list(token, `?contractId=${contractId}`)).body.items[0];
      expect(closed).toMatchObject({ status: 'Cerrado', outcome: 'Prorrogado' });

      const audit = await prisma.baseClient.auditLog.findMany({ where: { entityId: contractId } });
      expect(audit.some((a: any) => a.changes?.operation === 'oral-extension')).toBe(true);

      // Con el nuevo fin lejos no se abre otro seguimiento; cuando se acerca, sí.
      expect((await scheduler.openForAllTenants()).opened).toBe(0);
      expect((await scheduler.openForAllTenants(inDays(150))).opened).toBe(1);
      const next = (await list(token, `?contractId=${contractId}&status=Abierto`)).body.items[0];
      expect(iso(new Date(next.dueDate))).toBe(until);
    });

    it('CP-479: rechaza una fecha que no es posterior al fin y un contrato que no está activo', async () => {
      const { token } = await agency('prv');
      const contractId = await activeContract(token, 'prv', 30);
      const post = (id: string, body: object) =>
        http().post(`/api/contracts/${id}/oral-extension`).set(auth(token)).send(body);

      await post(contractId, { until: iso(inDays(30)), note: 'igual al fin' }).expect(400);
      await post(contractId, { until: iso(inDays(10)), note: 'anterior' }).expect(400);
      await post(contractId, { until: iso(inDays(60)) }).expect(400);
      await post('00000000-0000-4000-8000-000000000000', { until: iso(inDays(60)), note: 'x' }).expect(404);
      await http().post(`/api/contracts/${contractId}/terminate`).set(auth(token)).expect(201);
      await post(contractId, { until: iso(inDays(60)), note: 'rescindido' }).expect(409);
    });

    it('CP-479: la ruta de convenios no acepta prórrogas ni renovaciones', async () => {
      const { token } = await agency('agr');
      const contractId = await activeContract(token, 'agr', 30);
      await http()
        .post(`/api/contracts/${contractId}/agreements`)
        .set(auth(token))
        .send({ kind: 'Prorroga', effectiveFrom: iso(inDays(30)) })
        .expect(400);
    });
  });

  describe('renovación como período', () => {
    const renew = (token: string, id: string, body: object) =>
      http().post(`/api/contracts/${id}/renew`).set(auth(token)).send(body);
    const periods = async (token: string, id: string) =>
      (await http().get(`/api/contracts/${id}/periods`).set(auth(token)).expect(200)).body as any[];

    it('CP-480: agrega un período, fija el alquiler y la regla nuevos, mueve el fin y cierra el seguimiento', async () => {
      const { token } = await agency('ren');
      const contractId = await activeContract(token, 'ren', 20);
      await scheduler.openForAllTenants();
      const start = iso(inDays(21));
      const end = iso(inDays(21 + 730));

      const res = await renew(token, contractId, {
        start,
        end,
        rent: '180000.50',
        adjustment: { adjustmentType: 'FixedPercent', adjustmentPeriod: 'Semestral', customPct: '12' },
        notes: 'Renovación por 24 meses',
      }).expect(201);
      expect(res.body.period).toMatchObject({ seq: 2, kind: 'Renovacion', initialRent: '180000.5' });
      expect(iso(new Date(res.body.contract.endDate))).toBe(end);
      expect(res.body.contract.actualEndDate).toBeNull();

      expect((await periods(token, contractId)).map((p) => [p.seq, p.kind])).toEqual([
        [1, 'Original'],
        [2, 'Renovacion'],
      ]);
      const terms = (await http().get(`/api/contracts/${contractId}/terms`).set(auth(token)).expect(200)).body;
      const version = terms.versions.find((v: any) => iso(new Date(v.validFrom)) === start);
      expect(version).toMatchObject({ rentOverride: '180000.5', adjustmentType: 'FixedPercent', adjustmentPeriod: 'Semestral' });
      const agreements = (await http().get(`/api/contracts/${contractId}/agreements`).set(auth(token)).expect(200)).body;
      expect(agreements.map((a: any) => a.kind)).toContain('Renovacion');

      const followUp = (await list(token, `?contractId=${contractId}`)).body.items[0];
      expect(followUp).toMatchObject({ status: 'Cerrado', outcome: 'Renovado' });
      const audit = await prisma.baseClient.auditLog.findMany({ where: { entityId: contractId } });
      expect(audit.some((a: any) => a.changes?.operation === 'renewal')).toBe(true);
      // El nuevo fin queda lejos: el proceso diario no abre otro seguimiento.
      expect((await scheduler.openForAllTenants()).opened).toBe(0);
    });

    it('CP-481: una renovación que ya rige actualiza el alquiler vigente y absorbe la prórroga de palabra', async () => {
      const { token } = await agency('abs');
      const contractId = await activeContract(token, 'abs', 5);
      await http()
        .post(`/api/contracts/${contractId}/oral-extension`)
        .set(auth(token))
        .send({ until: iso(inDays(60)), note: 'De palabra' })
        .expect(201);

      const res = await renew(token, contractId, { start: iso(inDays(6)), end: iso(inDays(6 + 365)), rent: '150000' }).expect(201);
      expect(res.body.contract.actualEndDate).toBeNull();
      expect(iso(new Date(res.body.contract.endDate))).toBe(iso(inDays(6 + 365)));
      // Todavía no rige (empieza en 6 días): el alquiler vigente es el de hoy.
      expect(res.body.contract.rentAmount).toBe('100000');

      const past = await activeContract(token, 'past', -20);
      const now = await renew(token, past, { start: iso(inDays(-19)), end: iso(inDays(-19 + 365)), rent: '150000' }).expect(201);
      expect(now.body.contract.rentAmount).toBe('150000');
    });

    it('CP-482: anota garantes y honorarios, y exige que sean garantes del contrato', async () => {
      const { token } = await agency('gar');
      const guarantor = await person(token, PersonRole.Garante, 'gar-g@venc.test');
      const stranger = await person(token, PersonRole.Garante, 'gar-x@venc.test');
      const contractId = await activeContract(token, 'gar', 10, [{ personId: guarantor, role: PersonRole.Garante }]);
      const base = { start: iso(inDays(11)), end: iso(inDays(11 + 365)), rent: '120000' };

      await renew(token, contractId, { ...base, guarantorPersonIds: [stranger] }).expect(400);
      const res = await renew(token, contractId, {
        ...base,
        guarantorPersonIds: [guarantor],
        fee: { amount: '96000', currency: 'ARS' },
        signedAt: iso(inDays(1)),
      }).expect(201);
      expect(res.body.period).toMatchObject({ guarantorPersonIds: [guarantor], feeAmount: '96000', feeCurrency: 'ARS' });
      expect(iso(new Date(res.body.period.signedAt))).toBe(iso(inDays(1)));
    });

    it('CP-483: rechaza fechas incoherentes, otra renovación sobre la misma fecha, roles y contratos inactivos', async () => {
      const { token, tokens } = await agency('val');
      const contractId = await activeContract(token, 'val', 10);
      const ok = { start: iso(inDays(11)), end: iso(inDays(11 + 365)), rent: '120000' };

      await renew(token, contractId, { ...ok, end: ok.start }).expect(400);
      await renew(token, contractId, { ...ok, rent: '0' }).expect(400);
      await renew(token, contractId, { ...ok, start: iso(inDays(-800)) }).expect(400);
      await renew(tokens[UserRole.Ventas], contractId, ok).expect(403);
      await renew(token, '00000000-0000-4000-8000-000000000000', ok).expect(404);
      await renew(token, contractId, ok).expect(201);
      // Una segunda renovación debe empezar después del inicio de la anterior.
      await renew(token, contractId, { ...ok, start: ok.start, end: iso(inDays(11 + 800)) }).expect(400);
      await http().post(`/api/contracts/${contractId}/terminate`).set(auth(token)).expect(201);
      await renew(token, contractId, { start: iso(inDays(400)), end: iso(inDays(900)), rent: '1' }).expect(409);
    });

    it('CP-484: genera la adenda corta en PDF solo de un período de renovación', async () => {
      const { token } = await agency('pdf');
      const contractId = await activeContract(token, 'pdf', 10);
      await renew(token, contractId, {
        start: iso(inDays(11)),
        end: iso(inDays(11 + 365)),
        rent: '120000',
        fee: { amount: '60000', currency: 'ARS' },
      }).expect(201);

      const pdf = await http()
        .get(`/api/contracts/${contractId}/periods/2/addendum`)
        .set(auth(token))
        .buffer(true)
        .parse((res, cb) => {
          const chunks: Buffer[] = [];
          res.on('data', (c: Buffer) => chunks.push(c));
          res.on('end', () => cb(null, Buffer.concat(chunks)));
        })
        .expect(200);
      expect(pdf.headers['content-type']).toContain('application/pdf');
      expect((pdf.body as Buffer).subarray(0, 4).toString()).toBe('%PDF');

      await http().get(`/api/contracts/${contractId}/periods/1/addendum`).set(auth(token)).expect(400);
      await http().get(`/api/contracts/${contractId}/periods/9/addendum`).set(auth(token)).expect(404);
    });
  });

  describe('contratos vencidos que siguen corriendo', () => {
    /** Un contrato importado como Vencido: sin fecha de cierre ni decisión. */
    async function expiredContract(token: string, prefix: string, endInDays: number) {
      const id = await activeContract(token, prefix, endInDays);
      await prisma.baseClient.contract.update({ where: { id }, data: { status: 'Vencido', closedAt: null } });
      return id;
    }
    const contractOf = async (token: string, id: string) =>
      (await http().get(`/api/contracts/${id}`).set(auth(token)).expect(200)).body;

    it('CP-490: el proceso diario sigue a los vencidos sin decisión y no a los cerrados', async () => {
      const { token } = await agency('vxx');
      const undecided = await expiredContract(token, 'und', -40);
      const closed = await expiredContract(token, 'clo', -40);
      await prisma.baseClient.contract.update({ where: { id: closed }, data: { closedAt: new Date() } });

      expect((await scheduler.openForAllTenants()).opened).toBe(1);
      const res = await list(token);
      expect(res.body.items.map((i: any) => i.contractId)).toEqual([undecided]);
      expect(res.body.items[0]).toMatchObject({ light: 'expired', kind: 'Renovacion' });
    });

    it('CP-491: la prórroga de palabra reactiva el vencido, lo audita y /activate no puede', async () => {
      const { token } = await agency('vpr');
      const id = await expiredContract(token, 'vpr', -40);
      await scheduler.openForAllTenants();

      await http().post(`/api/contracts/${id}/activate`).set(auth(token)).expect(409);
      await http()
        .post(`/api/contracts/${id}/oral-extension`)
        .set(auth(token))
        .send({ until: iso(inDays(120)), note: 'Sigue de palabra' })
        .expect(201);

      const contract = await contractOf(token, id);
      expect(contract.status).toBe('Activo');
      expect(contract.closedAt).toBeNull();
      expect(iso(new Date(contract.actualEndDate))).toBe(iso(inDays(120)));
      expect((await list(token, `?contractId=${id}`)).body.items[0]).toMatchObject({ status: 'Cerrado', outcome: 'Prorrogado' });
      const audit = await prisma.baseClient.auditLog.findMany({ where: { entityId: id } });
      const entry: any = audit.find((a: any) => a.changes?.operation === 'oral-extension');
      expect(entry.changes.before.status).toBe('Vencido');
      expect(entry.changes.after.status).toBe('Activo');
      expect(entry.changes.reactivated).toBe(true);
    });

    it('CP-492: la renovación reactiva el vencido y un rescindido sigue sin poder renovarse', async () => {
      const { token } = await agency('vrn');
      const id = await expiredContract(token, 'vrn', -40);
      const res = await http()
        .post(`/api/contracts/${id}/renew`)
        .set(auth(token))
        .send({ start: iso(inDays(-39)), end: iso(inDays(-39 + 365)), rent: '150000' })
        .expect(201);
      expect(res.body.contract.status).toBe('Activo');
      expect(res.body.contract.closedAt).toBeNull();
      expect(res.body.contract.rentAmount).toBe('150000');

      const dead = await activeContract(token, 'dead', 30);
      await http().post(`/api/contracts/${dead}/terminate`).set(auth(token)).expect(201);
      await http()
        .post(`/api/contracts/${dead}/renew`)
        .set(auth(token))
        .send({ start: iso(inDays(31)), end: iso(inDays(400)), rent: '1' })
        .expect(409);
    });
  });
});
