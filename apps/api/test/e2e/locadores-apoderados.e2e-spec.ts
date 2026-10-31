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

const START = '2026-01-01T00:00:00.000Z';
const END = '2028-01-01T00:00:00.000Z';

describe('Locadores, apoderados y titularidad (e2e)', () => {
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

  async function admin(email: string) {
    return registerUser(app, {
      email,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Prueba',
    });
  }

  async function createPerson(token: string, firstName: string, body: Record<string, unknown> = {}) {
    const res = await http()
      .post('/api/persons')
      .set(auth(token))
      .send({ firstName, lastName: 'Sintético', ...body })
      .expect(201);
    return res.body.id as string;
  }

  async function giveRole(token: string, personId: string, role: PersonRole) {
    await http().post(`/api/persons/${personId}/roles`).set(auth(token)).send({ role }).expect(201);
  }

  async function createProperty(token: string, title = 'Unidad de prueba') {
    const res = await http()
      .post('/api/properties')
      .set(auth(token))
      .send({ title, type: PropertyType.Departamento })
      .expect(201);
    return res.body.id as string;
  }

  function createContract(token: string, propertyId: string, extra: Record<string, unknown>) {
    return http()
      .post('/api/contracts')
      .set(auth(token))
      .send({
        propertyId,
        contractType: ContractType.Alquiler,
        startDate: START,
        endDate: END,
        rentAmount: '100000.00',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        guarantees: [],
        ...extra,
      });
  }

  const lessorsOf = async (token: string, contractId: string) =>
    (await http().get(`/api/contracts/${contractId}/lessors`).set(auth(token)).expect(200)).body as any[];

  // ─── Locadores del contrato ─────────────────────────

  describe('locadores del contrato', () => {
    it('CP-118 — tres propietarios en el alta se reparten el 100 % y el contrato se activa', async () => {
      const user = await admin('admin@lessors-1.test');
      const token = user.accessToken;
      const [a, b, c] = [
        await createPerson(token, 'Ana'),
        await createPerson(token, 'Beto'),
        await createPerson(token, 'Carla'),
      ];
      const tenant = await createPerson(token, 'Ines');
      await giveRole(token, tenant, PersonRole.Inquilino);
      const propertyId = await createProperty(token);

      const created = await createContract(token, propertyId, {
        persons: [
          { personId: a, role: PersonRole.Propietario },
          { personId: b, role: PersonRole.Propietario },
          { personId: c, role: PersonRole.Propietario },
          { personId: tenant, role: PersonRole.Inquilino },
        ],
      }).then((r) => {
        expect(r.status).toBe(201);
        return r.body;
      });

      // Los propietarios son locadores, no partes del contrato.
      expect(created.persons.map((p: any) => p.role)).toEqual([PersonRole.Inquilino]);
      expect(created.lessors).toHaveLength(3);
      const lessors = await lessorsOf(token, created.id);
      // Mayor porcentaje primero; Decimal se serializa sin ceros de relleno.
      expect(lessors.map((l) => l.payoutPct)).toEqual(['33.3334', '33.3333', '33.3333']);
      expect(lessors.every((l) => l.needsReview === true && l.capacity === 'Propietario')).toBe(true);

      await http().post(`/api/contracts/${created.id}/activate`).set(auth(token)).expect(201);
    });

    it('CP-118 — un borrador con locadores que no suman 100 no se activa; PUT los corrige', async () => {
      const user = await admin('admin@lessors-2.test');
      const token = user.accessToken;
      const [a, b] = [await createPerson(token, 'Ana'), await createPerson(token, 'Beto')];
      const tenant = await createPerson(token, 'Ines');
      await giveRole(token, tenant, PersonRole.Inquilino);
      const propertyId = await createProperty(token);

      const created = (
        await createContract(token, propertyId, {
          persons: [{ personId: tenant, role: PersonRole.Inquilino }],
          lessors: [
            { personId: a, payoutPct: '60' },
            { personId: b, payoutPct: '30' },
          ],
        }).expect(201)
      ).body;

      const rejected = await http()
        .post(`/api/contracts/${created.id}/activate`)
        .set(auth(token))
        .expect(400);
      expect(rejected.body.error).toBe('CONTRACT_NOT_ACTIVATABLE');
      expect(rejected.body.problems).toEqual([
        expect.objectContaining({
          code: 'LESSOR_SHARES_INVALID',
          invalidDates: [{ date: START, sum: '90.0000' }],
        }),
      ]);

      const rows = await lessorsOf(token, created.id);
      await http()
        .put(`/api/contracts/${created.id}/lessors`)
        .set(auth(token))
        .send({
          lessors: [
            { id: rows[0].id, personId: a, payoutPct: '60' },
            { id: rows[1].id, personId: b, payoutPct: '40' },
          ],
        })
        .expect(200);

      const activated = await http()
        .post(`/api/contracts/${created.id}/activate`)
        .set(auth(token))
        .expect(201);
      expect(activated.body.status).toBe(ContractStatus.Activo);
    });

    it('CP-118 — en un contrato activo los cambios sueltos no pueden romper la suma', async () => {
      const user = await admin('admin@lessors-3.test');
      const token = user.accessToken;
      const [a, b] = [await createPerson(token, 'Ana'), await createPerson(token, 'Beto')];
      const tenant = await createPerson(token, 'Ines');
      await giveRole(token, tenant, PersonRole.Inquilino);
      const propertyId = await createProperty(token);
      const created = (
        await createContract(token, propertyId, {
          persons: [
            { personId: a, role: PersonRole.Propietario },
            { personId: tenant, role: PersonRole.Inquilino },
          ],
        }).expect(201)
      ).body;
      await http().post(`/api/contracts/${created.id}/activate`).set(auth(token)).expect(201);

      // Sumar un segundo locador sin bajar al primero: 150 %.
      const tooMuch = await http()
        .post(`/api/contracts/${created.id}/lessors`)
        .set(auth(token))
        .send({ personId: b, payoutPct: '50' })
        .expect(400);
      expect(tooMuch.body.error).toBe('LESSOR_SHARES_INVALID');
      expect(tooMuch.body.details.invalidDates[0].sum).toBe('150.0000');
      expect(await lessorsOf(token, created.id)).toHaveLength(1);

      // Quitar al único locador deja el contrato sin quien cobre.
      const [only] = await lessorsOf(token, created.id);
      await http()
        .delete(`/api/contracts/${created.id}/lessors/${only.id}`)
        .set(auth(token))
        .expect(400);

      // El reparto se cambia de una vez con PUT.
      await http()
        .put(`/api/contracts/${created.id}/lessors`)
        .set(auth(token))
        .send({
          lessors: [
            { id: only.id, personId: a, payoutPct: '50' },
            { personId: b, payoutPct: '50' },
          ],
        })
        .expect(200);
      expect((await lessorsOf(token, created.id)).map((l) => l.payoutPct)).toEqual(['50', '50']);

      // Una cesión: b sale a mitad del contrato y entra otro desde ese día.
      const c = await createPerson(token, 'Carla');
      const cession = '2027-01-01T00:00:00.000Z';
      const current = await lessorsOf(token, created.id);
      const bRow = current.find((l) => l.personId === b)!;
      await http()
        .put(`/api/contracts/${created.id}/lessors`)
        .set(auth(token))
        .send({
          lessors: [
            { id: only.id, personId: a, payoutPct: '50' },
            { id: bRow.id, personId: b, payoutPct: '50', validTo: cession },
            { personId: c, payoutPct: '50', validFrom: cession },
          ],
        })
        .expect(200);
      const at = await http()
        .get(`/api/contracts/${created.id}/lessors?at=2027-06-01T00:00:00.000Z`)
        .set(auth(token))
        .expect(200);
      expect(at.body.map((l: any) => l.personId).sort()).toEqual([a, c].sort());
    });

    it('CP-118 — un locador sin rol de propietario puede firmar: se le pone el rol', async () => {
      const user = await admin('admin@lessors-4.test');
      const token = user.accessToken;
      const sinRol = await createPerson(token, 'Ana');
      const tenant = await createPerson(token, 'Ines');
      await giveRole(token, tenant, PersonRole.Inquilino);
      const propertyId = await createProperty(token);

      await createContract(token, propertyId, {
        persons: [{ personId: tenant, role: PersonRole.Inquilino }],
        lessors: [{ personId: sinRol, capacity: 'Usufructuario', payoutPct: '100' }],
      }).expect(201);

      const person = await http().get(`/api/persons/${sinRol}`).set(auth(token)).expect(200);
      expect(person.body.roles.map((r: any) => r.role)).toContain(PersonRole.Propietario);

      // Un inquilino sin rol sigue sin poder firmar.
      const otro = await createPerson(token, 'Beto');
      const rejected = await createContract(token, propertyId, {
        persons: [{ personId: otro, role: PersonRole.Inquilino }],
        lessors: [{ personId: sinRol, payoutPct: '100' }],
      });
      expect(rejected.status).toBe(400);
      expect(rejected.body.error).toBe('INVALID_PERSON_ROLE');
    });

    it('CP-118 — permisos y aislamiento de los locadores', async () => {
      const owner = await admin('admin@lessors-5.test');
      const token = owner.accessToken;
      const a = await createPerson(token, 'Ana');
      const propertyId = await createProperty(token);
      const created = (
        await createContract(token, propertyId, { lessors: [{ personId: a, payoutPct: '100' }] }).expect(201)
      ).body;
      await createUserDirect(prisma, owner.user.tenantId, {
        email: 'lectura@lessors-5.test',
        password: 'Password123!',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(app, 'lectura@lessors-5.test', 'Password123!');
      const other = await admin('admin@lessors-5-b.test');

      await http().get(`/api/contracts/${created.id}/lessors`).set(auth(lectura.accessToken)).expect(200);
      await http()
        .post(`/api/contracts/${created.id}/lessors`)
        .set(auth(lectura.accessToken))
        .send({ personId: a, payoutPct: '10' })
        .expect(403);
      await http().get(`/api/contracts/${created.id}/lessors`).set(auth(other.accessToken)).expect(404);
      await http()
        .post(`/api/contracts/${created.id}/lessors`)
        .set(auth(other.accessToken))
        .send({ personId: a, payoutPct: '10' })
        .expect(404);
    });
  });

  // ─── Apoderados ─────────────────────────────────────

  describe('apoderados', () => {
    it('CP-244 — poder general o de contrato, firma indistinta o conjunta, y rol Apoderado', async () => {
      const user = await admin('admin@powers-1.test');
      const token = user.accessToken;
      const principal = await createPerson(token, 'Ana');
      const [agent1, agent2] = [await createPerson(token, 'Beto'), await createPerson(token, 'Carla')];
      const propertyId = await createProperty(token);
      const contract = (
        await createContract(token, propertyId, { lessors: [{ personId: principal, payoutPct: '100' }] }).expect(201)
      ).body;

      const general = await http()
        .post(`/api/persons/${principal}/powers`)
        .set(auth(token))
        .send({ agentId: agent1, scopes: ['Cobrar', 'Firmar'] })
        .expect(201);
      expect(general.body).toMatchObject({
        signatureMode: 'Indistinta',
        groupKey: null,
        contractId: null,
        propertyId: null,
      });

      const joint = await Promise.all(
        [agent1, agent2].map((agentId) =>
          http()
            .post(`/api/persons/${principal}/powers`)
            .set(auth(token))
            .send({ agentId, scopes: ['Firmar'], signatureMode: 'Conjunta', contractId: contract.id })
            .expect(201),
        ),
      );
      expect(joint[0].body.groupKey).toBe(`${principal}:${contract.id}`);
      expect(joint[1].body.groupKey).toBe(joint[0].body.groupKey);

      // Como poderdante y como apoderado.
      const asPrincipal = await http().get(`/api/persons/${principal}/powers`).set(auth(token)).expect(200);
      expect(asPrincipal.body).toHaveLength(3);
      const asAgent = await http()
        .get(`/api/persons/${agent2}/powers?as=agent`)
        .set(auth(token))
        .expect(200);
      expect(asAgent.body).toHaveLength(1);
      expect(asAgent.body[0].principalId).toBe(principal);

      const agent = await http().get(`/api/persons/${agent1}`).set(auth(token)).expect(200);
      expect(agent.body.roles.map((r: any) => r.role)).toContain(PersonRole.Apoderado);

      // El detalle del contrato trae los apoderados vigentes.
      const detail = await http().get(`/api/contracts/${contract.id}`).set(auth(token)).expect(200);
      expect(detail.body.apoderados).toHaveLength(3);
    });

    it('CP-244 — alcances inválidos, poder a sí mismo y conjunta sin firma conjunta', async () => {
      const user = await admin('admin@powers-2.test');
      const token = user.accessToken;
      const principal = await createPerson(token, 'Ana');
      const agent = await createPerson(token, 'Beto');
      const post = (body: Record<string, unknown>) =>
        http().post(`/api/persons/${principal}/powers`).set(auth(token)).send(body);

      expect((await post({ agentId: agent, scopes: [] })).status).toBe(400);
      expect((await post({ agentId: agent, scopes: ['Vender'] })).status).toBe(400);
      expect((await post({ agentId: agent, scopes: ['Cobrar'], groupKey: 'g' })).status).toBe(400);
      const self = await post({ agentId: principal, scopes: ['Cobrar'] });
      expect(self.status).toBe(400);
      expect(self.body.error).toBe('POWER_SELF');
    });

    it('CP-244 — el cobrador de un locador necesita un poder de cobro; y no se puede revocar en uso', async () => {
      const user = await admin('admin@powers-3.test');
      const token = user.accessToken;
      const [principal, agent] = [await createPerson(token, 'Ana'), await createPerson(token, 'Beto')];
      const propertyId = await createProperty(token);
      const contract = (
        await createContract(token, propertyId, { lessors: [{ personId: principal, payoutPct: '100' }] }).expect(201)
      ).body;
      const [lessor] = await lessorsOf(token, contract.id);

      const without = await http()
        .patch(`/api/contracts/${contract.id}/lessors/${lessor.id}`)
        .set(auth(token))
        .send({ payeePersonId: agent })
        .expect(400);
      expect(without.body.error).toBe('PAYEE_WITHOUT_POWER');

      // Un poder que no es para cobrar no alcanza.
      await http()
        .post(`/api/persons/${principal}/powers`)
        .set(auth(token))
        .send({ agentId: agent, scopes: ['Firmar'] })
        .expect(201);
      await http()
        .patch(`/api/contracts/${contract.id}/lessors/${lessor.id}`)
        .set(auth(token))
        .send({ payeePersonId: agent })
        .expect(400);

      const power = await http()
        .post(`/api/persons/${principal}/powers`)
        .set(auth(token))
        .send({ agentId: agent, scopes: ['Cobrar'], contractId: contract.id })
        .expect(201);
      await http()
        .patch(`/api/contracts/${contract.id}/lessors/${lessor.id}`)
        .set(auth(token))
        .send({ payeePersonId: agent })
        .expect(200);

      const inUse = await http()
        .delete(`/api/persons/${principal}/powers/${power.body.id}`)
        .set(auth(token))
        .expect(409);
      expect(inUse.body.error).toBe('POWER_IN_USE');

      await http()
        .patch(`/api/contracts/${contract.id}/lessors/${lessor.id}`)
        .set(auth(token))
        .send({ payeePersonId: null })
        .expect(200);
      await http()
        .delete(`/api/persons/${principal}/powers/${power.body.id}`)
        .set(auth(token))
        .expect(200);
    });

    it('CP-244 — la cuenta de cobro tiene que ser del locador', async () => {
      const user = await admin('admin@powers-4.test');
      const token = user.accessToken;
      const [a, b] = [await createPerson(token, 'Ana'), await createPerson(token, 'Beto')];
      const propertyId = await createProperty(token);
      const contract = (
        await createContract(token, propertyId, { lessors: [{ personId: a, payoutPct: '100' }] }).expect(201)
      ).body;
      const [lessor] = await lessorsOf(token, contract.id);
      const mine = (
        await http()
          .post(`/api/persons/${a}/bank-accounts`)
          .set(auth(token))
          .send({ currency: 'ARS', cbu: '0000000000000000000001' })
          .expect(201)
      ).body;
      const theirs = (
        await http()
          .post(`/api/persons/${b}/bank-accounts`)
          .set(auth(token))
          .send({ currency: 'ARS', cbu: '0000000000000000000002' })
          .expect(201)
      ).body;

      const rejected = await http()
        .patch(`/api/contracts/${contract.id}/lessors/${lessor.id}`)
        .set(auth(token))
        .send({ bankAccountId: theirs.id })
        .expect(400);
      expect(rejected.body.error).toBe('BANK_ACCOUNT_NOT_OF_LESSOR');
      await http()
        .patch(`/api/contracts/${contract.id}/lessors/${lessor.id}`)
        .set(auth(token))
        .send({ bankAccountId: mine.id })
        .expect(200);
    });
  });

  // ─── Titularidad ────────────────────────────────────

  describe('titularidad de propiedades', () => {
    it('CP-246 — se registra sin exigir que sume 100 y se lista y se quita', async () => {
      const user = await admin('admin@ownership-1.test');
      const token = user.accessToken;
      const [a, b] = [await createPerson(token, 'Ana'), await createPerson(token, 'Beto')];
      const propertyId = await createProperty(token);

      const first = await http()
        .post(`/api/properties/${propertyId}/ownerships`)
        .set(auth(token))
        .send({ personId: a, sharePct: '30', title: 'Escritura' })
        .expect(201);
      await http()
        .post(`/api/properties/${propertyId}/ownerships`)
        .set(auth(token))
        .send({ personId: b })
        .expect(201);

      const list = await http().get(`/api/properties/${propertyId}/ownerships`).set(auth(token)).expect(200);
      expect(list.body.map((o: any) => [o.personId, o.sharePct])).toEqual([
        [a, '30'],
        [b, null],
      ]);
      const person = await http().get(`/api/persons/${b}`).set(auth(token)).expect(200);
      expect(person.body.roles.map((r: any) => r.role)).toContain(PersonRole.Propietario);

      await http()
        .delete(`/api/properties/${propertyId}/ownerships/${first.body.id}`)
        .set(auth(token))
        .expect(200);
      expect(
        (await http().get(`/api/properties/${propertyId}/ownerships`).set(auth(token)).expect(200)).body,
      ).toHaveLength(1);
    });

    it('CP-246 — asignar el rol Propietario con una propiedad crea la titularidad y ya no guarda propertyId', async () => {
      const user = await admin('admin@ownership-2.test');
      const token = user.accessToken;
      const a = await createPerson(token, 'Ana');
      const propertyId = await createProperty(token);

      const role = await http()
        .post(`/api/persons/${a}/roles`)
        .set(auth(token))
        .send({ role: PersonRole.Propietario, propertyId })
        .expect(201);

      expect(role.body.propertyId).toBeNull();
      const list = await http().get(`/api/properties/${propertyId}/ownerships`).set(auth(token)).expect(200);
      expect(list.body.map((o: any) => o.personId)).toEqual([a]);
    });

    it('CP-246 — permisos y aislamiento', async () => {
      const owner = await admin('admin@ownership-3.test');
      const a = await createPerson(owner.accessToken, 'Ana');
      const propertyId = await createProperty(owner.accessToken);
      const other = await admin('admin@ownership-3-b.test');
      await createUserDirect(prisma, owner.user.tenantId, {
        email: 'lectura@ownership-3.test',
        password: 'Password123!',
        role: UserRole.Lectura,
      });
      const lectura = await loginUser(app, 'lectura@ownership-3.test', 'Password123!');

      await http()
        .post(`/api/properties/${propertyId}/ownerships`)
        .set(auth(lectura.accessToken))
        .send({ personId: a })
        .expect(403);
      await http()
        .post(`/api/properties/${propertyId}/ownerships`)
        .set(auth(other.accessToken))
        .send({ personId: a })
        .expect(404);
    });
  });

  // ─── Plantillas ─────────────────────────────────────

  describe('plantillas', () => {
    it('CP-248 — las variables traen locadores y apoderados, y propietario.* sigue funcionando', async () => {
      const user = await admin('admin@templates-1.test');
      const token = user.accessToken;
      const a = await createPerson(token, 'Ana', { dni: '10000001', address: 'Calle Falsa 1' });
      const b = await createPerson(token, 'Beto');
      const agent = await createPerson(token, 'Carla');
      const propertyId = await createProperty(token);
      const contract = (
        await createContract(token, propertyId, {
          lessors: [
            { personId: a, payoutPct: '60' },
            { personId: b, capacity: 'Usufructuario', payoutPct: '40' },
          ],
        }).expect(201)
      ).body;
      await http()
        .post(`/api/persons/${a}/powers`)
        .set(auth(token))
        .send({ agentId: agent, scopes: ['Firmar'], contractId: contract.id })
        .expect(201);

      const vars = (
        await http().get(`/api/contracts/${contract.id}/template-variables`).set(auth(token)).expect(200)
      ).body;

      expect(vars['locadores.cantidad']).toBe('2');
      expect(vars['locadores.1.nombreCompleto']).toBe('Ana Sintético');
      expect(vars['locadores.1.documento']).toBe('10000001');
      expect(vars['locadores.1.domicilio']).toBe('Calle Falsa 1');
      expect(vars['locadores.1.porcentaje']).toBe('60 %');
      expect(vars['locadores.2.capacidad']).toBe('Usufructuario');
      expect(vars['locador.nombreCompleto']).toBe('Ana Sintético');
      expect(vars['propietario.nombreCompleto']).toBe('Ana Sintético');
      expect(vars['apoderados.1.nombreCompleto']).toBe('Carla Sintético');
      expect(vars['apoderados.1.poderdante']).toBe('Ana Sintético');
    });
  });
});
