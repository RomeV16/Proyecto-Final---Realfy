import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  setupTestApp,
  cleanDatabase,
  teardownTestApp,
  registerUser,
  createPortalInvitation,
  portalSetPassword,
  portalLogin,
} from '../helpers/test-utils';
import { PrismaService } from '../../src/common/prisma/prisma.service';
import {
  PersonRole,
  ContractType,
  ContractStatus,
  AdjustmentType,
  AdjustmentPeriod,
  PropertyType,
  LiquidacionStatus,
} from '@realfy/shared';

describe('Portal Data (e2e)', () => {
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

  // ─── Helpers ──────────────────────────────────────────

  async function createProperty(token: string) {
    const res = await request(app.getHttpServer())
      .post('/api/properties')
      .set('Authorization', `Bearer ${token}`)
      .send({
        title: 'Depto Palermo',
        type: PropertyType.Departamento,
        street: 'Av. Santa Fe',
        number: '1234',
        city: 'Buenos Aires',
        province: 'CABA',
        area: 65,
        rooms: 2,
        bedrooms: 1,
        bathrooms: 1,
        price: 100000,
        currency: 'USD',
      })
      .expect(201);
    return res.body;
  }

  async function createPersonWithRole(
    token: string,
    overrides: { firstName: string; lastName: string; role: PersonRole; email?: string },
  ) {
    const personRes = await request(app.getHttpServer())
      .post('/api/persons')
      .set('Authorization', `Bearer ${token}`)
      .send({
        firstName: overrides.firstName,
        lastName: overrides.lastName,
        email: overrides.email ?? `${overrides.firstName.toLowerCase()}@test.com`,
      })
      .expect(201);

    await request(app.getHttpServer())
      .post(`/api/persons/${personRes.body.id}/roles`)
      .set('Authorization', `Bearer ${token}`)
      .send({ role: overrides.role })
      .expect(201);

    return personRes.body;
  }

  /**
   * Full setup: register staff, create property, propietario, inquilino,
   * contract, portal credential, and login the inquilino.
   */
  async function setupPortalWithContract(emailPrefix: string) {
    const staff = await registerUser(app, {
      email: `${emailPrefix}-staff@test.com`,
      password: 'Password123!',
      firstName: 'Admin',
      lastName: 'Staff',
    });

    const property = await createProperty(staff.accessToken);

    const propietario = await createPersonWithRole(staff.accessToken, {
      firstName: 'Carlos',
      lastName: 'Propietario',
      role: PersonRole.Propietario,
      email: `${emailPrefix}-prop@test.com`,
    });

    const inquilino = await createPersonWithRole(staff.accessToken, {
      firstName: 'Ana',
      lastName: 'Inquilina',
      role: PersonRole.Inquilino,
      email: `${emailPrefix}-inq@test.com`,
    });

    const contractRes = await request(app.getHttpServer())
      .post('/api/contracts')
      .set('Authorization', `Bearer ${staff.accessToken}`)
      .send({
        propertyId: property.id,
        contractType: ContractType.Alquiler,
        status: ContractStatus.Activo,
        startDate: '2025-01-01T00:00:00.000Z',
        endDate: '2027-01-01T00:00:00.000Z',
        rentAmount: '150000.00',
        rentCurrency: 'ARS',
        depositAmount: '300000.00',
        depositCurrency: 'ARS',
        adjustmentType: AdjustmentType.IPC,
        adjustmentPeriod: AdjustmentPeriod.Trimestral,
        notes: 'Contrato test',
        persons: [
          { personId: propietario.id, role: PersonRole.Propietario },
          { personId: inquilino.id, role: PersonRole.Inquilino },
        ],
        guarantees: [],
      })
      .expect(201);

    // Create portal invitation and set password
    const invitation = await createPortalInvitation(
      app,
      staff.accessToken,
      inquilino.id,
    );

    const pwResult = await portalSetPassword(
      app,
      invitation.token,
      'PortalPass123!',
    );

    // Login via portal to get fresh tokens
    const loginResult = await portalLogin(
      app,
      `${emailPrefix}-inq@test.com`,
      'PortalPass123!',
    );

    return {
      staff,
      property,
      propietario,
      inquilino,
      contract: contractRes.body,
      portalTokens: loginResult.tokens,
      inquilinoEmail: `${emailPrefix}-inq@test.com`,
    };
  }

  // ─── Contract Scoping ────────────────────────────────

  describe('Contract scoping', () => {
    it('GET /portal/contract returns only inquilino own contracts', async () => {
      const setup = await setupPortalWithContract('contract-scope');

      const res = await request(app.getHttpServer())
        .get('/api/portal/contract')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      expect(res.body).toBeInstanceOf(Array);
      expect(res.body.length).toBe(1);
      expect(res.body[0].id).toBe(setup.contract.id);
      expect(res.body[0].propertyId).toBe(setup.property.id);
      expect(res.body[0].rentAmount).toBeDefined();
    });

    it('portal user does NOT see contracts they are not part of', async () => {
      // Setup two independent tenants with contracts
      const setupA = await setupPortalWithContract('scope-a');

      // Register a second staff in a different tenant
      const staffB = await registerUser(app, {
        email: 'scope-b-staff@test.com',
        password: 'Password123!',
        firstName: 'Staff',
        lastName: 'B',
      });

      const propB = await createProperty(staffB.accessToken);
      const propietarioB = await createPersonWithRole(staffB.accessToken, {
        firstName: 'Bob',
        lastName: 'PropB',
        role: PersonRole.Propietario,
        email: 'scope-b-prop@test.com',
      });
      const inquilinoB = await createPersonWithRole(staffB.accessToken, {
        firstName: 'Bea',
        lastName: 'InqB',
        role: PersonRole.Inquilino,
        email: 'scope-b-inq@test.com',
      });

      await request(app.getHttpServer())
        .post('/api/contracts')
        .set('Authorization', `Bearer ${staffB.accessToken}`)
        .send({
          propertyId: propB.id,
          contractType: ContractType.Alquiler,
          status: ContractStatus.Activo,
          startDate: '2025-01-01T00:00:00.000Z',
          endDate: '2027-01-01T00:00:00.000Z',
          rentAmount: '200000.00',
          rentCurrency: 'ARS',
          depositAmount: '400000.00',
          depositCurrency: 'ARS',
          adjustmentType: AdjustmentType.IPC,
          adjustmentPeriod: AdjustmentPeriod.Trimestral,
          persons: [
            { personId: propietarioB.id, role: PersonRole.Propietario },
            { personId: inquilinoB.id, role: PersonRole.Inquilino },
          ],
          guarantees: [],
        })
        .expect(201);

      // Inquilino A should only see their contract
      const res = await request(app.getHttpServer())
        .get('/api/portal/contract')
        .set('Authorization', `Bearer ${setupA.portalTokens.accessToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(setupA.contract.id);
    });
  });

  // ─── Liquidaciones Scoping ──────────────────────────

  describe('Liquidaciones scoping', () => {
    it('GET /portal/liquidaciones returns only liquidaciones for inquilino contracts', async () => {
      const setup = await setupPortalWithContract('liq-scope');

      // Generate liquidaciones as staff
      await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${setup.staff.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(201);

      const res = await request(app.getHttpServer())
        .get('/api/portal/liquidaciones')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      expect(res.body.items).toBeInstanceOf(Array);
      expect(res.body.items.length).toBe(1);
      expect(res.body.total).toBe(1);
      expect(res.body.page).toBe(1);
    });

    it('GET /portal/liquidaciones returns empty for inquilino with no contracts', async () => {
      // Setup a portal user with a contract first, then setup another user without one
      const staffSetup = await registerUser(app, {
        email: 'liq-empty-staff@test.com',
        password: 'Password123!',
        firstName: 'Admin',
        lastName: 'Staff',
      });

      const person = await createPersonWithRole(staffSetup.accessToken, {
        firstName: 'Solo',
        lastName: 'Inquilino',
        role: PersonRole.Inquilino,
        email: 'liq-empty-inq@test.com',
      });

      const invitation = await createPortalInvitation(
        app,
        staffSetup.accessToken,
        person.id,
      );

      await portalSetPassword(app, invitation.token, 'PortalPass123!');

      const loginResult = await portalLogin(
        app,
        'liq-empty-inq@test.com',
        'PortalPass123!',
      );

      const res = await request(app.getHttpServer())
        .get('/api/portal/liquidaciones')
        .set('Authorization', `Bearer ${loginResult.tokens.accessToken}`)
        .expect(200);

      expect(res.body.items).toHaveLength(0);
      expect(res.body.total).toBe(0);
    });

    it('portal liquidaciones support pagination', async () => {
      const setup = await setupPortalWithContract('liq-pag');

      // Generate liquidaciones for two months
      await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${setup.staff.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(201);

      await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${setup.staff.accessToken}`)
        .send({ month: 2, year: 2026 })
        .expect(201);

      // Page 1 with limit 1
      const page1 = await request(app.getHttpServer())
        .get('/api/portal/liquidaciones?page=1&limit=1')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      expect(page1.body.items).toHaveLength(1);
      expect(page1.body.total).toBe(2);
      expect(page1.body.totalPages).toBe(2);

      // Page 2 with limit 1
      const page2 = await request(app.getHttpServer())
        .get('/api/portal/liquidaciones?page=2&limit=1')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      expect(page2.body.items).toHaveLength(1);
      expect(page2.body.total).toBe(2);
    });
  });

  // ─── PDF Download ───────────────────────────────────

  describe('PDF download', () => {
    it('GET /portal/liquidaciones/:id/pdf downloads PDF for own liquidacion', async () => {
      const setup = await setupPortalWithContract('pdf-dl');

      // Generate liquidaciones as staff
      await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${setup.staff.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(201);

      // Get the liquidacion ID
      const liqRes = await request(app.getHttpServer())
        .get('/api/portal/liquidaciones')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      const liquidacionId = liqRes.body.items[0].id;

      const pdfRes = await request(app.getHttpServer())
        .get(`/api/portal/liquidaciones/${liquidacionId}/pdf`)
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(200);

      expect(pdfRes.headers['content-type']).toBe('application/pdf');
      expect(pdfRes.headers['content-disposition']).toContain('liquidacion-');
      expect(pdfRes.body).toBeInstanceOf(Buffer);
    });

    it('GET /portal/liquidaciones/:id/pdf rejects non-existent liquidacion', async () => {
      const setup = await setupPortalWithContract('pdf-404');

      await request(app.getHttpServer())
        .get('/api/portal/liquidaciones/non-existent-uuid/pdf')
        .set('Authorization', `Bearer ${setup.portalTokens.accessToken}`)
        .expect(404);
    });
  });

  // ─── Cross-Tenant Isolation ─────────────────────────

  describe('Cross-tenant isolation', () => {
    it('inquilino from tenant A cannot see contracts from tenant B', async () => {
      // Tenant A setup
      const setupA = await setupPortalWithContract('xtenant-a');

      // Tenant B setup with its own contract
      const staffB = await registerUser(app, {
        email: 'xtenant-b-staff@test.com',
        password: 'Password123!',
        firstName: 'Staff',
        lastName: 'B',
      });

      const propB = await createProperty(staffB.accessToken);
      const propietarioB = await createPersonWithRole(staffB.accessToken, {
        firstName: 'Bob',
        lastName: 'PropB',
        role: PersonRole.Propietario,
        email: 'xtenant-b-prop@test.com',
      });
      const inquilinoB = await createPersonWithRole(staffB.accessToken, {
        firstName: 'Bea',
        lastName: 'InqB',
        role: PersonRole.Inquilino,
        email: 'xtenant-b-inq@test.com',
      });

      await request(app.getHttpServer())
        .post('/api/contracts')
        .set('Authorization', `Bearer ${staffB.accessToken}`)
        .send({
          propertyId: propB.id,
          contractType: ContractType.Alquiler,
          status: ContractStatus.Activo,
          startDate: '2025-01-01T00:00:00.000Z',
          endDate: '2027-01-01T00:00:00.000Z',
          rentAmount: '200000.00',
          rentCurrency: 'ARS',
          depositAmount: '400000.00',
          depositCurrency: 'ARS',
          adjustmentType: AdjustmentType.IPC,
          adjustmentPeriod: AdjustmentPeriod.Trimestral,
          persons: [
            { personId: propietarioB.id, role: PersonRole.Propietario },
            { personId: inquilinoB.id, role: PersonRole.Inquilino },
          ],
          guarantees: [],
        })
        .expect(201);

      // Inquilino A's portal token should NOT see B's contracts
      const res = await request(app.getHttpServer())
        .get('/api/portal/contract')
        .set('Authorization', `Bearer ${setupA.portalTokens.accessToken}`)
        .expect(200);

      expect(res.body).toHaveLength(1);
      expect(res.body[0].id).toBe(setupA.contract.id);
    });

    it('inquilino from tenant A cannot access PDF from tenant B liquidacion', async () => {
      const setupA = await setupPortalWithContract('xtenant-pdf-a');

      // Tenant B setup
      const setupB = await setupPortalWithContract('xtenant-pdf-b');

      // Generate liquidaciones for B
      await request(app.getHttpServer())
        .post('/api/liquidaciones/generate')
        .set('Authorization', `Bearer ${setupB.staff.accessToken}`)
        .send({ month: 3, year: 2026 })
        .expect(201);

      // Get B's liquidacion ID via staff
      const bLiqRes = await request(app.getHttpServer())
        .get('/api/liquidaciones')
        .set('Authorization', `Bearer ${setupB.staff.accessToken}`)
        .expect(200);

      const bLiqId = bLiqRes.body.items[0].id;

      // Tenant A's portal user tries to access B's PDF
      const res = await request(app.getHttpServer())
        .get(`/api/portal/liquidaciones/${bLiqId}/pdf`)
        .set('Authorization', `Bearer ${setupA.portalTokens.accessToken}`);

      // Should be 403 (access denied) or 404 (not found via tenant scoping)
      expect([403, 404]).toContain(res.status);
    });
  });
});
