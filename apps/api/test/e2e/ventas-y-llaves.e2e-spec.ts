import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole, todayInAR } from '@realfy/shared';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import { SalesScheduler } from '../../src/modules/sales/sales.scheduler';
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
const inDays = (n: number) => iso(new Date(todayInAR().getTime() + n * DAY_MS));

/** CP-700 a CP-717: ventas (reserva, seña, boleto, escritura) y llaves. */
describe('Ventas y llaves (e2e)', () => {
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
      email: `${prefix}-admin@ven.test`,
      password: PASSWORD,
      firstName: 'Admin',
      lastName: 'Ventas',
    });
    const tokens: Record<string, string> = { [UserRole.Admin]: admin.accessToken };
    for (const role of [UserRole.Gerente, UserRole.Liquidaciones, UserRole.Lectura, UserRole.Ventas, UserRole.Soporte]) {
      const email = `${prefix}-${role.toLowerCase()}@ven.test`;
      await createUserDirect(prisma, admin.user.tenantId, { email, password: PASSWORD, role });
      tokens[role] = (await loginUser(app, email, PASSWORD)).accessToken;
    }
    return { token: admin.accessToken, tenantId: admin.user.tenantId as string, userId: admin.user.id as string, tokens };
  }

  async function person(token: string, email: string) {
    const p = await http().post('/api/persons').set(auth(token)).send({ firstName: 'Persona', lastName: 'Sintética', email }).expect(201);
    return p.body.id as string;
  }

  async function property(token: string, title: string, type = 'Departamento') {
    const res = await http()
      .post('/api/properties')
      .set(auth(token))
      .send({ title, type, street: 'Calle Ficticia', number: '200', city: 'Córdoba', province: 'Córdoba', area: 80, price: 120000, currency: 'USD' })
      .expect(201);
    return res.body.id as string;
  }

  /** Operación con un comprador y un vendedor. */
  async function sale(token: string, prefix: string, over: Record<string, unknown> = {}, type = 'Departamento') {
    const propertyId = await property(token, `Venta ${prefix}`, type);
    const buyer = await person(token, `${prefix}-c@ven.test`);
    const seller = await person(token, `${prefix}-v@ven.test`);
    const res = await http()
      .post('/api/sales-operations')
      .set(auth(token))
      .send({
        propertyId,
        status: 'Publicada',
        price: '120000',
        currency: 'USD',
        parties: [
          { role: 'Comprador', personId: buyer },
          { role: 'Vendedor', personId: seller },
        ],
        ...over,
      })
      .expect(201);
    return { id: res.body.id as string, propertyId, buyer, seller, body: res.body };
  }

  const move = (token: string, id: string, body: Record<string, unknown>, status = 200) =>
    http().post(`/api/sales-operations/${id}/transition`).set(auth(token)).send(body).expect(status);

  const addDeposit = (token: string, id: string, body: Record<string, unknown>, status = 201) =>
    http().post(`/api/sales-operations/${id}/deposits`).set(auth(token)).send(body).expect(status);

  const depositAction = (token: string, id: string, depositId: string, action: string, body: Record<string, unknown> = {}, status = 200) =>
    http().post(`/api/sales-operations/${id}/deposits/${depositId}/${action}`).set(auth(token)).send(body).expect(status);

  /** Lleva la operación hasta SenaRecibida con reserva y seña recibidas en caja. */
  async function toSena(token: string, id: string, buyer: string) {
    const reserva = await addDeposit(token, id, { kind: 'Reserva', amount: '2000', payerPersonId: buyer });
    await depositAction(token, id, reserva.body.id, 'receive');
    await move(token, id, { to: 'Reservada', agreedPrice: '115000' });
    const sena = await addDeposit(token, id, { kind: 'Sena', amount: '10000', payerPersonId: buyer });
    await depositAction(token, id, sena.body.id, 'receive', { method: 'Transferencia' });
    await move(token, id, { to: 'SenaRecibida' });
    return { reserva: reserva.body.id as string, sena: sena.body.id as string };
  }

  describe('operación', () => {
    it('CP-700: se crea con la documentación del inmueble y una propiedad tiene una sola operación abierta', async () => {
      const { token } = await agency('v700');
      const s = await sale(token, 'v700');
      expect(s.body).toMatchObject({ status: 'Publicada', exclusive: false, currency: 'USD', validTransitions: ['Captacion', 'Reservada', 'Cancelada'] });
      expect(s.body.docs.length).toBeGreaterThanOrEqual(8);
      expect(s.body.docProgress).toMatchObject({ done: 0 });
      expect(s.body.parties).toHaveLength(2);
      await http().post('/api/sales-operations').set(auth(token)).send({ propertyId: s.propertyId }).expect(409);
      const list = await http().get(`/api/properties/${s.propertyId}/sales-operations`).set(auth(token)).expect(200);
      expect(list.body.items).toHaveLength(1);
    });

    it('CP-701: las partes de cada lado reparten el 100 % y se pueden reemplazar', async () => {
      const { token } = await agency('v701');
      const s = await sale(token, 'v701');
      const other = await person(token, 'v701-o@ven.test');
      await http()
        .put(`/api/sales-operations/${s.id}/parties`)
        .set(auth(token))
        .send({ parties: [{ role: 'Vendedor', personId: s.seller, sharePct: '60' }, { role: 'Vendedor', personId: other, sharePct: '30' }] })
        .expect(400);
      const ok = await http()
        .put(`/api/sales-operations/${s.id}/parties`)
        .set(auth(token))
        .send({
          parties: [
            { role: 'Vendedor', personId: s.seller, sharePct: '60' },
            { role: 'Vendedor', personId: other, sharePct: '40' },
            { role: 'Comprador', personId: s.buyer },
          ],
        })
        .expect(200);
      expect(ok.body.parties).toHaveLength(3);
      await http().put(`/api/sales-operations/${s.id}/parties`).set(auth(token)).send({ parties: [{ role: 'Comprador', personId: '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11' }] }).expect(404);
    });

    it('CP-702: la operación sigue el recorrido reserva, seña, boleto y escritura; la escritura aplica las señas', async () => {
      const { token } = await agency('v702');
      const s = await sale(token, 'v702');
      await move(token, s.id, { to: 'Boleto', boletoDate: inDays(0) }, 400);
      const { reserva, sena } = await toSena(token, s.id, s.buyer);
      const docs = (await http().get(`/api/sales-operations/${s.id}`).set(auth(token)).expect(200)).body.docs as Array<{ code: string; required: boolean }>;
      for (const d of docs.filter((x) => x.required)) {
        await http().patch(`/api/sales-operations/${s.id}/docs/${d.code}`).set(auth(token)).send({ done: true }).expect(200);
      }
      const boleto = await move(token, s.id, { to: 'Boleto', boletoDate: inDays(0) });
      expect(boleto.body).toMatchObject({ status: 'Boleto', agreedPrice: '115000' });
      await move(token, s.id, { to: 'Escriturada', escrituraDate: inDays(1) }, 400);
      const done = await move(token, s.id, { to: 'Escriturada', escrituraDate: inDays(0) });
      expect(done.body.status).toBe('Escriturada');
      expect(done.body.closedAt).toBeTruthy();
      expect(done.body.deposits.map((d: any) => [d.id, d.status]).sort()).toEqual([[reserva, 'Aplicada'], [sena, 'Aplicada']].sort());
      await http().patch(`/api/sales-operations/${s.id}`).set(auth(token)).send({ exclusive: true }).expect(409);
      // Escriturada libera la propiedad para una nueva operación.
      await http().post('/api/sales-operations').set(auth(token)).send({ propertyId: s.propertyId }).expect(201);
    });

    it('CP-703: pasar a boleto exige la documentación obligatoria o el motivo de seguir sin ella', async () => {
      const { token } = await agency('v703');
      const s = await sale(token, 'v703');
      await toSena(token, s.id, s.buyer);
      const blocked = await move(token, s.id, { to: 'Boleto', boletoDate: inDays(0) }, 409);
      expect(blocked.body.error).toBe('DOCS_PENDING');
      const forced = await move(token, s.id, { to: 'Boleto', boletoDate: inDays(0), docsOverrideReason: 'el escribano reúne los informes' });
      expect(forced.body.status).toBe('Boleto');
      const audit = await prisma.baseClient.auditLog.findMany({ where: { entity: 'SalesOperation', entityId: s.id } });
      expect(JSON.stringify(audit.map((a) => a.changes))).toContain('el escribano reúne los informes');
    });
  });

  describe('reservas y señas', () => {
    it('CP-704: el dinero que guarda la inmobiliaria entra a su caja como seña y se recibe una sola vez', async () => {
      const { token } = await agency('v704');
      const s = await sale(token, 'v704');
      const dep = await addDeposit(token, s.id, { kind: 'Reserva', amount: '2000', payerPersonId: s.buyer });
      expect(dep.body).toMatchObject({ status: 'Pendiente', holder: 'Inmobiliaria', currency: 'USD' });
      expect(dep.body.expiresAt.slice(0, 10)).toBe(inDays(7));
      const got = await depositAction(token, s.id, dep.body.id, 'receive');
      expect(got.body.status).toBe('Recibida');
      await depositAction(token, s.id, dep.body.id, 'receive', {}, 409);
      const moves = await prisma.baseClient.cashMovement.findMany({ where: { sourceType: 'SalesDeposit', sourceId: dep.body.id } });
      expect(moves).toHaveLength(1);
      expect(moves[0]).toMatchObject({ direction: 'In', category: 'Sena', currency: 'USD', counterpartyId: s.buyer });
      expect(moves[0].amount.toString()).toBe('2000');
    });

    it('CP-705: si lo guarda el escribano o el vendedor solo se anota, sin caja', async () => {
      const { token } = await agency('v705');
      const s = await sale(token, 'v705');
      await addDeposit(token, s.id, { kind: 'Reserva', amount: '1000', payerPersonId: s.buyer }).then((d) => depositAction(token, s.id, d.body.id, 'receive'));
      await move(token, s.id, { to: 'Reservada' });
      const dep = await addDeposit(token, s.id, { kind: 'Sena', amount: '8000', holder: 'Escribano' });
      await depositAction(token, s.id, dep.body.id, 'receive');
      const moves = await prisma.baseClient.cashMovement.findMany({ where: { sourceId: dep.body.id } });
      expect(moves).toHaveLength(0);
    });

    it('CP-706: devolver sale de la caja por el importe indicado; retener solo se registra con su motivo', async () => {
      const { token } = await agency('v706');
      const s = await sale(token, 'v706');
      const { reserva, sena } = await toSena(token, s.id, s.buyer);
      await depositAction(token, s.id, sena, 'refund', { amount: '99999' }, 400);
      const refunded = await depositAction(token, s.id, sena, 'refund', { amount: '10000', note: 'el comprador se arrepintió' });
      expect(refunded.body).toMatchObject({ status: 'Devuelta', resolvedAmount: '10000' });
      const out = await prisma.baseClient.cashMovement.findMany({ where: { sourceType: 'SalesDepositRefund', sourceId: sena } });
      expect(out).toHaveLength(1);
      expect(out[0]).toMatchObject({ direction: 'Out', category: 'Sena' });
      await depositAction(token, s.id, sena, 'refund', {}, 409);
      await depositAction(token, s.id, reserva, 'forfeit', {}, 400);
      const kept = await depositAction(token, s.id, reserva, 'forfeit', { note: 'cláusula de pérdida' });
      expect(kept.body).toMatchObject({ status: 'Retenida', resolvedAmount: '2000', resolutionNote: 'cláusula de pérdida' });
      expect(await prisma.baseClient.cashMovement.count({ where: { sourceId: reserva, sourceType: { not: 'SalesDeposit' } } })).toBe(0);
    });

    it('CP-707: no se libera ni se cancela con dinero recibido sin resolver', async () => {
      const { token } = await agency('v707');
      const s = await sale(token, 'v707');
      const { reserva, sena } = await toSena(token, s.id, s.buyer);
      const stuck = await move(token, s.id, { to: 'Publicada' }, 409);
      expect(stuck.body.error).toBe('DEPOSITS_UNRESOLVED');
      await move(token, s.id, { to: 'Cancelada', reason: 'se cayó' }, 409);
      await depositAction(token, s.id, sena, 'refund');
      await depositAction(token, s.id, reserva, 'forfeit', { note: 'el comprador desistió' });
      const free = await move(token, s.id, { to: 'Publicada' });
      expect(free.body.status).toBe('Publicada');
    });

    it('CP-708: el proceso diario vence las reservas, libera la operación y deja a la vista el dinero ya recibido', async () => {
      const { token } = await agency('v708');
      const s = await sale(token, 'v708');
      const pending = await addDeposit(token, s.id, { kind: 'Reserva', amount: '1500', payerPersonId: s.buyer, expiresAt: inDays(2) });
      await move(token, s.id, { to: 'Reservada' });
      const scheduler = app.get(SalesScheduler);
      expect((await scheduler.expireForAllTenants(todayInAR())).expired).toBe(0);
      const later = new Date(todayInAR().getTime() + 3 * DAY_MS);
      expect((await scheduler.expireForAllTenants(later)).expired).toBe(1);
      expect((await scheduler.expireForAllTenants(later)).expired).toBe(0);
      const op = await http().get(`/api/sales-operations/${s.id}`).set(auth(token)).expect(200);
      expect(op.body.status).toBe('Publicada');
      expect(op.body.deposits.find((d: any) => d.id === pending.body.id).status).toBe('Vencida');
      await depositAction(token, s.id, pending.body.id, 'receive', {}, 409);

      const paid = await sale(token, 'v708b');
      const withMoney = await addDeposit(token, paid.id, { kind: 'Reserva', amount: '700', payerPersonId: paid.buyer, expiresAt: inDays(1) });
      await depositAction(token, paid.id, withMoney.body.id, 'receive');
      await move(token, paid.id, { to: 'Reservada' });
      await scheduler.expireForAllTenants(later);
      const held = await http().get('/api/sales-operations/deposits/pending').set(auth(token)).expect(200);
      expect(held.body.items.map((d: any) => d.id)).toContain(withMoney.body.id);
      expect(held.body.held).toEqual([{ currency: 'USD', holder: 'Inmobiliaria', amount: '700' }]);
      expect((await http().get(`/api/sales-operations/${paid.id}`).set(auth(token))).body.status).toBe('Publicada');
    });

    it('CP-709: se puede prorrogar una reserva y no se acepta un vencimiento pasado', async () => {
      const { token } = await agency('v709');
      const s = await sale(token, 'v709');
      const dep = await addDeposit(token, s.id, { kind: 'Reserva', amount: '1000' });
      const url = `/api/sales-operations/${s.id}/deposits/${dep.body.id}`;
      const ok = await http().patch(url).set(auth(token)).send({ expiresAt: inDays(20) }).expect(200);
      expect(ok.body.expiresAt.slice(0, 10)).toBe(inDays(20));
      await http().patch(url).set(auth(token)).send({ expiresAt: inDays(-1) }).expect(400);
      await addDeposit(token, s.id, { kind: 'Reserva', amount: '1000', expiresAt: inDays(-1) }, 400);
    });
  });

  describe('honorario', () => {
    it('CP-710: el honorario de venta lleva el vínculo a la operación, 3 % cada parte en un inmueble construido', async () => {
      const { token } = await agency('v710');
      const s = await sale(token, 'v710');
      await http().post(`/api/sales-operations/${s.id}/fee`).set(auth(token)).send({}).expect(409);
      await toSena(token, s.id, s.buyer);
      const proposal = await http().get(`/api/sales-operations/${s.id}/fee-proposal`).set(auth(token)).expect(200);
      expect(proposal.body).toMatchObject({ pct: '3', baseAmount: '115000', saleAsset: 'Construido' });
      const res = await http().post(`/api/sales-operations/${s.id}/fee`).set(auth(token)).send({}).expect(201);
      expect(res.body.fees).toHaveLength(2);
      const fees = await prisma.baseClient.fee.findMany({ where: { salesOpId: s.id }, orderBy: { payerRole: 'asc' } });
      expect(fees.map((f) => f.payerRole)).toEqual(['Comprador', 'Vendedor']);
      expect(fees[0]).toMatchObject({ kind: 'Venta', propertyId: s.propertyId, currency: 'USD' });
      expect(fees[0].total.toString()).toBe('3450');
      await http().post(`/api/sales-operations/${s.id}/fee`).set(auth(token)).send({}).expect(409);
    });

    it('CP-711: en un lote el porcentaje por defecto es 5 %', async () => {
      const { token } = await agency('v711');
      const s = await sale(token, 'v711', {}, 'Lote');
      await toSena(token, s.id, s.buyer);
      const proposal = await http().get(`/api/sales-operations/${s.id}/fee-proposal`).set(auth(token)).expect(200);
      expect(proposal.body).toMatchObject({ pct: '5', saleAsset: 'Lote' });
    });
  });

  describe('permisos y aislamiento', () => {
    it('CP-712: escribe Ventas y la administración; el dinero de las señas y el honorario solo la administración', async () => {
      const { token, tokens } = await agency('v712');
      const s = await sale(tokens[UserRole.Ventas], 'v712');
      for (const role of [UserRole.Lectura, UserRole.Liquidaciones, UserRole.Soporte]) {
        await http().post('/api/sales-operations').set(auth(tokens[role])).send({ propertyId: s.propertyId }).expect(403);
      }
      await http().get(`/api/sales-operations/${s.id}`).set(auth(tokens[UserRole.Lectura])).expect(200);
      await http().get(`/api/sales-operations/${s.id}`).set(auth(tokens[UserRole.Liquidaciones])).expect(403);
      const { sena } = await toSena(tokens[UserRole.Ventas], s.id, s.buyer);
      await depositAction(tokens[UserRole.Ventas], s.id, sena, 'refund', {}, 403);
      await depositAction(tokens[UserRole.Ventas], s.id, sena, 'forfeit', { note: 'x' }, 403);
      await http().get(`/api/sales-operations/${s.id}/fee-proposal`).set(auth(tokens[UserRole.Ventas])).expect(403);
      await depositAction(tokens[UserRole.Gerente], s.id, sena, 'refund');
      await http().get('/api/sales-operations?open=true').set(auth(token)).expect(200);
    });

    it('CP-713: otra inmobiliaria no ve ni toca las operaciones ni las llaves', async () => {
      const a = await agency('v713a');
      const b = await agency('v713b');
      const s = await sale(a.token, 'v713');
      await http().get(`/api/sales-operations/${s.id}`).set(auth(b.token)).expect(404);
      await move(b.token, s.id, { to: 'Cancelada', reason: 'x' }, 404);
      const list = await http().get('/api/sales-operations').set(auth(b.token)).expect(200);
      expect(list.body.total).toBe(0);
      const set = await http().post(`/api/properties/${s.propertyId}/keys`).set(auth(a.token)).send({ label: 'Principal' }).expect(201);
      await http().get(`/api/keys/${set.body.id}`).set(auth(b.token)).expect(404);
      await http().get(`/api/properties/${s.propertyId}/keys`).set(auth(b.token)).expect(404);
    });

    it('CP-714: cada cambio de etapa y cada movimiento de dinero queda en la bitácora', async () => {
      const { token } = await agency('v714');
      const s = await sale(token, 'v714');
      const { sena } = await toSena(token, s.id, s.buyer);
      await depositAction(token, s.id, sena, 'refund');
      const operations = (await prisma.baseClient.auditLog.findMany()).map((a) => (a.changes as any)?.operation).filter(Boolean);
      expect(operations).toEqual(expect.arrayContaining(['sales-create', 'sales-deposit-create', 'sales-deposit-receive', 'sales-transition', 'sales-deposit-refund']));
    });
  });

  describe('llaves', () => {
    it('CP-715: un juego se carga, sale a un empleado y vuelve a la oficina con su historial', async () => {
      const { token, userId } = await agency('v715');
      const propertyId = await property(token, 'Llaves v715');
      const created = await http().post(`/api/properties/${propertyId}/keys`).set(auth(token)).send({ label: 'Principal', copies: 2, location: 'Caja fuerte, gancho 4' }).expect(201);
      expect(created.body).toMatchObject({ holder: 'Oficina', copies: 2, openMovement: null, location: 'Caja fuerte, gancho 4' });
      const out = await http()
        .post(`/api/keys/${created.body.id}/check-out`)
        .set(auth(token))
        .send({ holder: 'Empleado', holderUserId: userId, reason: 'Visita con interesado', expectedReturnAt: inDays(1) })
        .expect(200);
      expect(out.body).toMatchObject({ holder: 'Empleado', overdue: false, openMovement: { reason: 'Visita con interesado' } });
      await http().post(`/api/keys/${created.body.id}/check-out`).set(auth(token)).send({ holder: 'Tercero', holderName: 'Plomero' }).expect(409);
      await http().patch(`/api/keys/${created.body.id}`).set(auth(token)).send({ isActive: false }).expect(409);
      const back = await http().post(`/api/keys/${created.body.id}/check-in`).set(auth(token)).send({ location: 'Gancho 5' }).expect(200);
      expect(back.body).toMatchObject({ holder: 'Oficina', openMovement: null, location: 'Gancho 5' });
      expect(back.body.movements).toHaveLength(1);
      expect(back.body.movements[0].returnedAt).toBeTruthy();
      await http().post(`/api/keys/${created.body.id}/check-in`).set(auth(token)).send({}).expect(409);
      const list = await http().get(`/api/properties/${propertyId}/keys`).set(auth(token)).expect(200);
      expect(list.body.items).toHaveLength(1);
    });

    it('CP-716: "llaves fuera" lista las salidas abiertas y señala las atrasadas', async () => {
      const { token } = await agency('v716');
      const propertyId = await property(token, 'Llaves v716');
      const owner = await person(token, 'v716-o@ven.test');
      const late = await http().post(`/api/properties/${propertyId}/keys`).set(auth(token)).send({ label: 'Principal' }).expect(201);
      const withOwner = await http()
        .post(`/api/properties/${propertyId}/keys`)
        .set(auth(token))
        .send({ label: 'Copia propietario', holder: 'Propietario', holderPersonId: owner })
        .expect(201);
      expect(withOwner.body.openMovement).toMatchObject({ holder: 'Propietario', holderPersonId: owner });
      await http()
        .post(`/api/keys/${late.body.id}/check-out`)
        .set(auth(token))
        .send({ holder: 'Tercero', holderName: 'Escribana Gómez', outAt: inDays(-5), expectedReturnAt: inDays(-2) })
        .expect(200);
      const all = await http().get('/api/keys/out').set(auth(token)).expect(200);
      expect(all.body.total).toBe(2);
      expect(all.body.items[0]).toMatchObject({ overdue: true, daysOverdue: 2, holderName: 'Escribana Gómez' });
      const overdue = await http().get('/api/keys/out?overdue=true').set(auth(token)).expect(200);
      expect(overdue.body.items).toHaveLength(1);
      const byHolder = await http().get('/api/keys/out?holder=Propietario').set(auth(token)).expect(200);
      expect(byHolder.body.items).toHaveLength(1);
    });

    it('CP-717: valida los datos de la salida y los permisos de las llaves', async () => {
      const { token, tokens } = await agency('v717');
      const propertyId = await property(token, 'Llaves v717');
      const set = await http().post(`/api/properties/${propertyId}/keys`).set(auth(tokens[UserRole.Ventas])).send({ label: 'Principal' }).expect(201);
      const url = `/api/keys/${set.body.id}/check-out`;
      await http().post(url).set(auth(token)).send({ holder: 'Oficina' }).expect(400);
      await http().post(url).set(auth(token)).send({ holder: 'Tercero' }).expect(400);
      await http().post(url).set(auth(token)).send({ holder: 'Tercero', holderName: 'X', outAt: inDays(1) }).expect(400);
      await http().post(url).set(auth(token)).send({ holder: 'Tercero', holderName: 'X', expectedReturnAt: inDays(-3) }).expect(400);
      await http().post(url).set(auth(token)).send({ holder: 'Propietario', holderPersonId: '0d9bdf7e-8f4c-4a52-9d8e-5b3b4a6b3c11' }).expect(404);
      await http().post(url).set(auth(tokens[UserRole.Lectura])).send({ holder: 'Tercero', holderName: 'X' }).expect(403);
      await http().get(`/api/properties/${propertyId}/keys`).set(auth(tokens[UserRole.Soporte])).expect(200);
      await http().get('/api/keys/out').set(auth(tokens[UserRole.Liquidaciones])).expect(403);
      await http().post(`/api/properties/${propertyId}/keys`).set(auth(tokens[UserRole.Soporte])).send({ label: 'Otra' }).expect(403);
    });
  });
});
