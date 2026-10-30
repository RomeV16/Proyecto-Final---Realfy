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
  ContractStatus,
  AdjustmentPeriod,
  AdjustmentType,
  ContractType,
  PersonRole,
  PropertyOperationType,
  PropertyState,
  PropertyType,
  UserRole,
} from '@realfy/shared';

describe('Contract activation (e2e)', () => {
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

  // ─── Helpers ─────────────────────────────────────────

  const http = () => request(app.getHttpServer());

  async function admin(prefix: string) {
    return registerUser(app, {
      email: `${prefix}@activation.test`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Activacion',
    });
  }

  async function createProperty(token: string, title = 'Depto Activación') {
    const res = await http()
      .post('/api/properties')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title,
        type: PropertyType.Departamento,
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
    return res.body.id as string;
  }

  async function createPerson(token: string, role: PersonRole, email: string) {
    const p = await http()
      .post('/api/persons')
      .set('Authorization', `Bearer ${token}`)
      .send({ firstName: role, lastName: 'Sintético', email })
      .expect(201);
    await http()
      .post(`/api/persons/${p.body.id}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role })
      .expect(201);
    return p.body.id as string;
  }

  async function createRentalOperation(token: string, propertyId: string, state?: PropertyState) {
    const res = await http()
      .post(`/api/properties/${propertyId}/operations`)
      .set('Authorization', `Bearer ${token}`)
      .send({
        operationType: PropertyOperationType.Alquiler,
        ...(state ? { state } : {}),
      })
      .expect(201);
    return res.body.id as string;
  }

  /** Crea un contrato en Borrador con las partes que se indiquen. */
  async function createDraft(
    token: string,
    propertyId: string,
    persons: Array<{ personId: string; role: PersonRole }>,
    dates = { startDate: '2026-01-01T00:00:00.000Z', endDate: '2028-01-01T00:00:00.000Z' },
  ) {
    const res = await http()
      .post('/api/contracts')
      .set('Authorization', `Bearer ${token}`)
      .send({
        propertyId,
        contractType: ContractType.Alquiler,
        ...dates,
        rentAmount: '100000.00',
        rentCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        persons,
        guarantees: [],
      })
      .expect(201);
    expect(res.body.status).toBe(ContractStatus.Borrador);
    return res.body.id as string;
  }

  async function completeDraft(token: string, prefix: string, propertyId: string) {
    const owner = await createPerson(token, PersonRole.Propietario, `${prefix}-o@activation.test`);
    const tenant = await createPerson(token, PersonRole.Inquilino, `${prefix}-t@activation.test`);
    return createDraft(token, propertyId, [
      { personId: owner, role: PersonRole.Propietario },
      { personId: tenant, role: PersonRole.Inquilino },
    ]);
  }

  async function rentalState(token: string, propertyId: string) {
    const res = await http()
      .get(`/api/properties/${propertyId}`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    return res.body.operations.find(
      (o: any) => o.operationType === PropertyOperationType.Alquiler,
    )?.state;
  }

  // ─── Activación correcta ─────────────────────────────

  describe('POST /contracts/:id/activate', () => {
    it('activa el contrato y deja la operación de alquiler en Alquilado', async () => {
      const user = await admin('ok');
      const propertyId = await createProperty(user.accessToken);
      await createRentalOperation(user.accessToken, propertyId, PropertyState.Disponible);
      const contractId = await completeDraft(user.accessToken, 'ok', propertyId);

      const res = await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      expect(res.body.status).toBe(ContractStatus.Activo);
      expect(await rentalState(user.accessToken, propertyId)).toBe(PropertyState.Alquilado);

      const detail = await http()
        .get(`/api/contracts/${contractId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(detail.body.status).toBe(ContractStatus.Activo);
    });

    it('crea la operación ya alquilada si la propiedad no tenía una', async () => {
      const user = await admin('noop');
      const propertyId = await createProperty(user.accessToken);
      const contractId = await completeDraft(user.accessToken, 'noop', propertyId);

      await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      expect(await rentalState(user.accessToken, propertyId)).toBe(PropertyState.Alquilado);
    });

    it('recorre Disponible → Reservado → Alquilado desde un borrador de propiedad', async () => {
      const user = await admin('path');
      const propertyId = await createProperty(user.accessToken);
      await createRentalOperation(user.accessToken, propertyId, PropertyState.Borrador);
      const contractId = await completeDraft(user.accessToken, 'path', propertyId);

      await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      expect(await rentalState(user.accessToken, propertyId)).toBe(PropertyState.Alquilado);
    });
  });

  // ─── Requisitos faltantes ────────────────────────────

  describe('requisitos faltantes', () => {
    it('rechaza con CONTRACT_NOT_ACTIVATABLE y lista cada problema', async () => {
      const user = await admin('miss');
      const propertyId = await createProperty(user.accessToken);
      await createRentalOperation(user.accessToken, propertyId, PropertyState.Disponible);
      const owner = await createPerson(user.accessToken, PersonRole.Propietario, 'miss-o@activation.test');
      const contractId = await createDraft(user.accessToken, propertyId, [
        { personId: owner, role: PersonRole.Propietario },
      ]);

      const res = await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);

      expect(res.body.error).toBe('CONTRACT_NOT_ACTIVATABLE');
      expect(res.body.problems.map((p: any) => p.code)).toEqual(['MISSING_INQUILINO']);

      // Nada cambió: el contrato sigue en Borrador y la propiedad en Disponible.
      const detail = await http()
        .get(`/api/contracts/${contractId}`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(200);
      expect(detail.body.status).toBe(ContractStatus.Borrador);
      expect(await rentalState(user.accessToken, propertyId)).toBe(PropertyState.Disponible);
    });

    it('informa a la vez que faltan propietario e inquilino', async () => {
      const user = await admin('both');
      const propertyId = await createProperty(user.accessToken);
      const garante = await createPerson(user.accessToken, PersonRole.Garante, 'both-g@activation.test');
      const contractId = await createDraft(user.accessToken, propertyId, [
        { personId: garante, role: PersonRole.Garante },
      ]);

      const res = await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);

      const codes = res.body.problems.map((p: any) => p.code);
      expect(codes).toEqual(expect.arrayContaining(['MISSING_PROPIETARIO', 'MISSING_INQUILINO']));
    });

    it('rechaza un alquiler que se pisa con otro contrato activo de la propiedad', async () => {
      const user = await admin('overlap');
      const propertyId = await createProperty(user.accessToken);
      const first = await completeDraft(user.accessToken, 'ov1', propertyId);
      const second = await completeDraft(user.accessToken, 'ov2', propertyId);

      await http()
        .post(`/api/contracts/${first}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      const res = await http()
        .post(`/api/contracts/${second}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);

      expect(res.body.error).toBe('CONTRACT_NOT_ACTIVATABLE');
      expect(res.body.problems).toEqual([
        expect.objectContaining({ code: 'OVERLAPPING_CONTRACT', contractId: first }),
      ]);
    });
  });

  // ─── Transición inválida ─────────────────────────────

  describe('transición inválida', () => {
    it('activar un contrato ya activo devuelve INVALID_TRANSITION con los destinos válidos', async () => {
      const user = await admin('inv');
      const propertyId = await createProperty(user.accessToken);
      const contractId = await completeDraft(user.accessToken, 'inv', propertyId);

      await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);

      const res = await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);

      expect(res.body.error).toBe('INVALID_TRANSITION');
      expect(res.body.validTransitions).toEqual(
        expect.arrayContaining(['Vencido', 'Rescindido', 'Renovado']),
      );
      expect(res.body.validTransitions).not.toContain('Activo');
    });

    it('un contrato rescindido no se puede reactivar', async () => {
      const user = await admin('resc');
      const propertyId = await createProperty(user.accessToken);
      const contractId = await completeDraft(user.accessToken, 'resc', propertyId);

      await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(201);
      await http()
        .post(`/api/contracts/${contractId}/terminate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .send({})
        .expect(201);

      const res = await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(400);
      expect(res.body.error).toBe('INVALID_TRANSITION');
      expect(res.body.validTransitions).toEqual(['Archivado']);
    });

    it('un contrato inexistente devuelve 404', async () => {
      const user = await admin('nf');
      const res = await http()
        .post('/api/contracts/00000000-0000-4000-8000-000000000000/activate')
        .set('Authorization', `Bearer ${user.accessToken}`)
        .expect(404);
      expect(res.body.error).toBe('CONTRACT_NOT_FOUND');
    });
  });

  // ─── RBAC ────────────────────────────────────────────

  describe('roles', () => {
    async function asRole(tenantId: string, role: UserRole) {
      const email = `${role.toLowerCase()}@activation-rbac.test`;
      await createUserDirect(prisma, tenantId, { email, password: 'Password123!', role });
      return loginUser(app, email, 'Password123!');
    }

    it.each([UserRole.Gerente, UserRole.Ventas])('%s puede activar un contrato', async (role) => {
      const owner = await admin(`rbac-${role}`);
      const propertyId = await createProperty(owner.accessToken);
      const contractId = await completeDraft(owner.accessToken, `rbac-${role}`, propertyId);
      const actor = await asRole(owner.user.tenantId, role);

      const res = await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${actor.accessToken}`)
        .expect(201);
      expect(res.body.status).toBe(ContractStatus.Activo);
    });

    it.each([UserRole.Lectura, UserRole.Liquidaciones, UserRole.Soporte, UserRole.Marketing])(
      '%s recibe 403 y el contrato no cambia',
      async (role) => {
        const owner = await admin(`deny-${role}`);
        const propertyId = await createProperty(owner.accessToken);
        const contractId = await completeDraft(owner.accessToken, `deny-${role}`, propertyId);
        const actor = await asRole(owner.user.tenantId, role);

        const res = await http()
          .post(`/api/contracts/${contractId}/activate`)
          .set('Authorization', `Bearer ${actor.accessToken}`)
          .expect(403);
        expect(res.body.error).toBe('FORBIDDEN');

        const detail = await http()
          .get(`/api/contracts/${contractId}`)
          .set('Authorization', `Bearer ${owner.accessToken}`)
          .expect(200);
        expect(detail.body.status).toBe(ContractStatus.Borrador);
      },
    );

    it('sin token recibe 401', async () => {
      await http()
        .post('/api/contracts/00000000-0000-4000-8000-000000000000/activate')
        .expect(401);
    });
  });

  // ─── Aislamiento entre inmobiliarias ─────────────────

  describe('aislamiento entre inmobiliarias', () => {
    it('otra inmobiliaria no puede activar el contrato y recibe 404', async () => {
      const t1 = await admin('iso1');
      const t2 = await admin('iso2');
      const propertyId = await createProperty(t1.accessToken);
      await createRentalOperation(t1.accessToken, propertyId, PropertyState.Disponible);
      const contractId = await completeDraft(t1.accessToken, 'iso', propertyId);

      const res = await http()
        .post(`/api/contracts/${contractId}/activate`)
        .set('Authorization', `Bearer ${t2.accessToken}`)
        .expect(404);
      expect(res.body.error).toBe('CONTRACT_NOT_FOUND');

      const detail = await http()
        .get(`/api/contracts/${contractId}`)
        .set('Authorization', `Bearer ${t1.accessToken}`)
        .expect(200);
      expect(detail.body.status).toBe(ContractStatus.Borrador);
      expect(await rentalState(t1.accessToken, propertyId)).toBe(PropertyState.Disponible);
    });
  });
});
