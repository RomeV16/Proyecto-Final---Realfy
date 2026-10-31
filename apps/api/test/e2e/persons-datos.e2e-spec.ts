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

const CBU_1 = '0000000000000000000001';
const CBU_2 = '0000000000000000000002';

describe('Datos de persona, cuentas bancarias y referencias externas (e2e)', () => {
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

  const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

  async function admin(email: string) {
    return registerUser(app, {
      email,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Prueba',
    });
  }

  async function createPerson(token: string, body: Record<string, unknown> = {}) {
    const res = await request(app.getHttpServer())
      .post('/api/persons')
      .set(auth(token))
      .send({ firstName: 'Ana', lastName: 'Prueba', ...body });
    return res;
  }

  async function createProperty(token: string, body: Record<string, unknown> = {}) {
    return request(app.getHttpServer())
      .post('/api/properties')
      .set(auth(token))
      .send({ title: 'Unidad de prueba', type: PropertyType.Departamento, ...body });
  }

  // ─── Datos de persona ───────────────────────────────

  describe('datos de persona', () => {
    it('CP-110 — guarda tipo de persona, documento, domicilio y forma de cobro', async () => {
      const user = await admin('admin@datos-persona.test');
      const res = await createPerson(user.accessToken, {
        personType: 'Juridica',
        dni: '00000001',
        address: 'Calle Falsa 123, Ciudad de prueba',
        maritalStatus: 'Soltero',
        nationality: 'Argentina',
        payoutMethod: 'Custodia',
      }).then((r) => {
        expect(r.status).toBe(201);
        return r;
      });

      expect(res.body).toMatchObject({
        personType: 'Juridica',
        dni: '00000001',
        payoutMethod: 'Custodia',
        bankAccounts: [],
      });

      const defaulted = await createPerson(user.accessToken, { firstName: 'Beto' });
      expect(defaulted.body.personType).toBe('Fisica');
      expect(defaulted.body.payoutMethod).toBeNull();
    });
  });

  // ─── Cuentas bancarias ──────────────────────────────

  describe('cuentas bancarias', () => {
    it('CP-111 — alta, listado, edición y baja; una predeterminada por moneda', async () => {
      const user = await admin('admin@cuentas.test');
      const person = (await createPerson(user.accessToken)).body;
      const base = `/api/persons/${person.id}/bank-accounts`;

      const ars1 = await request(app.getHttpServer())
        .post(base)
        .set(auth(user.accessToken))
        .send({ currency: 'ARS', bankName: 'Banco Ficticio', cbu: CBU_1 })
        .expect(201);
      expect(ars1.body.isDefault).toBe(true);
      expect(ars1.body.holder).toBe('Ana Prueba');

      const usd = await request(app.getHttpServer())
        .post(base)
        .set(auth(user.accessToken))
        .send({ currency: 'USD', alias: 'ana.usd' })
        .expect(201);
      expect(usd.body.isDefault).toBe(true);

      const ars2 = await request(app.getHttpServer())
        .post(base)
        .set(auth(user.accessToken))
        .send({ currency: 'ARS', cbu: CBU_2 })
        .expect(201);
      expect(ars2.body.isDefault).toBe(false);

      // La default de ARS no se puede soltar ni borrar mientras haya otra.
      const unset = await request(app.getHttpServer())
        .patch(`${base}/${ars1.body.id}`)
        .set(auth(user.accessToken))
        .send({ isDefault: false })
        .expect(409);
      expect(unset.body.error).toBe('BANK_ACCOUNT_DEFAULT_REQUIRED');
      await request(app.getHttpServer())
        .delete(`${base}/${ars1.body.id}`)
        .set(auth(user.accessToken))
        .expect(409);

      // Promover la segunda intercambia la predeterminada, sin tocar USD.
      await request(app.getHttpServer())
        .patch(`${base}/${ars2.body.id}`)
        .set(auth(user.accessToken))
        .send({ isDefault: true, holder: 'Ana Prueba SRL' })
        .expect(200);

      const list = await request(app.getHttpServer())
        .get(base)
        .set(auth(user.accessToken))
        .expect(200);
      const byId = Object.fromEntries(list.body.map((a: any) => [a.id, a]));
      expect(byId[ars1.body.id].isDefault).toBe(false);
      expect(byId[ars2.body.id]).toMatchObject({ isDefault: true, holder: 'Ana Prueba SRL' });
      expect(byId[usd.body.id].isDefault).toBe(true);

      await request(app.getHttpServer())
        .delete(`${base}/${ars1.body.id}`)
        .set(auth(user.accessToken))
        .expect(200);

      // El detalle de la persona trae las cuentas y ya no las columnas viejas.
      const detail = await request(app.getHttpServer())
        .get(`/api/persons/${person.id}`)
        .set(auth(user.accessToken))
        .expect(200);
      expect(detail.body.bankAccounts).toHaveLength(2);
      expect(detail.body).not.toHaveProperty('cbu');
    });

    it('CP-111 — valida el CBU y la moneda', async () => {
      const user = await admin('admin@cuentas-val.test');
      const person = (await createPerson(user.accessToken)).body;
      const res = await request(app.getHttpServer())
        .post(`/api/persons/${person.id}/bank-accounts`)
        .set(auth(user.accessToken))
        .send({ currency: 'EUR', cbu: '12' })
        .expect(400);
      expect(res.body.error).toBe('VALIDATION_ERROR');
    });

    it('CP-112 — los campos bancarios planos de la persona se guardan como cuenta ARS predeterminada', async () => {
      const user = await admin('admin@cuentas-atajo.test');
      const created = await createPerson(user.accessToken, {
        bankName: 'Banco Ficticio',
        cbu: CBU_1,
        bankAlias: 'ana.prueba',
      });
      expect(created.status).toBe(201);
      expect(created.body.bankAccounts).toHaveLength(1);
      expect(created.body.bankAccounts[0]).toMatchObject({
        currency: 'ARS',
        isDefault: true,
        cbu: CBU_1,
        alias: 'ana.prueba',
      });
      expect(created.body).not.toHaveProperty('bankName');

      const patched = await request(app.getHttpServer())
        .patch(`/api/persons/${created.body.id}`)
        .set(auth(user.accessToken))
        .send({ bankName: 'Otro Banco' })
        .expect(200);
      expect(patched.body.bankAccounts).toHaveLength(1);
      expect(patched.body.bankAccounts[0]).toMatchObject({ bankName: 'Otro Banco', cbu: CBU_1 });

      // Las columnas deprecadas no se escriben.
      const raw = await prisma.baseClient.$queryRaw<{ cbu: string | null }[]>`
        SELECT "cbu" FROM "persons" WHERE "id" = ${created.body.id}`;
      expect(raw[0].cbu).toBeNull();
    });

    it('CP-113 — aislamiento: la persona de otra inmobiliaria responde 404 y el listado no mezcla cuentas', async () => {
      const a = await admin('admin@cuentas-a.test');
      const b = await admin('admin@cuentas-b.test');
      const personA = (await createPerson(a.accessToken)).body;
      const accA = (
        await request(app.getHttpServer())
          .post(`/api/persons/${personA.id}/bank-accounts`)
          .set(auth(a.accessToken))
          .send({ currency: 'ARS', cbu: CBU_1 })
          .expect(201)
      ).body;
      const personB = (await createPerson(b.accessToken, { firstName: 'Beto' })).body;
      await request(app.getHttpServer())
        .post(`/api/persons/${personB.id}/bank-accounts`)
        .set(auth(b.accessToken))
        .send({ currency: 'ARS', cbu: CBU_2 })
        .expect(201);

      const base = `/api/persons/${personA.id}/bank-accounts`;
      await request(app.getHttpServer()).get(base).set(auth(b.accessToken)).expect(404);
      await request(app.getHttpServer())
        .post(base)
        .set(auth(b.accessToken))
        .send({ currency: 'USD', alias: 'x' })
        .expect(404);
      await request(app.getHttpServer())
        .patch(`${base}/${accA.id}`)
        .set(auth(b.accessToken))
        .send({ alias: 'robado' })
        .expect(404);
      await request(app.getHttpServer())
        .delete(`${base}/${accA.id}`)
        .set(auth(b.accessToken))
        .expect(404);

      // La cuenta de A sigue intacta y B solo ve las suyas.
      const mine = await request(app.getHttpServer())
        .get(`/api/persons/${personB.id}/bank-accounts`)
        .set(auth(b.accessToken))
        .expect(200);
      expect(mine.body).toHaveLength(1);
      expect(mine.body[0].cbu).toBe(CBU_2);
      const still = await prisma.baseClient.personBankAccount.findUnique({ where: { id: accA.id } });
      expect(still?.alias).toBeNull();
    });

    it('CP-114 — permisos: Lectura lee pero no escribe; Ventas escribe', async () => {
      const owner = await admin('admin@cuentas-rbac.test');
      const person = (await createPerson(owner.accessToken)).body;
      for (const [email, role] of [
        ['lectura@cuentas-rbac.test', UserRole.Lectura],
        ['ventas@cuentas-rbac.test', UserRole.Ventas],
      ] as const) {
        await createUserDirect(prisma, owner.user.tenantId, {
          email,
          password: 'Password123!',
          role,
        });
      }
      const lectura = await loginUser(app, 'lectura@cuentas-rbac.test', 'Password123!');
      const ventas = await loginUser(app, 'ventas@cuentas-rbac.test', 'Password123!');
      const base = `/api/persons/${person.id}/bank-accounts`;

      await request(app.getHttpServer()).get(base).set(auth(lectura.accessToken)).expect(200);
      await request(app.getHttpServer())
        .post(base)
        .set(auth(lectura.accessToken))
        .send({ currency: 'ARS', cbu: CBU_1 })
        .expect(403);

      const created = await request(app.getHttpServer())
        .post(base)
        .set(auth(ventas.accessToken))
        .send({ currency: 'ARS', cbu: CBU_1 })
        .expect(201);
      await request(app.getHttpServer())
        .patch(`${base}/${created.body.id}`)
        .set(auth(lectura.accessToken))
        .send({ alias: 'x' })
        .expect(403);
      await request(app.getHttpServer())
        .delete(`${base}/${created.body.id}`)
        .set(auth(lectura.accessToken))
        .expect(403);
      await request(app.getHttpServer())
        .delete(`${base}/${created.body.id}`)
        .set(auth(ventas.accessToken))
        .expect(200);
    });
  });

  // ─── Referencias externas ───────────────────────────

  describe('referencia externa', () => {
    it('CP-115 — persona: duplicada en la misma inmobiliaria da 409, en otra se permite; filtrable', async () => {
      const a = await admin('admin@ref-persona-a.test');
      const b = await admin('admin@ref-persona-b.test');

      const first = await createPerson(a.accessToken, { externalRef: 'LEG-P-1' });
      expect(first.status).toBe(201);
      const dup = await createPerson(a.accessToken, { firstName: 'Otra', externalRef: 'LEG-P-1' });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toBe('EXTERNAL_REF_TAKEN');
      const otherTenant = await createPerson(b.accessToken, { externalRef: 'LEG-P-1' });
      expect(otherTenant.status).toBe(201);

      // Varias personas sin referencia conviven (NULL no choca).
      expect((await createPerson(a.accessToken, { firstName: 'Sin1' })).status).toBe(201);
      expect((await createPerson(a.accessToken, { firstName: 'Sin2' })).status).toBe(201);

      // Editar a una referencia ocupada también da 409.
      const second = await createPerson(a.accessToken, { firstName: 'Segunda', externalRef: 'LEG-P-2' });
      const clash = await request(app.getHttpServer())
        .patch(`/api/persons/${second.body.id}`)
        .set(auth(a.accessToken))
        .send({ externalRef: 'LEG-P-1' })
        .expect(409);
      expect(clash.body.error).toBe('EXTERNAL_REF_TAKEN');

      const list = await request(app.getHttpServer())
        .get('/api/persons?externalRef=LEG-P-1')
        .set(auth(a.accessToken))
        .expect(200);
      expect(list.body.items).toHaveLength(1);
      expect(list.body.items[0].id).toBe(first.body.id);
    });

    it('CP-115 — propiedad: duplicada da 409, en otra inmobiliaria se permite; filtrable', async () => {
      const a = await admin('admin@ref-prop-a.test');
      const b = await admin('admin@ref-prop-b.test');

      const first = await createProperty(a.accessToken, { externalRef: 'LEG-U-1' });
      expect(first.status).toBe(201);
      const dup = await createProperty(a.accessToken, { externalRef: 'LEG-U-1' });
      expect(dup.status).toBe(409);
      expect(dup.body.error).toBe('EXTERNAL_REF_TAKEN');
      expect((await createProperty(b.accessToken, { externalRef: 'LEG-U-1' })).status).toBe(201);

      const list = await request(app.getHttpServer())
        .get('/api/properties?externalRef=LEG-U-1')
        .set(auth(a.accessToken))
        .expect(200);
      expect(list.body.items.map((p: any) => p.id)).toEqual([first.body.id]);
    });

    it('CP-115 — contrato: duplicado da 409, en otra inmobiliaria se permite; filtrable', async () => {
      const a = await admin('admin@ref-contrato-a.test');
      const b = await admin('admin@ref-contrato-b.test');

      async function createContract(token: string, externalRef: string) {
        const property = (await createProperty(token)).body;
        const owner = (await createPerson(token, { firstName: 'Duenio' })).body;
        const tenant = (await createPerson(token, { firstName: 'Inquilino' })).body;
        for (const [p, role] of [
          [owner, PersonRole.Propietario],
          [tenant, PersonRole.Inquilino],
        ] as const) {
          await request(app.getHttpServer())
            .post(`/api/persons/${p.id}/roles`)
            .set(auth(token))
            .send({ role })
            .expect(201);
        }
        return request(app.getHttpServer())
          .post('/api/contracts')
          .set(auth(token))
          .send({
            propertyId: property.id,
            contractType: ContractType.Alquiler,
            status: ContractStatus.Borrador,
            startDate: '2026-01-01T00:00:00.000Z',
            endDate: '2028-01-01T00:00:00.000Z',
            rentAmount: '150000.00',
            adjustmentType: AdjustmentType.IPC,
            adjustmentPeriod: AdjustmentPeriod.Trimestral,
            externalRef,
            persons: [
              { personId: owner.id, role: PersonRole.Propietario },
              { personId: tenant.id, role: PersonRole.Inquilino },
            ],
          });
      }

      const first = await createContract(a.accessToken, 'LEG-C-1');
      expect(first.status).toBe(201);
      expect(first.body.externalRef).toBe('LEG-C-1');
      const dup = await createContract(a.accessToken, 'LEG-C-1');
      expect(dup.status).toBe(409);
      expect(dup.body.error).toBe('EXTERNAL_REF_TAKEN');
      expect((await createContract(b.accessToken, 'LEG-C-1')).status).toBe(201);

      const list = await request(app.getHttpServer())
        .get('/api/contracts?externalRef=LEG-C-1')
        .set(auth(a.accessToken))
        .expect(200);
      expect(list.body.items.map((c: any) => c.id)).toEqual([first.body.id]);
    });
  });

  // ─── Catastro y edificio ────────────────────────────

  describe('catastro y edificio padre', () => {
    it('CP-116 — acepta catastro y un edificio padre de la misma inmobiliaria', async () => {
      const user = await admin('admin@edificio.test');
      const building = (await createProperty(user.accessToken, { title: 'Edificio' })).body;
      const unit = await createProperty(user.accessToken, {
        title: 'Unidad 3B',
        cadastralId: '00-00-000-0000',
        parentPropertyId: building.id,
      });
      expect(unit.status).toBe(201);
      expect(unit.body).toMatchObject({
        cadastralId: '00-00-000-0000',
        parentPropertyId: building.id,
      });

      const units = await request(app.getHttpServer())
        .get(`/api/properties?parentPropertyId=${building.id}`)
        .set(auth(user.accessToken))
        .expect(200);
      expect(units.body.items.map((p: any) => p.id)).toEqual([unit.body.id]);
    });

    it('CP-116 — rechaza ser su propio padre, un padre de otra inmobiliaria y los ciclos', async () => {
      const a = await admin('admin@edificio-a.test');
      const b = await admin('admin@edificio-b.test');
      const buildingA = (await createProperty(a.accessToken, { title: 'Edificio A' })).body;
      const foreign = (await createProperty(b.accessToken, { title: 'Edificio B' })).body;

      const self = await request(app.getHttpServer())
        .patch(`/api/properties/${buildingA.id}`)
        .set(auth(a.accessToken))
        .send({ parentPropertyId: buildingA.id })
        .expect(400);
      expect(self.body.error).toBe('PROPERTY_SELF_PARENT');

      const cross = await createProperty(a.accessToken, { parentPropertyId: foreign.id });
      expect(cross.status).toBe(404);
      expect(cross.body.error).toBe('PARENT_PROPERTY_NOT_FOUND');

      const unit = (
        await createProperty(a.accessToken, { title: 'Unidad', parentPropertyId: buildingA.id })
      ).body;
      const cycle = await request(app.getHttpServer())
        .patch(`/api/properties/${buildingA.id}`)
        .set(auth(a.accessToken))
        .send({ parentPropertyId: unit.id })
        .expect(400);
      expect(cycle.body.error).toBe('PROPERTY_PARENT_CYCLE');

      // Soltar el padre es válido.
      const cleared = await request(app.getHttpServer())
        .patch(`/api/properties/${unit.id}`)
        .set(auth(a.accessToken))
        .send({ parentPropertyId: null })
        .expect(200);
      expect(cleared.body.parentPropertyId).toBeNull();
    });
  });
});
